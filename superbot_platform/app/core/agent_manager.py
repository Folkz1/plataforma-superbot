"""
SuperBot Platform - Gerenciador de Agentes
CRUD real no banco de dados (tabela agents + project_tools_knowledge + project_knowledge_base)
"""
import json
import logging
from typing import Optional
from uuid import UUID

from sqlalchemy import text as sa_text
from sqlalchemy.ext.asyncio import AsyncSession

from app.integrations.gemini import GeminiClient, GeminiRAGManager

logger = logging.getLogger("superbot.agent_manager")


class AgentManager:
    """
    Gerenciador de agentes da plataforma.

    Responsável por:
    - CRUD de agentes (tabela agents)
    - Configuração de tools/webhooks (project_tools_knowledge)
    - Gerenciamento de RAG (project_knowledge_base + Gemini FileSearch)
    """

    def __init__(self, db: AsyncSession, gemini_client: GeminiClient = None, rag_manager: GeminiRAGManager = None):
        self.db = db
        self.gemini = gemini_client
        self.rag = rag_manager

    # ==================== Agentes ====================

    async def create_agent(
        self,
        project_id: str,
        name: str,
        system_prompt: str,
        llm_model: str = "gemini-2.0-flash",
        first_message: str = "",
        voice_id: str = None,
        send_audio: bool = False,
        settings: dict = None
    ) -> dict:
        """Cria um novo agente vinculado a um projeto."""
        # Desativa agentes existentes do projeto (apenas 1 ativo por vez)
        await self.db.execute(
            sa_text("""
                UPDATE agents SET is_active = false, updated_at = now()
                WHERE project_id = :pid AND is_active = true
            """),
            {"pid": project_id}
        )

        result = await self.db.execute(
            sa_text("""
                INSERT INTO agents
                    (project_id, name, system_prompt, llm_model,
                     first_message, voice_id, send_audio, settings, is_active)
                VALUES
                    (:pid::uuid, :name, :prompt, :model,
                     :first_msg, :voice, :audio, :settings::jsonb, true)
                RETURNING id, project_id, name, system_prompt, llm_model,
                          first_message, voice_id, send_audio, rag_store_id,
                          settings, is_active, created_at, updated_at
            """),
            {
                "pid": project_id,
                "name": name,
                "prompt": system_prompt,
                "model": llm_model,
                "first_msg": first_message,
                "voice": voice_id,
                "audio": send_audio,
                "settings": json.dumps(settings or {})
            }
        )
        row = result.mappings().first()
        return dict(row) if row else {}

    async def get_agent(self, agent_id: str) -> Optional[dict]:
        """Busca um agente pelo ID."""
        result = await self.db.execute(
            sa_text("""
                SELECT id, project_id, name, system_prompt, llm_model,
                       first_message, voice_id, send_audio, rag_store_id,
                       settings, is_active, created_at, updated_at
                FROM agents WHERE id = :aid::uuid
            """),
            {"aid": agent_id}
        )
        row = result.mappings().first()
        return dict(row) if row else None

    async def get_active_agent_for_project(self, project_id: str) -> Optional[dict]:
        """Busca o agente ativo de um projeto."""
        result = await self.db.execute(
            sa_text("""
                SELECT id, project_id, name, system_prompt, llm_model,
                       first_message, voice_id, send_audio, rag_store_id,
                       settings, is_active, created_at, updated_at
                FROM agents
                WHERE project_id = :pid::uuid AND is_active = true
                LIMIT 1
            """),
            {"pid": project_id}
        )
        row = result.mappings().first()
        return dict(row) if row else None

    async def list_agents(self, project_id: str) -> list:
        """Lista todos os agentes de um projeto."""
        result = await self.db.execute(
            sa_text("""
                SELECT id, project_id, name, system_prompt, llm_model,
                       first_message, voice_id, send_audio, rag_store_id,
                       settings, is_active, created_at, updated_at
                FROM agents
                WHERE project_id = :pid::uuid
                ORDER BY is_active DESC, created_at DESC
            """),
            {"pid": project_id}
        )
        return [dict(r) for r in result.mappings().all()]

    async def update_agent(self, agent_id: str, updates: dict) -> Optional[dict]:
        """Atualiza um agente."""
        allowed_fields = {
            "name", "system_prompt", "llm_model", "first_message",
            "voice_id", "send_audio", "rag_store_id", "settings", "is_active"
        }

        set_clauses = []
        params = {"aid": agent_id}

        for key, value in updates.items():
            if key not in allowed_fields:
                continue
            if key == "settings":
                set_clauses.append(f"settings = :{key}::jsonb")
                params[key] = json.dumps(value)
            elif key == "send_audio" or key == "is_active":
                set_clauses.append(f"{key} = :{key}")
                params[key] = bool(value)
            else:
                set_clauses.append(f"{key} = :{key}")
                params[key] = value

        if not set_clauses:
            return await self.get_agent(agent_id)

        # If activating this agent, deactivate others in the same project
        if updates.get("is_active") is True:
            agent = await self.get_agent(agent_id)
            if agent:
                await self.db.execute(
                    sa_text("""
                        UPDATE agents SET is_active = false, updated_at = now()
                        WHERE project_id = :pid AND id != :aid::uuid AND is_active = true
                    """),
                    {"pid": str(agent["project_id"]), "aid": agent_id}
                )

        set_clauses.append("updated_at = now()")
        sql = f"UPDATE agents SET {', '.join(set_clauses)} WHERE id = :aid::uuid"

        await self.db.execute(sa_text(sql), params)
        return await self.get_agent(agent_id)

    async def delete_agent(self, agent_id: str) -> bool:
        """Deleta um agente."""
        result = await self.db.execute(
            sa_text("DELETE FROM agents WHERE id = :aid::uuid RETURNING id"),
            {"aid": agent_id}
        )
        return result.scalar_one_or_none() is not None

    # ==================== Tools (project_tools_knowledge) ====================

    async def add_tool(
        self,
        project_id: str,
        name: str,
        description: str,
        webhook_url: str,
        parameters: list = None
    ) -> dict:
        """Adiciona uma tool/webhook ao projeto."""
        # instructions = description + parameters schema
        instructions = description
        if parameters:
            instructions += f"\n\nParameters: {json.dumps(parameters)}"

        result = await self.db.execute(
            sa_text("""
                INSERT INTO project_tools_knowledge
                    (project_id, tool_name, instructions, api_endpoint)
                VALUES
                    (:pid::uuid, :name, :instr, :endpoint)
                RETURNING id, project_id, tool_name, instructions, api_endpoint, created_at
            """),
            {
                "pid": project_id,
                "name": name,
                "instr": instructions,
                "endpoint": webhook_url
            }
        )
        row = result.mappings().first()
        return dict(row) if row else {}

    async def get_agent_tools(self, project_id: str) -> list:
        """Lista tools de um projeto."""
        result = await self.db.execute(
            sa_text("""
                SELECT id, project_id, tool_name, instructions, api_endpoint, created_at
                FROM project_tools_knowledge
                WHERE project_id = :pid::uuid
                ORDER BY created_at ASC
            """),
            {"pid": project_id}
        )
        return [dict(r) for r in result.mappings().all()]

    async def get_agent_tools_schema(self, project_id: str) -> list:
        """Retorna tools no formato esperado pelo LLM (function calling)."""
        tools = await self.get_agent_tools(project_id)

        schema = []
        for tool in tools:
            schema.append({
                "name": tool["tool_name"],
                "description": tool["instructions"] or "",
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
        return schema

    async def remove_tool(self, project_id: str, tool_id: str) -> bool:
        """Remove uma tool do projeto."""
        result = await self.db.execute(
            sa_text("""
                DELETE FROM project_tools_knowledge
                WHERE id = :tid::uuid AND project_id = :pid::uuid
                RETURNING id
            """),
            {"tid": tool_id, "pid": project_id}
        )
        return result.scalar_one_or_none() is not None

    # ==================== RAG (project_knowledge_base) ====================

    async def add_knowledge(
        self,
        project_id: str,
        content: str,
        metadata: dict = None
    ) -> dict:
        """Adiciona chunk de conhecimento ao projeto."""
        result = await self.db.execute(
            sa_text("""
                INSERT INTO project_knowledge_base
                    (project_id, content, metadata)
                VALUES
                    (:pid::uuid, :content, :meta::jsonb)
                RETURNING id, project_id, content, metadata, created_at
            """),
            {
                "pid": project_id,
                "content": content,
                "meta": json.dumps(metadata or {})
            }
        )
        row = result.mappings().first()
        return dict(row) if row else {}

    async def list_knowledge(self, project_id: str) -> list:
        """Lista chunks de conhecimento do projeto."""
        result = await self.db.execute(
            sa_text("""
                SELECT id, project_id, content, metadata, created_at
                FROM project_knowledge_base
                WHERE project_id = :pid::uuid
                ORDER BY created_at ASC
            """),
            {"pid": project_id}
        )
        return [dict(r) for r in result.mappings().all()]

    async def delete_knowledge(self, project_id: str, knowledge_id: str) -> bool:
        """Remove chunk de conhecimento."""
        result = await self.db.execute(
            sa_text("""
                DELETE FROM project_knowledge_base
                WHERE id = :kid::uuid AND project_id = :pid::uuid
                RETURNING id
            """),
            {"kid": knowledge_id, "pid": project_id}
        )
        return result.scalar_one_or_none() is not None

    # ==================== Gemini RAG FileSearch ====================

    async def setup_rag_store(self, agent_id: str, store_name: str = None) -> dict:
        """Configura RAG FileSearch store para o agente."""
        if not self.rag:
            return {"error": "RAG manager not configured"}

        agent = await self.get_agent(agent_id)
        if not agent:
            return {"error": "Agent not found"}

        store_name = store_name or f"agent_{agent_id}"
        store_id = await self.rag.create_store(
            name=store_name,
            description=f"RAG Store for agent {agent['name']}"
        )

        await self.update_agent(agent_id, {"rag_store_id": store_id})
        return {"rag_store_id": store_id}

    async def upload_rag_document(self, agent_id: str, file_path: str, display_name: str = None) -> dict:
        """Upload documento para RAG FileSearch do agente."""
        if not self.rag:
            return {"error": "RAG manager not configured"}

        agent = await self.get_agent(agent_id)
        if not agent:
            return {"error": "Agent not found"}

        store_id = agent.get("rag_store_id")
        if not store_id:
            result = await self.setup_rag_store(agent_id)
            store_id = result.get("rag_store_id")

        return await self.rag.upload_document(store_id, file_path, display_name)

    async def upload_rag_text(self, agent_id: str, content: str, name: str = "document.txt") -> dict:
        """Upload texto para RAG FileSearch do agente."""
        if not self.rag:
            return {"error": "RAG manager not configured"}

        agent = await self.get_agent(agent_id)
        if not agent:
            return {"error": "Agent not found"}

        store_id = agent.get("rag_store_id")
        if not store_id:
            result = await self.setup_rag_store(agent_id)
            store_id = result.get("rag_store_id")

        return await self.rag.upload_text(store_id, content, name)
