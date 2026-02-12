"""
SuperBot Platform - Cliente Gemini com suporte a RAG File Search
"""
import asyncio
import json
from typing import Optional
from google import genai
from google.genai import types


class GeminiClient:
    """
    Cliente para Google Gemini API com suporte a:
    - Chat/Completions
    - Function Calling (Tools)
    - File Search RAG (grounding)
    """
    
    def __init__(self, api_key: str):
        self.client = genai.Client(api_key=api_key)
        self.default_model = "gemini-2.0-flash"
    
    async def chat(
        self,
        messages: list[dict],
        model: str = None,
        tools: list[dict] = None,
        file_search_store_id: str = None,
        temperature: float = 0.7,
        max_tokens: int = 4096
    ) -> dict:
        """
        Gera resposta do chat com suporte a tools e RAG.
        
        Args:
            messages: Lista de mensagens [{"role": "user/assistant/system", "content": "..."}]
            model: Nome do modelo (default: gemini-2.0-flash)
            tools: Lista de tools/functions para function calling
            file_search_store_id: ID do FileSearchStore para RAG
            temperature: Criatividade (0-1)
            max_tokens: Máximo de tokens na resposta
        
        Returns:
            dict com text, tool_calls (se houver), usage
        """
        model = model or self.default_model
        
        # Converte mensagens para formato Gemini
        gemini_contents = self._convert_messages(messages)
        
        # Monta configuração
        config = types.GenerateContentConfig(
            temperature=temperature,
            max_output_tokens=max_tokens,
        )
        
        # Adiciona tools se fornecidas
        gemini_tools = []
        
        if tools:
            function_declarations = []
            for tool in tools:
                function_declarations.append(
                    types.FunctionDeclaration(
                        name=tool["name"],
                        description=tool.get("description", ""),
                        parameters=self._convert_parameters(tool.get("parameters", {}))
                    )
                )
            gemini_tools.append(types.Tool(function_declarations=function_declarations))
        
        # Adiciona File Search RAG se configurado
        if file_search_store_id:
            gemini_tools.append(
                types.Tool(
                    file_search=types.FileSearchTool(
                        file_search_store=types.FileSearchStore(
                            file_search_store_id=file_search_store_id
                        )
                    )
                )
            )
        
        if gemini_tools:
            config.tools = gemini_tools
        
        # Gera resposta (sync SDK -> run in thread to avoid blocking event loop)
        def _generate():
            return self.client.models.generate_content(
                model=model,
                contents=gemini_contents,
                config=config
            )
        response = await asyncio.to_thread(_generate)
        
        # Processa resposta
        result = {
            "text": "",
            "tool_calls": [],
            "citations": [],
            "model": model,
            "usage": {}
        }
        
        if response.candidates:
            candidate = response.candidates[0]
            
            for part in candidate.content.parts:
                if hasattr(part, 'text') and part.text:
                    result["text"] += part.text
                
                if hasattr(part, 'function_call') and part.function_call:
                    result["tool_calls"].append({
                        "name": part.function_call.name,
                        "params": dict(part.function_call.args) if part.function_call.args else {}
                    })
        
        # Extrai citações RAG se houver
        if hasattr(response, 'grounding_metadata') and response.grounding_metadata:
            if hasattr(response.grounding_metadata, 'grounding_chunks'):
                for chunk in response.grounding_metadata.grounding_chunks:
                    result["citations"].append({
                        "content": chunk.text if hasattr(chunk, 'text') else "",
                        "source": chunk.source if hasattr(chunk, 'source') else ""
                    })
        
        # Usage
        if hasattr(response, 'usage_metadata'):
            result["usage"] = {
                "input_tokens": response.usage_metadata.prompt_token_count,
                "output_tokens": response.usage_metadata.candidates_token_count
            }
        
        return result
    
    async def chat_with_tool_result(
        self,
        messages: list[dict],
        tool_name: str,
        tool_result: dict,
        model: str = None,
        temperature: float = 0.7
    ) -> dict:
        """
        Continua chat após execução de tool.
        
        Args:
            messages: Mensagens anteriores
            tool_name: Nome da tool executada
            tool_result: Resultado da execução
            model: Modelo a usar
        
        Returns:
            dict com resposta final
        """
        # Adiciona resultado da tool às mensagens
        messages.append({
            "role": "tool",
            "name": tool_name,
            "content": json.dumps(tool_result, ensure_ascii=False)
        })
        
        return await self.chat(
            messages=messages,
            model=model,
            temperature=temperature
        )
    
    def _convert_messages(self, messages: list[dict]) -> list:
        """Converte mensagens para formato Gemini."""
        gemini_contents = []
        system_instruction = ""
        
        for msg in messages:
            role = msg.get("role", "user")
            content = msg.get("content", "")
            
            if role == "system":
                system_instruction = content
            elif role == "user":
                gemini_contents.append(
                    types.Content(
                        role="user",
                        parts=[types.Part(text=content)]
                    )
                )
            elif role == "assistant":
                gemini_contents.append(
                    types.Content(
                        role="model",
                        parts=[types.Part(text=content)]
                    )
                )
            elif role == "tool":
                # Resultado de function call
                gemini_contents.append(
                    types.Content(
                        role="function",
                        parts=[types.Part(
                            function_response=types.FunctionResponse(
                                name=msg.get("name", "tool"),
                                response={"result": content}
                            )
                        )]
                    )
                )
        
        # Se tem system instruction, adiciona no início do primeiro user message
        if system_instruction and gemini_contents:
            first_user = gemini_contents[0]
            if first_user.role == "user":
                original_text = first_user.parts[0].text
                first_user.parts[0] = types.Part(
                    text=f"[System Instruction]\n{system_instruction}\n\n[User Message]\n{original_text}"
                )
        
        return gemini_contents
    
    def _convert_parameters(self, params: dict) -> dict:
        """Converte parâmetros de tool para formato Gemini."""
        if not params:
            return {"type": "object", "properties": {}}
        
        # Se já está no formato correto
        if "type" in params and "properties" in params:
            return params
        
        # Converte lista de parâmetros para objeto
        properties = {}
        required = []
        
        for param in params if isinstance(params, list) else [params]:
            name = param.get("name", param.get("id", "param"))
            properties[name] = {
                "type": param.get("type", "string"),
                "description": param.get("description", "")
            }
            if param.get("required", False):
                required.append(name)
        
        return {
            "type": "object",
            "properties": properties,
            "required": required
        }


class GeminiRAGManager:
    """
    Gerenciador de File Search Stores para RAG.
    """
    
    def __init__(self, api_key: str):
        self.client = genai.Client(api_key=api_key)
    
    async def create_store(self, name: str, description: str = "") -> str:
        """
        Cria um FileSearchStore para armazenar documentos RAG.

        Returns:
            ID do store criado
        """
        def _create():
            return self.client.file_search_stores.create(
                name=name,
                description=description or f"RAG Store: {name}"
            )
        store = await asyncio.to_thread(_create)
        return store.id
    
    async def upload_document(
        self, 
        store_id: str, 
        file_path: str,
        display_name: str = None
    ) -> dict:
        """
        Faz upload e indexa um documento no store.
        
        Args:
            store_id: ID do FileSearchStore
            file_path: Caminho do arquivo
            display_name: Nome amigável do arquivo
        
        Returns:
            dict com file_id e status
        """
        # Upload do arquivo
        def _upload():
            return self.client.files.upload(
                file=file_path,
                config={"display_name": display_name or file_path.split("/")[-1]}
            )
        file = await asyncio.to_thread(_upload)

        # Importa para o store
        def _import():
            return self.client.file_search_stores.import_file(
                file_search_store_id=store_id,
                file_id=file.id
            )
        await asyncio.to_thread(_import)
        
        return {
            "file_id": file.id,
            "store_id": store_id,
            "display_name": display_name or file_path,
            "status": "indexed"
        }
    
    async def upload_text(
        self, 
        store_id: str, 
        content: str,
        name: str = "document.txt"
    ) -> dict:
        """
        Faz upload de texto direto para o store.
        
        Args:
            store_id: ID do FileSearchStore
            content: Conteúdo de texto
            name: Nome do documento
        
        Returns:
            dict com file_id e status
        """
        import tempfile
        import os
        
        # Cria arquivo temporário
        with tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False, encoding='utf-8') as f:
            f.write(content)
            temp_path = f.name
        
        try:
            result = await self.upload_document(store_id, temp_path, name)
        finally:
            os.unlink(temp_path)
        
        return result
    
    async def list_stores(self) -> list:
        """Lista todos os FileSearchStores."""
        stores = await asyncio.to_thread(lambda: self.client.file_search_stores.list())
        return [{"id": s.id, "name": s.name} for s in stores]

    async def delete_store(self, store_id: str) -> bool:
        """Deleta um FileSearchStore."""
        await asyncio.to_thread(
            lambda: self.client.file_search_stores.delete(file_search_store_id=store_id)
        )
        return True
    
    async def query(
        self, 
        store_id: str, 
        query: str,
        model: str = "gemini-2.0-flash"
    ) -> dict:
        """
        Faz query no RAG store.
        
        Args:
            store_id: ID do store
            query: Pergunta/busca
            model: Modelo a usar
        
        Returns:
            dict com resposta e citações
        """
        def _query():
            return self.client.models.generate_content(
                model=model,
                contents=query,
                config=types.GenerateContentConfig(
                    tools=[types.Tool(
                        file_search=types.FileSearchTool(
                            file_search_store=types.FileSearchStore(
                                file_search_store_id=store_id
                            )
                        )
                    )]
                )
            )
        response = await asyncio.to_thread(_query)
        
        result = {
            "response": response.text if hasattr(response, 'text') else "",
            "citations": []
        }
        
        if hasattr(response, 'grounding_metadata') and response.grounding_metadata:
            if hasattr(response.grounding_metadata, 'grounding_chunks'):
                for chunk in response.grounding_metadata.grounding_chunks:
                    result["citations"].append({
                        "content": chunk.text if hasattr(chunk, 'text') else ""
                    })
        
        return result
