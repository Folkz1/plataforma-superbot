"""
Updated Conversations API with real PostgreSQL queries (Async version)
"""
import logging
import os
import httpx
import jwt
import uuid as uuid_mod
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import desc, func, and_, select, text as sa_text, update as sa_update
from pydantic import BaseModel
from typing import Optional, List, Any
from datetime import datetime, timedelta, timezone
from uuid import UUID

from app.db.database import get_db
from app.db.models import DashboardUser, Client, ConversationEvent, ConversationState, Contact, Channel
from app.api.routes.auth import get_current_user
from app.core.tenancy import resolve_project_id_for_user, resolve_project_id_from_client_id

logger = logging.getLogger("superbot.conversations")

router = APIRouter(prefix="/api/conversations", tags=["conversations"])

MEDIA_TOKEN_SECRET = os.getenv("JWT_SECRET_KEY", "your-secret-key-change-in-production")
MEDIA_TOKEN_ALGORITHM = "HS256"
MEDIA_TOKEN_TTL_MINUTES = 15
META_API_VERSION = "v21.0"
WHATSAPP_MEDIA_TYPES = {"audio", "image", "video", "document", "sticker"}


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

        # --- channel_router outgoing format: { model: "...", tool: ... } ---
        if "model" in raw_payload and "entry" not in raw_payload:
            return None  # AI response, text is in the text column

        # --- channel_router incoming format: { page_id: "...", raw: {...} } ---
        raw_inner = raw_payload.get("raw")
        if isinstance(raw_inner, dict):
            # IG/Messenger: raw contains the messaging-level object
            msg = raw_inner.get("message")
            if isinstance(msg, dict):
                t = msg.get("text")
                if t:
                    return t
                attachments = msg.get("attachments", [])
                if attachments:
                    att_type = attachments[0].get("type", "attachment")
                    return f"[{att_type}]"
                if msg.get("reply_to", {}).get("story"):
                    return "[Resposta a story]"
            # WhatsApp: raw contains the message-level object
            wa_type = raw_inner.get("type")
            if wa_type == "text":
                return raw_inner.get("text", {}).get("body")
            if wa_type in ("image", "video", "audio", "document", "sticker"):
                caption = raw_inner.get(wa_type, {}).get("caption")
                return caption or f"[{wa_type}]"
            if wa_type == "interactive":
                return raw_inner.get("interactive", {}).get("button_reply", {}).get("title") or "[interativo]"
            if wa_type:
                return f"[{wa_type}]"

        entries = raw_payload.get("entry")
        if not isinstance(entries, list) or len(entries) == 0:
            return None
        entry = entries[0]

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
            statuses = value.get("statuses", [])
            if statuses:
                return None  # Delivery receipt, no text

        # --- Messenger/Instagram format: entry[0].messaging[0] ---
        messaging_list = entry.get("messaging")
        if not isinstance(messaging_list, list) or len(messaging_list) == 0:
            return None
        messaging = messaging_list[0]

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
            return None

        postback = messaging.get("postback")
        if postback:
            return postback.get("title") or "[postback]"

        referral = messaging.get("referral")
        if referral:
            return "[referral]"
    except (IndexError, KeyError, TypeError, AttributeError):
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


def _is_meta_echo_event(event: ConversationEvent) -> bool:
    """
    Detect Meta echo webhooks (bot's own sent message mirrored back by Meta).
    These should not be rendered as user-visible messages in conversation history.
    """
    if event.channel_type not in ("instagram", "messenger"):
        return False

    try:
        raw = event.raw_payload if isinstance(event.raw_payload, dict) else {}
        meta = event.metadata_json if isinstance(event.metadata_json, dict) else {}

        # Check raw_payload: entry[0].messaging[0].message.is_echo
        raw_echo = None
        entries = raw.get("entry")
        if isinstance(entries, list) and len(entries) > 0:
            messaging_list = entries[0].get("messaging")
            if isinstance(messaging_list, list) and len(messaging_list) > 0:
                raw_echo = messaging_list[0].get("message", {}).get("is_echo")

        meta_echo = meta.get("is_echo")

        return str(raw_echo).lower() == "true" or str(meta_echo).lower() == "true"
    except (IndexError, KeyError, TypeError, AttributeError):
        return False


def _extract_whatsapp_media_items(raw_payload: dict | None) -> list[dict[str, str]]:
    """Extract WhatsApp media metadata from persisted raw payload."""
    if not raw_payload:
        return []

    wa_msg = None

    raw_inner = raw_payload.get("raw")
    if isinstance(raw_inner, dict) and raw_inner.get("type"):
        wa_msg = raw_inner
    else:
        try:
            entries = raw_payload.get("entry") or []
            changes = entries[0].get("changes", []) if entries else []
            value = changes[0].get("value", {}) if changes else {}
            messages = value.get("messages", [])
            wa_msg = messages[0] if messages else None
        except (IndexError, KeyError, TypeError, AttributeError):
            wa_msg = None

    if not isinstance(wa_msg, dict):
        return []

    media_type = str(wa_msg.get("type") or "").lower()
    if media_type not in WHATSAPP_MEDIA_TYPES:
        return []

    media_payload = wa_msg.get(media_type)
    if not isinstance(media_payload, dict):
        return []

    media_id = media_payload.get("id")
    if not media_id:
        return []

    item = {
        "type": media_type,
        "media_id": str(media_id),
    }

    for key in ("mime_type", "sha256", "caption", "filename"):
        value = media_payload.get(key)
        if value:
            item[key] = str(value)

    return [item]


def _encode_media_token(
    project_id: str,
    conversation_id: str,
    event_id: str,
    channel_type: str,
    media_id: str,
) -> str:
    payload = {
        "type": "conversation_media",
        "project_id": project_id,
        "conversation_id": conversation_id,
        "event_id": event_id,
        "channel_type": channel_type,
        "media_id": media_id,
        "exp": datetime.now(timezone.utc) + timedelta(minutes=MEDIA_TOKEN_TTL_MINUTES),
    }
    return jwt.encode(payload, MEDIA_TOKEN_SECRET, algorithm=MEDIA_TOKEN_ALGORITHM)


def _decode_media_token(token: str) -> dict[str, Any]:
    try:
        payload = jwt.decode(token, MEDIA_TOKEN_SECRET, algorithms=[MEDIA_TOKEN_ALGORITHM])
    except jwt.ExpiredSignatureError as exc:
        raise HTTPException(status_code=401, detail="Link de mídia expirado") from exc
    except jwt.InvalidTokenError as exc:
        raise HTTPException(status_code=401, detail="Link de mídia inválido") from exc

    if payload.get("type") != "conversation_media":
        raise HTTPException(status_code=401, detail="Link de mídia inválido")

    return payload


def _build_media_payload(
    request: Request,
    project_id: str,
    conversation_id: str,
    channel_type: str,
    event_id: str,
    stored_media: Any,
    raw_payload: dict | None,
) -> Any:
    if stored_media:
        return stored_media

    if channel_type != "whatsapp":
        return stored_media

    extracted = _extract_whatsapp_media_items(raw_payload)
    if not extracted:
        return stored_media

    base_url = str(request.base_url).rstrip("/")
    media_items = []
    for item in extracted:
        signed = _encode_media_token(
            project_id=project_id,
            conversation_id=conversation_id,
            event_id=event_id,
            channel_type=channel_type,
            media_id=item["media_id"],
        )
        proxy_url = f"{base_url}/api/conversations/media/proxy/{signed}"
        media_item = {
            "type": item["type"],
            "url": proxy_url,
            "download_url": proxy_url,
        }
        for key in ("mime_type", "caption", "filename"):
            value = item.get(key)
            if value:
                media_item[key] = value
        media_items.append(media_item)

    return media_items


# ==================== Schemas ====================

class MessageSchema(BaseModel):
    id: str
    direction: str  # 'in', 'out', 'system'
    message_type: str
    text: Optional[str]
    # Can be dict (single) or list (multiple), depending on n8n workflows.
    media: Optional[Any]
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
    # Try with channel_type first
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
    # Fallback: try without channel_type filter
    result = await db.execute(
        select(ConversationEvent.text, ConversationEvent.raw_payload).where(
            and_(
                ConversationEvent.project_id == conv.project_id,
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
        # Message count: exclude receipts (incoming with no text and no media)
        msg_count_query = select(func.count(ConversationEvent.id)).where(
            and_(
                ConversationEvent.project_id == conv.project_id,
                ConversationEvent.channel_type == conv.channel_type,
                ConversationEvent.conversation_id == conv.conversation_id,
                ~and_(
                    ConversationEvent.text.is_(None),
                    ConversationEvent.media.is_(None),
                    ConversationEvent.direction == "in",
                ),
            )
        )
        msg_result = await db.execute(msg_count_query)
        msg_count = msg_result.scalar() or 0

        # Fallback: count without channel_type filter
        if msg_count == 0:
            fallback_query = select(func.count(ConversationEvent.id)).where(
                and_(
                    ConversationEvent.project_id == conv.project_id,
                    ConversationEvent.conversation_id == conv.conversation_id,
                    ~and_(
                        ConversationEvent.text.is_(None),
                        ConversationEvent.media.is_(None),
                        ConversationEvent.direction == "in",
                    ),
                )
            )
            fb_result = await db.execute(fallback_query)
            msg_count = fb_result.scalar() or 0

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
    request: Request,
    channel_type: Optional[str] = Query(default=None),
    db: AsyncSession = Depends(get_db),
    current_user: DashboardUser = Depends(get_current_user)
):
    """Get conversation details with all messages"""
    resolved_project_id = await resolve_project_id_for_user(project_id, current_user, db)
    project_uuid = UUID(resolved_project_id)

    filters = [
        ConversationState.project_id == project_uuid,
        ConversationState.conversation_id == conversation_id,
    ]
    if channel_type:
        filters.append(ConversationState.channel_type == channel_type)

    result = await db.execute(
        select(ConversationState)
        .where(and_(*filters))
        .order_by(desc(ConversationState.last_event_at))
        .limit(2)
    )
    rows = result.scalars().all()
    state = rows[0] if rows else None

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
    def _build_events_query(with_channel_type: bool = True):
        filters = [
            ConversationEvent.project_id == project_uuid,
            ConversationEvent.conversation_id == conversation_id,
        ]
        if with_channel_type:
            filters.append(ConversationEvent.channel_type == state.channel_type)

        q = select(ConversationEvent).where(and_(*filters))

        # Stable chronological ordering
        dialect_name = ""
        try:
            bind = db.get_bind()
            if bind is not None and getattr(bind, "dialect", None) is not None:
                dialect_name = (bind.dialect.name or "").lower()
        except Exception:
            dialect_name = ""

        if dialect_name == "postgresql":
            q = q.order_by(
                sa_text("COALESCE(event_created_at, created_at)"),
                sa_text("ctid"),
            )
        else:
            q = q.order_by(
                func.coalesce(ConversationEvent.event_created_at, ConversationEvent.created_at),
                ConversationEvent.id,
            )
        return q

    result = await db.execute(_build_events_query(with_channel_type=True))
    events = result.scalars().all()

    # Fallback: if no events found with channel_type filter, try without it
    if not events:
        logger.warning(
            f"No events for conversation={conversation_id} with channel_type={state.channel_type}, "
            f"retrying without channel_type filter"
        )
        result = await db.execute(_build_events_query(with_channel_type=False))
        events = result.scalars().all()
        if events:
            logger.info(
                f"Found {len(events)} events without channel_type filter. "
                f"Event channel_types: {set(e.channel_type for e in events)}"
            )

    # Format messages (extract text from raw_payload when missing)
    # Filter out only true delivery/read receipts (no content at all)
    messages = []
    for event in events:
        try:
            # Ignore Meta echo reflections to avoid duplicated outbound messages in UI.
            if _is_meta_echo_event(event):
                continue

            text = extract_text_from_raw(event.raw_payload, event.text)

            # Skip only confirmed read/delivery receipts with zero content
            if text is None and not event.media and event.direction == "in":
                raw = event.raw_payload if isinstance(event.raw_payload, dict) else {}
                is_receipt = False
                try:
                    entries = raw.get("entry")
                    if isinstance(entries, list) and len(entries) > 0:
                        entry = entries[0]
                        # WhatsApp: statuses array = delivery receipt
                        changes = entry.get("changes", [])
                        if changes and changes[0].get("value", {}).get("statuses"):
                            is_receipt = True
                        # Messenger/IG: read or delivery keys
                        messaging_list = entry.get("messaging")
                        if isinstance(messaging_list, list) and len(messaging_list) > 0:
                            if "read" in messaging_list[0] or "delivery" in messaging_list[0]:
                                is_receipt = True
                except (IndexError, KeyError, TypeError):
                    pass
                if is_receipt:
                    continue

            messages.append({
                "id": str(event.id),
                "direction": event.direction or "in",
                "message_type": event.message_type or "text",
                "text": text,
                "media": _build_media_payload(
                    request=request,
                    project_id=project_id,
                    conversation_id=conversation_id,
                    channel_type=state.channel_type,
                    event_id=str(event.id),
                    stored_media=event.media,
                    raw_payload=event.raw_payload if isinstance(event.raw_payload, dict) else None,
                ),
                "raw_payload": event.raw_payload,
                "created_at": event.event_created_at or event.created_at or datetime.now(timezone.utc)
            })
        except Exception as exc:
            logger.error(f"Error processing event {event.id}: {exc}", exc_info=True)
            # Still include the event with minimal data rather than dropping it
            messages.append({
                "id": str(event.id),
                "direction": event.direction or "in",
                "message_type": event.message_type or "text",
                "text": event.text or "[erro ao processar mensagem]",
                "media": _build_media_payload(
                    request=request,
                    project_id=project_id,
                    conversation_id=conversation_id,
                    channel_type=state.channel_type,
                    event_id=str(event.id),
                    stored_media=event.media,
                    raw_payload=event.raw_payload if isinstance(event.raw_payload, dict) else None,
                ),
                "raw_payload": event.raw_payload,
                "created_at": event.event_created_at or event.created_at or datetime.now(timezone.utc)
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


@router.get("/media/proxy/{token}")
async def proxy_conversation_media(
    token: str,
    db: AsyncSession = Depends(get_db),
):
    """Proxy signed WhatsApp media URLs so the dashboard can play them without auth headers."""
    payload = _decode_media_token(token)
    project_uuid = UUID(str(payload["project_id"]))
    event_uuid = UUID(str(payload["event_id"]))
    conversation_id = str(payload["conversation_id"])
    channel_type = str(payload["channel_type"])
    media_id = str(payload["media_id"])

    event = (
        await db.execute(
            select(ConversationEvent).where(
                and_(
                    ConversationEvent.id == event_uuid,
                    ConversationEvent.project_id == project_uuid,
                    ConversationEvent.channel_type == channel_type,
                    ConversationEvent.conversation_id == conversation_id,
                )
            )
        )
    ).scalar_one_or_none()
    if not event:
        raise HTTPException(status_code=404, detail="Evento de mídia não encontrado")

    state = (
        await db.execute(
            select(ConversationState).where(
                and_(
                    ConversationState.project_id == project_uuid,
                    ConversationState.channel_type == channel_type,
                    ConversationState.conversation_id == conversation_id,
                )
            )
        )
    ).scalar_one_or_none()
    if not state:
        raise HTTPException(status_code=404, detail="Conversa não encontrada")

    channel = (
        await db.execute(
            select(Channel).where(
                and_(
                    Channel.project_id == project_uuid,
                    Channel.channel_type == channel_type,
                    Channel.channel_identifier == state.channel_identifier,
                )
            )
        )
    ).scalar_one_or_none()
    if not channel or not channel.access_token:
        raise HTTPException(status_code=400, detail="Canal sem access_token configurado")

    headers = {"Authorization": f"Bearer {channel.access_token}"}

    async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
        meta_resp = await client.get(
            f"https://graph.facebook.com/{META_API_VERSION}/{media_id}",
            headers=headers,
        )
        if meta_resp.status_code != 200:
            raise HTTPException(
                status_code=502,
                detail=f"Erro ao resolver mídia da Meta ({meta_resp.status_code})",
            )

        meta_data = meta_resp.json()
        source_url = meta_data.get("url")
        if not source_url:
            raise HTTPException(status_code=502, detail="Meta não retornou URL da mídia")

        media_resp = await client.get(source_url, headers=headers)
        if media_resp.status_code != 200:
            raise HTTPException(
                status_code=502,
                detail=f"Erro ao baixar mídia da Meta ({media_resp.status_code})",
            )

    content_type = (
        media_resp.headers.get("Content-Type")
        or meta_data.get("mime_type")
        or "application/octet-stream"
    )
    response_headers = {
        "Cache-Control": "private, max-age=300",
        "Accept-Ranges": "bytes",
    }
    filename = meta_data.get("name")
    if filename:
        response_headers["Content-Disposition"] = f'inline; filename="{filename}"'

    return Response(
        content=media_resp.content,
        media_type=content_type,
        headers=response_headers,
    )


# ==================== Takeover Humano ====================

class StatusUpdateRequest(BaseModel):
    status: str  # 'handoff', 'open', 'closed'
    reason: Optional[str] = None


class SendMessageRequest(BaseModel):
    text: str


async def _get_conversation_state(
    project_id: str,
    conversation_id: str,
    current_user: DashboardUser,
    db: AsyncSession,
    channel_type: Optional[str] = None,
) -> tuple[UUID, ConversationState]:
    """Resolve project and get conversation state."""
    resolved = await resolve_project_id_for_user(project_id, current_user, db)
    project_uuid = UUID(resolved)
    filters = [
        ConversationState.project_id == project_uuid,
        ConversationState.conversation_id == conversation_id,
    ]
    if channel_type:
        filters.append(ConversationState.channel_type == channel_type)

    result = await db.execute(
        select(ConversationState)
        .where(and_(*filters))
        .order_by(desc(ConversationState.last_event_at))
        .limit(2)
    )
    rows = result.scalars().all()
    state = rows[0] if rows else None
    if not state:
        raise HTTPException(status_code=404, detail="Conversa não encontrada")
    return project_uuid, state


@router.patch("/{project_id}/{conversation_id}/status")
async def update_conversation_status(
    project_id: str,
    conversation_id: str,
    body: StatusUpdateRequest,
    channel_type: Optional[str] = Query(default=None),
    db: AsyncSession = Depends(get_db),
    current_user: DashboardUser = Depends(get_current_user)
):
    """Update conversation status (handoff/open/closed)."""
    project_uuid, state = await _get_conversation_state(
        project_id, conversation_id, current_user, db, channel_type
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


class BotPauseRequest(BaseModel):
    pause_hours: Optional[int] = None  # None = resume, 3 = 3h, 360 = 15 days


@router.post("/{project_id}/{conversation_id}/bot-pause")
async def toggle_bot_pause(
    project_id: str,
    conversation_id: str,
    body: BotPauseRequest = BotPauseRequest(),
    channel_type: Optional[str] = Query(default=None),
    db: AsyncSession = Depends(get_db),
    current_user: DashboardUser = Depends(get_current_user)
):
    """
    Pause or resume bot for a conversation.
    - pause_hours=None and bot is paused -> resume
    - pause_hours=3 -> pause for 3 hours
    - pause_hours=360 -> pause for 15 days (max)
    """
    project_uuid, state = await _get_conversation_state(
        project_id, conversation_id, current_user, db, channel_type
    )

    now = datetime.now(timezone.utc)
    meta = dict(state.metadata_json or {})
    was_paused = meta.get("bot_paused", False)

    if body.pause_hours is None and was_paused:
        # Resume bot
        meta.pop("bot_paused", None)
        meta.pop("bot_paused_by", None)
        meta.pop("bot_paused_at", None)
        meta.pop("bot_paused_until", None)
        meta.pop("human_takeover_until", None)
        meta.pop("human_agent_name", None)
        new_status = "open"
        action = "retomado"
    elif body.pause_hours is not None:
        # Pause bot for N hours (max 360h = 15 days)
        hours = min(body.pause_hours, 360)
        until = now + timedelta(hours=hours)
        meta["bot_paused"] = True
        meta["bot_paused_by"] = current_user.name or current_user.email
        meta["bot_paused_at"] = now.isoformat()
        meta["bot_paused_until"] = until.isoformat()
        meta["human_agent_name"] = current_user.name or current_user.email
        new_status = "handoff"
        if hours >= 360:
            action = "pausado por 15 dias"
        elif hours >= 24:
            action = f"pausado por {hours // 24} dias"
        else:
            action = f"pausado por {hours}h"
    else:
        return {"ok": True, "bot_paused": False, "status": state.status}

    await db.execute(
        sa_update(ConversationState).where(
            and_(
                ConversationState.project_id == project_uuid,
                ConversationState.channel_type == state.channel_type,
                ConversationState.conversation_id == conversation_id
            )
        ).values(
            status=new_status,
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
        text=f"Bot {action} por {current_user.name or current_user.email}",
    )
    db.add(event)
    await db.commit()

    return {
        "ok": True,
        "bot_paused": body.pause_hours is not None,
        "pause_hours": body.pause_hours,
        "paused_until": meta.get("bot_paused_until"),
        "status": new_status,
        "paused_by": meta.get("bot_paused_by"),
    }


@router.post("/{project_id}/{conversation_id}/send")
async def send_human_message(
    project_id: str,
    conversation_id: str,
    body: SendMessageRequest,
    channel_type: Optional[str] = Query(default=None),
    db: AsyncSession = Depends(get_db),
    current_user: DashboardUser = Depends(get_current_user)
):
    """Send a message from the dashboard as a human agent via Meta API."""
    project_uuid, state = await _get_conversation_state(
        project_id, conversation_id, current_user, db, channel_type
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


# ==================== Transfer to Human ====================

class TransferRequest(BaseModel):
    reason: Optional[str] = None
    timeout_hours: float = 8.0


@router.post("/{project_id}/{conversation_id}/transfer")
async def transfer_to_human(
    project_id: str,
    conversation_id: str,
    body: TransferRequest,
    channel_type: Optional[str] = Query(default=None),
    db: AsyncSession = Depends(get_db),
    current_user: DashboardUser = Depends(get_current_user)
):
    """Transfer conversation to human agent with WhatsApp notification."""
    project_uuid, state = await _get_conversation_state(
        project_id, conversation_id, current_user, db, channel_type
    )

    now = datetime.now(timezone.utc)
    meta = dict(state.metadata_json or {})
    timeout_hours = max(0.5, min(body.timeout_hours, 24))

    # Set handoff status
    meta["human_takeover_until"] = (now + timedelta(hours=timeout_hours)).isoformat()
    meta["human_agent_name"] = current_user.name or current_user.email
    meta["transfer_reason"] = body.reason or "Transferido pelo dashboard"

    await db.execute(
        sa_update(ConversationState).where(
            and_(
                ConversationState.project_id == project_uuid,
                ConversationState.channel_type == state.channel_type,
                ConversationState.conversation_id == conversation_id
            )
        ).values(
            status="handoff",
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
        text=f"Transferido para humano por {current_user.name or current_user.email}" + (f": {body.reason}" if body.reason else ""),
    )
    db.add(event)
    await db.commit()

    # Resolve contact name for notifications
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

    # Get channel credentials
    ch_type = state.channel_type or "whatsapp"

    # Build display name and identifier for N8N
    contact_display = format_contact_display(conversation_id, ch_type, raw_name)
    # For IG/Messenger, include channel info in the N8N payload
    channel_label = {"instagram": "Instagram", "messenger": "Messenger"}.get(ch_type, "WhatsApp")

    channel = (await db.execute(
        select(Channel).where(
            and_(
                Channel.project_id == project_uuid,
                Channel.channel_type == ch_type,
            )
        ).limit(1)
    )).scalar_one_or_none()

    n8n_notified = False
    client_msg_sent = False

    async with httpx.AsyncClient(timeout=10) as http:
        # 1) Call N8N webhook "Transfer To Human (Multitenant)" - handles admin notification
        try:
            await http.post(
                "https://ai.superbot.digital/webhook/transfer-to-number",
                json={
                    "project_id": str(project_uuid),
                    "customer_phone": conversation_id,
                    "customer_name": contact_display,
                    "channel_type": ch_type,
                    "reason": body.reason or "Transferido pelo dashboard",
                    "summary": f"Conversa via {channel_label} com {contact_display} transferida por {current_user.name or current_user.email}",
                }
            )
            n8n_notified = True
        except Exception:
            pass

        # 2) Send message to the CLIENT informing them of the transfer
        if channel and channel.access_token:
            client_msg = "Sua conversa foi transferida para um atendente humano. Em breve voce sera atendido. Agradecemos a paciencia!"
            try:
                if ch_type == "whatsapp":
                    await http.post(
                        f"https://graph.facebook.com/v21.0/{channel.channel_identifier}/messages",
                        headers={"Authorization": f"Bearer {channel.access_token}"},
                        json={
                            "messaging_product": "whatsapp",
                            "recipient_type": "individual",
                            "to": conversation_id,
                            "type": "text",
                            "text": {"body": client_msg}
                        }
                    )
                elif ch_type in ("messenger", "instagram"):
                    await http.post(
                        "https://graph.facebook.com/v21.0/me/messages",
                        params={"access_token": channel.access_token},
                        json={
                            "recipient": {"id": conversation_id},
                            "message": {"text": client_msg}
                        }
                    )
                client_msg_sent = True
            except Exception:
                pass

    return {
        "ok": True,
        "status": "handoff",
        "human_takeover_until": meta.get("human_takeover_until"),
        "n8n_notified": n8n_notified,
        "client_msg_sent": client_msg_sent,
    }
