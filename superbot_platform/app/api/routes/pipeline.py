"""
SuperBot Platform - Pipeline de Vendas API
Equipe, etapas, atribuições, pool, métricas, handoffs.
"""
import json
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text as sa_text
from pydantic import BaseModel
from typing import Optional, Any
from datetime import datetime, timezone

from app.db.database import get_db
from app.db.models import DashboardUser
from app.api.routes.auth import get_current_user
from app.core.tenancy import resolve_project_id_for_user

router = APIRouter(prefix="/api/pipeline", tags=["pipeline"])


# ==================== Schemas ====================

class CreateStageRequest(BaseModel):
    name: str
    slug: str
    position: int = 0
    color: str = "#6366f1"
    auto_assign: bool = False


class UpdateStageRequest(BaseModel):
    name: Optional[str] = None
    position: Optional[int] = None
    color: Optional[str] = None
    auto_assign: Optional[bool] = None


class AddTeamMemberRequest(BaseModel):
    user_id: str
    role: str = "vendedor"
    max_concurrent_conversations: int = 10


class UpdateTeamMemberRequest(BaseModel):
    role: Optional[str] = None
    max_concurrent_conversations: Optional[int] = None
    is_available: Optional[bool] = None


class AssignConversationRequest(BaseModel):
    conversation_id: str
    channel_type: str
    assigned_to: str  # sales_team_member_id
    pipeline_stage_id: Optional[str] = None
    notes: Optional[str] = None


class MoveStageRequest(BaseModel):
    pipeline_stage_id: str
    notes: Optional[str] = None


class HandoffRequest(BaseModel):
    conversation_id: str
    channel_type: str
    to_type: str  # 'vendedor', 'gerente', 'bot', 'pool'
    to_id: Optional[str] = None
    reason: Optional[str] = None


# ==================== Pipeline Stages ====================

@router.get("/stages/{tenant_id}")
async def list_stages(
    tenant_id: str,
    current_user: DashboardUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Lista etapas do pipeline de um projeto."""
    project_id = await resolve_project_id_for_user(tenant_id, current_user, db)

    result = await db.execute(
        sa_text("""
            SELECT id, project_id, name, slug, position, color, auto_assign, created_at
            FROM pipeline_stages
            WHERE project_id = :pid::uuid
            ORDER BY position ASC
        """),
        {"pid": project_id}
    )
    stages = [dict(r) for r in result.mappings().all()]
    return {"stages": stages, "project_id": project_id}


@router.post("/stages/{tenant_id}")
async def create_stage(
    tenant_id: str,
    body: CreateStageRequest,
    current_user: DashboardUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Cria uma nova etapa no pipeline."""
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Apenas admin")

    project_id = await resolve_project_id_for_user(tenant_id, current_user, db)

    result = await db.execute(
        sa_text("""
            INSERT INTO pipeline_stages (project_id, name, slug, position, color, auto_assign)
            VALUES (:pid::uuid, :name, :slug, :pos, :color, :auto)
            RETURNING id, project_id, name, slug, position, color, auto_assign, created_at
        """),
        {
            "pid": project_id, "name": body.name, "slug": body.slug,
            "pos": body.position, "color": body.color, "auto": body.auto_assign
        }
    )
    stage = dict(result.mappings().first())
    await db.commit()
    return {"stage": stage}


@router.patch("/stages/{tenant_id}/{stage_id}")
async def update_stage(
    tenant_id: str,
    stage_id: str,
    body: UpdateStageRequest,
    current_user: DashboardUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Atualiza uma etapa do pipeline."""
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Apenas admin")

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
        UPDATE pipeline_stages SET {', '.join(set_clauses)}
        WHERE id = :sid::uuid AND project_id = :pid::uuid
        RETURNING id, project_id, name, slug, position, color, auto_assign
    """
    result = await db.execute(sa_text(sql), params)
    row = result.mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Etapa não encontrada")
    await db.commit()
    return {"stage": dict(row)}


@router.delete("/stages/{tenant_id}/{stage_id}")
async def delete_stage(
    tenant_id: str,
    stage_id: str,
    current_user: DashboardUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Remove uma etapa do pipeline."""
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Apenas admin")

    project_id = await resolve_project_id_for_user(tenant_id, current_user, db)

    result = await db.execute(
        sa_text("""
            DELETE FROM pipeline_stages
            WHERE id = :sid::uuid AND project_id = :pid::uuid
            RETURNING id
        """),
        {"sid": stage_id, "pid": project_id}
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Etapa não encontrada")
    await db.commit()
    return {"deleted": True}


@router.post("/stages/{tenant_id}/seed")
async def seed_default_stages(
    tenant_id: str,
    current_user: DashboardUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Cria etapas padrão do pipeline para o projeto."""
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Apenas admin")

    project_id = await resolve_project_id_for_user(tenant_id, current_user, db)

    # Verifica se já tem etapas
    existing = await db.execute(
        sa_text("SELECT COUNT(*) FROM pipeline_stages WHERE project_id = :pid::uuid"),
        {"pid": project_id}
    )
    if existing.scalar() > 0:
        raise HTTPException(status_code=409, detail="Projeto já tem etapas configuradas")

    defaults = [
        ("Novo Lead", "novo", 0, "#6366f1"),
        ("Qualificado", "qualificado", 1, "#8b5cf6"),
        ("Proposta", "proposta", 2, "#f59e0b"),
        ("Negociação", "negociacao", 3, "#3b82f6"),
        ("Fechado", "fechado", 4, "#10b981"),
        ("Perdido", "perdido", 5, "#ef4444"),
    ]

    stages = []
    for name, slug, pos, color in defaults:
        result = await db.execute(
            sa_text("""
                INSERT INTO pipeline_stages (project_id, name, slug, position, color)
                VALUES (:pid::uuid, :name, :slug, :pos, :color)
                RETURNING id, name, slug, position, color
            """),
            {"pid": project_id, "name": name, "slug": slug, "pos": pos, "color": color}
        )
        stages.append(dict(result.mappings().first()))

    await db.commit()
    return {"stages": stages, "count": len(stages)}


# ==================== Team Members ====================

@router.get("/team/{tenant_id}")
async def list_team(
    tenant_id: str,
    current_user: DashboardUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Lista membros da equipe de vendas."""
    project_id = await resolve_project_id_for_user(tenant_id, current_user, db)

    result = await db.execute(
        sa_text("""
            SELECT s.id, s.project_id, s.user_id, s.role,
                   s.max_concurrent_conversations, s.is_available,
                   s.created_at, s.updated_at,
                   u.name AS user_name, u.email AS user_email
            FROM sales_team_members s
            JOIN dashboard_users u ON u.id = s.user_id
            WHERE s.project_id = :pid::uuid
            ORDER BY s.role, u.name
        """),
        {"pid": project_id}
    )
    members = [dict(r) for r in result.mappings().all()]

    # Add active assignment count
    for member in members:
        count_result = await db.execute(
            sa_text("""
                SELECT COUNT(*) FROM conversation_assignments
                WHERE assigned_to = :mid::uuid AND status = 'active'
            """),
            {"mid": str(member["id"])}
        )
        member["active_conversations"] = count_result.scalar() or 0

    return {"team": members, "project_id": project_id}


@router.post("/team/{tenant_id}")
async def add_team_member(
    tenant_id: str,
    body: AddTeamMemberRequest,
    current_user: DashboardUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Adiciona membro à equipe de vendas."""
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Apenas admin")

    project_id = await resolve_project_id_for_user(tenant_id, current_user, db)

    result = await db.execute(
        sa_text("""
            INSERT INTO sales_team_members (project_id, user_id, role, max_concurrent_conversations)
            VALUES (:pid::uuid, :uid::uuid, :role, :max_conv)
            ON CONFLICT (project_id, user_id) DO UPDATE SET
                role = EXCLUDED.role,
                max_concurrent_conversations = EXCLUDED.max_concurrent_conversations,
                updated_at = now()
            RETURNING id, project_id, user_id, role, max_concurrent_conversations, is_available
        """),
        {
            "pid": project_id, "uid": body.user_id,
            "role": body.role, "max_conv": body.max_concurrent_conversations
        }
    )
    member = dict(result.mappings().first())
    await db.commit()
    return {"member": member}


@router.patch("/team/{tenant_id}/{member_id}")
async def update_team_member(
    tenant_id: str,
    member_id: str,
    body: UpdateTeamMemberRequest,
    current_user: DashboardUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Atualiza membro da equipe."""
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Apenas admin")

    project_id = await resolve_project_id_for_user(tenant_id, current_user, db)

    updates = body.model_dump(exclude_none=True)
    if not updates:
        raise HTTPException(status_code=400, detail="Nenhum campo")

    set_clauses = ["updated_at = now()"]
    params = {"mid": member_id, "pid": project_id}
    for key, value in updates.items():
        set_clauses.append(f"{key} = :{key}")
        params[key] = value

    sql = f"""
        UPDATE sales_team_members SET {', '.join(set_clauses)}
        WHERE id = :mid::uuid AND project_id = :pid::uuid
        RETURNING id, project_id, user_id, role, max_concurrent_conversations, is_available
    """
    result = await db.execute(sa_text(sql), params)
    row = result.mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Membro não encontrado")
    await db.commit()
    return {"member": dict(row)}


@router.delete("/team/{tenant_id}/{member_id}")
async def remove_team_member(
    tenant_id: str,
    member_id: str,
    current_user: DashboardUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Remove membro da equipe."""
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Apenas admin")

    project_id = await resolve_project_id_for_user(tenant_id, current_user, db)

    result = await db.execute(
        sa_text("""
            DELETE FROM sales_team_members
            WHERE id = :mid::uuid AND project_id = :pid::uuid
            RETURNING id
        """),
        {"mid": member_id, "pid": project_id}
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Membro não encontrado")
    await db.commit()
    return {"deleted": True}


# ==================== Assignments ====================

@router.get("/assignments/{tenant_id}")
async def list_assignments(
    tenant_id: str,
    status: str = Query("active", description="Filter: active, completed, all"),
    assigned_to: Optional[str] = Query(None, description="Filter by team member ID"),
    stage_id: Optional[str] = Query(None, description="Filter by pipeline stage"),
    current_user: DashboardUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Lista atribuições de conversas."""
    project_id = await resolve_project_id_for_user(tenant_id, current_user, db)

    where_clauses = ["ca.project_id = :pid::uuid"]
    params = {"pid": project_id}

    if status != "all":
        where_clauses.append("ca.status = :status")
        params["status"] = status

    if assigned_to:
        where_clauses.append("ca.assigned_to = :ato::uuid")
        params["ato"] = assigned_to

    if stage_id:
        where_clauses.append("ca.pipeline_stage_id = :sid::uuid")
        params["sid"] = stage_id

    where_sql = " AND ".join(where_clauses)

    result = await db.execute(
        sa_text(f"""
            SELECT ca.id, ca.project_id, ca.conversation_id, ca.channel_type,
                   ca.assigned_to, ca.assigned_by, ca.pipeline_stage_id,
                   ca.status, ca.notes, ca.assigned_at, ca.completed_at,
                   stm.role AS assignee_role,
                   du.name AS assignee_name,
                   ps.name AS stage_name, ps.color AS stage_color,
                   cs.last_text, cs.last_event_at, cs.summary_short
            FROM conversation_assignments ca
            LEFT JOIN sales_team_members stm ON stm.id = ca.assigned_to
            LEFT JOIN dashboard_users du ON du.id = stm.user_id
            LEFT JOIN pipeline_stages ps ON ps.id = ca.pipeline_stage_id
            LEFT JOIN conversation_states cs ON (
                cs.project_id = ca.project_id
                AND cs.conversation_id = ca.conversation_id
                AND cs.channel_type = ca.channel_type
            )
            WHERE {where_sql}
            ORDER BY ca.assigned_at DESC
        """),
        params
    )
    assignments = [dict(r) for r in result.mappings().all()]
    return {"assignments": assignments, "count": len(assignments)}


@router.post("/assign/{tenant_id}")
async def assign_conversation(
    tenant_id: str,
    body: AssignConversationRequest,
    current_user: DashboardUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Atribui uma conversa a um vendedor."""
    project_id = await resolve_project_id_for_user(tenant_id, current_user, db)

    # Mark any existing active assignment as reassigned
    await db.execute(
        sa_text("""
            UPDATE conversation_assignments
            SET status = 'reassigned', completed_at = now()
            WHERE project_id = :pid::uuid
              AND conversation_id = :cid
              AND channel_type = :ct
              AND status = 'active'
        """),
        {"pid": project_id, "cid": body.conversation_id, "ct": body.channel_type}
    )

    # Get first stage if none specified
    stage_id = body.pipeline_stage_id
    if not stage_id:
        stage_result = await db.execute(
            sa_text("""
                SELECT id FROM pipeline_stages
                WHERE project_id = :pid::uuid
                ORDER BY position ASC LIMIT 1
            """),
            {"pid": project_id}
        )
        first_stage = stage_result.scalar_one_or_none()
        stage_id = str(first_stage) if first_stage else None

    result = await db.execute(
        sa_text("""
            INSERT INTO conversation_assignments
                (project_id, conversation_id, channel_type,
                 assigned_to, assigned_by, pipeline_stage_id, notes)
            VALUES
                (:pid::uuid, :cid, :ct,
                 :ato::uuid, :aby::uuid, :sid::uuid, :notes)
            RETURNING id, project_id, conversation_id, channel_type,
                      assigned_to, assigned_by, pipeline_stage_id,
                      status, notes, assigned_at
        """),
        {
            "pid": project_id,
            "cid": body.conversation_id,
            "ct": body.channel_type,
            "ato": body.assigned_to,
            "aby": str(current_user.id),
            "sid": stage_id,
            "notes": body.notes
        }
    )

    assignment = dict(result.mappings().first())

    # Log handoff
    await db.execute(
        sa_text("""
            INSERT INTO handoff_history
                (project_id, conversation_id, channel_type, from_type, to_type, to_id, reason)
            VALUES
                (:pid::uuid, :cid, :ct, 'pool', 'vendedor', :to_id::uuid, :reason)
        """),
        {
            "pid": project_id,
            "cid": body.conversation_id,
            "ct": body.channel_type,
            "to_id": body.assigned_to,
            "reason": body.notes or "Assigned from pool"
        }
    )

    await db.commit()
    return {"assignment": assignment}


@router.patch("/assignments/{tenant_id}/{assignment_id}/stage")
async def move_assignment_stage(
    tenant_id: str,
    assignment_id: str,
    body: MoveStageRequest,
    current_user: DashboardUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Move uma atribuição para outra etapa do pipeline."""
    project_id = await resolve_project_id_for_user(tenant_id, current_user, db)

    result = await db.execute(
        sa_text("""
            UPDATE conversation_assignments
            SET pipeline_stage_id = :sid::uuid, notes = COALESCE(:notes, notes)
            WHERE id = :aid::uuid AND project_id = :pid::uuid AND status = 'active'
            RETURNING id, conversation_id, pipeline_stage_id, status
        """),
        {"aid": assignment_id, "pid": project_id, "sid": body.pipeline_stage_id, "notes": body.notes}
    )
    row = result.mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Atribuição não encontrada")
    await db.commit()
    return {"assignment": dict(row)}


@router.post("/assignments/{tenant_id}/{assignment_id}/complete")
async def complete_assignment(
    tenant_id: str,
    assignment_id: str,
    current_user: DashboardUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Marca uma atribuição como completa."""
    project_id = await resolve_project_id_for_user(tenant_id, current_user, db)

    result = await db.execute(
        sa_text("""
            UPDATE conversation_assignments
            SET status = 'completed', completed_at = now()
            WHERE id = :aid::uuid AND project_id = :pid::uuid AND status = 'active'
            RETURNING id, conversation_id, status
        """),
        {"aid": assignment_id, "pid": project_id}
    )
    row = result.mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Atribuição não encontrada")
    await db.commit()
    return {"assignment": dict(row)}


# ==================== Pool (unassigned conversations) ====================

@router.get("/pool/{tenant_id}")
async def get_pool(
    tenant_id: str,
    current_user: DashboardUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Lista conversas não atribuídas (pré-qualificadas pelo bot).
    Conversas abertas sem assignment ativo = pool.
    """
    project_id = await resolve_project_id_for_user(tenant_id, current_user, db)

    result = await db.execute(
        sa_text("""
            SELECT cs.conversation_id, cs.channel_type, cs.channel_identifier,
                   cs.status, cs.last_event_at, cs.last_text, cs.last_direction,
                   cs.ai_state, cs.summary_short, cs.created_at
            FROM conversation_states cs
            WHERE cs.project_id = :pid::uuid
              AND cs.status IN ('open', 'waiting_customer')
              AND NOT EXISTS (
                  SELECT 1 FROM conversation_assignments ca
                  WHERE ca.project_id = cs.project_id
                    AND ca.conversation_id = cs.conversation_id
                    AND ca.channel_type = cs.channel_type
                    AND ca.status = 'active'
              )
            ORDER BY cs.last_event_at DESC
            LIMIT 100
        """),
        {"pid": project_id}
    )
    pool = [dict(r) for r in result.mappings().all()]
    return {"pool": pool, "count": len(pool)}


# ==================== Handoffs ====================

@router.post("/handoff/{tenant_id}")
async def create_handoff(
    tenant_id: str,
    body: HandoffRequest,
    current_user: DashboardUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Cria um handoff (bot -> vendedor, vendedor -> gerente, etc)."""
    project_id = await resolve_project_id_for_user(tenant_id, current_user, db)

    # Determine from_type from current assignment
    current = await db.execute(
        sa_text("""
            SELECT ca.assigned_to, stm.role
            FROM conversation_assignments ca
            LEFT JOIN sales_team_members stm ON stm.id = ca.assigned_to
            WHERE ca.project_id = :pid::uuid
              AND ca.conversation_id = :cid
              AND ca.channel_type = :ct
              AND ca.status = 'active'
        """),
        {"pid": project_id, "cid": body.conversation_id, "ct": body.channel_type}
    )
    current_row = current.mappings().first()
    from_type = current_row["role"] if current_row else "bot"
    from_id = str(current_row["assigned_to"]) if current_row and current_row["assigned_to"] else None

    # Log handoff
    result = await db.execute(
        sa_text("""
            INSERT INTO handoff_history
                (project_id, conversation_id, channel_type,
                 from_type, from_id, to_type, to_id, reason)
            VALUES
                (:pid::uuid, :cid, :ct,
                 :ft, :fi::uuid, :tt, :ti::uuid, :reason)
            RETURNING id, project_id, conversation_id, from_type, to_type, reason, created_at
        """),
        {
            "pid": project_id,
            "cid": body.conversation_id,
            "ct": body.channel_type,
            "ft": from_type,
            "fi": from_id,
            "tt": body.to_type,
            "ti": body.to_id,
            "reason": body.reason
        }
    )
    handoff = dict(result.mappings().first())

    # If assigning to a specific person, create/update assignment
    if body.to_id and body.to_type in ("vendedor", "gerente"):
        # Close current assignment
        await db.execute(
            sa_text("""
                UPDATE conversation_assignments
                SET status = 'reassigned', completed_at = now()
                WHERE project_id = :pid::uuid
                  AND conversation_id = :cid
                  AND channel_type = :ct
                  AND status = 'active'
            """),
            {"pid": project_id, "cid": body.conversation_id, "ct": body.channel_type}
        )

        # Create new assignment
        await db.execute(
            sa_text("""
                INSERT INTO conversation_assignments
                    (project_id, conversation_id, channel_type,
                     assigned_to, assigned_by, notes)
                VALUES
                    (:pid::uuid, :cid, :ct,
                     :ato::uuid, :aby::uuid, :notes)
            """),
            {
                "pid": project_id,
                "cid": body.conversation_id,
                "ct": body.channel_type,
                "ato": body.to_id,
                "aby": str(current_user.id),
                "notes": body.reason
            }
        )

    await db.commit()
    return {"handoff": handoff}


@router.get("/handoffs/{tenant_id}")
async def list_handoffs(
    tenant_id: str,
    conversation_id: Optional[str] = None,
    limit: int = Query(50, ge=1, le=200),
    current_user: DashboardUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Lista histórico de handoffs."""
    project_id = await resolve_project_id_for_user(tenant_id, current_user, db)

    params = {"pid": project_id, "lim": limit}
    where = "hh.project_id = :pid::uuid"

    if conversation_id:
        where += " AND hh.conversation_id = :cid"
        params["cid"] = conversation_id

    result = await db.execute(
        sa_text(f"""
            SELECT hh.id, hh.project_id, hh.conversation_id, hh.channel_type,
                   hh.from_type, hh.from_id, hh.to_type, hh.to_id,
                   hh.reason, hh.created_at
            FROM handoff_history hh
            WHERE {where}
            ORDER BY hh.created_at DESC
            LIMIT :lim
        """),
        params
    )
    handoffs = [dict(r) for r in result.mappings().all()]
    return {"handoffs": handoffs, "count": len(handoffs)}


# ==================== Metrics ====================

@router.get("/metrics/{tenant_id}")
async def get_metrics(
    tenant_id: str,
    current_user: DashboardUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Métricas do pipeline: por vendedor, por etapa, resumo geral."""
    project_id = await resolve_project_id_for_user(tenant_id, current_user, db)

    # Per-member metrics
    members_result = await db.execute(
        sa_text("""
            SELECT stm.id, du.name,
                   COUNT(ca.id) FILTER (WHERE ca.status = 'active') AS active_count,
                   COUNT(ca.id) FILTER (WHERE ca.status = 'completed') AS completed_count,
                   COUNT(ca.id) AS total_count
            FROM sales_team_members stm
            JOIN dashboard_users du ON du.id = stm.user_id
            LEFT JOIN conversation_assignments ca ON ca.assigned_to = stm.id
            WHERE stm.project_id = :pid::uuid
            GROUP BY stm.id, du.name
            ORDER BY du.name
        """),
        {"pid": project_id}
    )
    by_member = [dict(r) for r in members_result.mappings().all()]

    # Per-stage metrics
    stages_result = await db.execute(
        sa_text("""
            SELECT ps.id, ps.name, ps.color, ps.position,
                   COUNT(ca.id) FILTER (WHERE ca.status = 'active') AS active_count
            FROM pipeline_stages ps
            LEFT JOIN conversation_assignments ca ON ca.pipeline_stage_id = ps.id AND ca.status = 'active'
            WHERE ps.project_id = :pid::uuid
            GROUP BY ps.id, ps.name, ps.color, ps.position
            ORDER BY ps.position
        """),
        {"pid": project_id}
    )
    by_stage = [dict(r) for r in stages_result.mappings().all()]

    # Pool count
    pool_result = await db.execute(
        sa_text("""
            SELECT COUNT(*) FROM conversation_states cs
            WHERE cs.project_id = :pid::uuid
              AND cs.status IN ('open', 'waiting_customer')
              AND NOT EXISTS (
                  SELECT 1 FROM conversation_assignments ca
                  WHERE ca.project_id = cs.project_id
                    AND ca.conversation_id = cs.conversation_id
                    AND ca.channel_type = cs.channel_type
                    AND ca.status = 'active'
              )
        """),
        {"pid": project_id}
    )
    pool_count = pool_result.scalar() or 0

    return {
        "by_member": by_member,
        "by_stage": by_stage,
        "pool_count": pool_count,
        "project_id": project_id
    }
