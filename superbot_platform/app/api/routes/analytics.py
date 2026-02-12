"""
Analytics API routes for SuperBot Dashboard.

Reads from the shared multitenant tables:
- public.conversation_states
- public.conversation_events
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.routes.auth import get_current_user
from app.core.tenancy import resolve_project_id_for_user
from app.db.database import get_db
from app.db.models import DashboardUser

router = APIRouter(prefix="/api", tags=["analytics"])


def _format_duration(seconds: float | None) -> str:
    if seconds is None or seconds <= 0:
        return "—"
    minutes = int(round(seconds / 60))
    hours = minutes // 60
    mins = minutes % 60
    if hours > 0:
        return f"{hours}h {mins:02d}m"
    return f"{mins}m"


@router.get("/analytics/overview/{tenant_or_project_id}")
async def get_analytics_overview(
    tenant_or_project_id: str,
    days: int = Query(default=30, ge=1, le=365),
    db: AsyncSession = Depends(get_db),
    current_user: DashboardUser = Depends(get_current_user),
) -> dict[str, Any]:
    """
    KPIs principais do projeto (real data).

    `tenant_or_project_id` accepts either:
    - dashboard clients.id (tenant), OR
    - multitenant projects.id
    """
    project_id = await resolve_project_id_for_user(tenant_or_project_id, current_user, db)
    project_uuid = UUID(project_id)

    since = datetime.now(timezone.utc) - timedelta(days=days)

    total_conv = await db.execute(
        text("SELECT count(*) FROM conversation_states WHERE project_id = (:pid)::uuid"),
        {"pid": str(project_uuid)},
    )
    total_conversations = int(total_conv.scalar_one() or 0)

    period_conv = await db.execute(
        text(
            "SELECT count(*) FROM conversation_states "
            "WHERE project_id = (:pid)::uuid AND last_event_at >= :since"
        ),
        {"pid": str(project_uuid), "since": since},
    )
    period_conversations = int(period_conv.scalar_one() or 0)

    active_conv = await db.execute(
        text(
            "SELECT count(*) FROM conversation_states "
            "WHERE project_id = (:pid)::uuid AND status NOT IN ('closed','handoff','do_not_contact')"
        ),
        {"pid": str(project_uuid)},
    )
    active_conversations = int(active_conv.scalar_one() or 0)

    closed_period = await db.execute(
        text(
            "SELECT count(*) FROM conversation_states "
            "WHERE project_id = (:pid)::uuid AND status = 'closed' AND closed_at >= :since"
        ),
        {"pid": str(project_uuid), "since": since},
    )
    closed_in_period = int(closed_period.scalar_one() or 0)

    resolution_rate = round((closed_in_period / period_conversations) * 100, 1) if period_conversations else 0.0

    total_msgs = await db.execute(
        text("SELECT count(*) FROM conversation_events WHERE project_id = (:pid)::uuid"),
        {"pid": str(project_uuid)},
    )
    total_messages = int(total_msgs.scalar_one() or 0)

    period_msgs = await db.execute(
        text(
            "SELECT count(*) FROM conversation_events "
            "WHERE project_id = (:pid)::uuid AND created_at >= :since"
        ),
        {"pid": str(project_uuid), "since": since},
    )
    period_messages = int(period_msgs.scalar_one() or 0)

    avg_resp = await db.execute(
        text(
            "SELECT AVG(EXTRACT(EPOCH FROM (last_out_at - last_in_at))) "
            "FROM conversation_states "
            "WHERE project_id = (:pid)::uuid "
            "  AND last_in_at IS NOT NULL "
            "  AND last_out_at IS NOT NULL "
            "  AND last_out_at >= last_in_at "
            "  AND last_event_at >= :since"
        ),
        {"pid": str(project_uuid), "since": since},
    )
    avg_response_seconds = avg_resp.scalar_one_or_none()

    return {
        "total_conversations": total_conversations,
        "period_conversations": period_conversations,
        "active_conversations": active_conversations,
        "resolution_rate": resolution_rate,
        "total_messages": total_messages,
        "period_messages": period_messages,
        "avg_response_time": _format_duration(float(avg_response_seconds) if avg_response_seconds else None),
        "period_days": days,
    }


@router.get("/analytics/timeline/{tenant_or_project_id}")
async def get_analytics_timeline(
    tenant_or_project_id: str,
    days: int = Query(default=30, ge=1, le=365),
    db: AsyncSession = Depends(get_db),
    current_user: DashboardUser = Depends(get_current_user),
) -> dict[str, Any]:
    """
    Timeline de conversas e mensagens por dia (real data).
    """
    project_id = await resolve_project_id_for_user(tenant_or_project_id, current_user, db)
    project_uuid = UUID(project_id)

    since = datetime.now(timezone.utc) - timedelta(days=days)

    rows = await db.execute(
        text(
            """
            WITH days AS (
              SELECT generate_series(
                date_trunc('day', CAST(:since AS timestamptz)),
                date_trunc('day', now()),
                interval '1 day'
              ) AS day
            ),
            conv AS (
              SELECT date_trunc('day', last_event_at) AS day, count(*) AS conversations
              FROM conversation_states
              WHERE project_id = (:pid)::uuid
                AND last_event_at >= :since
              GROUP BY 1
            ),
            msgs AS (
              SELECT date_trunc('day', created_at) AS day, count(*) AS messages
              FROM conversation_events
              WHERE project_id = (:pid)::uuid
                AND created_at >= :since
              GROUP BY 1
            )
            SELECT
              to_char(d.day, 'YYYY-MM-DD') AS date,
              COALESCE(c.conversations, 0) AS conversations,
              COALESCE(m.messages, 0) AS messages
            FROM days d
            LEFT JOIN conv c ON c.day = d.day
            LEFT JOIN msgs m ON m.day = d.day
            ORDER BY d.day
            """
        ),
        {"pid": str(project_uuid), "since": since},
    )

    timeline = [
        {"date": r["date"], "conversations": int(r["conversations"]), "messages": int(r["messages"])}
        for r in rows.mappings().all()
    ]

    return {"timeline": timeline}


@router.get("/analytics/channels/{tenant_or_project_id}")
async def get_analytics_channels(
    tenant_or_project_id: str,
    days: int = Query(default=30, ge=1, le=365),
    db: AsyncSession = Depends(get_db),
    current_user: DashboardUser = Depends(get_current_user),
) -> dict[str, Any]:
    """
    Distribuição de conversas por canal (real data).
    """
    project_id = await resolve_project_id_for_user(tenant_or_project_id, current_user, db)
    project_uuid = UUID(project_id)

    since = datetime.now(timezone.utc) - timedelta(days=days)

    result = await db.execute(
        text(
            "SELECT channel_type, count(*) AS cnt "
            "FROM conversation_states "
            "WHERE project_id = (:pid)::uuid "
            "  AND last_event_at >= :since "
            "GROUP BY channel_type "
            "ORDER BY cnt DESC"
        ),
        {"pid": str(project_uuid), "since": since},
    )

    rows = result.mappings().all()
    total = sum(int(r["cnt"]) for r in rows) or 0
    channels = [
        {
            "name": str(r["channel_type"]),
            "count": int(r["cnt"]),
            "percentage": round((int(r["cnt"]) / total) * 100, 1) if total else 0.0,
        }
        for r in rows
    ]

    return {"channels": channels}


@router.get("/analytics/status/{tenant_or_project_id}")
async def get_analytics_status(
    tenant_or_project_id: str,
    days: int = Query(default=30, ge=1, le=365),
    db: AsyncSession = Depends(get_db),
    current_user: DashboardUser = Depends(get_current_user),
) -> dict[str, Any]:
    """
    Distribuição de conversas por status (real data).
    """
    project_id = await resolve_project_id_for_user(tenant_or_project_id, current_user, db)
    project_uuid = UUID(project_id)

    since = datetime.now(timezone.utc) - timedelta(days=days)

    result = await db.execute(
        text(
            "SELECT status, count(*) AS cnt "
            "FROM conversation_states "
            "WHERE project_id = (:pid)::uuid "
            "  AND last_event_at >= :since "
            "GROUP BY status "
            "ORDER BY cnt DESC"
        ),
        {"pid": str(project_uuid), "since": since},
    )

    statuses = [{"name": str(r["status"]), "count": int(r["cnt"])} for r in result.mappings().all()]
    return {"statuses": statuses}


@router.get("/analytics/hourly/{tenant_or_project_id}")
async def get_analytics_hourly(
    tenant_or_project_id: str,
    days: int = Query(default=7, ge=1, le=90),
    db: AsyncSession = Depends(get_db),
    current_user: DashboardUser = Depends(get_current_user),
) -> dict[str, Any]:
    """
    Distribuição por hora do dia baseada em mensagens (conversation_events).
    """
    project_id = await resolve_project_id_for_user(tenant_or_project_id, current_user, db)
    project_uuid = UUID(project_id)

    since = datetime.now(timezone.utc) - timedelta(days=days)

    result = await db.execute(
        text(
            "SELECT EXTRACT(HOUR FROM created_at) AS hour, count(*) AS cnt "
            "FROM conversation_events "
            "WHERE project_id = (:pid)::uuid "
            "  AND created_at >= :since "
            "GROUP BY 1 "
            "ORDER BY 1"
        ),
        {"pid": str(project_uuid), "since": since},
    )
    rows = {int(r["hour"]): int(r["cnt"]) for r in result.mappings().all()}

    hourly = [{"hour": h, "count": int(rows.get(h, 0))} for h in range(24)]
    return {"hourly": hourly, "period_days": days}
