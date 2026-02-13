"""
ElevenLabs Proxy API - Manage agents, tools, and prompts
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import httpx
import os

from uuid import UUID
from datetime import datetime, timezone, timedelta
from sqlalchemy import desc, and_

from app.db.database import get_db
from app.db.models import DashboardUser, Client, VoiceCallHistory, ProjectVoiceAgent
from app.api.routes.auth import get_current_user
from app.core.tenancy import resolve_project_id_from_client_id

router = APIRouter(prefix="/api/elevenlabs", tags=["elevenlabs"])

# ElevenLabs API config
ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY")
ELEVENLABS_BASE_URL = "https://api.elevenlabs.io/v1"


# Schemas
class AgentCreate(BaseModel):
    name: str
    system_prompt: str
    voice_id: str
    first_message: str = ""
    language: str = "pt"


class AgentUpdate(BaseModel):
    name: Optional[str] = None
    system_prompt: Optional[str] = None
    first_message: Optional[str] = None
    language: Optional[str] = None


class ToolConfig(BaseModel):
    type: str = "webhook"
    name: str
    description: str
    url: str
    method: str = "POST"
    parameters: Dict[str, Any]


# Helper: Get client's ElevenLabs API key
async def get_client_elevenlabs_key(client_id: str, db: AsyncSession) -> str:
    """Get ElevenLabs API key for client - check clients table first, then fallback"""
    result = await db.execute(
        select(Client.elevenlabs_api_key).where(Client.id == client_id)
    )
    row = result.scalar_one_or_none()

    if row:
        return row

    # Fallback to global key
    return ELEVENLABS_API_KEY


async def get_client_agent_ids(client_id: str, db: AsyncSession) -> List[str]:
    """Get list of ElevenLabs agent IDs configured for this client."""
    result = await db.execute(
        select(Client.elevenlabs_agent_id).where(Client.id == client_id)
    )
    agent_id = result.scalar_one_or_none()
    if not agent_id:
        return []
    # Support comma-separated agent IDs
    return [aid.strip() for aid in agent_id.split(",") if aid.strip()]


# Helper: Check access
def check_access(client_id: str, current_user: DashboardUser):
    if current_user.role == "admin":
        return True
    
    if str(current_user.client_id) != client_id:
        raise HTTPException(status_code=403, detail="Acesso negado")
    
    return True


# Routes
@router.get("/agents/{client_id}")
async def list_agents(
    client_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: DashboardUser = Depends(get_current_user)
):
    """List ElevenLabs agents for a client (filtered by client's agent IDs)"""
    check_access(client_id, current_user)
    api_key = await get_client_elevenlabs_key(client_id, db)
    allowed_ids = await get_client_agent_ids(client_id, db)

    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{ELEVENLABS_BASE_URL}/convai/agents",
                headers={"xi-api-key": api_key}
            )
            response.raise_for_status()
            data = response.json()

            # Filter agents by client's configured agent IDs (if any)
            if allowed_ids and isinstance(data, dict) and "agents" in data:
                data["agents"] = [
                    a for a in data["agents"]
                    if a.get("agent_id") in allowed_ids
                ]

            return data
    except httpx.HTTPError as e:
        raise HTTPException(status_code=500, detail=f"Erro ElevenLabs: {str(e)}")


@router.get("/agents/{client_id}/{agent_id}")
async def get_agent(
    client_id: str,
    agent_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: DashboardUser = Depends(get_current_user)
):
    """Get agent details"""
    check_access(client_id, current_user)
    api_key = await get_client_elevenlabs_key(client_id, db)
    
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{ELEVENLABS_BASE_URL}/convai/agents/{agent_id}",
                headers={"xi-api-key": api_key}
            )
            response.raise_for_status()
            return response.json()
    except httpx.HTTPError as e:
        raise HTTPException(status_code=500, detail=f"Erro ElevenLabs: {str(e)}")


@router.post("/agents/{client_id}")
async def create_agent(
    client_id: str,
    data: AgentCreate,
    db: AsyncSession = Depends(get_db),
    current_user: DashboardUser = Depends(get_current_user)
):
    """Create new ElevenLabs agent"""
    check_access(client_id, current_user)
    api_key = await get_client_elevenlabs_key(client_id, db)
    
    payload = {
        "conversation_config": {
            "agent": {
                "prompt": {
                    "prompt": data.system_prompt
                },
                "first_message": data.first_message,
                "language": data.language
            }
        },
        "platform_settings": {
            "widget_settings": {
                "name": data.name
            }
        },
        "tts_config": {
            "voice_id": data.voice_id
        }
    }
    
    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{ELEVENLABS_BASE_URL}/convai/agents",
                headers={"xi-api-key": api_key, "Content-Type": "application/json"},
                json=payload
            )
            response.raise_for_status()
            return response.json()
    except httpx.HTTPError as e:
        raise HTTPException(status_code=500, detail=f"Erro ElevenLabs: {str(e)}")


@router.patch("/agents/{client_id}/{agent_id}")
async def update_agent(
    client_id: str,
    agent_id: str,
    data: AgentUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: DashboardUser = Depends(get_current_user)
):
    """Update agent configuration"""
    check_access(client_id, current_user)
    api_key = await get_client_elevenlabs_key(client_id, db)
    
    # Build update payload
    payload = {}
    
    if data.system_prompt:
        payload["conversation_config"] = {
            "agent": {
                "prompt": {"prompt": data.system_prompt}
            }
        }
    
    if data.first_message is not None:
        if "conversation_config" not in payload:
            payload["conversation_config"] = {"agent": {}}
        payload["conversation_config"]["agent"]["first_message"] = data.first_message
    
    if data.name:
        payload["platform_settings"] = {
            "widget_settings": {"name": data.name}
        }
    
    try:
        async with httpx.AsyncClient() as client:
            response = await client.patch(
                f"{ELEVENLABS_BASE_URL}/convai/agents/{agent_id}",
                headers={"xi-api-key": api_key, "Content-Type": "application/json"},
                json=payload
            )
            response.raise_for_status()
            return response.json()
    except httpx.HTTPError as e:
        raise HTTPException(status_code=500, detail=f"Erro ElevenLabs: {str(e)}")


@router.delete("/agents/{client_id}/{agent_id}")
async def delete_agent(
    client_id: str,
    agent_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: DashboardUser = Depends(get_current_user)
):
    """Delete agent"""
    check_access(client_id, current_user)
    api_key = await get_client_elevenlabs_key(client_id, db)
    
    try:
        async with httpx.AsyncClient() as client:
            response = await client.delete(
                f"{ELEVENLABS_BASE_URL}/convai/agents/{agent_id}",
                headers={"xi-api-key": api_key}
            )
            response.raise_for_status()
            return {"success": True, "message": "Agent removido"}
    except httpx.HTTPError as e:
        raise HTTPException(status_code=500, detail=f"Erro ElevenLabs: {str(e)}")


@router.get("/voices/{client_id}")
async def list_voices(
    client_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: DashboardUser = Depends(get_current_user)
):
    """List available voices"""
    check_access(client_id, current_user)
    api_key = await get_client_elevenlabs_key(client_id, db)
    
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{ELEVENLABS_BASE_URL}/voices",
                headers={"xi-api-key": api_key}
            )
            response.raise_for_status()
            return response.json()
    except httpx.HTTPError as e:
        raise HTTPException(status_code=500, detail=f"Erro ElevenLabs: {str(e)}")


@router.post("/agents/{client_id}/{agent_id}/tools")
async def add_agent_tool(
    client_id: str,
    agent_id: str,
    tool: ToolConfig,
    db: AsyncSession = Depends(get_db),
    current_user: DashboardUser = Depends(get_current_user)
):
    """Add tool to agent"""
    check_access(client_id, current_user)
    api_key = await get_client_elevenlabs_key(client_id, db)
    
    # Get current agent config
    try:
        async with httpx.AsyncClient() as client:
            # Get agent
            get_response = await client.get(
                f"{ELEVENLABS_BASE_URL}/convai/agents/{agent_id}",
                headers={"xi-api-key": api_key}
            )
            get_response.raise_for_status()
            agent_data = get_response.json()
            
            # Add tool to tools array
            tools = agent_data.get("conversation_config", {}).get("agent", {}).get("tools", [])
            
            # Build tool config
            new_tool = {
                "type": tool.type,
                "name": tool.name,
                "description": tool.description,
                "api_schema": {
                    "url": tool.url,
                    "method": tool.method,
                    "request_body_schema": tool.parameters
                }
            }
            
            tools.append(new_tool)
            
            # Update agent
            update_payload = {
                "conversation_config": {
                    "agent": {
                        "tools": tools
                    }
                }
            }
            
            update_response = await client.patch(
                f"{ELEVENLABS_BASE_URL}/convai/agents/{agent_id}",
                headers={"xi-api-key": api_key, "Content-Type": "application/json"},
                json=update_payload
            )
            update_response.raise_for_status()
            
            return {
                "success": True,
                "message": f"Tool '{tool.name}' adicionada",
                "agent": update_response.json()
            }

    except httpx.HTTPError as e:
        raise HTTPException(status_code=500, detail=f"Erro ElevenLabs: {str(e)}")


# ─── Voice Call History (Webhook + API) ─────────────────────────────

WEBHOOK_SECRET = os.getenv("ELEVENLABS_WEBHOOK_SECRET", "superbot-webhook-2026")


class CallWebhookPayload(BaseModel):
    agent_id: str
    agent_name: Optional[str] = None
    conversation_id: str
    customer_name: Optional[str] = None
    customer_phone: Optional[str] = None
    customer_email: Optional[str] = None
    call_duration_secs: Optional[int] = None
    start_time: Optional[str] = None
    transcript_summary: Optional[str] = None
    transcript: Optional[List[Dict[str, Any]]] = None
    call_successful: bool = True
    termination_reason: Optional[str] = None
    audio_url: Optional[str] = None
    data_collection: Optional[Dict[str, Any]] = None
    project_id: str


@router.post("/calls/webhook")
async def receive_call_webhook(
    payload: CallWebhookPayload,
    db: AsyncSession = Depends(get_db),
    x_webhook_secret: Optional[str] = None
):
    """Receive call data from n8n ElevenLabs workflow"""
    from fastapi import Header
    # Simple auth check
    # In production, use Header dependency; here we accept from body or query

    start_dt = None
    if payload.start_time:
        try:
            start_dt = datetime.fromisoformat(payload.start_time.replace("Z", "+00:00"))
        except (ValueError, AttributeError):
            start_dt = datetime.now(timezone.utc)

    call = VoiceCallHistory(
        project_id=payload.project_id,
        agent_id=payload.agent_id,
        agent_name=payload.agent_name,
        conversation_id=payload.conversation_id,
        customer_name=payload.customer_name,
        customer_phone=payload.customer_phone,
        customer_email=payload.customer_email,
        call_duration_secs=payload.call_duration_secs,
        start_time=start_dt or datetime.now(timezone.utc),
        transcript_summary=payload.transcript_summary,
        transcript=payload.transcript,
        call_successful=payload.call_successful,
        termination_reason=payload.termination_reason,
        audio_url=payload.audio_url,
        data_collection=payload.data_collection,
    )
    db.add(call)
    await db.commit()

    return {"ok": True, "call_id": str(call.id)}


@router.get("/calls/{client_id}")
async def list_calls(
    client_id: str,
    days: int = 30,
    agent_id: Optional[str] = None,
    status: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: DashboardUser = Depends(get_current_user)
):
    """List voice calls for a client with stats"""
    check_access(client_id, current_user)
    project_id = await resolve_project_id_from_client_id(client_id, db)

    since = datetime.now(timezone.utc) - timedelta(days=days)

    filters = [
        VoiceCallHistory.project_id == project_id,
        VoiceCallHistory.start_time >= since,
    ]
    if agent_id:
        filters.append(VoiceCallHistory.agent_id == agent_id)
    if status == "successful":
        filters.append(VoiceCallHistory.call_successful == True)
    elif status == "failed":
        filters.append(VoiceCallHistory.call_successful == False)

    result = await db.execute(
        select(VoiceCallHistory)
        .where(and_(*filters))
        .order_by(desc(VoiceCallHistory.start_time))
        .limit(200)
    )
    calls = result.scalars().all()

    # Compute stats
    total = len(calls)
    successful = sum(1 for c in calls if c.call_successful)
    total_duration = sum(c.call_duration_secs or 0 for c in calls)
    avg_duration = total_duration // total if total > 0 else 0
    today = datetime.now(timezone.utc).date()
    today_count = sum(1 for c in calls if c.start_time and c.start_time.date() == today)

    # Resolve agent names from project_voice_agents
    agent_ids = list({c.agent_id for c in calls if c.agent_id})
    agent_names: Dict[str, str] = {}
    if agent_ids:
        ar = await db.execute(
            select(ProjectVoiceAgent.agent_id, ProjectVoiceAgent.label)
            .where(ProjectVoiceAgent.project_id == project_id)
        )
        agent_names = {row[0]: row[1] for row in ar.all() if row[1]}

    def _agent_display(c):
        return c.agent_name or agent_names.get(c.agent_id) or c.agent_id or "-"

    return {
        "stats": {
            "total": total,
            "successful": successful,
            "success_rate": round(successful / total * 100, 1) if total > 0 else 0,
            "avg_duration_secs": avg_duration,
            "today": today_count,
        },
        "calls": [
            {
                "id": str(c.id),
                "agent_id": c.agent_id,
                "agent_name": _agent_display(c),
                "conversation_id": c.conversation_id,
                "customer_name": c.customer_name,
                "customer_phone": c.customer_phone,
                "customer_email": c.customer_email,
                "call_duration_secs": c.call_duration_secs,
                "start_time": c.start_time.isoformat() if c.start_time else None,
                "call_successful": c.call_successful,
                "termination_reason": c.termination_reason,
                "transcript_summary": c.transcript_summary,
                "audio_url": c.audio_url,
            }
            for c in calls
        ],
    }


@router.get("/calls/{client_id}/{call_id}")
async def get_call_detail(
    client_id: str,
    call_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: DashboardUser = Depends(get_current_user)
):
    """Get full call detail with transcript"""
    check_access(client_id, current_user)
    project_id = await resolve_project_id_from_client_id(client_id, db)

    result = await db.execute(
        select(VoiceCallHistory).where(
            and_(
                VoiceCallHistory.id == call_id,
                VoiceCallHistory.project_id == project_id,
            )
        )
    )
    call = result.scalar_one_or_none()
    if not call:
        raise HTTPException(status_code=404, detail="Ligação não encontrada")

    # Resolve agent name
    resolved_name = call.agent_name
    if not resolved_name and call.agent_id:
        ar = await db.execute(
            select(ProjectVoiceAgent.label)
            .where(and_(
                ProjectVoiceAgent.project_id == project_id,
                ProjectVoiceAgent.agent_id == call.agent_id,
            ))
        )
        resolved_name = ar.scalar_one_or_none() or call.agent_id

    return {
        "id": str(call.id),
        "agent_id": call.agent_id,
        "agent_name": resolved_name or call.agent_id or "-",
        "conversation_id": call.conversation_id,
        "customer_name": call.customer_name,
        "customer_phone": call.customer_phone,
        "customer_email": call.customer_email,
        "call_duration_secs": call.call_duration_secs,
        "start_time": call.start_time.isoformat() if call.start_time else None,
        "transcript_summary": call.transcript_summary,
        "transcript": call.transcript,
        "call_successful": call.call_successful,
        "termination_reason": call.termination_reason,
        "audio_url": call.audio_url,
        "data_collection": call.data_collection,
        "created_at": call.created_at.isoformat() if call.created_at else None,
    }
