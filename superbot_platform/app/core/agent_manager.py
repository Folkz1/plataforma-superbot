"""
SuperBot Platform - Gerenciador de Agentes
"""
from typing import Optional
from uuid import uuid4


class AgentManager:
    """
    Gerenciador de agentes da plataforma.
    
    Responsável por:
    - CRUD de agentes
    - Configuração de tools/webhooks
    - Conexão de canais
    - Gerenciamento de RAG
    """
    
    def __init__(self, db, gemini_client, rag_manager, elevenlabs_manager):
        self.db = db
        self.gemini = gemini_client
        self.rag = rag_manager
        self.elevenlabs = elevenlabs_manager
    
    # ==================== Agentes ====================
    
    async def create_agent(
        self,
        name: str,
        system_prompt: str,
        voice_id: str = None,
        first_message: str = "",
        llm_model: str = "gemini-2.0-flash",
        send_audio: bool = False,
        settings: dict = None
    ) -> dict:
        """
        Cria um novo agente.
        
        Args:
            name: Nome do agente
            system_prompt: Prompt do sistema
            voice_id: ID da voz no ElevenLabs (opcional)
            first_message: Mensagem inicial
            llm_model: Modelo LLM a usar
            send_audio: Se deve enviar respostas em áudio
            settings: Configurações adicionais
        
        Returns:
            dict com id e dados do agente
        """
        agent_id = str(uuid4())
        
        agent = {
            "id": agent_id,
            "name": name,
            "system_prompt": system_prompt,
            "voice_id": voice_id,
            "first_message": first_message,
            "llm_model": llm_model,
            "send_audio": send_audio,
            "rag_store_id": None,
            "settings": settings or {}
        }
        
        # TODO: Salvar no banco
        # await self.db.create_agent(agent)
        
        return agent
    
    async def get_agent(self, agent_id: str) -> Optional[dict]:
        """Busca um agente pelo ID."""
        # TODO: Buscar no banco
        return None
    
    async def list_agents(self) -> list:
        """Lista todos os agentes."""
        # TODO: Buscar no banco
        return []
    
    async def update_agent(self, agent_id: str, updates: dict) -> dict:
        """Atualiza um agente."""
        # TODO: Atualizar no banco
        return {"id": agent_id, **updates}
    
    async def delete_agent(self, agent_id: str) -> bool:
        """Deleta um agente."""
        # TODO: Deletar do banco
        return True
    
    # ==================== Tools ====================
    
    async def add_tool(
        self,
        agent_id: str,
        name: str,
        description: str,
        webhook_url: str,
        parameters: list = None
    ) -> dict:
        """
        Adiciona uma tool/webhook ao agente.
        
        Args:
            agent_id: ID do agente
            name: Nome da tool (será usado pelo LLM)
            description: Descrição do que a tool faz
            webhook_url: URL do webhook (n8n, etc)
            parameters: Lista de parâmetros
        
        Returns:
            dict com id e dados da tool
        """
        tool_id = str(uuid4())
        
        tool = {
            "id": tool_id,
            "agent_id": agent_id,
            "name": name,
            "description": description,
            "webhook_url": webhook_url,
            "parameters": parameters or []
        }
        
        # TODO: Salvar no banco
        
        return tool
    
    async def get_agent_tools(self, agent_id: str) -> list:
        """Lista tools de um agente."""
        # TODO: Buscar no banco
        return []
    
    async def get_agent_tools_schema(self, agent_id: str) -> list:
        """
        Retorna tools no formato esperado pelo LLM.
        
        Returns:
            Lista de tools no formato OpenAI/Gemini
        """
        tools = await self.get_agent_tools(agent_id)
        
        schema = []
        for tool in tools:
            properties = {}
            required = []
            
            for param in tool.get("parameters", []):
                properties[param["name"]] = {
                    "type": param.get("type", "string"),
                    "description": param.get("description", "")
                }
                if param.get("required", False):
                    required.append(param["name"])
            
            schema.append({
                "name": tool["name"],
                "description": tool["description"],
                "parameters": {
                    "type": "object",
                    "properties": properties,
                    "required": required
                }
            })
        
        return schema
    
    async def remove_tool(self, agent_id: str, tool_id: str) -> bool:
        """Remove uma tool do agente."""
        # TODO: Deletar do banco
        return True
    
    # ==================== Canais ====================
    
    async def connect_channel(
        self,
        agent_id: str,
        channel_type: str,
        channel_identifier: str,
        settings: dict = None
    ) -> dict:
        """
        Conecta um canal ao agente.
        
        Args:
            agent_id: ID do agente
            channel_type: Tipo (whatsapp, instagram, messenger, phone)
            channel_identifier: Identificador (phone_number_id, page_id, etc)
            settings: Configurações específicas do canal
        
        Returns:
            dict com id e dados do canal
        """
        channel_id = str(uuid4())
        
        channel = {
            "id": channel_id,
            "agent_id": agent_id,
            "channel_type": channel_type,
            "channel_identifier": channel_identifier,
            "is_active": True,
            "settings": settings or {}
        }
        
        # TODO: Salvar no banco
        
        return channel
    
    async def list_agent_channels(self, agent_id: str) -> list:
        """Lista canais de um agente."""
        # TODO: Buscar no banco
        return []
    
    async def disconnect_channel(self, agent_id: str, channel_id: str) -> bool:
        """Desconecta um canal do agente."""
        # TODO: Atualizar no banco
        return True
    
    # ==================== RAG ====================
    
    async def setup_rag(self, agent_id: str, store_name: str = None) -> dict:
        """
        Configura RAG para o agente.
        
        Args:
            agent_id: ID do agente
            store_name: Nome do store (default: agent_id)
        
        Returns:
            dict com rag_store_id
        """
        store_name = store_name or f"agent_{agent_id}"
        
        # Cria FileSearchStore no Gemini
        store_id = await self.rag.create_store(
            name=store_name,
            description=f"RAG Store for agent {agent_id}"
        )
        
        # Atualiza agente com store_id
        await self.update_agent(agent_id, {"rag_store_id": store_id})
        
        return {"rag_store_id": store_id}
    
    async def upload_rag_document(
        self,
        agent_id: str,
        file_path: str,
        display_name: str = None
    ) -> dict:
        """
        Faz upload de documento para o RAG do agente.
        
        Args:
            agent_id: ID do agente
            file_path: Caminho do arquivo
            display_name: Nome amigável
        
        Returns:
            dict com file_id e status
        """
        agent = await self.get_agent(agent_id)
        
        if not agent:
            raise ValueError(f"Agent {agent_id} not found")
        
        store_id = agent.get("rag_store_id")
        
        if not store_id:
            # Cria store se não existir
            result = await self.setup_rag(agent_id)
            store_id = result["rag_store_id"]
        
        # Upload do documento
        return await self.rag.upload_document(
            store_id=store_id,
            file_path=file_path,
            display_name=display_name
        )
    
    async def upload_rag_text(
        self,
        agent_id: str,
        content: str,
        name: str = "document.txt"
    ) -> dict:
        """
        Faz upload de texto direto para o RAG.
        
        Args:
            agent_id: ID do agente
            content: Conteúdo de texto
            name: Nome do documento
        
        Returns:
            dict com file_id e status
        """
        agent = await self.get_agent(agent_id)
        
        if not agent:
            raise ValueError(f"Agent {agent_id} not found")
        
        store_id = agent.get("rag_store_id")
        
        if not store_id:
            result = await self.setup_rag(agent_id)
            store_id = result["rag_store_id"]
        
        return await self.rag.upload_text(
            store_id=store_id,
            content=content,
            name=name
        )
    
    async def query_rag(self, agent_id: str, query: str) -> dict:
        """
        Faz query no RAG do agente.
        
        Args:
            agent_id: ID do agente
            query: Pergunta/busca
        
        Returns:
            dict com resposta e citações
        """
        agent = await self.get_agent(agent_id)
        
        if not agent:
            raise ValueError(f"Agent {agent_id} not found")
        
        store_id = agent.get("rag_store_id")
        
        if not store_id:
            raise ValueError(f"Agent {agent_id} has no RAG configured")
        
        return await self.rag.query(
            store_id=store_id,
            query=query
        )
    
    # ==================== Migração Pacific Surf ====================
    
    async def import_from_elevenlabs_config(
        self,
        name: str,
        system_prompt_path: str,
        rag_content_path: str,
        tools_config: list,
        voice_id: str = None
    ) -> dict:
        """
        Importa configuração do formato ElevenLabs existente.
        
        Args:
            name: Nome do agente
            system_prompt_path: Caminho do arquivo system.md
            rag_content_path: Caminho do arquivo memoria_rag.md
            tools_config: Lista de configurações de tools
            voice_id: ID da voz no ElevenLabs
        
        Returns:
            dict com agente criado
        """
        # Lê system prompt
        with open(system_prompt_path, 'r', encoding='utf-8') as f:
            system_prompt = f.read()
        
        # Cria agente
        agent = await self.create_agent(
            name=name,
            system_prompt=system_prompt,
            voice_id=voice_id,
            llm_model="gemini-2.0-flash"
        )
        
        # Configura RAG
        await self.setup_rag(agent["id"])
        
        # Upload conteúdo RAG
        with open(rag_content_path, 'r', encoding='utf-8') as f:
            rag_content = f.read()
        
        await self.upload_rag_text(
            agent_id=agent["id"],
            content=rag_content,
            name="knowledge_base.txt"
        )
        
        # Adiciona tools
        for tool_config in tools_config:
            await self.add_tool(
                agent_id=agent["id"],
                name=tool_config["name"],
                description=tool_config.get("description", ""),
                webhook_url=tool_config["webhook_url"],
                parameters=tool_config.get("parameters", [])
            )
        
        return agent
