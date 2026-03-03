"""
SuperBot Platform - Router de Canais Multi-Canal
Processa mensagens de WhatsApp, Instagram, Messenger
Implementa queries reais no banco (channels, projects, project_secrets)
"""
import json
import logging
import httpx
from typing import Optional
from uuid import uuid4
from datetime import datetime, timezone

from sqlalchemy import text as sa_text
from sqlalchemy.ext.asyncio import AsyncSession

from app.integrations.gemini import GeminiClient, GeminiRAGManager
from app.integrations.elevenlabs import ElevenLabsManager

logger = logging.getLogger("superbot.channel_router")


class ChannelRouter:
    """
    Roteador de mensagens multi-canal.

    Processa mensagens de:
    - WhatsApp (via Meta API)
    - Instagram DM
    - Messenger

    E executa:
    - Busca RAG (project_knowledge_base ou Gemini File Search)
    - Geração de resposta (Gemini)
    - Execução de tools (webhooks n8n)
    - TTS (ElevenLabs)
    """

    def __init__(
        self,
        db: AsyncSession,
        gemini_client: GeminiClient,
        rag_manager: GeminiRAGManager,
        elevenlabs_manager: ElevenLabsManager
    ):
        self.db = db
        self.gemini = gemini_client
        self.rag = rag_manager
        self.tts = elevenlabs_manager

    async def process_message(
        self,
        channel: str,
        sender_id: str,
        message_text: str,
        channel_identifier: str,
        audio_url: Optional[str] = None,
        metadata: Optional[dict] = None
    ) -> dict:
        """
        Processa uma mensagem de qualquer canal.

        Args:
            channel: Tipo do canal (whatsapp, instagram, messenger)
            sender_id: ID do remetente (phone number, IGSID, PSID)
            message_text: Texto da mensagem
            channel_identifier: phone_number_id, page_id, etc
            audio_url: URL de áudio (se for mensagem de voz)
            metadata: Metadados adicionais

        Returns:
            dict com text, audio_url (se aplicável), tool_executed, project_id
        """
        # 1. Resolve channel -> project -> config
        agent = await self._get_agent_for_channel(channel, channel_identifier)

        if not agent:
            logger.warning(f"No agent for channel={channel} identifier={channel_identifier}")
            return {
                "error": "No agent configured for this channel",
                "channel": channel,
                "channel_identifier": channel_identifier
            }

        project_id = agent["project_id"]

        # 2. Salva mensagem de entrada
        await self._save_message(
            project_id=project_id,
            channel_type=channel,
            channel_identifier=channel_identifier,
            conversation_id=sender_id,
            direction="in",
            message_type="text",
            text=message_text,
            raw_payload=metadata
        )

        # 3. Verifica se conversa está em handoff (atendimento humano)
        state = await self._get_conversation_state(project_id, channel, sender_id)
        if state and state.get("status") == "handoff":
            human_until = (state.get("metadata") or {}).get("human_takeover_until")
            if human_until:
                try:
                    until_dt = datetime.fromisoformat(human_until)
                    if datetime.now(timezone.utc) < until_dt:
                        logger.info(f"Conversation {sender_id} in handoff mode, skipping AI")
                        return {
                            "text": None,
                            "skipped": True,
                            "reason": "handoff_active",
                            "project_id": str(project_id)
                        }
                except (ValueError, TypeError):
                    pass

        # 4. Busca contexto RAG (project_knowledge_base)
        rag_context = await self._query_rag(project_id, message_text)

        # 5. Busca histórico da conversa (últimas 20 msgs)
        history = await self._get_conversation_history(
            project_id=project_id,
            channel_type=channel,
            conversation_id=sender_id,
            limit=20
        )

        # 6. Monta mensagens para o LLM
        messages = self._build_messages(
            agent=agent,
            history=history,
            user_message=message_text,
            rag_context=rag_context
        )

        # 7. Busca tools do agente (project_tools_knowledge)
        tools = await self._get_agent_tools(project_id)

        # 8. Gera resposta com Gemini
        response = await self.gemini.chat(
            messages=messages,
            model=agent.get("llm_model", "gemini-2.0-flash"),
            tools=tools if tools else None,
            temperature=0.7
        )

        tool_executed = None

        # 9. Executa tools se necessário
        if response.get("tool_calls"):
            for tool_call in response["tool_calls"]:
                tool_result = await self._execute_tool(
                    project_id=project_id,
                    tool_name=tool_call["name"],
                    params=tool_call["params"],
                    context={
                        "conversation_id": sender_id,
                        "channel_type": channel,
                        "project_id": str(project_id)
                    }
                )

                tool_executed = {
                    "name": tool_call["name"],
                    "params": tool_call["params"],
                    "result": tool_result
                }

                # Gera resposta final com resultado da tool
                response = await self.gemini.chat_with_tool_result(
                    messages=messages,
                    tool_name=tool_call["name"],
                    tool_result=tool_result,
                    model=agent.get("llm_model", "gemini-2.0-flash")
                )

        response_text = response.get("text", "")

        # 10. Gera áudio se configurado
        audio_url_response = None
        if agent.get("send_audio", False) and response_text:
            try:
                audio_path = await self.tts.text_to_speech(
                    text=response_text,
                    voice_id=agent["voice_id"]
                )
                audio_url_response = audio_path
            except Exception as e:
                logger.error(f"TTS error: {e}")

        # 11. Salva resposta no histórico
        await self._save_message(
            project_id=project_id,
            channel_type=channel,
            channel_identifier=channel_identifier,
            conversation_id=sender_id,
            direction="out",
            message_type="ai_reply",
            text=response_text,
            raw_payload={"model": response.get("model"), "tool": tool_executed}
        )

        # 12. Atualiza conversation_state
        await self._update_conversation_state(
            project_id=project_id,
            channel_type=channel,
            channel_identifier=channel_identifier,
            conversation_id=sender_id,
            ai_response=response_text,
            ai_state=state.get("ai_state") if state else None
        )

        return {
            "text": response_text,
            "audio_url": audio_url_response,
            "model_used": response.get("model"),
            "tool_executed": tool_executed,
            "citations": response.get("citations", []),
            "project_id": str(project_id),
            "access_token": agent.get("access_token")
        }

    def _build_messages(
        self,
        agent: dict,
        history: list,
        user_message: str,
        rag_context: str = ""
    ) -> list:
        """Monta lista de mensagens para o LLM."""

        system_prompt = agent.get("system_prompt", "You are a helpful assistant.")

        # Adiciona contexto RAG ao system prompt
        if rag_context:
            system_prompt += f"\n\n## Contexto Relevante (use para responder):\n{rag_context}"

        messages = [{"role": "system", "content": system_prompt}]

        # Adiciona histórico
        for msg in history:
            messages.append({
                "role": msg["role"],
                "content": msg["content"]
            })

        # Adiciona mensagem atual
        messages.append({"role": "user", "content": user_message})

        return messages

    # ==================== Database Methods (REAL) ====================

    async def _get_agent_for_channel(
        self, channel_type: str, channel_identifier: str
    ) -> Optional[dict]:
        """
        Resolve channel_identifier -> project -> agent config.

        Queries: channels + projects + project_secrets
        Returns agent dict with system_prompt, llm_model, tools config, access_token
        """
        result = await self.db.execute(
            sa_text("""
                SELECT
                    c.id AS channel_id,
                    c.project_id,
                    c.channel_type,
                    c.channel_identifier,
                    c.access_token,
                    p.project_slug,
                    p.agent_workflow_id,
                    p.webhook_path,
                    ps.gemini_api_key,
                    ps.openrouter_api_key,
                    ps.meta_master_token,
                    ps.followup_enabled,
                    ps.followup_config
                FROM channels c
                JOIN projects p ON p.id = c.project_id
                LEFT JOIN project_secrets ps ON ps.project_id = c.project_id
                WHERE c.channel_identifier = :identifier
                  AND c.channel_type = :channel_type
                LIMIT 1
            """),
            {"identifier": channel_identifier, "channel_type": channel_type}
        )
        row = result.mappings().first()

        if not row:
            # Fallback: try matching just channel_identifier (some channels share identifiers)
            result = await self.db.execute(
                sa_text("""
                    SELECT
                        c.id AS channel_id,
                        c.project_id,
                        c.channel_type,
                        c.channel_identifier,
                        c.access_token,
                        p.project_slug,
                        p.agent_workflow_id,
                        p.webhook_path,
                        ps.gemini_api_key,
                        ps.openrouter_api_key,
                        ps.meta_master_token,
                        ps.followup_enabled,
                        ps.followup_config
                    FROM channels c
                    JOIN projects p ON p.id = c.project_id
                    LEFT JOIN project_secrets ps ON ps.project_id = c.project_id
                    WHERE c.channel_identifier = :identifier
                    LIMIT 1
                """),
                {"identifier": channel_identifier}
            )
            row = result.mappings().first()

        if not row:
            return None

        # Build system prompt from n8n_chat_histories or project_knowledge_base
        system_prompt = await self._load_system_prompt(row["project_id"], row["project_slug"])

        # Access token: channel-specific or master
        access_token = row["access_token"] or row.get("meta_master_token") or ""

        return {
            "id": str(row["channel_id"]),
            "project_id": row["project_id"],
            "project_slug": row["project_slug"],
            "channel_type": row["channel_type"],
            "channel_identifier": row["channel_identifier"],
            "access_token": access_token,
            "system_prompt": system_prompt,
            "llm_model": "gemini-2.0-flash",
            "send_audio": False,
            "voice_id": None,
            "rag_store_id": None,
            "agent_workflow_id": row.get("agent_workflow_id"),
            "webhook_path": row.get("webhook_path"),
            "followup_enabled": row.get("followup_enabled", False),
        }

    async def _load_system_prompt(self, project_id, project_slug: str) -> str:
        """
        Load system prompt. Priority:
        1. agents table (if exists and has active agent)
        2. project_knowledge_base
        3. Default prompt
        """
        # 1. Try agents table first
        try:
            agent_result = await self.db.execute(
                sa_text("""
                    SELECT system_prompt, llm_model FROM agents
                    WHERE project_id = :pid AND is_active = true
                    LIMIT 1
                """),
                {"pid": str(project_id)}
            )
            agent_row = agent_result.mappings().first()
            if agent_row and agent_row["system_prompt"]:
                return agent_row["system_prompt"]
        except Exception:
            # agents table may not exist yet
            pass

        # 2. Try project_knowledge_base
        result = await self.db.execute(
            sa_text("""
                SELECT content FROM project_knowledge_base
                WHERE project_id = :pid
                ORDER BY created_at ASC
            """),
            {"pid": str(project_id)}
        )
        rows = result.all()

        if rows:
            return "\n\n".join(r[0] for r in rows if r[0])

        # 3. Default
        return (
            f"Você é o assistente virtual do projeto {project_slug or 'SuperBot'}. "
            "Responda de forma profissional, amigável e direta. "
            "Se não souber a resposta, diga que vai verificar e retornará."
        )

    async def _get_conversation_state(
        self, project_id, channel_type: str, conversation_id: str
    ) -> Optional[dict]:
        """Busca estado atual da conversa."""
        result = await self.db.execute(
            sa_text("""
                SELECT status, ai_state, ai_reason, summary_short,
                       followup_stage, metadata, last_event_at
                FROM conversation_states
                WHERE project_id = :pid
                  AND channel_type = :ct
                  AND conversation_id = :cid
            """),
            {"pid": str(project_id), "ct": channel_type, "cid": conversation_id}
        )
        row = result.mappings().first()
        if not row:
            return None
        return dict(row)

    async def _get_conversation_history(
        self,
        project_id,
        channel_type: str,
        conversation_id: str,
        limit: int = 20
    ) -> list:
        """Busca histórico da conversa de conversation_events."""
        result = await self.db.execute(
            sa_text("""
                SELECT direction, text, message_type,
                       COALESCE(event_created_at, created_at) AS ts
                FROM conversation_events
                WHERE project_id = :pid
                  AND channel_type = :ct
                  AND conversation_id = :cid
                  AND text IS NOT NULL
                  AND text != ''
                  AND direction IN ('in', 'out')
                ORDER BY COALESCE(event_created_at, created_at) DESC
                LIMIT :lim
            """),
            {"pid": str(project_id), "ct": channel_type, "cid": conversation_id, "lim": limit}
        )
        rows = result.mappings().all()

        # Converter para formato LLM (reverter ordem para cronológica)
        messages = []
        for row in reversed(rows):
            role = "user" if row["direction"] == "in" else "assistant"
            content = row["text"]
            if content:
                messages.append({"role": role, "content": content})

        return messages

    async def _save_message(
        self,
        project_id,
        channel_type: str,
        channel_identifier: str,
        conversation_id: str,
        direction: str,
        message_type: str,
        text: str,
        raw_payload: dict = None
    ):
        """Salva mensagem em conversation_events."""
        await self.db.execute(
            sa_text("""
                INSERT INTO conversation_events
                    (id, project_id, channel_type, channel_identifier,
                     conversation_id, direction, message_type, text, raw_payload)
                VALUES
                    (gen_random_uuid(), :pid, :ct, :ci, :cid, :dir, :mt, :txt, CAST(:rp AS jsonb))
            """),
            {
                "pid": str(project_id),
                "ct": channel_type,
                "ci": channel_identifier,
                "cid": conversation_id,
                "dir": direction,
                "mt": message_type,
                "txt": text,
                "rp": json.dumps(raw_payload) if raw_payload else None
            }
        )

    async def _update_conversation_state(
        self,
        project_id,
        channel_type: str,
        channel_identifier: str,
        conversation_id: str,
        ai_response: str,
        ai_state: str = None
    ):
        """Atualiza ou cria conversation_state."""
        now = datetime.now(timezone.utc).isoformat()
        summary = ai_response[:200] if ai_response else None

        await self.db.execute(
            sa_text("""
                INSERT INTO conversation_states
                    (project_id, channel_type, conversation_id, channel_identifier,
                     status, last_event_at, last_out_at, last_direction,
                     last_message_type, last_text, summary_short, updated_at)
                VALUES
                    (CAST(:pid AS uuid), :ct, :cid, :ci,
                     'open', CAST(:now AS timestamptz), CAST(:now AS timestamptz), 'out',
                     'ai_reply', :txt, :summary, CAST(:now AS timestamptz))
                ON CONFLICT (project_id, channel_type, conversation_id)
                DO UPDATE SET
                    last_event_at = CAST(:now AS timestamptz),
                    last_out_at = CAST(:now AS timestamptz),
                    last_direction = 'out',
                    last_message_type = 'ai_reply',
                    last_text = :txt,
                    summary_short = COALESCE(:summary, conversation_states.summary_short),
                    status = CASE
                        WHEN conversation_states.status = 'closed' THEN 'open'
                        ELSE conversation_states.status
                    END,
                    updated_at = CAST(:now AS timestamptz)
            """),
            {
                "pid": str(project_id),
                "ct": channel_type,
                "cid": conversation_id,
                "ci": channel_identifier,
                "now": now,
                "txt": ai_response[:500] if ai_response else None,
                "summary": summary
            }
        )

    async def _query_rag(self, project_id, query: str) -> str:
        """Query RAG from project_knowledge_base (simple keyword match)."""
        result = await self.db.execute(
            sa_text("""
                SELECT content FROM project_knowledge_base
                WHERE project_id = :pid
                  AND content IS NOT NULL
                ORDER BY created_at ASC
            """),
            {"pid": str(project_id)}
        )
        rows = result.all()
        if not rows:
            return ""

        # Return all knowledge base content as context (simple approach)
        # For production, this should use vector similarity search
        chunks = [r[0] for r in rows if r[0]]
        if not chunks:
            return ""

        # Limit to ~4000 chars to fit in context
        combined = "\n---\n".join(chunks)
        return combined[:4000]

    async def _get_agent_tools(self, project_id) -> list:
        """Busca tools do project_tools_knowledge formatadas para LLM."""
        result = await self.db.execute(
            sa_text("""
                SELECT tool_name, instructions, api_endpoint
                FROM project_tools_knowledge
                WHERE project_id = :pid
            """),
            {"pid": str(project_id)}
        )
        rows = result.mappings().all()

        tools = []
        for row in rows:
            # Parse instructions to extract parameters if possible
            tools.append({
                "name": row["tool_name"],
                "description": row["instructions"] or "",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "data": {
                            "type": "string",
                            "description": "JSON data to send to the tool"
                        }
                    },
                    "required": []
                }
            })

        return tools

    async def _execute_tool(
        self,
        project_id,
        tool_name: str,
        params: dict,
        context: dict = None
    ) -> dict:
        """Executa tool via webhook (project_tools_knowledge.api_endpoint)."""
        result = await self.db.execute(
            sa_text("""
                SELECT api_endpoint FROM project_tools_knowledge
                WHERE project_id = :pid AND tool_name = :name
                LIMIT 1
            """),
            {"pid": str(project_id), "name": tool_name}
        )
        row = result.scalar_one_or_none()

        if not row:
            return {"error": f"Tool '{tool_name}' not found"}

        webhook_url = row
        if not webhook_url:
            return {"error": f"Tool '{tool_name}' has no endpoint configured"}

        try:
            payload = {**params}
            if context:
                payload["_context"] = context

            async with httpx.AsyncClient(timeout=30) as client:
                response = await client.post(
                    webhook_url,
                    json=payload,
                    headers={"Content-Type": "application/json"}
                )

                if response.status_code == 200:
                    try:
                        return response.json()
                    except Exception:
                        return {"result": response.text}
                else:
                    return {
                        "error": f"Tool returned status {response.status_code}",
                        "body": response.text[:500]
                    }
        except Exception as e:
            logger.error(f"Tool execution error: {e}")
            return {"error": str(e)}


class MetaWebhookHandler:
    """
    Handler para webhooks da Meta (WhatsApp, Instagram, Messenger).
    Resolve channel_identifier dinamicamente do banco.
    """

    META_API_VERSION = "v21.0"

    def __init__(self, verify_token: str):
        self.verify_token = verify_token

    def verify_webhook(self, mode: str, token: str, challenge: str) -> Optional[str]:
        """Verifica webhook da Meta."""
        if mode == "subscribe" and token == self.verify_token:
            return challenge
        return None

    async def process_webhook(
        self,
        payload: dict,
        router: ChannelRouter
    ) -> list:
        """
        Processa webhook da Meta e retorna respostas para enviar.

        Returns:
            Lista de dicts com channel, to, response, access_token
        """
        responses = []

        for entry in payload.get("entry", []):
            # WhatsApp
            if "changes" in entry:
                for change in entry["changes"]:
                    if change.get("field") == "messages":
                        value = change.get("value", {})

                        # Skip status updates (delivered, read, etc)
                        if value.get("statuses"):
                            continue

                        for message in value.get("messages", []):
                            result = await self._handle_whatsapp_message(
                                message=message,
                                metadata=value.get("metadata", {}),
                                router=router
                            )
                            if result:
                                responses.append(result)

            # Messenger / Instagram
            if "messaging" in entry:
                for messaging in entry["messaging"]:
                    # Skip echoes, reads, deliveries
                    if messaging.get("read") or messaging.get("delivery"):
                        continue
                    if messaging.get("message", {}).get("is_echo"):
                        continue

                    result = await self._handle_messenger_message(
                        messaging=messaging,
                        page_id=entry.get("id"),
                        router=router
                    )
                    if result:
                        responses.append(result)

        return responses

    async def _handle_whatsapp_message(
        self, message: dict, metadata: dict, router: ChannelRouter
    ) -> Optional[dict]:
        """Processa mensagem do WhatsApp."""
        msg_type = message.get("type")
        sender = message.get("from")
        phone_number_id = metadata.get("phone_number_id")

        if not sender or not phone_number_id:
            return None

        text = ""
        audio_url = None

        if msg_type == "text":
            text = message.get("text", {}).get("body", "")
        elif msg_type == "audio":
            audio_url = message.get("audio", {}).get("id")
            text = "[Áudio recebido]"
        elif msg_type == "image":
            caption = message.get("image", {}).get("caption", "")
            text = caption or "[Imagem recebida]"
        elif msg_type == "interactive":
            # Button reply or list reply
            btn = message.get("interactive", {}).get("button_reply", {})
            lst = message.get("interactive", {}).get("list_reply", {})
            text = btn.get("title") or lst.get("title") or "[Interação]"
        elif msg_type == "reaction":
            # Skip reactions
            return None
        else:
            text = f"[{msg_type}]"

        if not text:
            return None

        # Processa com o router (queries reais no banco)
        result = await router.process_message(
            channel="whatsapp",
            sender_id=sender,
            message_text=text,
            channel_identifier=phone_number_id,
            audio_url=audio_url,
            metadata={"phone_number_id": phone_number_id, "raw": message}
        )

        if result.get("skipped") or result.get("error"):
            return None

        return {
            "channel": "whatsapp",
            "to": sender,
            "phone_number_id": phone_number_id,
            "access_token": result.get("access_token", ""),
            "response": result
        }

    async def _handle_messenger_message(
        self, messaging: dict, page_id: str, router: ChannelRouter
    ) -> Optional[dict]:
        """Processa mensagem do Messenger/Instagram."""
        sender = messaging.get("sender", {}).get("id")
        message = messaging.get("message", {})

        if not message or not sender:
            return None

        text = message.get("text", "")
        if not text:
            # Check for attachments
            attachments = message.get("attachments", [])
            if attachments:
                text = f"[{attachments[0].get('type', 'attachment')}]"
            else:
                return None

        # Determine channel type based on the webhook structure
        # Instagram webhooks have "instagram" in the object field
        channel = "instagram" if messaging.get("_channel") == "instagram" else "messenger"

        result = await router.process_message(
            channel=channel,
            sender_id=sender,
            message_text=text,
            channel_identifier=page_id,
            metadata={"page_id": page_id, "raw": messaging}
        )

        if result.get("skipped") or result.get("error"):
            return None

        return {
            "channel": channel,
            "to": sender,
            "page_id": page_id,
            "access_token": result.get("access_token", ""),
            "response": result
        }

    @staticmethod
    async def send_response(response_item: dict):
        """Envia resposta de volta ao canal correto via Meta API."""
        channel = response_item["channel"]
        text = response_item.get("response", {}).get("text", "")
        access_token = response_item.get("access_token", "")

        if not text or not access_token:
            return

        api_version = MetaWebhookHandler.META_API_VERSION

        async with httpx.AsyncClient(timeout=15) as client:
            if channel == "whatsapp":
                phone_number_id = response_item["phone_number_id"]
                await client.post(
                    f"https://graph.facebook.com/{api_version}/{phone_number_id}/messages",
                    headers={"Authorization": f"Bearer {access_token}"},
                    json={
                        "messaging_product": "whatsapp",
                        "recipient_type": "individual",
                        "to": response_item["to"],
                        "type": "text",
                        "text": {"body": text}
                    }
                )

                # Send audio if available
                audio_url = response_item.get("response", {}).get("audio_url")
                if audio_url:
                    await client.post(
                        f"https://graph.facebook.com/{api_version}/{phone_number_id}/messages",
                        headers={"Authorization": f"Bearer {access_token}"},
                        json={
                            "messaging_product": "whatsapp",
                            "to": response_item["to"],
                            "type": "audio",
                            "audio": {"link": audio_url}
                        }
                    )

            elif channel in ("messenger", "instagram"):
                page_id = response_item.get("page_id", "me")
                await client.post(
                    f"https://graph.facebook.com/{api_version}/{page_id}/messages",
                    params={"access_token": access_token},
                    json={
                        "recipient": {"id": response_item["to"]},
                        "message": {"text": text}
                    }
                )
