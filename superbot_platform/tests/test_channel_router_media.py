import pytest
from starlette.requests import Request

from app.api.routes.conversations import _resolve_stored_media_payload
from app.core import channel_router as channel_router_module


def test_detect_incoming_message_type_from_webhook_entry_payload():
    router = channel_router_module.ChannelRouter.__new__(channel_router_module.ChannelRouter)

    metadata = {
        "entry": [
            {
                "changes": [
                    {
                        "value": {
                            "messages": [
                                {
                                    "type": "audio",
                                    "audio": {
                                        "id": "media-123",
                                        "mime_type": "audio/ogg; codecs=opus",
                                    },
                                }
                            ]
                        }
                    }
                ]
            }
        ]
    }

    assert router._detect_incoming_message_type("whatsapp", metadata) == "audio"


class _DummyResponse:
    def __init__(self, *, json_data=None, content=b"", headers=None):
        self._json_data = json_data or {}
        self.content = content
        self.headers = headers or {}

    def raise_for_status(self):
        return None

    def json(self):
        return self._json_data


class _DummyAsyncClient:
    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def get(self, url, headers=None):
        if "graph.facebook.com" in url:
            return _DummyResponse(
                json_data={
                    "url": "https://cdn.meta.example/audio.ogg",
                    "mime_type": "audio/ogg; codecs=opus",
                }
            )

        return _DummyResponse(
            content=b"audio-bytes",
            headers={"Content-Type": "audio/ogg; codecs=opus"},
        )


async def _fake_store_uploaded_media(db, project_id, filename, data, content_type):
    return {
        "url": "https://storage.example/audio.ogg",
        "share_url": "https://storage.example/share/audio",
        "path": "/SuperBotMedia/audio.ogg",
    }


@pytest.mark.anyio
async def test_persist_incoming_media_from_webhook_entry_payload(monkeypatch):
    monkeypatch.setattr(channel_router_module.httpx, "AsyncClient", _DummyAsyncClient)
    monkeypatch.setattr(channel_router_module, "store_uploaded_media", _fake_store_uploaded_media)

    router = channel_router_module.ChannelRouter.__new__(channel_router_module.ChannelRouter)
    router.db = object()

    metadata = {
        "entry": [
            {
                "changes": [
                    {
                        "value": {
                            "messages": [
                                {
                                    "type": "audio",
                                    "audio": {
                                        "id": "media-123",
                                        "url": "https://lookaside.example/audio.ogg",
                                        "mime_type": "audio/ogg; codecs=opus",
                                    },
                                }
                            ]
                        }
                    }
                ]
            }
        ]
    }

    media = await router._persist_incoming_media(
        project_id="1785d020-50f9-49a9-81d7-64927e3e6f96",
        channel="whatsapp",
        access_token="token-123",
        metadata=metadata,
        message_type="audio",
    )

    assert media == [
        {
            "type": "audio",
            "mime_type": "audio/ogg; codecs=opus",
            "url": "https://storage.example/audio.ogg",
            "download_url": "https://storage.example/audio.ogg",
            "filename": "audio_media-123.oga",
            "share_url": "https://storage.example/share/audio",
            "path": "/SuperBotMedia/audio.ogg",
        }
    ]


@pytest.mark.anyio
async def test_process_message_uses_access_token_from_enriched_webhook_payload(monkeypatch):
    captured: dict[str, object] = {}

    async def _fake_get_agent_for_channel(self, channel, channel_identifier):
        return {
            "id": "channel-1",
            "project_id": "1785d020-50f9-49a9-81d7-64927e3e6f96",
            "project_slug": "dentaly",
            "channel_type": channel,
            "channel_identifier": channel_identifier,
            "access_token": "",
            "system_prompt": "prompt",
            "llm_model": "gemini-2.0-flash",
            "send_audio": False,
            "voice_id": None,
            "rag_store_id": None,
            "agent_workflow_id": None,
            "webhook_path": None,
            "followup_enabled": False,
        }

    async def _fake_persist_incoming_media(self, project_id, channel, access_token, metadata, message_type):
        captured["access_token"] = access_token
        captured["message_type"] = message_type
        return [{"type": "audio", "url": "https://storage.example/audio.ogg"}]

    async def _fake_save_message(self, **kwargs):
        captured.setdefault("saved_messages", []).append(kwargs)

    async def _fake_get_conversation_state(self, *args, **kwargs):
        return {"ai_state": None, "metadata": {}}

    async def _fake_query_rag(self, *args, **kwargs):
        return ""

    async def _fake_get_conversation_history(self, *args, **kwargs):
        return []

    async def _fake_get_agent_tools(self, *args, **kwargs):
        return []

    async def _fake_get_elevenlabs_text_agent(self, *args, **kwargs):
        return None

    async def _fake_update_conversation_state(self, *args, **kwargs):
        return None

    class _GeminiStub:
        async def chat(self, **kwargs):
            return {"text": "ok", "model": "gemini-2.0-flash"}

    monkeypatch.setattr(channel_router_module.ChannelRouter, "_get_agent_for_channel", _fake_get_agent_for_channel)
    monkeypatch.setattr(channel_router_module.ChannelRouter, "_persist_incoming_media", _fake_persist_incoming_media)
    monkeypatch.setattr(channel_router_module.ChannelRouter, "_save_message", _fake_save_message)
    monkeypatch.setattr(channel_router_module.ChannelRouter, "_get_conversation_state", _fake_get_conversation_state)
    monkeypatch.setattr(channel_router_module.ChannelRouter, "_query_rag", _fake_query_rag)
    monkeypatch.setattr(channel_router_module.ChannelRouter, "_get_conversation_history", _fake_get_conversation_history)
    monkeypatch.setattr(channel_router_module.ChannelRouter, "_get_agent_tools", _fake_get_agent_tools)
    monkeypatch.setattr(channel_router_module.ChannelRouter, "_get_elevenlabs_text_agent", _fake_get_elevenlabs_text_agent)
    monkeypatch.setattr(channel_router_module.ChannelRouter, "_update_conversation_state", _fake_update_conversation_state)

    router = channel_router_module.ChannelRouter.__new__(channel_router_module.ChannelRouter)
    router.db = object()
    router.gemini = _GeminiStub()
    router.rag = object()
    router.tts = None

    metadata = {
        "object": "whatsapp_business_account",
        "entry": [
            {
                "changes": [
                    {
                        "field": "messages",
                        "value": {
                            "messages": [
                                {
                                    "type": "audio",
                                    "audio": {
                                        "id": "media-123",
                                        "mime_type": "audio/ogg; codecs=opus",
                                    },
                                }
                            ]
                        },
                    }
                ]
            }
        ],
        "metadata": {
            "access_token": "payload-token-123",
        },
        "push_name": "Diego",
        "phone_number_id": "974324942422221",
    }

    result = await router.process_message(
        channel="whatsapp",
        sender_id="555193448124",
        message_text="[audio]",
        channel_identifier="974324942422221",
        metadata=metadata,
    )

    assert captured["access_token"] == "payload-token-123"
    assert captured["message_type"] == "audio"
    assert result["access_token"] == "payload-token-123"
    assert captured["saved_messages"][0]["media"] == [{"type": "audio", "url": "https://storage.example/audio.ogg"}]


def test_resolve_stored_media_payload_expands_relative_upload_paths():
    request = Request(
        {
            "type": "http",
            "scheme": "https",
            "server": ("api.superbot.digital", 443),
            "headers": [],
            "method": "GET",
            "path": "/api/conversations/x/y",
            "query_string": b"",
        }
    )

    payload = _resolve_stored_media_payload(
        request,
        {"type": "audio", "url_path": "/uploads/media/test/audio.ogg"},
    )

    assert payload["url"] == "https://api.superbot.digital/uploads/media/test/audio.ogg"
    assert payload["download_url"] == "https://api.superbot.digital/uploads/media/test/audio.ogg"
