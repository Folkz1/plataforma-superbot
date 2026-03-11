"""
SuperBot Platform - API Principal
Dashboard de gerenciamento multi-tenant para bots de conversacao.
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager
import os
from pathlib import Path

from app.db.database import init_db
from app.core.loyalty_campaigns import start_loyalty_scheduler, stop_loyalty_scheduler
from app.core.tools.base import ToolRegistry
from app.api.routes import (
    auth as auth_routes,
    clients as clients_routes,
    conversations as conversations_routes,
    contacts as contacts_routes,
    analytics as analytics_routes,
    config_meta as config_meta_routes,
    rag as rag_routes,
    elevenlabs as elevenlabs_routes,
    live as live_routes,
    users as users_routes,
    webhook as webhook_routes,
    agents as agents_routes,
    pipeline as pipeline_routes,
    onboarding as onboarding_routes,
    media as media_routes,
    loyalty as loyalty_routes,
    followup_stages as followup_stages_routes,
    agent_tools as agent_tools_routes,
)


# ==================== App Setup ====================

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup: garante que tabelas do dashboard existam."""
    await init_db()
    ToolRegistry.register_all()
    await start_loyalty_scheduler()
    try:
        yield
    finally:
        await stop_loyalty_scheduler()


app = FastAPI(
    title="SuperBot Platform API",
    description="Dashboard multi-tenant para gerenciamento de bots IA",
    version="2.0.0",
    lifespan=lifespan,
)

upload_root = Path(__file__).resolve().parent.parent / "uploads"
upload_root.mkdir(parents=True, exist_ok=True)

_cors_origins = [
    "http://localhost:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:3001",
    "https://app.superbot.digital",
    "https://aplicativos-plataforma-superbot.gtzkxz.easypanel.host",
]
_extra = os.getenv("CORS_ORIGINS", "")
if _extra:
    _cors_origins.extend([u.strip() for u in _extra.split(",") if u.strip()])

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/uploads", StaticFiles(directory=upload_root), name="uploads")


# ==================== Routers ====================

app.include_router(auth_routes.router)
app.include_router(clients_routes.router)
app.include_router(conversations_routes.router)
app.include_router(contacts_routes.router)
app.include_router(analytics_routes.router)
app.include_router(config_meta_routes.router)
app.include_router(rag_routes.router)
app.include_router(elevenlabs_routes.router)
app.include_router(live_routes.router)
app.include_router(users_routes.router)
app.include_router(webhook_routes.router)
app.include_router(agents_routes.router)
app.include_router(pipeline_routes.router)
app.include_router(onboarding_routes.router)
app.include_router(media_routes.router)
app.include_router(loyalty_routes.router)
app.include_router(followup_stages_routes.router)
app.include_router(agent_tools_routes.router)


# ==================== Health ====================

@app.get("/")
async def root():
    return {
        "name": "SuperBot Platform API",
        "version": "2.0.0",
        "status": "running",
    }


@app.get("/health")
async def health():
    return {"status": "healthy"}


# ==================== Run ====================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        proxy_headers=True,
        forwarded_allow_ips="*",
    )
