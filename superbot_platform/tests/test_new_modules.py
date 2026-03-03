"""
Testes para os novos módulos: webhook, agents, pipeline, onboarding.
Verifica que os endpoints existem e respondem corretamente.
Compatível com httpx >= 0.28 (transport-based AsyncClient).
"""
import pytest
import httpx
from app.main import app


@pytest.fixture(scope="module")
def anyio_backend():
    return "asyncio"


@pytest.fixture(scope="module")
async def client():
    """Create async test client compatible with httpx 0.28+."""
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as c:
        yield c


# ==================== Webhook ====================

@pytest.mark.anyio
async def test_webhook_verification_missing_token(client):
    response = await client.get("/webhook/meta")
    assert response.status_code == 403


@pytest.mark.anyio
async def test_webhook_verification_wrong_token(client):
    response = await client.get(
        "/webhook/meta",
        params={
            "hub.mode": "subscribe",
            "hub.verify_token": "wrong-token",
            "hub.challenge": "test123"
        }
    )
    assert response.status_code == 403


@pytest.mark.anyio
async def test_webhook_post_invalid_object(client):
    response = await client.post(
        "/webhook/meta",
        json={"object": "unknown", "entry": []}
    )
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ignored"


@pytest.mark.anyio
async def test_webhook_post_invalid_json(client):
    response = await client.post(
        "/webhook/meta",
        content=b"not json",
        headers={"Content-Type": "application/json"}
    )
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "error"


# ==================== Agents ====================

@pytest.mark.anyio
async def test_agents_list_requires_auth(client):
    response = await client.get("/api/agents/test-tenant")
    assert response.status_code in (401, 403)


@pytest.mark.anyio
async def test_agents_create_requires_auth(client):
    response = await client.post(
        "/api/agents/test-tenant",
        json={"name": "Test Agent", "system_prompt": "Test prompt"}
    )
    assert response.status_code in (401, 403)


@pytest.mark.anyio
async def test_agents_active_requires_auth(client):
    response = await client.get("/api/agents/test-tenant/active")
    assert response.status_code in (401, 403)


@pytest.mark.anyio
async def test_agents_tools_requires_auth(client):
    response = await client.get("/api/agents/test-tenant/tools")
    assert response.status_code in (401, 403)


@pytest.mark.anyio
async def test_agents_knowledge_requires_auth(client):
    response = await client.get("/api/agents/test-tenant/knowledge")
    assert response.status_code in (401, 403)


# ==================== Pipeline ====================

@pytest.mark.anyio
async def test_pipeline_stages_requires_auth(client):
    response = await client.get("/api/pipeline/stages/test-tenant")
    assert response.status_code in (401, 403)


@pytest.mark.anyio
async def test_pipeline_team_requires_auth(client):
    response = await client.get("/api/pipeline/team/test-tenant")
    assert response.status_code in (401, 403)


@pytest.mark.anyio
async def test_pipeline_assignments_requires_auth(client):
    response = await client.get("/api/pipeline/assignments/test-tenant")
    assert response.status_code in (401, 403)


@pytest.mark.anyio
async def test_pipeline_pool_requires_auth(client):
    response = await client.get("/api/pipeline/pool/test-tenant")
    assert response.status_code in (401, 403)


@pytest.mark.anyio
async def test_pipeline_metrics_requires_auth(client):
    response = await client.get("/api/pipeline/metrics/test-tenant")
    assert response.status_code in (401, 403)


@pytest.mark.anyio
async def test_pipeline_handoff_requires_auth(client):
    response = await client.post(
        "/api/pipeline/handoff/test-tenant",
        json={
            "conversation_id": "123",
            "channel_type": "whatsapp",
            "to_type": "vendedor",
            "reason": "Test"
        }
    )
    assert response.status_code in (401, 403)


# ==================== Onboarding ====================

@pytest.mark.anyio
async def test_onboarding_provision_requires_auth(client):
    response = await client.post(
        "/api/onboarding/provision",
        json={
            "company_name": "Test Co",
            "project_slug": "test",
            "client_name": "Test Client",
            "client_slug": "test-client",
            "user_email": "test@test.com",
            "user_password": "test123",
            "user_name": "Test User"
        }
    )
    assert response.status_code in (401, 403)


@pytest.mark.anyio
async def test_onboarding_status_requires_auth(client):
    response = await client.get("/api/onboarding/status/test-id")
    assert response.status_code in (401, 403)


# ==================== Unit Tests (sem HTTP) ====================

class TestChannelRouterUnit:
    """Testes unitários do ChannelRouter."""

    def test_build_messages_basic(self):
        from app.core.channel_router import ChannelRouter

        router = ChannelRouter.__new__(ChannelRouter)

        agent = {
            "system_prompt": "Você é um bot de teste.",
            "llm_model": "gemini-2.0-flash"
        }

        history = [
            {"role": "user", "content": "Olá"},
            {"role": "assistant", "content": "Oi! Como posso ajudar?"}
        ]

        messages = router._build_messages(
            agent=agent,
            history=history,
            user_message="Qual o horário?",
            rag_context="Horário: 9h-18h"
        )

        assert len(messages) == 4
        assert messages[0]["role"] == "system"
        assert "Você é um bot de teste" in messages[0]["content"]
        assert "Horário: 9h-18h" in messages[0]["content"]
        assert messages[-1]["content"] == "Qual o horário?"

    def test_build_messages_no_rag(self):
        from app.core.channel_router import ChannelRouter

        router = ChannelRouter.__new__(ChannelRouter)

        messages = router._build_messages(
            agent={"system_prompt": "Test prompt"},
            history=[],
            user_message="Hello"
        )

        assert len(messages) == 2
        assert "Contexto Relevante" not in messages[0]["content"]

    def test_build_messages_empty_history(self):
        from app.core.channel_router import ChannelRouter

        router = ChannelRouter.__new__(ChannelRouter)

        messages = router._build_messages(
            agent={"system_prompt": "System"},
            history=[],
            user_message="Test msg",
            rag_context=""
        )

        assert len(messages) == 2
        assert messages[0]["content"] == "System"
        assert messages[1]["content"] == "Test msg"


class TestMetaWebhookHandlerUnit:
    """Testes unitários do MetaWebhookHandler."""

    def test_verify_webhook_valid(self):
        from app.core.channel_router import MetaWebhookHandler

        handler = MetaWebhookHandler(verify_token="test-token")
        result = handler.verify_webhook("subscribe", "test-token", "challenge123")
        assert result == "challenge123"

    def test_verify_webhook_invalid_token(self):
        from app.core.channel_router import MetaWebhookHandler

        handler = MetaWebhookHandler(verify_token="correct-token")
        result = handler.verify_webhook("subscribe", "wrong-token", "challenge123")
        assert result is None

    def test_verify_webhook_invalid_mode(self):
        from app.core.channel_router import MetaWebhookHandler

        handler = MetaWebhookHandler(verify_token="test-token")
        result = handler.verify_webhook("unsubscribe", "test-token", "challenge123")
        assert result is None

    def test_api_version_constant(self):
        from app.core.channel_router import MetaWebhookHandler

        assert MetaWebhookHandler.META_API_VERSION == "v21.0"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
