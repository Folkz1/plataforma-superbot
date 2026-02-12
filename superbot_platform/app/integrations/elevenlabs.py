"""
SuperBot Platform - Cliente ElevenLabs para TTS e Conversational AI
"""
import asyncio
from elevenlabs import ElevenLabs
from typing import Optional, AsyncGenerator
import httpx
import os
import tempfile
from uuid import uuid4


class ElevenLabsManager:
    """
    Gerenciador ElevenLabs para:
    - Text-to-Speech (TTS)
    - Voice Cloning
    - Conversational AI Agents
    """
    
    def __init__(self, api_key: str, audio_base_path: str = None):
        self.client = ElevenLabs(api_key=api_key)
        self.api_key = api_key
        self.audio_base_path = audio_base_path or os.path.join(tempfile.gettempdir(), "superbot_audios")
        self.base_url = "https://api.elevenlabs.io/v1"

        # Cria diretório de áudios se não existir
        os.makedirs(self.audio_base_path, exist_ok=True)
    
    # ==================== TTS ====================
    
    async def text_to_speech(
        self,
        text: str,
        voice_id: str,
        model_id: str = "eleven_multilingual_v2",
        output_format: str = "mp3_44100_128"
    ) -> str:
        """
        Converte texto em áudio.
        
        Args:
            text: Texto para converter
            voice_id: ID da voz no ElevenLabs
            model_id: Modelo TTS a usar
            output_format: Formato do áudio
        
        Returns:
            Caminho do arquivo de áudio gerado
        """
        def _convert():
            audio = self.client.text_to_speech.convert(
                text=text,
                voice_id=voice_id,
                model_id=model_id,
                output_format=output_format
            )
            # Salva o áudio
            filename = f"{uuid4()}.mp3"
            filepath = os.path.join(self.audio_base_path, filename)
            with open(filepath, "wb") as f:
                for chunk in audio:
                    f.write(chunk)
            return filepath

        return await asyncio.to_thread(_convert)
    
    async def text_to_speech_stream(
        self,
        text: str,
        voice_id: str,
        model_id: str = "eleven_multilingual_v2"
    ) -> AsyncGenerator[bytes, None]:
        """
        Converte texto em áudio com streaming.
        
        Yields:
            Chunks de áudio em bytes
        """
        audio_stream = self.client.text_to_speech.stream(
            text=text,
            voice_id=voice_id,
            model_id=model_id
        )
        
        for chunk in audio_stream:
            if isinstance(chunk, bytes):
                yield chunk
    
    # ==================== Vozes ====================
    
    async def list_voices(self) -> list:
        """Lista todas as vozes disponíveis."""
        def _search():
            response = self.client.voices.search()
            return [
                {
                    "voice_id": v.voice_id,
                    "name": v.name,
                    "category": v.category,
                    "labels": v.labels
                }
                for v in response.voices
            ]
        return await asyncio.to_thread(_search)
    
    async def clone_voice(
        self,
        name: str,
        audio_files: list[str],
        description: str = ""
    ) -> dict:
        """
        Clona uma voz a partir de amostras de áudio.
        """
        def _clone():
            voice = self.client.voices.ivc.create(
                name=name,
                files=audio_files,
                description=description
            )
            return {
                "voice_id": voice.voice_id,
                "name": voice.name
            }
        return await asyncio.to_thread(_clone)
    
    async def get_voice(self, voice_id: str) -> dict:
        """Obtém detalhes de uma voz."""
        def _get():
            voice = self.client.voices.get(voice_id=voice_id)
            return {
                "voice_id": voice.voice_id,
                "name": voice.name,
                "category": voice.category
            }
        return await asyncio.to_thread(_get)
    
    # ==================== Conversational AI Agents ====================
    
    async def create_agent(
        self,
        name: str,
        system_prompt: str,
        voice_id: str,
        first_message: str = "",
        language: str = "pt",
        tools: list[dict] = None
    ) -> dict:
        """
        Cria um agente conversacional no ElevenLabs.
        
        Args:
            name: Nome do agente
            system_prompt: Prompt do sistema
            voice_id: ID da voz
            first_message: Mensagem inicial
            language: Idioma (pt, en, es, etc)
            tools: Lista de tools/webhooks
        
        Returns:
            dict com agent_id e info
        """
        conversation_config = {
            "agent": {
                "prompt": {
                    "prompt": system_prompt
                },
                "first_message": first_message,
                "language": language
            },
            "tts": {
                "voice_id": voice_id
            }
        }
        
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.base_url}/convai/agents/create",
                headers={
                    "xi-api-key": self.api_key,
                    "Content-Type": "application/json"
                },
                json={
                    "conversation_config": conversation_config,
                    "name": name
                }
            )
            response.raise_for_status()
            data = response.json()
        
        agent_id = data.get("agent_id")
        
        # Adiciona tools se fornecidas
        if tools and agent_id:
            for tool in tools:
                await self.add_agent_tool(agent_id, tool)
        
        return {
            "agent_id": agent_id,
            "name": name,
            "voice_id": voice_id
        }
    
    async def add_agent_tool(self, agent_id: str, tool_config: dict) -> dict:
        """
        Adiciona uma tool/webhook a um agente.
        
        Args:
            agent_id: ID do agente
            tool_config: Configuração da tool
        
        Returns:
            dict com status
        """
        tool = {
            "type": "webhook",
            "name": tool_config["name"],
            "description": tool_config.get("description", ""),
            "api_schema": {
                "url": tool_config["webhook_url"],
                "method": "POST",
                "request_body_schema": {
                    "type": "object",
                    "properties": tool_config.get("parameters", {})
                }
            }
        }
        
        async with httpx.AsyncClient() as client:
            response = await client.patch(
                f"{self.base_url}/convai/agents/{agent_id}",
                headers={
                    "xi-api-key": self.api_key,
                    "Content-Type": "application/json"
                },
                json={"tools": [tool]}
            )
            response.raise_for_status()
        
        return {"status": "tool_added", "tool_name": tool_config["name"]}
    
    async def get_agent(self, agent_id: str) -> dict:
        """Obtém detalhes de um agente."""
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self.base_url}/convai/agents/{agent_id}",
                headers={"xi-api-key": self.api_key}
            )
            response.raise_for_status()
            return response.json()
    
    async def list_agents(self) -> list:
        """Lista todos os agentes."""
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self.base_url}/convai/agents",
                headers={"xi-api-key": self.api_key}
            )
            response.raise_for_status()
            return response.json().get("agents", [])
    
    async def delete_agent(self, agent_id: str) -> bool:
        """Deleta um agente."""
        async with httpx.AsyncClient() as client:
            response = await client.delete(
                f"{self.base_url}/convai/agents/{agent_id}",
                headers={"xi-api-key": self.api_key}
            )
            response.raise_for_status()
            return True
    
    # ==================== Phone Calls (Twilio Integration) ====================
    
    async def setup_phone_number(
        self,
        phone_number: str,
        agent_id: str,
        provider: str = "twilio"
    ) -> dict:
        """
        Configura número de telefone para receber chamadas.
        
        Args:
            phone_number: Número no formato E.164
            agent_id: ID do agente que atenderá
            provider: Provedor (twilio)
        
        Returns:
            dict com status
        """
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.base_url}/convai/phone-numbers/import",
                headers={
                    "xi-api-key": self.api_key,
                    "Content-Type": "application/json"
                },
                json={
                    "phone_number": phone_number,
                    "provider": provider,
                    "agent_id": agent_id
                }
            )
            response.raise_for_status()
            return response.json()
    
    async def make_outbound_call(
        self,
        agent_id: str,
        to_number: str,
        custom_variables: dict = None
    ) -> dict:
        """
        Inicia uma chamada outbound.
        
        Args:
            agent_id: ID do agente
            to_number: Número de destino (E.164)
            custom_variables: Variáveis customizadas para o agente
        
        Returns:
            dict com call_id e status
        """
        payload = {
            "agent_id": agent_id,
            "phone_number": to_number
        }
        
        if custom_variables:
            payload["custom_variables"] = custom_variables
        
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.base_url}/convai/phone-calls/create",
                headers={
                    "xi-api-key": self.api_key,
                    "Content-Type": "application/json"
                },
                json=payload
            )
            response.raise_for_status()
            return response.json()
