"""
Testes basicos para os modulos de loyalty/media.
"""
import httpx
import pytest

from app.main import app
from app.core.loyalty_campaigns import normalize_phone, is_valid_whatsapp_phone
from app.core.media_storage import detect_media_type, parse_tags_csv


@pytest.fixture(scope="module")
def anyio_backend():
    return "asyncio"


@pytest.fixture(scope="module")
async def client():
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as c:
        yield c


def test_normalize_phone():
    assert normalize_phone("+55 (11) 99999-8888") == "5511999998888"
    assert normalize_phone("005511999998888") == "5511999998888"


def test_is_valid_whatsapp_phone():
    assert is_valid_whatsapp_phone("+55 11 99999-8888") is True
    assert is_valid_whatsapp_phone("123") is False


def test_detect_media_type():
    assert detect_media_type("image/png", "banner.png") == "image"
    assert detect_media_type("video/mp4", "video.mp4") == "video"
    assert detect_media_type("audio/mpeg", "audio.mp3") == "audio"
    assert detect_media_type("application/pdf", "doc.pdf") == "document"


def test_parse_tags_csv():
    assert parse_tags_csv("promo,  banner ,") == ["promo", "banner"]


@pytest.mark.anyio
async def test_media_upload_requires_auth(client):
    response = await client.post(
        "/api/media/test-tenant/upload",
        files={"file": ("test.txt", b"hello", "text/plain")},
    )
    assert response.status_code in (401, 403)


@pytest.mark.anyio
async def test_loyalty_import_requires_auth(client):
    response = await client.post(
        "/api/loyalty/members/test-tenant/test-club/import",
        files={"file": ("members.csv", b"phone,name\n5511999999999,Ana\n", "text/csv")},
    )
    assert response.status_code in (401, 403)


@pytest.mark.anyio
async def test_loyalty_send_requires_auth(client):
    response = await client.post(
        "/api/loyalty/campaigns/test-tenant/test-club/test-campaign/send",
        json={},
    )
    assert response.status_code in (401, 403)
