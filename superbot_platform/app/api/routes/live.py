"""
Client Portal API - token-based access for clients to manage their conversations.

Supports: list conversations, view details, send messages, change status, schedule follow-ups.
"""
import os
import httpx
import uuid as uuid_mod
import jwt
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import and_, select, desc, func, update as sa_update
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timedelta, timezone
from uuid import UUID

from app.db.database import get_db
from app.db.models import (
    DashboardUser, ConversationEvent, ConversationState, Contact, Channel
)
from app.api.routes.auth import get_current_user
from app.api.routes.conversations import (
    extract_text_from_raw, extract_contact_name_from_raw,
    format_contact_display, _resolve_contact_names, _get_last_text_fallback,
    MessageSchema, ConversationListItem
)

router = APIRouter(prefix="/api/live", tags=["live"])

SECRET_KEY = os.getenv("JWT_SECRET_KEY", "your-secret-key-change-in-production")
ALGORITHM = "HS256"


# ==================== Schemas ====================

class CreatePortalLinkRequest(BaseModel):
    project_id: str


class CreateConversationLinkRequest(BaseModel):
    project_id: str
    conversation_id: str


class PortalSendRequest(BaseModel):
    text: str


class PortalStatusRequest(BaseModel):
    status: str  # 'handoff', 'open', 'closed'
    reason: Optional[str] = None


class PortalFollowupRequest(BaseModel):
    next_followup_at: Optional[str] = None  # ISO datetime or null to clear
    followup_stage: Optional[int] = None


class LiveMessage(BaseModel):
    id: str
    direction: str
    message_type: str
    text: Optional[str]
    created_at: datetime


class LiveConversationDetail(BaseModel):
    project_id: str
    conversation_id: str
    contact_name: Optional[str]
    channel_type: str
    status: str
    last_event_at: datetime
    ai_state: Optional[str]
    summary_short: Optional[str]
    metadata: Optional[dict] = None
    messages: List[LiveMessage]


class LiveConversationListItem(BaseModel):
    project_id: str
    conversation_id: str
    contact_name: Optional[str]
    channel_type: str
    status: str
    last_event_at: datetime
    last_text: Optional[str]
    message_count: int


# ==================== Token Helpers ====================

def _decode_token(token: str) -> dict:
    """Decode and validate a portal/live token."""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Link expirado")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Link inválido")

    token_type = payload.get("type")
    if token_type not in ("live_view", "portal"):
        raise HTTPException(status_code=401, detail="Token inválido")
    return payload


# ==================== Create Links ====================

@router.post("/create-link")
async def create_live_link(
    body: CreateConversationLinkRequest,
    current_user: DashboardUser = Depends(get_current_user)
):
    """Generate a public token for viewing a single conversation."""
    payload = {
        "type": "live_view",
        "project_id": body.project_id,
        "conversation_id": body.conversation_id,
        "exp": datetime.now(timezone.utc) + timedelta(hours=72)
    }
    token = jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)
    return {"token": token}


@router.post("/create-portal")
async def create_portal_link(
    body: CreatePortalLinkRequest,
    current_user: DashboardUser = Depends(get_current_user)
):
    """Generate a portal token for full client access to all conversations."""
    payload = {
        "type": "portal",
        "project_id": body.project_id,
        "exp": datetime.now(timezone.utc) + timedelta(days=30)
    }
    token = jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)
    return {"token": token}


# ==================== Portal: List Conversations ====================

@router.get("/{token}/conversations", response_model=List[LiveConversationListItem])
async def portal_list_conversations(
    token: str,
    status: Optional[str] = None,
    channel_type: Optional[str] = None,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db)
):
    """List all conversations for a portal token."""
    payload = _decode_token(token)
    project_uuid = UUID(payload["project_id"])

    # Portal tokens can list all conversations; live_view only their one
    if payload["type"] == "live_view":
        raise HTTPException(status_code=403, detail="Use o endpoint /{token} para visualizar conversa individual")

    query = select(ConversationState).where(
        and_(
            ConversationState.project_id == project_uuid,
            ConversationState.conversation_id != "null"
        )
    )

    if status:
        query = query.where(ConversationState.status == status)
    if channel_type:
        query = query.where(ConversationState.channel_type == channel_type)

    query = query.order_by(desc(ConversationState.last_event_at))
    query = query.offset(offset).limit(limit)

    result = await db.execute(query)
    conversations = result.scalars().all()

    names = await _resolve_contact_names(conversations, db)

    conv_list = []
    for conv in conversations:
        msg_result = await db.execute(
            select(func.count(ConversationEvent.id)).where(
                and_(
                    ConversationEvent.project_id == conv.project_id,
                    ConversationEvent.channel_type == conv.channel_type,
                    ConversationEvent.conversation_id == conv.conversation_id,
                )
            )
        )
        msg_count = msg_result.scalar() or 0

        raw_name = names.get(conv.conversation_id)
        contact_name = format_contact_display(conv.conversation_id, conv.channel_type, raw_name)
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


# ==================== Portal/Live: View Conversation ====================

@router.get("/{token}/conversations/{conversation_id}", response_model=LiveConversationDetail)
async def portal_get_conversation(
    token: str,
    conversation_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get conversation detail from portal or live token."""
    payload = _decode_token(token)
    project_uuid = UUID(payload["project_id"])

    # live_view tokens can only see their specific conversation
    if payload["type"] == "live_view" and payload.get("conversation_id") != conversation_id:
        raise HTTPException(status_code=403, detail="Acesso negado a esta conversa")

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

    # Resolve name
    contact_result = await db.execute(
        select(Contact.name).where(Contact.id == conversation_id)
    )
    raw_name = contact_result.scalars().first()
    if not raw_name:
        evt = await db.execute(
            select(ConversationEvent.raw_payload).where(
                and_(
                    ConversationEvent.project_id == project_uuid,
                    ConversationEvent.conversation_id == conversation_id,
                    ConversationEvent.direction == "in",
                )
            ).limit(1)
        )
        raw_name = extract_contact_name_from_raw(evt.scalar_one_or_none())
    contact_name = format_contact_display(conversation_id, state.channel_type, raw_name)

    events_query = select(ConversationEvent).where(
        and_(
            ConversationEvent.project_id == project_uuid,
            ConversationEvent.channel_type == state.channel_type,
            ConversationEvent.conversation_id == conversation_id
        )
    ).order_by(ConversationEvent.created_at)

    result = await db.execute(events_query)
    events = result.scalars().all()

    messages = []
    for e in events:
        text = extract_text_from_raw(e.raw_payload, e.text)
        if text is None and e.direction == "in" and e.message_type in ("unknown", ""):
            continue
        messages.append({
            "id": str(e.id),
            "direction": e.direction,
            "message_type": e.message_type,
            "text": text,
            "created_at": e.created_at
        })

    return {
        "project_id": str(state.project_id),
        "conversation_id": state.conversation_id,
        "contact_name": contact_name,
        "channel_type": state.channel_type,
        "status": state.status,
        "last_event_at": state.last_event_at,
        "ai_state": state.ai_state,
        "summary_short": state.summary_short,
        "metadata": state.metadata_json,
        "messages": messages
    }


# ==================== Single conversation shortcut (backwards compat) ====================

@router.get("/{token}")
async def get_live_conversation_redirect(
    token: str,
    db: AsyncSession = Depends(get_db)
):
    """Get single conversation data (for live_view tokens)."""
    payload = _decode_token(token)
    conversation_id = payload.get("conversation_id")
    if not conversation_id:
        # Portal token without conversation_id - return project info
        return {"type": "portal", "project_id": payload["project_id"]}
    return await portal_get_conversation(token, conversation_id, db)


# ==================== Portal: Update Status ====================

@router.patch("/{token}/conversations/{conversation_id}/status")
async def portal_update_status(
    token: str,
    conversation_id: str,
    body: PortalStatusRequest,
    db: AsyncSession = Depends(get_db)
):
    """Update conversation status from portal."""
    payload = _decode_token(token)
    if payload["type"] != "portal":
        raise HTTPException(status_code=403, detail="Ação não permitida com este tipo de link")

    project_uuid = UUID(payload["project_id"])

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

    now = datetime.now(timezone.utc)
    meta = dict(state.metadata_json or {})

    if body.status == "handoff":
        meta["human_takeover_until"] = (now + timedelta(hours=3)).isoformat()
        meta["human_agent_name"] = "Cliente (Portal)"
    elif body.status == "open":
        meta.pop("human_takeover_until", None)
        meta.pop("human_agent_name", None)

    await db.execute(
        sa_update(ConversationState).where(
            and_(
                ConversationState.project_id == project_uuid,
                ConversationState.channel_type == state.channel_type,
                ConversationState.conversation_id == conversation_id
            )
        ).values(status=body.status, metadata_json=meta, updated_at=now)
    )

    event = ConversationEvent(
        id=uuid_mod.uuid4(),
        project_id=project_uuid,
        channel_type=state.channel_type,
        channel_identifier=state.channel_identifier,
        conversation_id=conversation_id,
        direction="system",
        message_type="status_change",
        text=f"Status alterado para '{body.status}' via portal" + (f": {body.reason}" if body.reason else ""),
    )
    db.add(event)
    await db.commit()

    return {"ok": True, "status": body.status, "human_takeover_until": meta.get("human_takeover_until")}


# ==================== Portal: Send Message ====================

@router.post("/{token}/conversations/{conversation_id}/send")
async def portal_send_message(
    token: str,
    conversation_id: str,
    body: PortalSendRequest,
    db: AsyncSession = Depends(get_db)
):
    """Send a message from the portal via Meta API."""
    payload = _decode_token(token)
    if payload["type"] != "portal":
        raise HTTPException(status_code=403, detail="Ação não permitida com este tipo de link")

    project_uuid = UUID(payload["project_id"])

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
        raise HTTPException(status_code=400, detail=f"Canal sem access_token configurado")

    access_token = channel.access_token
    api_version = "v21.0"

    async with httpx.AsyncClient(timeout=15) as client:
        if state.channel_type == "whatsapp":
            resp = await client.post(
                f"https://graph.facebook.com/{api_version}/{state.channel_identifier}/messages",
                headers={"Authorization": f"Bearer {access_token}"},
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
                params={"access_token": access_token},
                json={"recipient": {"id": conversation_id}, "message": {"text": body.text}}
            )
        elif state.channel_type == "instagram":
            resp = await client.post(
                f"https://graph.facebook.com/{api_version}/{state.channel_identifier}/messages",
                params={"access_token": access_token},
                json={"recipient": {"id": conversation_id}, "message": {"text": body.text}}
            )
        else:
            raise HTTPException(status_code=400, detail=f"Canal '{state.channel_type}' não suportado")

    if resp.status_code not in (200, 201):
        raise HTTPException(status_code=502, detail=f"Erro Meta API ({resp.status_code}): {resp.text}")

    now = datetime.now(timezone.utc)

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

    meta = dict(state.metadata_json or {})
    new_status = state.status
    if state.status != "handoff":
        new_status = "handoff"
        meta["human_takeover_until"] = (now + timedelta(hours=3)).isoformat()
        meta["human_agent_name"] = "Cliente (Portal)"

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
    return {"ok": True, "message_id": str(event.id), "status": new_status}


# ==================== Portal: Follow-up ====================

@router.patch("/{token}/conversations/{conversation_id}/followup")
async def portal_update_followup(
    token: str,
    conversation_id: str,
    body: PortalFollowupRequest,
    db: AsyncSession = Depends(get_db)
):
    """Schedule or clear a follow-up for a conversation."""
    payload = _decode_token(token)
    if payload["type"] != "portal":
        raise HTTPException(status_code=403, detail="Ação não permitida com este tipo de link")

    project_uuid = UUID(payload["project_id"])

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

    now = datetime.now(timezone.utc)
    values: dict = {"updated_at": now}

    if body.next_followup_at is not None:
        values["next_followup_at"] = datetime.fromisoformat(body.next_followup_at) if body.next_followup_at else None
    if body.followup_stage is not None:
        values["followup_stage"] = body.followup_stage

    await db.execute(
        sa_update(ConversationState).where(
            and_(
                ConversationState.project_id == project_uuid,
                ConversationState.channel_type == state.channel_type,
                ConversationState.conversation_id == conversation_id
            )
        ).values(**values)
    )
    await db.commit()

    return {
        "ok": True,
        "next_followup_at": str(values.get("next_followup_at", state.next_followup_at)),
        "followup_stage": values.get("followup_stage", state.followup_stage)
    }
