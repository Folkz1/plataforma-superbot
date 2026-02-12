<!-- MEMORY:START -->
# projeto-superbot
SuperBot Platform - Multi-tenant WhatsApp/Instagram/Messenger bot management dashboard with FastAPI backend and Next.js frontend

_Last updated: 2026-02-12 | 5 active memories, 5 total_

## Architecture
- SuperBot Platform architecture: FastAPI backend (async SQLAlchemy + asyncpg) at superbot_platform/app/, Next.js 16 fr... [architecture, backend, frontend, database]

## Key Decisions
- Surgical cleanup over full rewrite (2026-02-05): Removed ~800 lines of agent-builder code from main.py (companies, di... [decision, cleanup, refactoring]

## Gotchas & Pitfalls
- asyncpg gotchas: (1) ::jsonb cast breaks with asyncpg params ($1,$2 style) - use CAST(:val AS jsonb) instead. (2) UUI... [gotcha, asyncpg, pydantic, fastapi]

## Context
- Real client data: Pacific Surf (slug: pacific-surf, project_id: 0624f30a-8774-4b19-9ba8-f029ab396144, phone: 91851635... [clients, data, credentials]

_For deeper context, use memory_search, memory_related, or memory_ask tools._
<!-- MEMORY:END -->
