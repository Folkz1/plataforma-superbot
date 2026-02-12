"""
Script para testar a API e diagnosticar erros CORS e autenticação
"""
import requests

BASE_URL = "http://localhost:8000"

def test_health():
    """Testa endpoint de health"""
    print("=" * 50)
    print("Testando /health...")
    try:
        response = requests.get(f"{BASE_URL}/health")
        print(f"Status: {response.status_code}")
        print(f"Response: {response.json()}")
        return True
    except Exception as e:
        print(f"Erro: {e}")
        return False

def test_login():
    """Testa login e retorna token"""
    print("=" * 50)
    print("Testando login com admin/admin123...")
    try:
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "username": "admin",
            "password": "admin123"
        })
        print(f"Status: {response.status_code}")
        data = response.json()
        if response.status_code == 200:
            print(f"✅ Login bem sucedido!")
            print(f"User: {data.get('user', {}).get('name')}")
            return data.get('access_token')
        else:
            print(f"❌ Erro: {data}")
            return None
    except Exception as e:
        print(f"Erro: {e}")
        return None

def test_conversations_with_token(token):
    """Testa endpoint de conversations com token"""
    print("=" * 50)
    print("Testando /api/conversations/ com autenticação...")
    try:
        response = requests.get(
            f"{BASE_URL}/api/conversations/",
            headers={"Authorization": f"Bearer {token}"}
        )
        print(f"Status: {response.status_code}")
        try:
            data = response.json()
            if response.status_code == 200:
                print(f"✅ Sucesso! {len(data)} conversas encontradas")
            else:
                print(f"Response: {data}")
        except:
            print(f"Response Text: {response.text[:500]}")
    except Exception as e:
        print(f"Erro: {e}")

def test_conversations_without_token():
    """Testa endpoint de conversations sem token"""
    print("=" * 50)
    print("Testando /api/conversations/ SEM autenticação...")
    try:
        response = requests.get(f"{BASE_URL}/api/conversations/")
        print(f"Status: {response.status_code}")
        try:
            print(f"Response: {response.json()}")
        except:
            print(f"Response Text: {response.text[:500]}")
    except Exception as e:
        print(f"Erro: {e}")

def test_cors_options():
    """Testa se CORS está configurado corretamente"""
    print("=" * 50)
    print("Testando CORS (OPTIONS request)...")
    try:
        response = requests.options(
            f"{BASE_URL}/api/conversations/",
            headers={
                "Origin": "http://localhost:3001",
                "Access-Control-Request-Method": "GET",
                "Access-Control-Request-Headers": "Content-Type,Authorization"
            }
        )
        print(f"Status: {response.status_code}")
        print(f"CORS Headers:")
        for key, value in response.headers.items():
            if 'access-control' in key.lower():
                print(f"  {key}: {value}")
    except Exception as e:
        print(f"Erro: {e}")

if __name__ == "__main__":
    print("\n🔍 Diagnóstico da API SuperBot Platform\n")
    
    # 1. Health check
    test_health()
    
    # 2. CORS test
    test_cors_options()
    
    # 3. Login
    token = test_login()
    
    # 4. Conversations sem token
    test_conversations_without_token()
    
    # 5. Conversations com token
    if token:
        test_conversations_with_token(token)
    else:
        print("\n⚠️ Não foi possível testar conversations - login falhou")
    
    print("\n" + "=" * 50)
    print("Diagnóstico concluído!")
