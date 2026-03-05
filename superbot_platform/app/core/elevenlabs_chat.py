"""
ElevenLabs Chat Mode Client - Text-only WebSocket for WhatsApp/Instagram/Messenger.

Per-message approach: opens WS, sends message, collects response, closes.
Chat Mode uses input_mode=text & output_mode=text_only (no TTS cost, 25x concurrency).
"""
import json
import logging
import asyncio
from typing import Optional

import httpx

logger = logging.getLogger("superbot.elevenlabs_chat")

ELEVENLABS_BASE_URL = "https://api.elevenlabs.io/v1"
WS_TIMEOUT = 15  # seconds - Meta webhook limit is 20s


class ElevenLabsChatClient:
    """
    Sends a text message to an ElevenLabs Conversational AI agent via WebSocket Chat Mode.

    Flow:
    1. GET signed_url from /convai/conversation/get-signed-url
    2. Connect WS with ?input_mode=text&output_mode=text_only
    3. Send conversation_initiation_client_data (dynamic_variables with history)
    4. Send user_message
    5. Collect agent_response events, handle ping/pong
    6. Return full text response
    """

    def __init__(self, api_key: str):
        self.api_key = api_key

    async def send_message(
        self,
        agent_id: str,
        message: str,
        conversation_history: str = "",
        conversation_id: Optional[str] = None,
        dynamic_variables: Optional[dict] = None,
    ) -> dict:
        """
        Send a message and get text response.

        Returns:
            {
                "text": "agent response",
                "conversation_id": "...",
                "model_used": "elevenlabs-chat",
                "success": True
            }
        """
        try:
            import websockets
        except ImportError:
            logger.error("websockets package not installed")
            return {"text": None, "success": False, "error": "websockets not installed"}

        # 1. Get signed URL
        signed_url = await self._get_signed_url(agent_id)
        if not signed_url:
            return {"text": None, "success": False, "error": "Failed to get signed URL"}

        # Add chat mode params
        separator = "&" if "?" in signed_url else "?"
        ws_url = f"{signed_url}{separator}input_mode=text&output_mode=text_only"

        # 2. Build dynamic variables
        dv = dynamic_variables or {}
        if conversation_history:
            dv["conversation_history"] = conversation_history

        # 3. Connect and exchange
        try:
            response_text = ""
            new_conversation_id = conversation_id

            async with asyncio.timeout(WS_TIMEOUT):
                async with websockets.connect(ws_url) as ws:
                    # Send init data
                    init_data = {
                        "type": "conversation_initiation_client_data",
                        "dynamic_variables": dv,
                    }
                    if conversation_id:
                        init_data["conversation_id"] = conversation_id
                    await ws.send(json.dumps(init_data))

                    # Send user message
                    await ws.send(json.dumps({
                        "type": "user_message",
                        "text": message,
                    }))

                    # Collect response
                    async for raw in ws:
                        try:
                            event = json.loads(raw)
                        except json.JSONDecodeError:
                            continue

                        evt_type = event.get("type", "")

                        # Handle ping -> pong (required, else timeout)
                        if evt_type == "ping":
                            pong = {"type": "pong"}
                            if event.get("event_id"):
                                pong["event_id"] = event["event_id"]
                            await ws.send(json.dumps(pong))
                            continue

                        # Capture conversation_id from init response
                        if evt_type == "conversation_initiation_metadata":
                            new_conversation_id = event.get("conversation_id", new_conversation_id)
                            continue

                        # Streaming text chunks
                        if evt_type == "agent_chat_response_part":
                            chunk = event.get("text", "")
                            response_text += chunk
                            continue

                        # Final response - done
                        if evt_type == "agent_response":
                            # agent_response may contain full text or just signal end
                            full = event.get("text")
                            if full:
                                response_text = full
                            break

                        # Error
                        if evt_type == "error":
                            logger.error(f"[ELEVENLABS_CHAT] WS error: {event}")
                            return {
                                "text": None,
                                "success": False,
                                "error": event.get("message", "WS error"),
                            }

            return {
                "text": response_text.strip() if response_text else None,
                "conversation_id": new_conversation_id,
                "model_used": "elevenlabs-chat",
                "success": bool(response_text),
            }

        except asyncio.TimeoutError:
            logger.warning(f"[ELEVENLABS_CHAT] Timeout ({WS_TIMEOUT}s) for agent {agent_id}")
            return {"text": None, "success": False, "error": "timeout"}
        except Exception as e:
            logger.error(f"[ELEVENLABS_CHAT] Error: {e}")
            return {"text": None, "success": False, "error": str(e)}

    async def _get_signed_url(self, agent_id: str) -> Optional[str]:
        """Get signed WebSocket URL from ElevenLabs."""
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(
                    f"{ELEVENLABS_BASE_URL}/convai/conversation/get-signed-url",
                    params={"agent_id": agent_id},
                    headers={"xi-api-key": self.api_key},
                )
                resp.raise_for_status()
                data = resp.json()
                return data.get("signed_url")
        except Exception as e:
            logger.error(f"[ELEVENLABS_CHAT] Failed to get signed URL: {e}")
            return None
