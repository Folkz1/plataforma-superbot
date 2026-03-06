"""
SuperBot Platform - Follow-up Stages API
Cadencia configuravel com prompt IA e midia por estagio.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text as sa_text
from pydantic import BaseModel
from typing import Optional

from app.db.database import get_db
from app.db.models import DashboardUser
from app.api.routes.auth import get_current_user
from app.core.tenancy import resolve_project_id_for_user

router = APIRouter(prefix="/api/followup-stages", tags=["followup-stages"])


# ==================== Schemas ====================

class CreateStageRequest(BaseModel):
    name: str
    position: int = 0
    delay_hours: int = 24
    delay_minutes: int = 0
    ai_prompt: str = ""
    template_name: str = ""
    language_code: str = "pt_BR"
    media_ids: list[str] = []
    is_active: bool = True


class UpdateStageRequest(BaseModel):
    name: Optional[str] = None
    position: Optional[int] = None
    delay_hours: Optional[int] = None
    delay_minutes: Optional[int] = None
    ai_prompt: Optional[str] = None
    template_name: Optional[str] = None
    language_code: Optional[str] = None
    media_ids: Optional[list[str]] = None
    is_active: Optional[bool] = None


class ReorderRequest(BaseModel):
    stage_ids: list[str]


# ==================== CRUD ====================

@router.get("/{tenant_id}")
async def list_stages(
    tenant_id: str,
    current_user: DashboardUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Lista estagios de follow-up do projeto."""
    project_id = await resolve_project_id_for_user(tenant_id, current_user, db)

    result = await db.execute(
        sa_text("""
            SELECT id, project_id, position, name, delay_hours, delay_minutes,
                   ai_prompt, template_name, language_code, media_ids, is_active, created_at
            FROM followup_stages
            WHERE project_id = CAST(:pid AS uuid)
            ORDER BY position ASC
        """),
        {"pid": project_id}
    )
    stages = [dict(r) for r in result.mappings().all()]
    return {"stages": stages}


@router.post("/{tenant_id}")
async def create_stage(
    tenant_id: str,
    body: CreateStageRequest,
    current_user: DashboardUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Cria estagio de follow-up."""
    if current_user.role not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Sem permissao")

    project_id = await resolve_project_id_for_user(tenant_id, current_user, db)

    # Auto-position if 0
    if body.position == 0:
        max_pos = await db.execute(
            sa_text("SELECT COALESCE(MAX(position), -1) FROM followup_stages WHERE project_id = CAST(:pid AS uuid)"),
            {"pid": project_id}
        )
        body.position = (max_pos.scalar() or 0) + 1

    result = await db.execute(
        sa_text("""
            INSERT INTO followup_stages
                (project_id, position, name, delay_hours, delay_minutes,
                 ai_prompt, template_name, language_code, media_ids, is_active)
            VALUES
                (CAST(:pid AS uuid), :pos, :name, :dh, :dm,
                 :prompt, :template, :lang, :media, :active)
            RETURNING id, project_id, position, name, delay_hours, delay_minutes,
                      ai_prompt, template_name, language_code, media_ids, is_active, created_at
        """),
        {
            "pid": project_id, "pos": body.position, "name": body.name,
            "dh": body.delay_hours, "dm": body.delay_minutes,
            "prompt": body.ai_prompt, "template": body.template_name,
            "lang": body.language_code, "media": body.media_ids, "active": body.is_active
        }
    )
    stage = dict(result.mappings().first())
    await db.commit()
    return {"stage": stage}


@router.patch("/{tenant_id}/{stage_id}")
async def update_stage(
    tenant_id: str,
    stage_id: str,
    body: UpdateStageRequest,
    current_user: DashboardUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Atualiza estagio de follow-up."""
    if current_user.role not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Sem permissao")

    project_id = await resolve_project_id_for_user(tenant_id, current_user, db)
    updates = body.model_dump(exclude_none=True)
    if not updates:
        raise HTTPException(status_code=400, detail="Nenhum campo")

    set_clauses = []
    params = {"sid": stage_id, "pid": project_id}
    for key, value in updates.items():
        set_clauses.append(f"{key} = :{key}")
        params[key] = value

    sql = f"""
        UPDATE followup_stages SET {', '.join(set_clauses)}
        WHERE id = CAST(:sid AS uuid) AND project_id = CAST(:pid AS uuid)
        RETURNING id, project_id, position, name, delay_hours, delay_minutes,
                  ai_prompt, template_name, language_code, media_ids, is_active, created_at
    """
    result = await db.execute(sa_text(sql), params)
    row = result.mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Estagio nao encontrado")
    await db.commit()
    return {"stage": dict(row)}


@router.delete("/{tenant_id}/{stage_id}")
async def delete_stage(
    tenant_id: str,
    stage_id: str,
    current_user: DashboardUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Remove estagio de follow-up."""
    if current_user.role not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Sem permissao")

    project_id = await resolve_project_id_for_user(tenant_id, current_user, db)

    result = await db.execute(
        sa_text("""
            DELETE FROM followup_stages
            WHERE id = CAST(:sid AS uuid) AND project_id = CAST(:pid AS uuid)
            RETURNING id
        """),
        {"sid": stage_id, "pid": project_id}
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Estagio nao encontrado")
    await db.commit()
    return {"deleted": True}


@router.post("/{tenant_id}/reorder")
async def reorder_stages(
    tenant_id: str,
    body: ReorderRequest,
    current_user: DashboardUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Reordena estagios de follow-up."""
    if current_user.role not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Sem permissao")

    project_id = await resolve_project_id_for_user(tenant_id, current_user, db)

    for i, stage_id in enumerate(body.stage_ids):
        await db.execute(
            sa_text("""
                UPDATE followup_stages SET position = :pos
                WHERE id = CAST(:sid AS uuid) AND project_id = CAST(:pid AS uuid)
            """),
            {"pos": i, "sid": stage_id, "pid": project_id}
        )

    await db.commit()
    return {"reordered": True, "count": len(body.stage_ids)}
