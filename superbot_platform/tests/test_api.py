"""
Testes básicos para o backend do SuperBot Dashboard.
"""
import pytest
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


class TestHealth:
    """Testes de health check."""
    
    def test_health_endpoint(self):
        """Testa se o endpoint de health está funcionando."""
        response = client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"


class TestAuth:
    """Testes de autenticação."""
    
    def test_login_invalid_credentials(self):
        """Testa login com credenciais inválidas."""
        response = client.post(
            "/api/auth/login",
            json={"username": "invalid", "password": "wrong"}
        )
        assert response.status_code == 401
    
    def test_login_missing_fields(self):
        """Testa login sem campos obrigatórios."""
        response = client.post("/api/auth/login", json={})
        assert response.status_code == 422


class TestAnalytics:
    """Testes de analytics (sem autenticação para simplificar)."""
    
    def test_analytics_endpoints_exist(self):
        """Verifica se os endpoints de analytics existem."""
        # Estes vão retornar 401 sem token, mas pelo menos confirmam que existem
        endpoints = [
            "/api/analytics/overview/test-id",
            "/api/analytics/timeline/test-id",
            "/api/analytics/channels/test-id",
            "/api/analytics/status/test-id",
            "/api/analytics/hourly/test-id"
        ]
        
        for endpoint in endpoints:
            response = client.get(endpoint)
            # 401 (não autenticado) ou 403 (sem permissão) são esperados
            assert response.status_code in [401, 403]


class TestConversations:
    """Testes de conversas."""
    
    def test_conversations_requires_auth(self):
        """Verifica que conversas requer autenticação."""
        response = client.get("/api/conversations")
        assert response.status_code == 401


class TestElevenLabs:
    """Testes de ElevenLabs proxy."""
    
    def test_elevenlabs_endpoints_exist(self):
        """Verifica se os endpoints de ElevenLabs existem."""
        endpoints = [
            "/api/elevenlabs/agents",
            "/api/elevenlabs/voices"
        ]
        
        for endpoint in endpoints:
            response = client.get(endpoint)
            # Pode retornar 401 ou erro de API key
            assert response.status_code in [401, 403, 500]


class TestRAG:
    """Testes de RAG."""
    
    def test_rag_search_requires_auth(self):
        """Verifica que RAG search requer autenticação."""
        response = client.post(
            "/api/rag/search",
            json={"query": "test", "project_id": "test"}
        )
        assert response.status_code == 401


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
