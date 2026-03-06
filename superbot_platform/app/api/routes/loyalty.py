"""
SuperBot Platform - Loyalty Club API (Clube da Julia)
Clubs, membros, campanhas/newsletter.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text as sa_text
from pydantic import BaseModel
from typing import Optional
from datetime import datetime

from app.db.database import get_db
from app.db.models import DashboardUser
from app.api.routes.auth import get_current_user
from app.core.tenancy import resolve_project_id_for_user

router = APIRouter(prefix="/api/loyalty", tags=["loyalty"])


# ==================== Schemas ====================

class CreateClubRequest(BaseModel):
    name: str
    description: str = ""
    welcome_message: str = ""
    active: bool = True


class UpdateClubRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    welcome_message: Optional[str] = None
    active: Optional[bool] = None


class AddMemberRequest(BaseModel):
    phone: str
    name: str = ""
    email: str = ""
    source: str = "manual"


class CreateCampaignRequest(BaseModel):
    name: str
    campaign_type: str = "manual"  # manual, scheduled
    template_name: str = ""
    ai_prompt: str = ""
    media_ids: list[str] = []
    scheduled_at: Optional[str] = None


class UpdateCampaignRequest(BaseModel):
    name: Optional[str] = None
    template_name: Optional[str] = None
    ai_prompt: Optional[str] = None
    media_ids: Optional[list[str]] = None
    scheduled_at: Optional[str] = None
    status: Optional[str] = None


# ==================== Clubs ====================

@router.get("/clubs/{tenant_id}")
async def list_clubs(
    tenant_id: str,
    current_user: DashboardUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Lista clubes do projeto."""
    project_id = await resolve_project_id_for_user(tenant_id, current_user, db)

    result = await db.execute(
        sa_text("""
            SELECT c.id, c.project_id, c.name, c.description, c.active,
                   c.welcome_message, c.settings, c.created_at,
                   (SELECT COUNT(*) FROM club_members m WHERE m.club_id = c.id) AS member_count
            FROM loyalty_clubs c
            WHERE c.project_id = CAST(:pid AS uuid)
            ORDER BY c.created_at DESC
        """),
        {"pid": project_id}
    )
    clubs = [dict(r) for r in result.mappings().all()]
    return {"clubs": clubs}


@router.post("/clubs/{tenant_id}")
async def create_club(
    tenant_id: str,
    body: CreateClubRequest,
    current_user: DashboardUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Cria um clube de fidelidade."""
    if current_user.role not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Sem permissao")

    project_id = await resolve_project_id_for_user(tenant_id, current_user, db)

    result = await db.execute(
        sa_text("""
            INSERT INTO loyalty_clubs (project_id, name, description, welcome_message, active)
            VALUES (CAST(:pid AS uuid), :name, :desc, :welcome, :active)
            RETURNING id, project_id, name, description, active, welcome_message, created_at
        """),
        {
            "pid": project_id, "name": body.name, "desc": body.description,
            "welcome": body.welcome_message, "active": body.active
        }
    )
    club = dict(result.mappings().first())
    await db.commit()
    return {"club": club}


@router.patch("/clubs/{tenant_id}/{club_id}")
async def update_club(
    tenant_id: str,
    club_id: str,
    body: UpdateClubRequest,
    current_user: DashboardUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Atualiza clube."""
    if current_user.role not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Sem permissao")

    project_id = await resolve_project_id_for_user(tenant_id, current_user, db)
    updates = body.model_dump(exclude_none=True)
    if not updates:
        raise HTTPException(status_code=400, detail="Nenhum campo")

    set_clauses = []
    params = {"cid": club_id, "pid": project_id}
    for key, value in updates.items():
        set_clauses.append(f"{key} = :{key}")
        params[key] = value

    sql = f"""
        UPDATE loyalty_clubs SET {', '.join(set_clauses)}
        WHERE id = CAST(:cid AS uuid) AND project_id = CAST(:pid AS uuid)
        RETURNING id, project_id, name, description, active, welcome_message, created_at
    """
    result = await db.execute(sa_text(sql), params)
    row = result.mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Clube nao encontrado")
    await db.commit()
    return {"club": dict(row)}


@router.delete("/clubs/{tenant_id}/{club_id}")
async def delete_club(
    tenant_id: str,
    club_id: str,
    current_user: DashboardUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Remove clube (e todos membros/campanhas)."""
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Apenas admin")

    project_id = await resolve_project_id_for_user(tenant_id, current_user, db)

    result = await db.execute(
        sa_text("""
            DELETE FROM loyalty_clubs
            WHERE id = CAST(:cid AS uuid) AND project_id = CAST(:pid AS uuid)
            RETURNING id
        """),
        {"cid": club_id, "pid": project_id}
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Clube nao encontrado")
    await db.commit()
    return {"deleted": True}


# ==================== Members ====================

@router.get("/members/{tenant_id}/{club_id}")
async def list_members(
    tenant_id: str,
    club_id: str,
    search: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    current_user: DashboardUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Lista membros de um clube."""
    project_id = await resolve_project_id_for_user(tenant_id, current_user, db)

    # Verify club belongs to project
    chk = await db.execute(
        sa_text("SELECT 1 FROM loyalty_clubs WHERE id = CAST(:cid AS uuid) AND project_id = CAST(:pid AS uuid)"),
        {"cid": club_id, "pid": project_id}
    )
    if not chk.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Clube nao encontrado")

    where = ["club_id = CAST(:cid AS uuid)"]
    params: dict = {"cid": club_id, "lim": limit, "off": offset}

    if search:
        where.append("(phone ILIKE :search OR name ILIKE :search OR email ILIKE :search)")
        params["search"] = f"%{search}%"

    where_sql = " AND ".join(where)

    result = await db.execute(
        sa_text(f"""
            SELECT id, club_id, phone, name, email, source, metadata, joined_at
            FROM club_members
            WHERE {where_sql}
            ORDER BY joined_at DESC
            LIMIT :lim OFFSET :off
        """),
        params
    )
    members = [dict(r) for r in result.mappings().all()]

    count_result = await db.execute(
        sa_text(f"SELECT COUNT(*) FROM club_members WHERE {where_sql}"),
        params
    )
    total = count_result.scalar() or 0

    return {"members": members, "total": total}


@router.post("/members/{tenant_id}/{club_id}")
async def add_member(
    tenant_id: str,
    club_id: str,
    body: AddMemberRequest,
    current_user: DashboardUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Adiciona membro ao clube."""
    if current_user.role not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Sem permissao")

    project_id = await resolve_project_id_for_user(tenant_id, current_user, db)

    chk = await db.execute(
        sa_text("SELECT 1 FROM loyalty_clubs WHERE id = CAST(:cid AS uuid) AND project_id = CAST(:pid AS uuid)"),
        {"cid": club_id, "pid": project_id}
    )
    if not chk.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Clube nao encontrado")

    # Upsert by phone
    result = await db.execute(
        sa_text("""
            INSERT INTO club_members (club_id, phone, name, email, source)
            VALUES (CAST(:cid AS uuid), :phone, :name, :email, :source)
            ON CONFLICT (club_id, phone) DO UPDATE SET
                name = COALESCE(NULLIF(EXCLUDED.name, ''), club_members.name),
                email = COALESCE(NULLIF(EXCLUDED.email, ''), club_members.email)
            RETURNING id, club_id, phone, name, email, source, joined_at
        """),
        {"cid": club_id, "phone": body.phone, "name": body.name, "email": body.email, "source": body.source}
    )
    member = dict(result.mappings().first())
    await db.commit()
    return {"member": member}


@router.delete("/members/{tenant_id}/{club_id}/{member_id}")
async def remove_member(
    tenant_id: str,
    club_id: str,
    member_id: str,
    current_user: DashboardUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Remove membro do clube."""
    if current_user.role not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Sem permissao")

    project_id = await resolve_project_id_for_user(tenant_id, current_user, db)

    result = await db.execute(
        sa_text("""
            DELETE FROM club_members
            WHERE id = CAST(:mid AS uuid)
              AND club_id = CAST(:cid AS uuid)
              AND club_id IN (
                  SELECT id FROM loyalty_clubs WHERE project_id = CAST(:pid AS uuid)
              )
            RETURNING id
        """),
        {"mid": member_id, "cid": club_id, "pid": project_id}
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Membro nao encontrado")
    await db.commit()
    return {"deleted": True}


# ==================== Campaigns ====================

@router.get("/campaigns/{tenant_id}/{club_id}")
async def list_campaigns(
    tenant_id: str,
    club_id: str,
    current_user: DashboardUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Lista campanhas de um clube."""
    project_id = await resolve_project_id_for_user(tenant_id, current_user, db)

    chk = await db.execute(
        sa_text("SELECT 1 FROM loyalty_clubs WHERE id = CAST(:cid AS uuid) AND project_id = CAST(:pid AS uuid)"),
        {"cid": club_id, "pid": project_id}
    )
    if not chk.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Clube nao encontrado")

    result = await db.execute(
        sa_text("""
            SELECT id, club_id, name, campaign_type, template_name, ai_prompt,
                   media_ids, scheduled_at, sent_at, recipients_count, status, created_at
            FROM club_campaigns
            WHERE club_id = CAST(:cid AS uuid)
            ORDER BY created_at DESC
        """),
        {"cid": club_id}
    )
    campaigns = [dict(r) for r in result.mappings().all()]
    return {"campaigns": campaigns}


@router.post("/campaigns/{tenant_id}/{club_id}")
async def create_campaign(
    tenant_id: str,
    club_id: str,
    body: CreateCampaignRequest,
    current_user: DashboardUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Cria campanha no clube."""
    if current_user.role not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Sem permissao")

    project_id = await resolve_project_id_for_user(tenant_id, current_user, db)

    chk = await db.execute(
        sa_text("SELECT 1 FROM loyalty_clubs WHERE id = CAST(:cid AS uuid) AND project_id = CAST(:pid AS uuid)"),
        {"cid": club_id, "pid": project_id}
    )
    if not chk.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Clube nao encontrado")

    status = "scheduled" if body.scheduled_at else "draft"

    result = await db.execute(
        sa_text("""
            INSERT INTO club_campaigns (club_id, name, campaign_type, template_name, ai_prompt, media_ids, scheduled_at, status)
            VALUES (CAST(:cid AS uuid), :name, :ctype, :template, :prompt, :media, :sched, :status)
            RETURNING id, club_id, name, campaign_type, template_name, ai_prompt, media_ids,
                      scheduled_at, sent_at, recipients_count, status, created_at
        """),
        {
            "cid": club_id, "name": body.name, "ctype": body.campaign_type,
            "template": body.template_name, "prompt": body.ai_prompt,
            "media": body.media_ids, "sched": body.scheduled_at, "status": status
        }
    )
    campaign = dict(result.mappings().first())
    await db.commit()
    return {"campaign": campaign}


@router.patch("/campaigns/{tenant_id}/{club_id}/{campaign_id}")
async def update_campaign(
    tenant_id: str,
    club_id: str,
    campaign_id: str,
    body: UpdateCampaignRequest,
    current_user: DashboardUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Atualiza campanha."""
    if current_user.role not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Sem permissao")

    project_id = await resolve_project_id_for_user(tenant_id, current_user, db)

    updates = body.model_dump(exclude_none=True)
    if not updates:
        raise HTTPException(status_code=400, detail="Nenhum campo")

    set_clauses = []
    params = {"cpid": campaign_id, "cid": club_id, "pid": project_id}
    for key, value in updates.items():
        set_clauses.append(f"{key} = :{key}")
        params[key] = value

    sql = f"""
        UPDATE club_campaigns SET {', '.join(set_clauses)}
        WHERE id = CAST(:cpid AS uuid)
          AND club_id = CAST(:cid AS uuid)
          AND club_id IN (
              SELECT id FROM loyalty_clubs WHERE project_id = CAST(:pid AS uuid)
          )
        RETURNING id, club_id, name, campaign_type, template_name, status, created_at
    """
    result = await db.execute(sa_text(sql), params)
    row = result.mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Campanha nao encontrada")
    await db.commit()
    return {"campaign": dict(row)}


@router.delete("/campaigns/{tenant_id}/{club_id}/{campaign_id}")
async def delete_campaign(
    tenant_id: str,
    club_id: str,
    campaign_id: str,
    current_user: DashboardUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Remove campanha."""
    if current_user.role not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Sem permissao")

    project_id = await resolve_project_id_for_user(tenant_id, current_user, db)

    result = await db.execute(
        sa_text("""
            DELETE FROM club_campaigns
            WHERE id = CAST(:cpid AS uuid)
              AND club_id = CAST(:cid AS uuid)
              AND club_id IN (
                  SELECT id FROM loyalty_clubs WHERE project_id = CAST(:pid AS uuid)
              )
            RETURNING id
        """),
        {"cpid": campaign_id, "cid": club_id, "pid": project_id}
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Campanha nao encontrada")
    await db.commit()
    return {"deleted": True}
