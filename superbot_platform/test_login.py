"""
Teste de login na API
"""
import requests

try:
    r = requests.post(
        'http://localhost:8000/api/auth/login', 
        json={'username': 'admin', 'password': 'admin123'},
        timeout=5
    )
    print(f"Status: {r.status_code}")
    print(f"Response: {r.text}")
except Exception as e:
    print(f"Erro: {e}")
