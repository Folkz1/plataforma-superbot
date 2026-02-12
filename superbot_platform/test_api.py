"""Quick API test - testa endpoints do dashboard com dados reais."""
import requests
import json

BASE = "http://localhost:8000"

# 1. Health
print("=== Health ===")
r = requests.get(f"{BASE}/health")
print(r.json())

# 2. Login
print("\n=== Login ===")
r = requests.post(f"{BASE}/api/auth/login", json={"username": "admin", "password": "admin123"})
print(f"Status: {r.status_code}")
if r.status_code != 200:
    print(f"Error: {r.text}")
    exit(1)

data = r.json()
token = data["access_token"]
print(f"Token: {token[:50]}...")
print(f"User: {data['user']}")

headers = {"Authorization": f"Bearer {token}"}

# 3. List clients
print("\n=== List Clients ===")
r = requests.get(f"{BASE}/api/clients/", headers=headers)
print(f"Status: {r.status_code}")
if r.status_code == 200:
    clients = r.json()
    print(f"Total: {len(clients)} clients")
    for c in clients:
        print(f"  - {c['name']} (slug={c['slug']}, id={c['id']})")
else:
    print(f"Error: {r.text}")

# 4. Conversations (for dentaly project)
print("\n=== Conversations (Dentaly) ===")
dentaly_project_id = "1785d020-50f9-49a9-81d7-64927e3e6f96"
r = requests.get(f"{BASE}/api/conversations/?project_id={dentaly_project_id}", headers=headers)
print(f"Status: {r.status_code}")
if r.status_code == 200:
    convs = r.json()
    print(f"Total: {len(convs)} conversations")
    for c in convs[:5]:
        print(f"  - {c['conversation_id']} | {c['channel_type']} | {c['status']} | msgs={c['message_count']}")
else:
    print(f"Error: {r.text}")

# 5. Analytics overview
print("\n=== Analytics (Dentaly) ===")
r = requests.get(f"{BASE}/api/analytics/overview/{dentaly_project_id}", headers=headers)
print(f"Status: {r.status_code}")
if r.status_code == 200:
    print(json.dumps(r.json(), indent=2))
else:
    print(f"Error: {r.text}")

# 6. Conversations for Famiglia Gianni
print("\n=== Conversations (Famiglia Gianni) ===")
famiglia_project_id = "b31efa28-58b1-404c-95dc-236a88fff6b5"
r = requests.get(f"{BASE}/api/conversations/?project_id={famiglia_project_id}", headers=headers)
print(f"Status: {r.status_code}")
if r.status_code == 200:
    convs = r.json()
    print(f"Total: {len(convs)} conversations")
    for c in convs[:5]:
        print(f"  - {c['conversation_id']} | {c['channel_type']} | {c['status']} | msgs={c['message_count']}")
else:
    print(f"Error: {r.text}")

# 7. Get a conversation detail
print("\n=== Conversation Detail (first Dentaly conv) ===")
r = requests.get(f"{BASE}/api/conversations/?project_id={dentaly_project_id}", headers=headers)
if r.status_code == 200:
    convs = r.json()
    if convs:
        first = convs[0]
        r2 = requests.get(
            f"{BASE}/api/conversations/{first['project_id']}/{first['conversation_id']}",
            headers=headers,
        )
        print(f"Status: {r2.status_code}")
        if r2.status_code == 200:
            detail = r2.json()
            print(f"  Channel: {detail['channel_type']}")
            print(f"  Status: {detail['status']}")
            print(f"  Messages: {len(detail['messages'])}")
            for msg in detail['messages'][:3]:
                direction = "<<" if msg['direction'] == 'in' else ">>"
                text = (msg.get('text') or '(no text)')[:80]
                print(f"    {direction} [{msg['message_type']}] {text}")
        else:
            print(f"Error: {r2.text}")

print("\n=== ALL TESTS DONE ===")
