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
