# SuperBot Dashboard - API Documentation

## 🔐 Authentication

### POST /api/auth/login

Login de usuário.

**Request:**

```json
{
  "username": "string",
  "password": "string"
}
```

**Response:**

```json
{
  "access_token": "string",
  "token_type": "bearer",
  "user": {
    "id": "uuid",
    "username": "string",
    "role": "admin|client",
    "client_id": "uuid",
    "client_name": "string"
  }
}
```

---

## 👥 Clients

### GET /api/clients

Lista todos os clientes (admin only).

**Response:**

```json
{
  "clients": [
    {
      "id": "uuid",
      "name": "string",
      "created_at": "datetime"
    }
  ]
}
```

### POST /api/clients

Cria novo cliente (admin only).

**Request:**

```json
{
  "name": "string"
}
```

---

## 💬 Conversations

### GET /api/conversations

Lista conversas do projeto.

**Query Params:**

- `limit` (optional): número de conversas (default: 50)
- `channel_type` (optional): filtrar por canal

**Response:**

```json
{
  "conversations": [
    {
      "conversation_id": "string",
      "channel_type": "whatsapp|instagram|messenger",
      "status": "open|resolved|abandoned",
      "last_event_at": "datetime",
      "last_text": "string"
    }
  ]
}
```

### GET /api/conversations/{conversation_id}

Detalhes de uma conversa.

**Response:**

```json
{
  "conversation": {
    "conversation_id": "string",
    "channel_type": "string",
    "status": "string",
    "created_at": "datetime"
  },
  "messages": [
    {
      "id": "uuid",
      "direction": "in|out|system",
      "text": "string",
      "created_at": "datetime"
    }
  ]
}
```

---

## 📊 Analytics

### GET /api/analytics/overview/{project_id}

KPIs principais.

**Query Params:**

- `days` (optional): período em dias (default: 30)

**Response:**

```json
{
  "total_conversations": 150,
  "active_conversations": 12,
  "resolution_rate": 85.5,
  "avg_response_time": "2h 30m",
  "total_messages": 1250
}
```

### GET /api/analytics/timeline/{project_id}

Conversas por dia.

**Response:**

```json
{
  "timeline": [
    {
      "date": "2024-01-01",
      "conversations": 10,
      "messages": 50
    }
  ]
}
```

### GET /api/analytics/channels/{project_id}

Distribuição por canal.

**Response:**

```json
{
  "channels": [
    {
      "name": "whatsapp",
      "count": 80,
      "percentage": 53.3
    }
  ]
}
```

### GET /api/analytics/status/{project_id}

Distribuição por status.

**Response:**

```json
{
  "statuses": [
    {
      "name": "open",
      "count": 12
    }
  ]
}
```

### GET /api/analytics/hourly/{project_id}

Conversas por hora do dia.

**Response:**

```json
{
  "hourly": [
    {
      "hour": 0,
      "count": 2
    }
  ]
}
```

---

## 🤖 ElevenLabs

### GET /api/elevenlabs/agents

Lista agents.

**Response:**

```json
{
  "agents": [
    {
      "agent_id": "string",
      "name": "string",
      "conversation_config": {}
    }
  ]
}
```

### GET /api/elevenlabs/voices

Lista vozes disponíveis.

**Response:**

```json
{
  "voices": [
    {
      "voice_id": "string",
      "name": "string"
    }
  ]
}
```

### POST /api/elevenlabs/agents/{agent_id}/tools

Adiciona tool a um agent.

**Request:**

```json
{
  "type": "webhook",
  "name": "string",
  "description": "string",
  "url": "string"
}
```

---

## 🔍 RAG

### POST /api/rag/search

Busca semântica no RAG.

**Request:**

```json
{
  "query": "string",
  "project_id": "uuid",
  "top_k": 5
}
```

**Response:**

```json
{
  "results": [
    {
      "content": "string",
      "score": 0.95,
      "metadata": {}
    }
  ]
}
```

---

## 🏥 Health

### GET /health

Health check.

**Response:**

```json
{
  "status": "healthy",
  "timestamp": "datetime"
}
```

---

## 🔒 Autenticação

Todos os endpoints (exceto `/api/auth/login` e `/health`) requerem autenticação via JWT.

**Header:**

```
Authorization: Bearer <token>
```

---

## 🎯 Tenant Isolation

- **Admin**: acesso a todos os clientes
- **Client**: acesso apenas aos próprios dados (via `client_id`)
