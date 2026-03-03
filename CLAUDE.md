# SuperBot Platform

## Stack
- **Backend**: FastAPI + async SQLAlchemy + asyncpg (Python 3.10)
- **Frontend**: Next.js 16 + React 19 (TypeScript)
- **N8N**: Workflows de automacao (48 ativos)
- **DB**: PostgreSQL (EasyPanel - 72.60.13.22:3030/aplicativos)
- **IA**: Gemini (google-genai), OpenRouter (GPT-4o fallback)
- **TTS**: ElevenLabs
- **Meta API**: v21.0 (WhatsApp, Instagram, Messenger)

## Deploy
- EasyPanel Docker via GitHub Actions CI
- ai.superbot.digital -> N8N (ainda nao migrado para FastAPI)
- app.superbot.digital -> Next.js Dashboard
- Containers: backend (FastAPI), frontend (Next.js), n8n, postgres, redis

## Clientes Ativos
| Cliente | Slug | Project ID | Agente | Workflow N8N |
|---------|------|-----------|--------|-------------|
| Pacific Surf | pacific-surf | 0624f30a-8774-4b19-9ba8-f029ab396144 | Sunny | jJPRW6DF0zHrNHCR |
| Dentaly | dentaly | (ver DB) | Livia | 9VTkn0lDnGlFLUeB |
| Famiglia Gianni | famiglia-gianni | b31efa28-58b1-404c-95dc-236a88fff6b5 | Giulia | 3rVHqArf3o0l97Yd |

## N8N API
- URL: https://ai.superbot.digital
- API Key: no .env (N8N_API_KEY)
- Docs: https://ai.superbot.digital/settings/api
- Workflow Giulia: GET/PUT /api/v1/workflows/3rVHqArf3o0l97Yd
- Workflow principal WhatsApp: 6VFZT5Gm4OfEcLYm (router dinamico via agent_workflow_id)
- PUT requer: name, nodes (limpas), connections, settings, staticData

## Gotchas Criticos
- **asyncpg**: NAO suporta `::uuid` cast. SEMPRE usar `CAST(:param AS uuid)`
- **tenancy.py**: usa `(:id)::uuid` (com parenteses) que funciona - padrao diferente
- **httpx 0.28+**: usar AsyncClient com ASGITransport (nao TestClient)
- **Auth**: retorna 403 (nao 401) para requests sem token
- **N8N API PUT**: nodes precisam ser limpas (remover campos extras como color, etc)
- **Knowledge base**: 73 chunks no project_knowledge_base (cardapio, vinhos, info restaurante)

## Estrutura Backend
```
superbot_platform/app/
  main.py           # FastAPI app + routers
  core/
    agent_manager.py  # CRUD agentes (agents table) + tools + RAG
    channel_router.py # Router multi-canal + loop IA Gemini
    tenancy.py        # Multi-tenant auth
  api/routes/
    webhook.py        # Meta webhook GET/POST
    agents.py         # REST CRUD agentes
    pipeline.py       # Pipeline vendas (16+ endpoints)
    onboarding.py     # Provisionamento 1-transacao
    conversations.py  # Conversas existentes
    rag.py           # RAG upload/query
  db/
    database.py       # Async engine + session
    models.py         # SQLAlchemy models
  integrations/
    gemini.py         # Gemini SDK wrapper
    elevenlabs.py     # TTS
```

## Tabelas Novas (migrations 011, 012)
- agents, sales_team_members, pipeline_stages, conversation_assignments, handoff_history

## Regras
- Analise de impacto OBRIGATORIA antes de qualquer mudanca
- Banco = SEMPRE risco ALTO
- Manter compatibilidade com 3 clientes ativos
- NAO quebrar workflows N8N durante transicao
- Testar com dados reais antes de deploy
