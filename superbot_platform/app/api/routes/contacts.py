"""
Contacts listing API for SuperBot Dashboard.

This endpoint is multitenant-aware: `project_id` can be either:
- A dashboard client_id (tenant) or
- A multitenant projects.id (project UUID)
"""
from __future__ import annotations

from datetime import datetime
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import and_, desc, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.routes.auth import get_current_user
from app.core.tenancy import resolve_project_id_for_user
from app.db.database import get_db
from app.db.models import Contact, ConversationEvent, ConversationState, DashboardUser

router = APIRouter(prefix="/api/contacts", tags=["contacts"])


def _extract_contact_name_from_raw(raw_payload: dict | None) -> str | None:
    """Extract contact name from WhatsApp raw_payload (profile.name)."""
    if not raw_payload:
        return None
    try:
        changes = raw_payload.get("entry", [{}])[0].get("changes", [])
        if changes:
            contacts = changes[0].get("value", {}).get("contacts", [])
            if contacts:
                return contacts[0].get("profile", {}).get("name")
    except (IndexError, KeyError, TypeError):
        pass
    return None


def format_contact_display(conversation_id: str, channel_type: str, contact_name: str | None) -> str:
    """Format a display name for a contact (same behavior as conversations list)."""
    if contact_name:
        return contact_name
    if not conversation_id or conversation_id == "null":
        return "Contato desconhecido"
    if channel_type == "whatsapp":
        cid = conversation_id.lstrip("+")
        if len(cid) >= 12 and cid.startswith("55"):
            return f"+{cid[:2]} {cid[2:4]} {cid[4:9]}-{cid[9:]}"
        return f"+{cid}"
    if len(conversation_id) > 10:
        return f"Contato #{conversation_id[-6:]}"
    return conversation_id


class ContactListItem(BaseModel):
    project_id: str
    conversation_id: str
    contact_name: str
    channel_type: str
    status: str
    last_event_at: datetime
    last_text: Optional[str] = None


@router.get("/", response_model=List[ContactListItem])
async def list_contacts(
    project_id: Optional[str] = None,
    channel_type: Optional[str] = None,
    status: Optional[str] = None,
    search: Optional[str] = None,
    last_event_from: Optional[datetime] = None,
    last_event_to: Optional[datetime] = None,
    limit: int = Query(default=200, ge=1, le=5000),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user: DashboardUser = Depends(get_current_user),
):
    """
    List contacts by channel (1 row per active conversation_state).

    Notes:
    - Uses `conversation_states` as the source of "who is in contact".
    - `contact_name` is resolved from `users` table when available; otherwise formatted.
    """
    if current_user.role == "admin":
        if not project_id:
            raise HTTPException(status_code=400, detail="project_id é obrigatório para admin")
        resolved_project_id = await resolve_project_id_for_user(project_id, current_user, db)
    else:
        tenant_or_project = project_id or (str(current_user.client_id) if current_user.client_id else None)
        if not tenant_or_project:
            raise HTTPException(status_code=403, detail="Usuário sem client_id")
        resolved_project_id = await resolve_project_id_for_user(tenant_or_project, current_user, db)

    project_uuid = UUID(resolved_project_id)

    query = (
        select(ConversationState, Contact.name)
        .outerjoin(Contact, Contact.id == ConversationState.conversation_id)
        .where(ConversationState.conversation_id != "null")
        .where(ConversationState.project_id == project_uuid)
    )

    if channel_type:
        query = query.where(ConversationState.channel_type == channel_type)
    if status:
        query = query.where(ConversationState.status == status)
    if last_event_from:
        query = query.where(ConversationState.last_event_at >= last_event_from)
    if last_event_to:
        query = query.where(ConversationState.last_event_at <= last_event_to)

    if search and search.strip():
        term = f"%{search.strip()}%"
        query = query.where(
            or_(
                ConversationState.conversation_id.ilike(term),
                ConversationState.last_text.ilike(term),
                Contact.name.ilike(term),
            )
        )

    query = query.order_by(desc(ConversationState.last_event_at)).offset(offset).limit(limit)

    result = await db.execute(query)
    rows = result.all()

    # Batch-resolve missing names from WhatsApp raw_payload (same as conversations endpoint)
    missing_ids = [state.conversation_id for state, raw_name in rows if not raw_name and state.channel_type == "whatsapp"]
    wa_names: dict[str, str] = {}
    if missing_ids:
        for cid in missing_ids:
            evt_result = await db.execute(
                select(ConversationEvent.raw_payload).where(
                    and_(
                        ConversationEvent.conversation_id == cid,
                        ConversationEvent.direction == "in",
                    )
                ).limit(1)
            )
            raw = evt_result.scalar_one_or_none()
            wa_name = _extract_contact_name_from_raw(raw)
            if wa_name:
                wa_names[cid] = wa_name

    items: list[dict] = []
    for state, raw_name in rows:
        resolved_name = raw_name or wa_names.get(state.conversation_id)
        items.append(
            {
                "project_id": str(state.project_id),
                "conversation_id": state.conversation_id,
                "contact_name": format_contact_display(state.conversation_id, state.channel_type, resolved_name),
                "channel_type": state.channel_type,
                "status": state.status,
                "last_event_at": state.last_event_at,
                "last_text": state.last_text,
            }
        )

    return items


@router.get("/{project_id}/{conversation_id}/profile")
async def get_contact_profile(
    project_id: str,
    conversation_id: str,
    channel_type: Optional[str] = Query(default=None),
    db: AsyncSession = Depends(get_db),
    current_user: DashboardUser = Depends(get_current_user),
):
    """
    Get aggregated contact profile: stats, channels, assignment, pipeline stage.
    """
    from sqlalchemy import text as sa_text

    resolved_project_id = await resolve_project_id_for_user(project_id, current_user, db)
    project_uuid = UUID(resolved_project_id)

    # Get conversation state
    state_result = await db.execute(
        select(ConversationState).where(
            and_(
                ConversationState.project_id == project_uuid,
                ConversationState.conversation_id == conversation_id,
                *([ConversationState.channel_type == channel_type] if channel_type else [])
            )
        )
    )
    state = state_result.scalar_one_or_none()
    if not state:
        raise HTTPException(status_code=404, detail="Contato não encontrado")

    # Get contact from users table
    contact = (await db.execute(
        select(Contact).where(Contact.id == conversation_id)
    )).scalar_one_or_none()

    # Get message stats
    stats_result = await db.execute(
        sa_text("""
            SELECT
                COUNT(*) AS total_messages,
                COUNT(*) FILTER (WHERE direction = 'in') AS messages_in,
                COUNT(*) FILTER (WHERE direction = 'out') AS messages_out,
                MIN(created_at) AS first_message_at,
                MAX(created_at) AS last_message_at
            FROM conversation_events
            WHERE project_id = CAST(:pid AS uuid) AND conversation_id = :cid
        """),
        {"pid": resolved_project_id, "cid": conversation_id}
    )
    stats = dict(stats_result.mappings().first())

    # Get all channels this contact is on
    channels_result = await db.execute(
        sa_text("""
            SELECT DISTINCT channel_type, channel_identifier, status, last_event_at
            FROM conversation_states
            WHERE project_id = CAST(:pid AS uuid) AND conversation_id = :cid
        """),
        {"pid": resolved_project_id, "cid": conversation_id}
    )
    channels = [dict(r) for r in channels_result.mappings().all()]

    # Get current assignment
    assign_result = await db.execute(
        sa_text("""
            SELECT ca.id, ca.status, ca.assigned_at, ca.notes,
                   du.name AS assignee_name, du.email AS assignee_email,
                   ps.name AS stage_name, ps.color AS stage_color
            FROM conversation_assignments ca
            LEFT JOIN sales_team_members stm ON stm.id = ca.assigned_to
            LEFT JOIN dashboard_users du ON du.id = stm.user_id
            LEFT JOIN pipeline_stages ps ON ps.id = ca.pipeline_stage_id
            WHERE ca.project_id = CAST(:pid AS uuid)
              AND ca.conversation_id = :cid
              AND ca.status = 'active'
            LIMIT 1
        """),
        {"pid": resolved_project_id, "cid": conversation_id}
    )
    assignment = None
    row = assign_result.mappings().first()
    if row:
        assignment = dict(row)

    # Resolve contact name
    contact_name = None
    if contact and contact.name:
        contact_name = contact.name
    else:
        # Try WhatsApp profile name
        evt = (await db.execute(
            select(ConversationEvent.raw_payload).where(
                and_(
                    ConversationEvent.conversation_id == conversation_id,
                    ConversationEvent.direction == "in",
                    ConversationEvent.project_id == project_uuid,
                )
            ).limit(1)
        )).scalar_one_or_none()
        contact_name = _extract_contact_name_from_raw(evt)

    return {
        "conversation_id": conversation_id,
        "contact_name": format_contact_display(conversation_id, state.channel_type, contact_name),
        "raw_name": contact_name,
        "phone": conversation_id if state.channel_type == "whatsapp" else None,
        "channel_type": state.channel_type,
        "status": state.status,
        "ai_state": state.ai_state,
        "summary": state.summary_short,
        "metadata": state.metadata_json,
        "stats": stats,
        "channels": channels,
        "assignment": assignment,
        "user_data": dict(contact.metadata_json or {}) if contact and contact.metadata_json else {},
        "created_at": str(state.created_at) if state.created_at else None,
    }

