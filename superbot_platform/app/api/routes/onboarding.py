"""
SuperBot Platform - Onboarding API
Provisionamento semi-automatizado de novos clientes.
Cria project + company + channels + secrets + client + user em uma transação.
"""
import json
import logging
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text as sa_text
from pydantic import BaseModel
from typing import Optional, Any
from uuid import uuid4

from app.db.database import get_db
from app.db.models import DashboardUser
from app.api.routes.auth import get_current_user

logger = logging.getLogger("superbot.onboarding")

router = APIRouter(prefix="/api/onboarding", tags=["onboarding"])


# ==================== Schemas ====================

class ChannelConfig(BaseModel):
    channel_type: str  # whatsapp, instagram, messenger
    channel_identifier: str  # phone_number_id, page_id, ig_user_id
    access_token: str = ""


class ProvisionRequest(BaseModel):
    # Company
    company_name: str

    # Project
    project_slug: str
    webhook_path: Optional[str] = None

    # Dashboard client
    client_name: str
    client_slug: str
    timezone: str = "America/Sao_Paulo"

    # Dashboard user (first user for this client)
    user_email: str
    user_password: str
    user_name: str

    # Channels (optional, can be added later)
    channels: list[ChannelConfig] = []

    # Secrets (optional)
    meta_master_token: Optional[str] = None
    gemini_api_key: Optional[str] = None
    openrouter_api_key: Optional[str] = None
    elevenlabs_api_key: Optional[str] = None

    # Agent config (optional)
    agent_name: Optional[str] = None
    agent_system_prompt: Optional[str] = None
    agent_llm_model: str = "gemini-2.0-flash"

    # Pipeline stages seed
    seed_pipeline: bool = True


class OnboardingStatusResponse(BaseModel):
    step: str
    status: str  # 'done', 'pending', 'manual'
    detail: Optional[str] = None


# ==================== Provision ====================

@router.post("/provision")
async def provision_client(
    body: ProvisionRequest,
    current_user: DashboardUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Provisiona um novo cliente completo em uma transação.

    Cria: company -> project -> channels -> project_secrets ->
          client -> dashboard_user -> agent (opcional) -> pipeline_stages (opcional)

    Retorna IDs de tudo criado + checklist de passos manuais.
    """
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Apenas admin pode provisionar clientes")

    results = {}

    # 1. Create company
    company_result = await db.execute(
        sa_text("""
            INSERT INTO companies (name)
            VALUES (:name)
            RETURNING id
        """),
        {"name": body.company_name}
    )
    company_id = str(company_result.scalar_one())
    results["company_id"] = company_id

    # 2. Create project
    webhook_path = body.webhook_path or f"/webhook/{body.project_slug}"
    project_result = await db.execute(
        sa_text("""
            INSERT INTO projects (company_id, project_slug, webhook_path)
            VALUES (CAST(:cid AS uuid), :slug, :webhook)
            RETURNING id
        """),
        {"cid": company_id, "slug": body.project_slug, "webhook": webhook_path}
    )
    project_id = str(project_result.scalar_one())
    results["project_id"] = project_id

    # 3. Create channels
    channel_ids = []
    for ch in body.channels:
        ch_result = await db.execute(
            sa_text("""
                INSERT INTO channels (project_id, channel_type, channel_identifier, access_token)
                VALUES (CAST(:pid AS uuid), :ct, :ci, :at)
                RETURNING id
            """),
            {
                "pid": project_id,
                "ct": ch.channel_type,
                "ci": ch.channel_identifier,
                "at": ch.access_token
            }
        )
        channel_ids.append(str(ch_result.scalar_one()))
    results["channel_ids"] = channel_ids

    # 4. Create project_secrets
    await db.execute(
        sa_text("""
            INSERT INTO project_secrets
                (project_id, meta_master_token, gemini_api_key,
                 openrouter_api_key, elevenlabs_api_key,
                 followup_enabled, feedback_enabled)
            VALUES
                (CAST(:pid AS uuid), :meta, :gemini, :openrouter, :elevenlabs, false, true)
        """),
        {
            "pid": project_id,
            "meta": body.meta_master_token or "",
            "gemini": body.gemini_api_key or "",
            "openrouter": body.openrouter_api_key or "",
            "elevenlabs": body.elevenlabs_api_key or "",
        }
    )

    # 5. Create dashboard client
    client_settings = {"project_id": project_id}
    client_result = await db.execute(
        sa_text("""
            INSERT INTO clients (name, slug, status, timezone, settings)
            VALUES (:name, :slug, 'active', :tz, CAST(:settings AS jsonb))
            RETURNING id
        """),
        {
            "name": body.client_name,
            "slug": body.client_slug,
            "tz": body.timezone,
            "settings": json.dumps(client_settings)
        }
    )
    client_id = str(client_result.scalar_one())
    results["client_id"] = client_id

    # 6. Create dashboard user
    from app.api.routes.auth import hash_password
    password_hash = hash_password(body.user_password)

    user_result = await db.execute(
        sa_text("""
            INSERT INTO dashboard_users (email, password_hash, name, role, client_id, is_active)
            VALUES (:email, :hash, :name, 'client', CAST(:cid AS uuid), true)
            RETURNING id
        """),
        {
            "email": body.user_email,
            "hash": password_hash,
            "name": body.user_name,
            "cid": client_id
        }
    )
    user_id = str(user_result.scalar_one())
    results["user_id"] = user_id

    # 7. Create agent (optional)
    if body.agent_name:
        system_prompt = body.agent_system_prompt or (
            f"Você é o assistente virtual da {body.company_name}. "
            "Responda de forma profissional e amigável. "
            "Se não souber a resposta, diga que vai verificar e retornará."
        )

        agent_result = await db.execute(
            sa_text("""
                INSERT INTO agents (project_id, name, system_prompt, llm_model, is_active)
                VALUES (CAST(:pid AS uuid), :name, :prompt, :model, true)
                RETURNING id
            """),
            {
                "pid": project_id,
                "name": body.agent_name,
                "prompt": system_prompt,
                "model": body.agent_llm_model
            }
        )
        results["agent_id"] = str(agent_result.scalar_one())

    # 8. Seed pipeline stages (optional)
    if body.seed_pipeline:
        defaults = [
            ("Novo Lead", "novo", 0, "#6366f1"),
            ("Qualificado", "qualificado", 1, "#8b5cf6"),
            ("Proposta", "proposta", 2, "#f59e0b"),
            ("Negociação", "negociacao", 3, "#3b82f6"),
            ("Fechado", "fechado", 4, "#10b981"),
            ("Perdido", "perdido", 5, "#ef4444"),
        ]
        for name, slug, pos, color in defaults:
            await db.execute(
                sa_text("""
                    INSERT INTO pipeline_stages (project_id, name, slug, position, color)
                    VALUES (CAST(:pid AS uuid), :name, :slug, :pos, :color)
                """),
                {"pid": project_id, "name": name, "slug": slug, "pos": pos, "color": color}
            )
        results["pipeline_seeded"] = True

    await db.commit()

    # Build checklist
    checklist = [
        {"step": "Criar company", "status": "done", "detail": f"ID: {company_id}"},
        {"step": "Criar project", "status": "done", "detail": f"ID: {project_id}, slug: {body.project_slug}"},
        {"step": "Criar channels", "status": "done" if channel_ids else "pending",
         "detail": f"{len(channel_ids)} canais criados" if channel_ids else "Adicionar canais via /api/config/channels"},
        {"step": "Criar project_secrets", "status": "done"},
        {"step": "Criar client dashboard", "status": "done", "detail": f"ID: {client_id}"},
        {"step": "Criar user dashboard", "status": "done", "detail": f"Email: {body.user_email}"},
        {"step": "Criar agente IA", "status": "done" if body.agent_name else "pending",
         "detail": results.get("agent_id", "Criar via /api/agents")},
        {"step": "Pipeline stages", "status": "done" if body.seed_pipeline else "pending"},
        {"step": "Subscribar WABA no webhook",
         "status": "manual",
         "detail": "Executar script de subscribe ou configurar no Meta Business Manager"},
        {"step": "Adicionar parceiro no Meta BM",
         "status": "manual",
         "detail": "Requer aprovação do cliente no Meta Business Manager"},
        {"step": "Atribuir ativos ao System User",
         "status": "manual",
         "detail": "Configurar no Meta Business Manager > System Users"},
        {"step": "Webhook subscriptions (FB/IG)",
         "status": "manual",
         "detail": "Configurar no Meta Developer Console > Webhooks"},
        {"step": "Cliente ativar msgs Instagram",
         "status": "manual",
         "detail": "Cliente deve ativar nas configurações do Instagram"},
        {"step": "Configurar follow-up",
         "status": "pending",
         "detail": "Configurar via dashboard /dash/config/followup"},
        {"step": "Upload knowledge base",
         "status": "pending",
         "detail": "Upload via dashboard /dash/rag ou /api/agents/{tenant}/knowledge"},
    ]

    return {
        "success": True,
        "results": results,
        "checklist": checklist,
        "message": f"Cliente {body.company_name} provisionado com sucesso!"
    }


# ==================== Checklist Status ====================

@router.get("/status/{tenant_id}")
async def get_onboarding_status(
    tenant_id: str,
    current_user: DashboardUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Retorna o status atual do onboarding de um cliente."""
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Apenas admin")

    # Find client
    client_result = await db.execute(
        sa_text("SELECT id, name, slug, settings FROM clients WHERE id = CAST(:cid AS uuid)"),
        {"cid": tenant_id}
    )
    client = client_result.mappings().first()
    if not client:
        raise HTTPException(status_code=404, detail="Cliente não encontrado")

    settings = client["settings"] or {}
    project_id = settings.get("project_id")

    if not project_id:
        return {"status": "incomplete", "detail": "Cliente sem project_id configurado"}

    # Check each component
    checks = []

    # Project exists?
    proj = await db.execute(
        sa_text("SELECT id, project_slug FROM projects WHERE id = CAST(:pid AS uuid)"),
        {"pid": project_id}
    )
    proj_row = proj.mappings().first()
    checks.append({
        "step": "Projeto",
        "status": "done" if proj_row else "missing",
        "detail": proj_row["project_slug"] if proj_row else None
    })

    # Channels?
    ch_count = await db.execute(
        sa_text("SELECT COUNT(*) FROM channels WHERE project_id = CAST(:pid AS uuid)"),
        {"pid": project_id}
    )
    n_channels = ch_count.scalar() or 0
    checks.append({
        "step": "Canais configurados",
        "status": "done" if n_channels > 0 else "pending",
        "detail": f"{n_channels} canais"
    })

    # Secrets?
    sec = await db.execute(
        sa_text("SELECT meta_master_token, gemini_api_key FROM project_secrets WHERE project_id = CAST(:pid AS uuid)"),
        {"pid": project_id}
    )
    sec_row = sec.mappings().first()
    checks.append({
        "step": "API Keys configuradas",
        "status": "done" if sec_row and (sec_row.get("gemini_api_key") or sec_row.get("meta_master_token")) else "pending"
    })

    # Agent?
    agent = await db.execute(
        sa_text("SELECT id, name FROM agents WHERE project_id = CAST(:pid AS uuid) AND is_active = true"),
        {"pid": project_id}
    )
    agent_row = agent.mappings().first()
    checks.append({
        "step": "Agente IA configurado",
        "status": "done" if agent_row else "pending",
        "detail": agent_row["name"] if agent_row else None
    })

    # Knowledge base?
    kb_count = await db.execute(
        sa_text("SELECT COUNT(*) FROM project_knowledge_base WHERE project_id = CAST(:pid AS uuid)"),
        {"pid": project_id}
    )
    n_kb = kb_count.scalar() or 0
    checks.append({
        "step": "Knowledge base",
        "status": "done" if n_kb > 0 else "pending",
        "detail": f"{n_kb} chunks"
    })

    # Pipeline stages?
    ps_count = await db.execute(
        sa_text("SELECT COUNT(*) FROM pipeline_stages WHERE project_id = CAST(:pid AS uuid)"),
        {"pid": project_id}
    )
    n_stages = ps_count.scalar() or 0
    checks.append({
        "step": "Pipeline configurado",
        "status": "done" if n_stages > 0 else "pending",
        "detail": f"{n_stages} etapas"
    })

    # Dashboard user?
    user_count = await db.execute(
        sa_text("SELECT COUNT(*) FROM dashboard_users WHERE client_id = CAST(:cid AS uuid) AND is_active = true"),
        {"cid": tenant_id}
    )
    n_users = user_count.scalar() or 0
    checks.append({
        "step": "Usuários dashboard",
        "status": "done" if n_users > 0 else "pending",
        "detail": f"{n_users} usuários"
    })

    # Manual steps (always pending)
    checks.extend([
        {"step": "WABA webhook subscription", "status": "manual"},
        {"step": "Meta BM partner access", "status": "manual"},
        {"step": "Instagram messaging enabled", "status": "manual"},
    ])

    done_count = sum(1 for c in checks if c["status"] == "done")
    total_auto = sum(1 for c in checks if c["status"] != "manual")

    return {
        "client": {"id": str(client["id"]), "name": client["name"]},
        "project_id": project_id,
        "progress": f"{done_count}/{total_auto}",
        "checks": checks
    }
