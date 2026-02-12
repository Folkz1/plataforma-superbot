"""
Updated Conversations API with real PostgreSQL queries (Async version)
"""
import httpx
import uuid as uuid_mod
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import desc, func, and_, select, text as sa_text, update as sa_update
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timedelta, timezone
from uuid import UUID

from app.db.database import get_db
from app.db.models import DashboardUser, Client, ConversationEvent, ConversationState, Contact, Channel
from app.api.routes.auth import get_current_user
from app.core.tenancy import resolve_project_id_for_user, resolve_project_id_from_client_id

router = APIRouter(prefix="/api/conversations", tags=["conversations"])


# ==================== Helpers ====================

def extract_text_from_raw(raw_payload: dict | None, text: str | None) -> str | None:
    """Extract message text from raw_payload when text column is NULL or empty."""
    if text and text.strip():
        return text
    if not raw_payload:
        return None
    try:
        # --- n8n outgoing format: { sent: { type: "image", ... } } ---
        sent = raw_payload.get("sent")
        if sent:
            sent_type = sent.get("type", "attachment")
            caption = sent.get("caption")
            return caption or f"[{sent_type}]"

        entry = raw_payload.get("entry", [{}])[0]

        # --- WhatsApp format: entry[0].changes[0].value.messages[0] ---
        changes = entry.get("changes", [])
        if changes:
            value = changes[0].get("value", {})
            msgs = value.get("messages", [])
            if msgs:
                wa_msg = msgs[0]
                msg_type = wa_msg.get("type", "")
                if msg_type == "text":
                    return wa_msg.get("text", {}).get("body")
                if msg_type in ("image", "video", "audio", "document", "sticker"):
                    caption = wa_msg.get(msg_type, {}).get("caption")
                    return caption or f"[{msg_type}]"
                if msg_type == "location":
                    return "[localizacao]"
                if msg_type == "contacts":
                    return "[contato]"
                if msg_type == "reaction":
                    emoji = wa_msg.get("reaction", {}).get("emoji", "")
                    return f"[reacao: {emoji}]" if emoji else "[reacao]"
                if msg_type == "interactive":
                    return wa_msg.get("interactive", {}).get("button_reply", {}).get("title") or "[interativo]"
                return f"[{msg_type}]" if msg_type else None
            # Status webhooks (delivery receipts) have no messages
            statuses = value.get("statuses", [])
            if statuses:
                return None  # Delivery receipt, no text

        # --- Messenger/Instagram format: entry[0].messaging[0] ---
        messaging = entry.get("messaging", [{}])[0]

        # Read receipts / delivery receipts / echoes — no user content
        if "read" in messaging or "delivery" in messaging:
            return None

        msg = messaging.get("message")
        if msg:
            t = msg.get("text")
            if t:
                return t
            if msg.get("reply_to", {}).get("story"):
                return "[Resposta a story]"
            attachments = msg.get("attachments", [])
            if attachments:
                att_type = attachments[0].get("type", "attachment")
                return f"[{att_type}]"
            # Message exists but no text/attachments (e.g. reactions, unsupported)
            return None

        postback = messaging.get("postback")
        if postback:
            return postback.get("title") or "[postback]"

        referral = messaging.get("referral")
        if referral:
            return "[referral]"
    except (IndexError, KeyError, TypeError):
        pass
    return None


def extract_contact_name_from_raw(raw_payload: dict | None) -> str | None:
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
    """Format a display name for a conversation contact."""
    if contact_name:
        return contact_name
    if not conversation_id or conversation_id == "null":
        return "Contato desconhecido"
    if channel_type == "whatsapp":
        # Format phone: 5592999981234 -> +55 92 99998-1234
        cid = conversation_id.lstrip("+")
        if len(cid) >= 12 and cid.startswith("55"):
            return f"+{cid[:2]} {cid[2:4]} {cid[4:9]}-{cid[9:]}"
        return f"+{cid}"
    # Messenger/Instagram: show short PSID
    if len(conversation_id) > 10:
        return f"Contato #{conversation_id[-6:]}"
    return conversation_id


# ==================== Schemas ====================

class MessageSchema(BaseModel):
    id: str
    direction: str  # 'in', 'out', 'system'
    message_type: str
    text: Optional[str]
    media: Optional[dict]
    raw_payload: Optional[dict]
    created_at: datetime

    class Config:
        from_attributes = True


class ConversationDetail(BaseModel):
    project_id: str
    conversation_id: str
    contact_name: Optional[str]
    channel_type: str
    channel_identifier: Optional[str]
    status: str
    last_event_at: datetime
    ai_state: Optional[str]
    summary_short: Optional[str]
    metadata: Optional[dict] = None
    messages: List[MessageSchema]


class ConversationListItem(BaseModel):
    project_id: str
    conversation_id: str
    contact_name: Optional[str]
    channel_type: str
    status: str
    last_event_at: datetime
    last_text: Optional[str]
    message_count: int


class ConversationStats(BaseModel):
    total: int
    open: int
    closed: int
    avg_messages_per_conversation: float
    total_messages: int


# Helper: Get client's project_id
async def get_user_project_uuid(current_user: DashboardUser, db: AsyncSession) -> Optional[UUID]:
    """Get project_id for current user's client"""
    if current_user.role == "admin":
        return None  # Admin can see all

    if not current_user.client_id:
        raise HTTPException(status_code=404, detail="Cliente não encontrado")

    project_id = await resolve_project_id_from_client_id(str(current_user.client_id), db)
    return UUID(project_id)


async def _resolve_contact_names(
    conversations: list, db: AsyncSession
) -> dict[str, str]:
    """Batch-resolve contact names from users table + WhatsApp raw_payload."""
    conv_ids = [c.conversation_id for c in conversations if c.conversation_id and c.conversation_id != "null"]
    if not conv_ids:
        return {}
    # 1) From users/contacts table
    result = await db.execute(
        select(Contact.id, Contact.name).where(Contact.id.in_(conv_ids))
    )
    names = {row[0]: row[1] for row in result.all() if row[1]}

    # 2) For missing names, try WhatsApp raw_payload (profile.name)
    missing = [cid for cid in conv_ids if cid not in names]
    if missing:
        for cid in missing:
            evt_result = await db.execute(
                select(ConversationEvent.raw_payload).where(
                    and_(
                        ConversationEvent.conversation_id == cid,
                        ConversationEvent.direction == "in",
                    )
                ).limit(1)
            )
            raw = evt_result.scalar_one_or_none()
            wa_name = extract_contact_name_from_raw(raw)
            if wa_name:
                names[cid] = wa_name

    return names


async def _get_last_text_fallback(
    conv: ConversationState, db: AsyncSession
) -> str | None:
    """Get last_text from the most recent event's raw_payload if last_text is empty."""
    if conv.last_text:
        return conv.last_text
    result = await db.execute(
        select(ConversationEvent.text, ConversationEvent.raw_payload).where(
            and_(
                ConversationEvent.project_id == conv.project_id,
                ConversationEvent.channel_type == conv.channel_type,
                ConversationEvent.conversation_id == conv.conversation_id,
            )
        ).order_by(desc(ConversationEvent.created_at)).limit(1)
    )
    row = result.first()
    if row:
        return extract_text_from_raw(row[1], row[0])
    return None


# ==================== Routes ====================

@router.get("/stats")
async def get_conversation_stats(
    project_id: Optional[str] = None,
    days: int = Query(default=7, ge=1, le=90),
    db: AsyncSession = Depends(get_db),
    current_user: DashboardUser = Depends(get_current_user)
):
    """Get conversation statistics"""
    user_project_uuid = await get_user_project_uuid(current_user, db)

    project_uuid: Optional[UUID] = None
    if user_project_uuid:
        project_uuid = user_project_uuid
    elif project_id:
        resolved = await resolve_project_id_for_user(project_id, current_user, db)
        project_uuid = UUID(resolved)

    # Build query
    query = select(ConversationState)

    # Filter by project
    if project_uuid:
        query = query.where(ConversationState.project_id == project_uuid)

    # Filter by date range
    since = datetime.now(timezone.utc) - timedelta(days=days)
    query = query.where(ConversationState.last_event_at >= since)

    # Get stats
    result = await db.execute(query)
    all_conversations = result.scalars().all()
    total = len(all_conversations)
    open_count = len([c for c in all_conversations if c.status == "open"])
    closed_count = len([c for c in all_conversations if c.status == "closed"])

    # Count total messages
    event_query = select(func.count(ConversationEvent.id))
    if project_uuid:
        event_query = event_query.where(ConversationEvent.project_id == project_uuid)

    event_query = event_query.where(ConversationEvent.created_at >= since)
    result = await db.execute(event_query)
    total_messages = result.scalar() or 0

    return {
        "total": total,
        "open": open_count,
        "closed": closed_count,
        "avg_messages_per_conversation": total_messages / total if total > 0 else 0,
        "total_messages": total_messages,
        "period_days": days
    }


@router.get("/", response_model=List[ConversationListItem])
async def list_conversations(
    project_id: Optional[str] = None,
    status: Optional[str] = None,
    channel_type: Optional[str] = None,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user: DashboardUser = Depends(get_current_user)
):
    """List conversations with filters"""
    user_project_uuid = await get_user_project_uuid(current_user, db)

    project_uuid: Optional[UUID] = None
    if user_project_uuid:
        project_uuid = user_project_uuid
    elif project_id:
        resolved = await resolve_project_id_for_user(project_id, current_user, db)
        project_uuid = UUID(resolved)

    # Build query - exclude "null" conversation_ids (delivery receipts from n8n)
    query = select(ConversationState).where(
        ConversationState.conversation_id != "null"
    )

    # Filter by project
    if project_uuid:
        query = query.where(ConversationState.project_id == project_uuid)

    # Apply filters
    if status:
        query = query.where(ConversationState.status == status)
    if channel_type:
        query = query.where(ConversationState.channel_type == channel_type)

    # Order and paginate
    query = query.order_by(desc(ConversationState.last_event_at))
    query = query.offset(offset).limit(limit)

    result = await db.execute(query)
    conversations = result.scalars().all()

    # Batch resolve contact names
    names = await _resolve_contact_names(conversations, db)

    # Build response
    conv_list = []
    for conv in conversations:
        # Message count
        msg_count_query = select(func.count(ConversationEvent.id)).where(
            and_(
                ConversationEvent.project_id == conv.project_id,
                ConversationEvent.channel_type == conv.channel_type,
                ConversationEvent.conversation_id == conv.conversation_id,
            )
        )
        msg_result = await db.execute(msg_count_query)
        msg_count = msg_result.scalar() or 0

        # Resolve contact name
        raw_name = names.get(conv.conversation_id)
        contact_name = format_contact_display(conv.conversation_id, conv.channel_type, raw_name)

        # Resolve last text (fallback to raw_payload)
        last_text = await _get_last_text_fallback(conv, db)

        conv_list.append({
            "project_id": str(conv.project_id),
            "conversation_id": conv.conversation_id,
            "contact_name": contact_name,
            "channel_type": conv.channel_type,
            "status": conv.status,
            "last_event_at": conv.last_event_at,
            "last_text": last_text,
            "message_count": msg_count
        })

    return conv_list


@router.get("/{project_id}/{conversation_id}", response_model=ConversationDetail)
async def get_conversation(
    project_id: str,
    conversation_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: DashboardUser = Depends(get_current_user)
):
    """Get conversation details with all messages"""
    resolved_project_id = await resolve_project_id_for_user(project_id, current_user, db)
    project_uuid = UUID(resolved_project_id)

    # Get conversation state
    query = select(ConversationState).where(
        and_(
            ConversationState.project_id == project_uuid,
            ConversationState.conversation_id == conversation_id
        )
    )
    result = await db.execute(query)
    state = result.scalar_one_or_none()

    if not state:
        raise HTTPException(status_code=404, detail="Conversa não encontrada")

    # Resolve contact name (users table + WhatsApp raw_payload fallback)
    contact_result = await db.execute(
        select(Contact.name).where(Contact.id == conversation_id)
    )
    raw_name = contact_result.scalars().first()
    if not raw_name:
        # Try WhatsApp profile name from raw_payload
        evt_result = await db.execute(
            select(ConversationEvent.raw_payload).where(
                and_(
                    ConversationEvent.project_id == project_uuid,
                    ConversationEvent.conversation_id == conversation_id,
                    ConversationEvent.direction == "in",
                )
            ).limit(1)
        )
        raw = evt_result.scalar_one_or_none()
        raw_name = extract_contact_name_from_raw(raw)
    contact_name = format_contact_display(conversation_id, state.channel_type, raw_name)

    # Get all events/messages
    events_query = select(ConversationEvent).where(
        and_(
            ConversationEvent.project_id == project_uuid,
            ConversationEvent.channel_type == state.channel_type,
            ConversationEvent.conversation_id == conversation_id
        )
    ).order_by(ConversationEvent.created_at)

    result = await db.execute(events_query)
    events = result.scalars().all()

    # Format messages (extract text from raw_payload when missing)
    # Filter out events with no content (read receipts, delivery receipts)
    messages = []
    for event in events:
        text = extract_text_from_raw(event.raw_payload, event.text)
        # Skip events with no text and no media (read/delivery receipts)
        if text is None and not event.media and event.direction == "in" and event.message_type in ("unknown", ""):
            continue
        messages.append({
            "id": str(event.id),
            "direction": event.direction,
            "message_type": event.message_type,
            "text": text,
            "media": event.media,
            "raw_payload": event.raw_payload,
            "created_at": event.created_at
        })

    return {
        "project_id": str(state.project_id),
        "conversation_id": state.conversation_id,
        "contact_name": contact_name,
        "channel_type": state.channel_type,
        "channel_identifier": state.channel_identifier,
        "status": state.status,
        "last_event_at": state.last_event_at,
        "ai_state": state.ai_state,
        "summary_short": state.summary_short,
        "metadata": state.metadata_json,
        "messages": messages
    }


# ==================== Takeover Humano ====================

class StatusUpdateRequest(BaseModel):
    status: str  # 'handoff', 'open', 'closed'
    reason: Optional[str] = None


class SendMessageRequest(BaseModel):
    text: str


async def _get_conversation_state(
    project_id: str, conversation_id: str, current_user: DashboardUser, db: AsyncSession
) -> tuple[UUID, ConversationState]:
    """Resolve project and get conversation state."""
    resolved = await resolve_project_id_for_user(project_id, current_user, db)
    project_uuid = UUID(resolved)
    result = await db.execute(
        select(ConversationState).where(
            and_(
                ConversationState.project_id == project_uuid,
                ConversationState.conversation_id == conversation_id
            )
        )
    )
    state = result.scalar_one_or_none()
    if not state:
        raise HTTPException(status_code=404, detail="Conversa não encontrada")
    return project_uuid, state


@router.patch("/{project_id}/{conversation_id}/status")
async def update_conversation_status(
    project_id: str,
    conversation_id: str,
    body: StatusUpdateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: DashboardUser = Depends(get_current_user)
):
    """Update conversation status (handoff/open/closed)."""
    project_uuid, state = await _get_conversation_state(
        project_id, conversation_id, current_user, db
    )

    now = datetime.now(timezone.utc)
    meta = dict(state.metadata_json or {})

    if body.status == "handoff":
        meta["human_takeover_until"] = (now + timedelta(hours=3)).isoformat()
        meta["human_agent_name"] = current_user.name or current_user.email
    elif body.status == "open":
        meta.pop("human_takeover_until", None)
        meta.pop("human_agent_name", None)

    # Update state
    await db.execute(
        sa_update(ConversationState).where(
            and_(
                ConversationState.project_id == project_uuid,
                ConversationState.channel_type == state.channel_type,
                ConversationState.conversation_id == conversation_id
            )
        ).values(
            status=body.status,
            metadata_json=meta,
            updated_at=now
        )
    )

    # Log system event
    event = ConversationEvent(
        id=uuid_mod.uuid4(),
        project_id=project_uuid,
        channel_type=state.channel_type,
        channel_identifier=state.channel_identifier,
        conversation_id=conversation_id,
        direction="system",
        message_type="status_change",
        text=f"Status alterado para '{body.status}'" + (f": {body.reason}" if body.reason else ""),
    )
    db.add(event)
    await db.commit()

    return {
        "ok": True,
        "status": body.status,
        "human_takeover_until": meta.get("human_takeover_until")
    }


@router.post("/{project_id}/{conversation_id}/send")
async def send_human_message(
    project_id: str,
    conversation_id: str,
    body: SendMessageRequest,
    db: AsyncSession = Depends(get_db),
    current_user: DashboardUser = Depends(get_current_user)
):
    """Send a message from the dashboard as a human agent via Meta API."""
    project_uuid, state = await _get_conversation_state(
        project_id, conversation_id, current_user, db
    )

    # Get channel credentials
    channel = (await db.execute(
        select(Channel).where(
            and_(
                Channel.project_id == project_uuid,
                Channel.channel_type == state.channel_type,
                Channel.channel_identifier == state.channel_identifier
            )
        )
    )).scalar_one_or_none()

    if not channel or not channel.access_token:
        raise HTTPException(
            status_code=400,
            detail=f"Canal {state.channel_type}/{state.channel_identifier} sem access_token configurado"
        )

    # Send via Meta API
    token = channel.access_token
    api_version = "v21.0"

    async with httpx.AsyncClient(timeout=15) as client:
        if state.channel_type == "whatsapp":
            resp = await client.post(
                f"https://graph.facebook.com/{api_version}/{state.channel_identifier}/messages",
                headers={"Authorization": f"Bearer {token}"},
                json={
                    "messaging_product": "whatsapp",
                    "recipient_type": "individual",
                    "to": conversation_id,
                    "type": "text",
                    "text": {"body": body.text}
                }
            )
        elif state.channel_type == "messenger":
            resp = await client.post(
                f"https://graph.facebook.com/{api_version}/me/messages",
                params={"access_token": token},
                json={
                    "recipient": {"id": conversation_id},
                    "message": {"text": body.text}
                }
            )
        elif state.channel_type == "instagram":
            resp = await client.post(
                f"https://graph.facebook.com/{api_version}/{state.channel_identifier}/messages",
                params={"access_token": token},
                json={
                    "recipient": {"id": conversation_id},
                    "message": {"text": body.text}
                }
            )
        else:
            raise HTTPException(status_code=400, detail=f"Canal '{state.channel_type}' não suportado para envio")

    if resp.status_code not in (200, 201):
        raise HTTPException(
            status_code=502,
            detail=f"Erro Meta API ({resp.status_code}): {resp.text}"
        )

    now = datetime.now(timezone.utc)

    # Save outgoing event
    event = ConversationEvent(
        id=uuid_mod.uuid4(),
        project_id=project_uuid,
        channel_type=state.channel_type,
        channel_identifier=state.channel_identifier,
        conversation_id=conversation_id,
        direction="out",
        message_type="human_reply",
        text=body.text,
    )
    db.add(event)

    # Auto-handoff if not already
    meta = dict(state.metadata_json or {})
    new_status = state.status
    if state.status != "handoff":
        new_status = "handoff"
        meta["human_takeover_until"] = (now + timedelta(hours=3)).isoformat()
        meta["human_agent_name"] = current_user.name or current_user.email

    # Update conversation state
    await db.execute(
        sa_update(ConversationState).where(
            and_(
                ConversationState.project_id == project_uuid,
                ConversationState.channel_type == state.channel_type,
                ConversationState.conversation_id == conversation_id
            )
        ).values(
            status=new_status,
            last_event_at=now,
            last_direction="out",
            last_message_type="human_reply",
            last_text=body.text,
            metadata_json=meta,
            updated_at=now
        )
    )

    await db.commit()

    return {
        "ok": True,
        "message_id": str(event.id),
        "meta_response": resp.json(),
        "status": new_status,
        "human_takeover_until": meta.get("human_takeover_until")
    }
