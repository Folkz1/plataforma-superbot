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

from fastapi import APIRouter, Depends, HTTPException, Query, status
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


def _require_admin(current_user: DashboardUser) -> None:
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Acesso negado. Apenas administradores.",
        )


def _build_company_alerts(row: dict[str, Any]) -> list[str]:
    alerts: list[str] = []

    if not row.get("project_id"):
        alerts.append("Sem projeto vinculado")
        return alerts

    if row.get("connected_channels", 0) <= 0:
        alerts.append("Sem canais conectados")

    if not row.get("has_meta_token"):
        alerts.append("Sem token Meta ativo")

    if not row.get("has_storage"):
        alerts.append("Storage nao configurado")

    if row.get("active_conversations", 0) >= 15:
        alerts.append("Fila alta de conversas abertas")

    if row.get("handoff_conversations", 0) >= 5:
        alerts.append("Muitas conversas em atendimento humano")

    if row.get("status") == "active" and not row.get("last_event_at"):
        alerts.append("Sem atividade registrada")

    return alerts


def _resolve_company_health(row: dict[str, Any], alerts: list[str]) -> str:
    if row.get("status") != "active":
        return "inactive"
    if any(
        alert in alerts
        for alert in (
            "Sem projeto vinculado",
            "Sem canais conectados",
            "Sem token Meta ativo",
        )
    ):
        return "critical"
    if alerts:
        return "attention"
    return "healthy"


@router.get("/admin/overview")
async def get_admin_overview(
    days: int = Query(default=30, ge=1, le=365),
    db: AsyncSession = Depends(get_db),
    current_user: DashboardUser = Depends(get_current_user),
) -> dict[str, Any]:
    _require_admin(current_user)

    now = datetime.now(timezone.utc)
    since = now - timedelta(days=days)
    today_start = datetime(now.year, now.month, now.day, tzinfo=timezone.utc)

    result = await db.execute(
        text(
            """
            WITH client_projects AS (
              SELECT
                c.id::text AS client_id,
                c.name AS client_name,
                c.slug,
                c.status,
                c.timezone,
                c.settings,
                CASE
                  WHEN COALESCE(c.settings->>'project_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                  THEN (c.settings->>'project_id')::uuid
                  ELSE NULL
                END AS project_id
              FROM clients c
            ),
            state_stats AS (
              SELECT
                cs.project_id,
                COUNT(*) AS total_conversations,
                COUNT(*) FILTER (WHERE cs.status NOT IN ('closed', 'resolved', 'do_not_contact')) AS active_conversations,
                COUNT(*) FILTER (WHERE cs.status = 'open') AS open_conversations,
                COUNT(*) FILTER (WHERE cs.status = 'handoff') AS handoff_conversations,
                COUNT(*) FILTER (WHERE cs.last_event_at >= :since) AS period_conversations,
                COUNT(*) FILTER (WHERE cs.last_event_at >= :today_start) AS today_conversations,
                COUNT(*) FILTER (WHERE cs.status IN ('closed', 'resolved') AND COALESCE(cs.closed_at, cs.updated_at) >= :since) AS closed_in_period,
                AVG(EXTRACT(EPOCH FROM (cs.last_out_at - cs.last_in_at)))
                  FILTER (
                    WHERE cs.last_in_at IS NOT NULL
                      AND cs.last_out_at IS NOT NULL
                      AND cs.last_out_at >= cs.last_in_at
                      AND cs.last_event_at >= :since
                  ) AS avg_response_seconds,
                MAX(cs.last_event_at) AS last_event_at
              FROM conversation_states cs
              GROUP BY cs.project_id
            ),
            event_stats AS (
              SELECT
                ce.project_id,
                COUNT(*) AS total_messages,
                COUNT(*) FILTER (WHERE ce.created_at >= :since) AS period_messages,
                COUNT(*) FILTER (WHERE ce.created_at >= :today_start) AS today_messages,
                COUNT(*) FILTER (WHERE ce.created_at >= :today_start AND ce.direction = 'in') AS inbound_today,
                COUNT(*) FILTER (WHERE ce.created_at >= :today_start AND ce.direction = 'out') AS outbound_today,
                COUNT(*) FILTER (WHERE ce.created_at >= :today_start AND ce.message_type = 'audio') AS audio_today,
                COUNT(*) FILTER (
                  WHERE ce.created_at >= :today_start
                    AND (
                      ce.media IS NOT NULL
                      OR ce.message_type IN ('audio', 'image', 'video', 'document', 'sticker')
                    )
                ) AS media_today
              FROM conversation_events ce
              GROUP BY ce.project_id
            ),
            channel_stats AS (
              SELECT
                ch.project_id,
                COUNT(*) AS connected_channels,
                COUNT(DISTINCT ch.channel_type) AS channel_type_count,
                ARRAY_REMOVE(ARRAY_AGG(DISTINCT ch.channel_type), NULL) AS channel_types,
                BOOL_OR(COALESCE(ch.access_token, '') <> '') AS has_channel_token
              FROM channels ch
              GROUP BY ch.project_id
            ),
            agent_stats AS (
              SELECT
                a.project_id,
                COUNT(*) FILTER (WHERE a.is_active = true) AS active_agents
              FROM agents a
              GROUP BY a.project_id
            ),
            secret_stats AS (
              SELECT
                ps.project_id,
                (COALESCE(ps.meta_master_token, '') <> '') AS has_meta_master_token,
                (
                  COALESCE(ps.nextcloud_base_url, '') <> ''
                  AND COALESCE(ps.nextcloud_username, '') <> ''
                  AND COALESCE(ps.nextcloud_password, '') <> ''
                ) AS has_storage
              FROM project_secrets ps
            )
            SELECT
              cp.client_id,
              cp.client_name,
              cp.slug,
              cp.status,
              cp.timezone,
              cp.project_id::text AS project_id,
              p.project_slug,
              COALESCE(ss.total_conversations, 0) AS total_conversations,
              COALESCE(ss.active_conversations, 0) AS active_conversations,
              COALESCE(ss.open_conversations, 0) AS open_conversations,
              COALESCE(ss.handoff_conversations, 0) AS handoff_conversations,
              COALESCE(ss.period_conversations, 0) AS period_conversations,
              COALESCE(ss.today_conversations, 0) AS today_conversations,
              COALESCE(ss.closed_in_period, 0) AS closed_in_period,
              ss.avg_response_seconds,
              ss.last_event_at,
              COALESCE(es.total_messages, 0) AS total_messages,
              COALESCE(es.period_messages, 0) AS period_messages,
              COALESCE(es.today_messages, 0) AS today_messages,
              COALESCE(es.inbound_today, 0) AS inbound_today,
              COALESCE(es.outbound_today, 0) AS outbound_today,
              COALESCE(es.audio_today, 0) AS audio_today,
              COALESCE(es.media_today, 0) AS media_today,
              COALESCE(chs.connected_channels, 0) AS connected_channels,
              COALESCE(chs.channel_type_count, 0) AS channel_type_count,
              COALESCE(chs.channel_types, ARRAY[]::text[]) AS channel_types,
              COALESCE(chs.has_channel_token, false) AS has_channel_token,
              COALESCE(ags.active_agents, 0) AS active_agents,
              COALESCE(sec.has_meta_master_token, false) AS has_meta_master_token,
              COALESCE(sec.has_storage, false) AS has_storage
            FROM client_projects cp
            LEFT JOIN projects p ON p.id = cp.project_id
            LEFT JOIN state_stats ss ON ss.project_id = cp.project_id
            LEFT JOIN event_stats es ON es.project_id = cp.project_id
            LEFT JOIN channel_stats chs ON chs.project_id = cp.project_id
            LEFT JOIN agent_stats ags ON ags.project_id = cp.project_id
            LEFT JOIN secret_stats sec ON sec.project_id = cp.project_id
            ORDER BY cp.client_name
            """
        ),
        {"since": since, "today_start": today_start},
    )

    rows = [dict(row) for row in result.mappings().all()]
    companies: list[dict[str, Any]] = []

    for row in rows:
        period_conversations = int(row.get("period_conversations") or 0)
        closed_in_period = int(row.get("closed_in_period") or 0)
        resolution_rate = round((closed_in_period / period_conversations) * 100, 1) if period_conversations else 0.0

        has_meta_token = bool(row.get("has_channel_token") or row.get("has_meta_master_token"))
        row["has_meta_token"] = has_meta_token

        alerts = _build_company_alerts(row)
        companies.append(
            {
                "client_id": row["client_id"],
                "name": row["client_name"],
                "slug": row["slug"],
                "status": row["status"],
                "timezone": row["timezone"],
                "project_id": row.get("project_id"),
                "project_slug": row.get("project_slug"),
                "health": _resolve_company_health(row, alerts),
                "alerts": alerts,
                "metrics": {
                    "total_conversations": int(row.get("total_conversations") or 0),
                    "active_conversations": int(row.get("active_conversations") or 0),
                    "open_conversations": int(row.get("open_conversations") or 0),
                    "handoff_conversations": int(row.get("handoff_conversations") or 0),
                    "period_conversations": period_conversations,
                    "today_conversations": int(row.get("today_conversations") or 0),
                    "total_messages": int(row.get("total_messages") or 0),
                    "period_messages": int(row.get("period_messages") or 0),
                    "today_messages": int(row.get("today_messages") or 0),
                    "inbound_today": int(row.get("inbound_today") or 0),
                    "outbound_today": int(row.get("outbound_today") or 0),
                    "audio_today": int(row.get("audio_today") or 0),
                    "media_today": int(row.get("media_today") or 0),
                    "resolution_rate": resolution_rate,
                    "avg_response_time": _format_duration(
                        float(row["avg_response_seconds"]) if row.get("avg_response_seconds") else None
                    ),
                    "last_event_at": row.get("last_event_at").isoformat() if row.get("last_event_at") else None,
                },
                "operations": {
                    "connected_channels": int(row.get("connected_channels") or 0),
                    "channel_types": list(row.get("channel_types") or []),
                    "active_agents": int(row.get("active_agents") or 0),
                    "has_meta_token": has_meta_token,
                    "has_storage": bool(row.get("has_storage")),
                },
            }
        )

    total_period_conversations = sum(company["metrics"]["period_conversations"] for company in companies)
    total_closed_in_period = sum(
        round((company["metrics"]["resolution_rate"] / 100) * company["metrics"]["period_conversations"])
        for company in companies
    )
    global_alerts = [
        {
            "client_id": company["client_id"],
            "name": company["name"],
            "health": company["health"],
            "alerts": company["alerts"],
        }
        for company in companies
        if company["alerts"]
    ]

    return {
        "generated_at": now.isoformat(),
        "period_days": days,
        "summary": {
            "total_clients": len(companies),
            "active_clients": sum(1 for company in companies if company["status"] == "active"),
            "inactive_clients": sum(1 for company in companies if company["status"] != "active"),
            "linked_projects": sum(1 for company in companies if company["project_id"]),
            "companies_with_alerts": sum(1 for company in companies if company["alerts"]),
            "active_conversations": sum(company["metrics"]["active_conversations"] for company in companies),
            "open_conversations": sum(company["metrics"]["open_conversations"] for company in companies),
            "handoff_conversations": sum(company["metrics"]["handoff_conversations"] for company in companies),
            "today_conversations": sum(company["metrics"]["today_conversations"] for company in companies),
            "today_messages": sum(company["metrics"]["today_messages"] for company in companies),
            "inbound_today": sum(company["metrics"]["inbound_today"] for company in companies),
            "outbound_today": sum(company["metrics"]["outbound_today"] for company in companies),
            "audio_today": sum(company["metrics"]["audio_today"] for company in companies),
            "media_today": sum(company["metrics"]["media_today"] for company in companies),
            "resolution_rate": round((total_closed_in_period / total_period_conversations) * 100, 1)
            if total_period_conversations
            else 0.0,
        },
        "alerts": global_alerts[:8],
        "companies": companies,
    }


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
