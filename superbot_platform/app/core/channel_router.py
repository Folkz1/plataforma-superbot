"""
SuperBot Platform - Router de Canais Multi-Canal
Processa mensagens de WhatsApp, Instagram, Messenger
"""
import json
import httpx
from typing import Optional
from uuid import uuid4

from app.integrations.gemini import GeminiClient, GeminiRAGManager
from app.integrations.elevenlabs import ElevenLabsManager


class ChannelRouter:
    """
    Roteador de mensagens multi-canal.
    
    Processa mensagens de:
    - WhatsApp (via Meta API ou Evolution API)
    - Instagram DM
    - Messenger
    
    E executa:
    - Busca RAG (Gemini File Search)
    - Geração de resposta (Gemini)
    - Execução de tools (webhooks n8n)
    - TTS (ElevenLabs)
    """
    
    def __init__(
        self,
        db,  # Database session
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
        audio_url: Optional[str] = None,
        metadata: Optional[dict] = None
    ) -> dict:
        """
        Processa uma mensagem de qualquer canal.
        
        Args:
            channel: Tipo do canal (whatsapp, instagram, messenger)
            sender_id: ID do remetente
            message_text: Texto da mensagem
            audio_url: URL de áudio (se for mensagem de voz)
            metadata: Metadados adicionais (phone_number_id, page_id, etc)
        
        Returns:
            dict com text, audio_url (se aplicável), tool_executed
        """
        # 1. Identifica o agente para este canal
        agent = await self._get_agent_for_channel(channel, metadata)
        
        if not agent:
            return {
                "error": "No agent configured for this channel",
                "channel": channel,
                "metadata": metadata
            }
        
        # 2. Busca ou cria conversa
        conversation = await self._get_or_create_conversation(
            agent_id=agent["id"],
            sender_id=sender_id,
            channel=channel
        )
        
        # 3. Busca contexto RAG se configurado
        rag_context = ""
        if agent.get("rag_store_id"):
            try:
                rag_result = await self.rag.query(
                    store_id=agent["rag_store_id"],
                    query=message_text
                )
                rag_context = rag_result.get("response", "")
            except Exception as e:
                print(f"RAG query error: {e}")
        
        # 4. Busca histórico da conversa
        history = await self._get_conversation_history(
            conversation_id=conversation["id"],
            limit=10
        )
        
        # 5. Monta mensagens para o LLM
        messages = self._build_messages(
            agent=agent,
            history=history,
            user_message=message_text,
            rag_context=rag_context
        )
        
        # 6. Busca tools do agente
        tools = await self._get_agent_tools(agent["id"])
        
        # 7. Gera resposta com Gemini
        response = await self.gemini.chat(
            messages=messages,
            model=agent.get("llm_model", "gemini-2.0-flash"),
            tools=tools,
            file_search_store_id=agent.get("rag_store_id"),
            temperature=0.7
        )
        
        tool_executed = None
        
        # 8. Executa tools se necessário
        if response.get("tool_calls"):
            for tool_call in response["tool_calls"]:
                tool_result = await self._execute_tool(
                    agent_id=agent["id"],
                    tool_name=tool_call["name"],
                    params=tool_call["params"]
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
        
        # 9. Gera áudio se configurado
        audio_url_response = None
        if agent.get("send_audio", False) and response.get("text"):
            try:
                audio_path = await self.tts.text_to_speech(
                    text=response["text"],
                    voice_id=agent["voice_id"]
                )
                # Aqui você pode upload para storage e retornar URL pública
                audio_url_response = audio_path
            except Exception as e:
                print(f"TTS error: {e}")
        
        # 10. Salva mensagens no histórico
        await self._save_message(
            conversation_id=conversation["id"],
            role="user",
            content=message_text
        )
        
        await self._save_message(
            conversation_id=conversation["id"],
            role="assistant",
            content=response.get("text", ""),
            model_used=response.get("model"),
            tool_call=tool_executed
        )
        
        return {
            "text": response.get("text", ""),
            "audio_url": audio_url_response,
            "model_used": response.get("model"),
            "tool_executed": tool_executed,
            "citations": response.get("citations", [])
        }
    
    def _build_messages(
        self,
        agent: dict,
        history: list,
        user_message: str,
        rag_context: str = ""
    ) -> list:
        """Monta lista de mensagens para o LLM."""
        
        # System prompt
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
    
    async def _execute_tool(
        self,
        agent_id: str,
        tool_name: str,
        params: dict
    ) -> dict:
        """Executa tool via webhook."""
        
        tool = await self._get_tool_by_name(agent_id, tool_name)
        
        if not tool:
            return {"error": f"Tool '{tool_name}' not found"}
        
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                response = await client.post(
                    tool["webhook_url"],
                    json=params,
                    headers={"Content-Type": "application/json"}
                )
                
                if response.status_code == 200:
                    return response.json()
                else:
                    return {
                        "error": f"Tool returned status {response.status_code}",
                        "body": response.text
                    }
        except Exception as e:
            return {"error": str(e)}
    
    # ==================== Database Methods (placeholders) ====================
    
    async def _get_agent_for_channel(self, channel: str, metadata: dict) -> Optional[dict]:
        """Busca agente configurado para o canal."""
        # TODO: Implementar busca no banco
        # Por enquanto, retorna um agente mockado
        return None
    
    async def _get_or_create_conversation(
        self,
        agent_id: str,
        sender_id: str,
        channel: str
    ) -> dict:
        """Busca ou cria conversa."""
        # TODO: Implementar no banco
        return {"id": str(uuid4())}
    
    async def _get_conversation_history(
        self,
        conversation_id: str,
        limit: int = 10
    ) -> list:
        """Busca histórico da conversa."""
        # TODO: Implementar no banco
        return []
    
    async def _save_message(
        self,
        conversation_id: str,
        role: str,
        content: str,
        model_used: str = None,
        tool_call: dict = None
    ):
        """Salva mensagem no histórico."""
        # TODO: Implementar no banco
        pass
    
    async def _get_agent_tools(self, agent_id: str) -> list:
        """Busca tools do agente formatadas para o LLM."""
        # TODO: Implementar no banco
        return []
    
    async def _get_tool_by_name(self, agent_id: str, tool_name: str) -> Optional[dict]:
        """Busca tool específica pelo nome."""
        # TODO: Implementar no banco
        return None


class MetaWebhookHandler:
    """
    Handler para webhooks da Meta (WhatsApp, Instagram, Messenger).
    """
    
    def __init__(self, router: ChannelRouter, access_token: str, verify_token: str):
        self.router = router
        self.access_token = access_token
        self.verify_token = verify_token
    
    def verify_webhook(self, mode: str, token: str, challenge: str) -> Optional[str]:
        """Verifica webhook da Meta."""
        if mode == "subscribe" and token == self.verify_token:
            return challenge
        return None
    
    async def process_webhook(self, payload: dict) -> list:
        """
        Processa webhook da Meta e retorna respostas.
        
        Returns:
            Lista de respostas para enviar
        """
        responses = []
        
        for entry in payload.get("entry", []):
            # WhatsApp
            if "changes" in entry:
                for change in entry["changes"]:
                    if change.get("field") == "messages":
                        value = change.get("value", {})
                        
                        for message in value.get("messages", []):
                            response = await self._handle_whatsapp_message(
                                message=message,
                                metadata=value.get("metadata", {})
                            )
                            if response:
                                responses.append(response)
            
            # Messenger / Instagram
            if "messaging" in entry:
                for messaging in entry["messaging"]:
                    response = await self._handle_messenger_message(
                        messaging=messaging,
                        page_id=entry.get("id")
                    )
                    if response:
                        responses.append(response)
        
        return responses
    
    async def _handle_whatsapp_message(self, message: dict, metadata: dict) -> Optional[dict]:
        """Processa mensagem do WhatsApp."""
        
        msg_type = message.get("type")
        sender = message.get("from")
        
        text = ""
        audio_url = None
        
        if msg_type == "text":
            text = message.get("text", {}).get("body", "")
        elif msg_type == "audio":
            audio_url = message.get("audio", {}).get("url")
            # TODO: Transcrever áudio
            text = "[Áudio recebido - transcrição pendente]"
        else:
            # Ignora outros tipos por enquanto
            return None
        
        # Processa com o router
        result = await self.router.process_message(
            channel="whatsapp",
            sender_id=sender,
            message_text=text,
            audio_url=audio_url,
            metadata={
                "phone_number_id": metadata.get("phone_number_id"),
                "display_phone_number": metadata.get("display_phone_number")
            }
        )
        
        return {
            "channel": "whatsapp",
            "to": sender,
            "phone_number_id": metadata.get("phone_number_id"),
            "response": result
        }
    
    async def _handle_messenger_message(self, messaging: dict, page_id: str) -> Optional[dict]:
        """Processa mensagem do Messenger/Instagram."""
        
        sender = messaging.get("sender", {}).get("id")
        message = messaging.get("message", {})
        
        if not message or not sender:
            return None
        
        text = message.get("text", "")
        
        if not text:
            # Ignora mensagens sem texto
            return None
        
        # Determina se é Instagram ou Messenger pelo page_id
        # TODO: Melhorar detecção
        channel = "messenger"
        
        # Processa com o router
        result = await self.router.process_message(
            channel=channel,
            sender_id=sender,
            message_text=text,
            metadata={"page_id": page_id}
        )
        
        return {
            "channel": channel,
            "to": sender,
            "page_id": page_id,
            "response": result
        }
    
    async def send_whatsapp_message(
        self,
        phone_number_id: str,
        to: str,
        text: str,
        audio_url: str = None
    ):
        """Envia mensagem no WhatsApp."""
        
        url = f"https://graph.facebook.com/v18.0/{phone_number_id}/messages"
        headers = {
            "Authorization": f"Bearer {self.access_token}",
            "Content-Type": "application/json"
        }
        
        # Envia texto
        if text:
            payload = {
                "messaging_product": "whatsapp",
                "to": to,
                "type": "text",
                "text": {"body": text}
            }
            
            async with httpx.AsyncClient() as client:
                await client.post(url, headers=headers, json=payload)
        
        # Envia áudio se disponível
        if audio_url:
            payload = {
                "messaging_product": "whatsapp",
                "to": to,
                "type": "audio",
                "audio": {"link": audio_url}
            }
            
            async with httpx.AsyncClient() as client:
                await client.post(url, headers=headers, json=payload)
    
    async def send_messenger_message(
        self,
        recipient_id: str,
        text: str,
        audio_url: str = None
    ):
        """Envia mensagem no Messenger/Instagram."""
        
        url = f"https://graph.facebook.com/v18.0/me/messages"
        headers = {
            "Authorization": f"Bearer {self.access_token}",
            "Content-Type": "application/json"
        }
        
        payload = {
            "recipient": {"id": recipient_id},
            "message": {"text": text}
        }
        
        async with httpx.AsyncClient() as client:
            await client.post(url, headers=headers, json=payload)
