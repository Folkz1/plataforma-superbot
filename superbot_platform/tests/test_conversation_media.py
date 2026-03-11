from app.api.routes.conversations import (
    _decode_media_token,
    _encode_media_token,
    _extract_whatsapp_media_items,
)


def test_extract_whatsapp_audio_media_from_raw_payload():
    raw_payload = {
        "phone_number_id": "123",
        "push_name": "Emilio",
        "raw": {
            "type": "audio",
            "audio": {
                "id": "wamid-audio-1",
                "mime_type": "audio/ogg",
            },
        },
    }

    items = _extract_whatsapp_media_items(raw_payload)

    assert items == [
        {
            "type": "audio",
            "media_id": "wamid-audio-1",
            "mime_type": "audio/ogg",
        }
    ]


def test_extract_whatsapp_video_media_from_entry_payload():
    raw_payload = {
        "entry": [
            {
                "changes": [
                    {
                        "value": {
                            "messages": [
                                {
                                    "type": "video",
                                    "video": {
                                        "id": "wamid-video-1",
                                        "mime_type": "video/mp4",
                                        "caption": "Lead mandou video",
                                    },
                                }
                            ]
                        }
                    }
                ]
            }
        ]
    }

    items = _extract_whatsapp_media_items(raw_payload)

    assert items == [
        {
            "type": "video",
            "media_id": "wamid-video-1",
            "mime_type": "video/mp4",
            "caption": "Lead mandou video",
        }
    ]


def test_media_token_roundtrip():
    token = _encode_media_token(
        project_id="11111111-1111-1111-1111-111111111111",
        conversation_id="5511999999999",
        event_id="22222222-2222-2222-2222-222222222222",
        channel_type="whatsapp",
        media_id="wamid-audio-1",
    )

    payload = _decode_media_token(token)

    assert payload["type"] == "conversation_media"
    assert payload["project_id"] == "11111111-1111-1111-1111-111111111111"
    assert payload["conversation_id"] == "5511999999999"
    assert payload["event_id"] == "22222222-2222-2222-2222-222222222222"
    assert payload["channel_type"] == "whatsapp"
    assert payload["media_id"] == "wamid-audio-1"
