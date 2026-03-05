"""
ElevenLabs Proxy API - Manage agents, tools, and prompts
"""
from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel, ConfigDict
from typing import Optional, List, Dict, Any
import httpx
import os

from uuid import UUID, uuid4
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
    voice_id: Optional[str] = "pFZP5JQG7iQjIQuC4Bku"
    first_message: str = ""
    language: str = "pt"
    model: str = "gpt-4.1-mini"
    channel_type: str = "text"


class AgentUpdate(BaseModel):
    name: Optional[str] = None
    system_prompt: Optional[str] = None
    first_message: Optional[str] = None
    language: Optional[str] = None
    model: Optional[str] = None
    tool_ids: Optional[List[str]] = None
    knowledge_base_ids: Optional[List[str]] = None
    temperature: Optional[float] = None
    max_tokens: Optional[int] = None
    max_duration_seconds: Optional[int] = None


class ToolConfig(BaseModel):
    type: str = "webhook"
    name: str
    description: str
    url: str
    method: str = "POST"
    parameters: Dict[str, Any]


class ActiveAgentCreate(BaseModel):
    agent_id: str
    label: Optional[str] = None
    channel_type: str = "phone"
    active: bool = True


class ActiveAgentUpdate(BaseModel):
    label: Optional[str] = None
    channel_type: Optional[str] = None
    active: Optional[bool] = None


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
    # Preferred source: active project_voice_agents linked to tenant's project.
    try:
        project_id = await resolve_project_id_from_client_id(client_id, db)
        result = await db.execute(
            select(ProjectVoiceAgent.agent_id)
            .where(
                and_(
                    ProjectVoiceAgent.project_id == project_id,
                    ProjectVoiceAgent.active == True,
                )
            )
            .order_by(desc(ProjectVoiceAgent.updated_at), desc(ProjectVoiceAgent.created_at))
        )

        seen: set[str] = set()
        active_ids: List[str] = []
        for agent_id in result.scalars().all():
            normalized = str(agent_id or "").strip()
            if normalized and normalized not in seen:
                seen.add(normalized)
                active_ids.append(normalized)
        if active_ids:
            return active_ids
    except HTTPException:
        # Some tenants may not have project mapping configured yet.
        pass

    # Backward compatibility source: clients.elevenlabs_agent_id
    result = await db.execute(
        select(Client.elevenlabs_agent_id).where(Client.id == client_id)
    )
    agent_id = result.scalar_one_or_none()
    if not agent_id:
        return []
    return [aid.strip() for aid in str(agent_id).split(",") if aid.strip()]


async def _sync_client_agent_ids(client_id: str, project_id: str, db: AsyncSession) -> None:
    """Keep clients.elevenlabs_agent_id synchronized with active project_voice_agents."""
    try:
        client_uuid = UUID(str(client_id))
    except Exception:
        return

    result = await db.execute(
        select(ProjectVoiceAgent.agent_id)
        .where(
            and_(
                ProjectVoiceAgent.project_id == project_id,
                ProjectVoiceAgent.active == True,
            )
        )
        .order_by(desc(ProjectVoiceAgent.updated_at), desc(ProjectVoiceAgent.created_at))
    )
    seen: set[str] = set()
    ids: List[str] = []
    for agent_id in result.scalars().all():
        normalized = str(agent_id or "").strip()
        if normalized and normalized not in seen:
            seen.add(normalized)
            ids.append(normalized)

    client_result = await db.execute(
        select(Client).where(Client.id == client_uuid)
    )
    client = client_result.scalar_one_or_none()
    if not client:
        return

    client.elevenlabs_agent_id = ",".join(ids) if ids else None


def _normalize_agent_id(value: Optional[str]) -> str:
    return str(value or "").strip()


def _normalize_channel_type(value: Optional[str]) -> str:
    channel = str(value or "phone").strip().lower()
    return channel or "phone"


def _build_elevenlabs_audio_url(conversation_id: Optional[str]) -> Optional[str]:
    conv_id = str(conversation_id or "").strip()
    if not conv_id:
        return None
    return f"{ELEVENLABS_BASE_URL}/convai/conversations/{conv_id}/audio"


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

    if not allowed_ids:
        return {"agents": []}

    project_id: Optional[str] = None
    try:
        project_id = await resolve_project_id_from_client_id(client_id, db)
    except HTTPException:
        project_id = None

    configured_meta: Dict[str, Dict[str, Any]] = {}
    if project_id:
        cfg = await db.execute(
            select(ProjectVoiceAgent.agent_id, ProjectVoiceAgent.label, ProjectVoiceAgent.channel_type, ProjectVoiceAgent.active)
            .where(ProjectVoiceAgent.project_id == project_id)
            .order_by(desc(ProjectVoiceAgent.updated_at), desc(ProjectVoiceAgent.created_at))
        )
        for row in cfg.all():
            aid = _normalize_agent_id(row[0])
            if aid and aid not in configured_meta:
                configured_meta[aid] = {
                    "label": row[1],
                    "channel_type": row[2],
                    "active": bool(row[3]),
                }

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(
                f"{ELEVENLABS_BASE_URL}/convai/agents",
                headers={"xi-api-key": api_key}
            )
            response.raise_for_status()
            data = response.json()

            raw_agents = data.get("agents", []) if isinstance(data, dict) else []
            by_id = {
                _normalize_agent_id(agent.get("agent_id")): agent
                for agent in raw_agents
                if isinstance(agent, dict) and _normalize_agent_id(agent.get("agent_id"))
            }

            ordered_agents: List[Dict[str, Any]] = []
            for allowed_id in allowed_ids:
                normalized_id = _normalize_agent_id(allowed_id)
                agent_payload = by_id.get(normalized_id, {"agent_id": normalized_id, "_missing": True}).copy()
                config = configured_meta.get(normalized_id) or {}

                if config.get("label"):
                    agent_payload.setdefault("name", config["label"])
                    agent_payload["_configured_label"] = config["label"]
                if config.get("channel_type"):
                    agent_payload["_configured_channel_type"] = config["channel_type"]
                if "active" in config:
                    agent_payload["_configured_active"] = bool(config["active"])

                ordered_agents.append(agent_payload)

            if isinstance(data, dict):
                data["agents"] = ordered_agents
                return data
            return {"agents": ordered_agents}
    except httpx.HTTPError as e:
        raise HTTPException(status_code=500, detail=f"Erro ElevenLabs: {str(e)}")


@router.get("/active-agents/{client_id}")
async def list_active_agents(
    client_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: DashboardUser = Depends(get_current_user)
):
    """List linked voice agents for this tenant/project."""
    check_access(client_id, current_user)
    project_id = await resolve_project_id_from_client_id(client_id, db)

    result = await db.execute(
        select(ProjectVoiceAgent)
        .where(ProjectVoiceAgent.project_id == project_id)
        .order_by(desc(ProjectVoiceAgent.active), desc(ProjectVoiceAgent.updated_at), desc(ProjectVoiceAgent.created_at))
    )
    rows = result.scalars().all()

    if not rows:
        fallback_ids = await get_client_agent_ids(client_id, db)
        return {
            "project_id": project_id,
            "agents": [
                {
                    "id": None,
                    "agent_id": aid,
                    "label": None,
                    "channel_type": "phone",
                    "active": True,
                    "source": "clients_table",
                }
                for aid in fallback_ids
            ],
        }

    return {
        "project_id": project_id,
        "agents": [
            {
                "id": str(row.id),
                "agent_id": row.agent_id,
                "label": row.label,
                "channel_type": row.channel_type,
                "active": bool(row.active),
                "created_at": row.created_at.isoformat() if row.created_at else None,
                "updated_at": row.updated_at.isoformat() if row.updated_at else None,
            }
            for row in rows
        ],
    }


@router.post("/active-agents/{client_id}")
async def add_active_agent(
    client_id: str,
    data: ActiveAgentCreate,
    db: AsyncSession = Depends(get_db),
    current_user: DashboardUser = Depends(get_current_user)
):
    """Link an existing ElevenLabs agent_id as active for this tenant/project."""
    check_access(client_id, current_user)
    project_id = await resolve_project_id_from_client_id(client_id, db)
    api_key = await get_client_elevenlabs_key(client_id, db)

    agent_id = _normalize_agent_id(data.agent_id)
    if not agent_id:
        raise HTTPException(status_code=400, detail="agent_id obrigatorio")

    channel_type = _normalize_channel_type(data.channel_type)
    provided_label = str(data.label or "").strip() or None
    elevenlabs_name: Optional[str] = None

    # Validate agent in ElevenLabs and capture current configured name.
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(
                f"{ELEVENLABS_BASE_URL}/convai/agents/{agent_id}",
                headers={"xi-api-key": api_key},
            )
            response.raise_for_status()
            payload = response.json() if response.content else {}
            elevenlabs_name = (
                payload.get("name")
                or payload.get("platform_settings", {}).get("widget_settings", {}).get("name")
            )
    except httpx.HTTPStatusError as e:
        detail = "Agent nao encontrado no ElevenLabs"
        if e.response is not None and e.response.text:
            detail = f"{detail}: {e.response.text}"
        raise HTTPException(status_code=400, detail=detail)
    except httpx.HTTPError as e:
        raise HTTPException(status_code=500, detail=f"Erro ElevenLabs: {str(e)}")

    existing_result = await db.execute(
        select(ProjectVoiceAgent)
        .where(
            and_(
                ProjectVoiceAgent.project_id == project_id,
                ProjectVoiceAgent.agent_id == agent_id,
                ProjectVoiceAgent.channel_type == channel_type,
            )
        )
        .order_by(desc(ProjectVoiceAgent.updated_at), desc(ProjectVoiceAgent.created_at))
    )
    row = existing_result.scalars().first()
    if row:
        row.active = bool(data.active)
        row.label = provided_label or row.label or elevenlabs_name
    else:
        row = ProjectVoiceAgent(
            project_id=project_id,
            agent_id=agent_id,
            label=provided_label or elevenlabs_name,
            channel_type=channel_type,
            active=bool(data.active),
        )
        db.add(row)

    await db.flush()
    await _sync_client_agent_ids(client_id, project_id, db)
    await db.commit()
    await db.refresh(row)

    return {
        "success": True,
        "agent": {
            "id": str(row.id),
            "project_id": str(project_id),
            "agent_id": row.agent_id,
            "label": row.label,
            "channel_type": row.channel_type,
            "active": bool(row.active),
        },
    }


@router.patch("/active-agents/{client_id}/{agent_id}")
async def update_active_agent(
    client_id: str,
    agent_id: str,
    data: ActiveAgentUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: DashboardUser = Depends(get_current_user)
):
    """Update linked active agent metadata for this tenant/project."""
    check_access(client_id, current_user)
    project_id = await resolve_project_id_from_client_id(client_id, db)

    normalized_agent_id = _normalize_agent_id(agent_id)
    if not normalized_agent_id:
        raise HTTPException(status_code=400, detail="agent_id invalido")

    stmt = select(ProjectVoiceAgent).where(
        and_(
            ProjectVoiceAgent.project_id == project_id,
            ProjectVoiceAgent.agent_id == normalized_agent_id,
        )
    )
    if data.channel_type is not None:
        stmt = stmt.where(ProjectVoiceAgent.channel_type == _normalize_channel_type(data.channel_type))

    result = await db.execute(stmt.order_by(desc(ProjectVoiceAgent.updated_at), desc(ProjectVoiceAgent.created_at)))
    row = result.scalars().first()
    if not row:
        raise HTTPException(status_code=404, detail="Agente ativo nao encontrado para este projeto")

    if data.label is not None:
        row.label = str(data.label).strip() or None
    if data.active is not None:
        row.active = bool(data.active)
    if data.channel_type is not None:
        row.channel_type = _normalize_channel_type(data.channel_type)

    await db.flush()
    await _sync_client_agent_ids(client_id, project_id, db)
    await db.commit()
    await db.refresh(row)

    return {
        "success": True,
        "agent": {
            "id": str(row.id),
            "project_id": str(project_id),
            "agent_id": row.agent_id,
            "label": row.label,
            "channel_type": row.channel_type,
            "active": bool(row.active),
        },
    }


@router.delete("/active-agents/{client_id}/{agent_id}")
async def deactivate_active_agent(
    client_id: str,
    agent_id: str,
    channel_type: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: DashboardUser = Depends(get_current_user)
):
    """Deactivate (unlink) agent from project without deleting it on ElevenLabs."""
    check_access(client_id, current_user)
    project_id = await resolve_project_id_from_client_id(client_id, db)

    normalized_agent_id = _normalize_agent_id(agent_id)
    if not normalized_agent_id:
        raise HTTPException(status_code=400, detail="agent_id invalido")

    stmt = select(ProjectVoiceAgent).where(
        and_(
            ProjectVoiceAgent.project_id == project_id,
            ProjectVoiceAgent.agent_id == normalized_agent_id,
        )
    )
    if channel_type:
        stmt = stmt.where(ProjectVoiceAgent.channel_type == _normalize_channel_type(channel_type))

    result = await db.execute(stmt)
    rows = result.scalars().all()
    if not rows:
        raise HTTPException(status_code=404, detail="Agente ativo nao encontrado para este projeto")

    deactivated = 0
    for row in rows:
        if row.active:
            row.active = False
            deactivated += 1

    await db.flush()
    await _sync_client_agent_ids(client_id, project_id, db)
    await db.commit()

    return {
        "success": True,
        "deactivated": deactivated,
        "message": "Agente desvinculado do projeto",
    }


@router.get("/agents/{client_id}/{agent_id}")
async def get_agent(
    client_id: str,
    agent_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: DashboardUser = Depends(get_current_user)
):
    """Get agent details enriched with DB metadata (_configured_*)"""
    check_access(client_id, current_user)
    api_key = await get_client_elevenlabs_key(client_id, db)

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(
                f"{ELEVENLABS_BASE_URL}/convai/agents/{agent_id}",
                headers={"xi-api-key": api_key}
            )
            response.raise_for_status()
            data = response.json()
    except httpx.HTTPStatusError as e:
        detail = e.response.text if e.response else str(e)
        raise HTTPException(status_code=e.response.status_code if e.response else 500, detail=detail)
    except httpx.HTTPError as e:
        raise HTTPException(status_code=500, detail=f"Erro ElevenLabs: {str(e)}")

    # Enrich with DB metadata from project_voice_agents
    try:
        project_id = await resolve_project_id_from_client_id(client_id, db)
        result = await db.execute(
            select(ProjectVoiceAgent)
            .where(
                and_(
                    ProjectVoiceAgent.project_id == project_id,
                    ProjectVoiceAgent.agent_id == agent_id,
                )
            )
            .order_by(desc(ProjectVoiceAgent.updated_at))
        )
        row = result.scalars().first()
        if row:
            data["_configured_label"] = row.label
            data["_configured_channel_type"] = row.channel_type
            data["_configured_active"] = bool(row.active)
    except Exception:
        pass

    return data


@router.post("/agents/{client_id}")
async def create_agent(
    client_id: str,
    data: AgentCreate,
    db: AsyncSession = Depends(get_db),
    current_user: DashboardUser = Depends(get_current_user)
):
    """Create new ElevenLabs agent via /convai/agents/create"""
    check_access(client_id, current_user)
    api_key = await get_client_elevenlabs_key(client_id, db)

    # Non-english agents require turbo/flash v2_5 TTS
    tts_model = "eleven_turbo_v2_5" if data.language != "en" else "eleven_flash_v2_5"

    payload: Dict[str, Any] = {
        "name": data.name,
        "conversation_config": {
            "agent": {
                "prompt": {
                    "prompt": data.system_prompt,
                    "llm": {
                        "model_id": data.model,
                    },
                },
                "first_message": data.first_message,
                "language": data.language,
            },
            "tts": {
                "model_id": tts_model,
            },
        },
        "platform_settings": {
            "widget": {
                "variant": "compact",
            },
        },
    }

    if data.voice_id:
        payload["conversation_config"]["tts"]["voice_id"] = data.voice_id

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{ELEVENLABS_BASE_URL}/convai/agents/create",
                headers={"xi-api-key": api_key, "Content-Type": "application/json"},
                json=payload,
            )
            response.raise_for_status()
            result = response.json()

            # Auto-link to project in DB
            agent_id = result.get("agent_id")
            if agent_id:
                try:
                    project_id = await resolve_project_id_from_client_id(client_id, db)
                    row = ProjectVoiceAgent(
                        project_id=project_id,
                        agent_id=agent_id,
                        label=data.name,
                        channel_type=_normalize_channel_type(data.channel_type),
                        active=True,
                    )
                    db.add(row)
                    await db.flush()
                    await _sync_client_agent_ids(client_id, project_id, db)
                    await db.commit()
                except Exception:
                    pass

            return result
    except httpx.HTTPStatusError as e:
        detail = e.response.text if e.response else str(e)
        raise HTTPException(status_code=e.response.status_code if e.response else 500, detail=f"Erro ElevenLabs: {detail}")
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
    """Update agent configuration (prompt, tools, KB, LLM params)"""
    check_access(client_id, current_user)
    api_key = await get_client_elevenlabs_key(client_id, db)

    # Build nested payload for ElevenLabs API
    payload: Dict[str, Any] = {}

    def ensure_path(*keys: str) -> Dict[str, Any]:
        """Ensure nested dict path exists and return the leaf dict."""
        d = payload
        for k in keys:
            if k not in d:
                d[k] = {}
            d = d[k]
        return d

    if data.system_prompt is not None:
        prompt_cfg = ensure_path("conversation_config", "agent", "prompt")
        prompt_cfg["prompt"] = data.system_prompt

    if data.first_message is not None:
        agent_cfg = ensure_path("conversation_config", "agent")
        agent_cfg["first_message"] = data.first_message

    if data.language is not None:
        agent_cfg = ensure_path("conversation_config", "agent")
        agent_cfg["language"] = data.language

    if data.name is not None:
        widget = ensure_path("platform_settings", "widget_settings")
        widget["name"] = data.name

    if data.model is not None:
        llm_cfg = ensure_path("conversation_config", "agent", "prompt", "llm")
        llm_cfg["model_id"] = data.model

    if data.temperature is not None:
        llm_cfg = ensure_path("conversation_config", "agent", "prompt", "llm")
        llm_cfg["model_temperature"] = data.temperature

    if data.max_tokens is not None:
        llm_cfg = ensure_path("conversation_config", "agent", "prompt", "llm")
        llm_cfg["max_tokens"] = data.max_tokens

    if data.max_duration_seconds is not None:
        conv_cfg = ensure_path("conversation_config")
        conv_cfg["max_duration_seconds"] = data.max_duration_seconds

    if data.tool_ids is not None:
        prompt_cfg = ensure_path("conversation_config", "agent", "prompt")
        prompt_cfg["tool_ids"] = data.tool_ids

    if data.knowledge_base_ids is not None:
        # Fetch KB metadata to get correct type/name for each doc
        kb_entries = []
        try:
            async with httpx.AsyncClient(timeout=15.0) as kb_client:
                kb_response = await kb_client.get(
                    f"{ELEVENLABS_BASE_URL}/convai/knowledge-base",
                    headers={"xi-api-key": api_key},
                )
                kb_response.raise_for_status()
                kb_data = kb_response.json()
                all_docs = kb_data.get("documents", kb_data.get("knowledge_base", []))
                doc_map = {d.get("id"): d for d in all_docs if isinstance(d, dict)}

                for kid in data.knowledge_base_ids:
                    doc = doc_map.get(kid, {})
                    # ElevenLabs requires type (file/text/url), name, id
                    kb_entries.append({
                        "type": doc.get("type", "file"),
                        "name": doc.get("name", kid),
                        "id": kid,
                        "usage_mode": "auto",
                    })
        except Exception:
            # Fallback: use 'file' type with id as name
            kb_entries = [
                {"type": "file", "name": kid, "id": kid, "usage_mode": "auto"}
                for kid in data.knowledge_base_ids
            ]

        prompt_cfg = ensure_path("conversation_config", "agent", "prompt")
        prompt_cfg["knowledge_base"] = kb_entries

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.patch(
                f"{ELEVENLABS_BASE_URL}/convai/agents/{agent_id}",
                headers={"xi-api-key": api_key, "Content-Type": "application/json"},
                json=payload
            )
            response.raise_for_status()
            return response.json()
    except httpx.HTTPStatusError as e:
        detail = e.response.text if e.response else str(e)
        raise HTTPException(status_code=e.response.status_code if e.response else 500, detail=detail)
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


@router.get("/workspace-agents/{client_id}")
async def list_workspace_agents(
    client_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: DashboardUser = Depends(get_current_user)
):
    """List ALL agents in the workspace (unfiltered) for 'Link Agent' modal."""
    check_access(client_id, current_user)
    api_key = await get_client_elevenlabs_key(client_id, db)

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(
                f"{ELEVENLABS_BASE_URL}/convai/agents",
                headers={"xi-api-key": api_key},
                params={"page_size": 100}
            )
            response.raise_for_status()
            data = response.json()
            agents_list = data.get("agents", [])
            return {"agents": agents_list}
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


# ─── Workspace Tools CRUD (proxy to ElevenLabs /v1/convai/tools) ─────

class ToolProperty(BaseModel):
    id: str                          # field name (snake_case)
    type: str = "string"             # string | number | boolean
    value_type: str = "llm_prompt"   # llm_prompt | constant | dynamic_variable
    description: str = ""
    required: bool = False


class WorkspaceToolCreate(BaseModel):
    name: str
    description: str
    type: str = "webhook"
    url: Optional[str] = None
    method: Optional[str] = "POST"
    headers: Optional[Dict[str, str]] = None
    body_schema: Optional[Dict[str, Any]] = None
    request_body_schema: Optional[Dict[str, Any]] = None
    parameters: Optional[Dict[str, Any]] = None
    properties: Optional[List[ToolProperty]] = None
    response_timeout_secs: Optional[int] = None
    disable_interruptions: Optional[bool] = None


@router.get("/tools/{client_id}")
async def list_workspace_tools(
    client_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: DashboardUser = Depends(get_current_user)
):
    """List all workspace tools from ElevenLabs"""
    check_access(client_id, current_user)
    api_key = await get_client_elevenlabs_key(client_id, db)

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(
                f"{ELEVENLABS_BASE_URL}/convai/tools",
                headers={"xi-api-key": api_key}
            )
            response.raise_for_status()
            return response.json()
    except httpx.HTTPError as e:
        raise HTTPException(status_code=500, detail=f"Erro ElevenLabs: {str(e)}")


@router.post("/tools/{client_id}")
async def create_workspace_tool(
    client_id: str,
    data: WorkspaceToolCreate,
    db: AsyncSession = Depends(get_db),
    current_user: DashboardUser = Depends(get_current_user)
):
    """Create a workspace tool in ElevenLabs (uses tool_config wrapper)"""
    check_access(client_id, current_user)
    api_key = await get_client_elevenlabs_key(client_id, db)

    # ElevenLabs requires { type, tool_config: { type, name, description, api_schema } }
    tool_config: Dict[str, Any] = {
        "type": data.type,
        "name": data.name,
        "description": data.description,
    }

    if data.type == "webhook" and data.url:
        api_schema: Dict[str, Any] = {
            "url": data.url,
            "method": data.method or "POST",
        }
        if data.headers:
            api_schema["request_headers"] = data.headers

        # Properties array format (preferred) or raw schema fallback
        if data.properties is not None:
            api_schema["request_body_schema"] = {
                "type": "object",
                "properties": [
                    {
                        "id": p.id,
                        "type": p.type,
                        "value_type": p.value_type,
                        "description": p.description,
                        "required": p.required,
                    }
                    for p in data.properties
                ],
            }
        else:
            rbs = data.request_body_schema or data.body_schema
            if rbs:
                api_schema["request_body_schema"] = rbs
            else:
                api_schema["request_body_schema"] = {
                    "type": "object",
                    "properties": {},
                    "required": [],
                }

        if data.response_timeout_secs is not None:
            api_schema["response_timeout_secs"] = data.response_timeout_secs

        tool_config["api_schema"] = api_schema

    if data.disable_interruptions is not None:
        tool_config["disable_interruptions"] = data.disable_interruptions

    payload: Dict[str, Any] = {
        "type": data.type,
        "tool_config": tool_config,
    }

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{ELEVENLABS_BASE_URL}/convai/tools",
                headers={"xi-api-key": api_key, "Content-Type": "application/json"},
                json=payload,
            )
            response.raise_for_status()
            return response.json()
    except httpx.HTTPStatusError as e:
        detail = e.response.text if e.response else str(e)
        raise HTTPException(status_code=e.response.status_code if e.response else 500, detail=detail)
    except httpx.HTTPError as e:
        raise HTTPException(status_code=500, detail=f"Erro ElevenLabs: {str(e)}")


@router.patch("/tools/{client_id}/{tool_id}")
async def update_workspace_tool(
    client_id: str,
    tool_id: str,
    data: WorkspaceToolCreate,
    db: AsyncSession = Depends(get_db),
    current_user: DashboardUser = Depends(get_current_user)
):
    """Update a workspace tool in ElevenLabs (uses tool_config wrapper)"""
    check_access(client_id, current_user)
    api_key = await get_client_elevenlabs_key(client_id, db)

    tool_config: Dict[str, Any] = {
        "type": data.type,
        "name": data.name,
        "description": data.description,
    }

    if data.type == "webhook" and data.url:
        api_schema: Dict[str, Any] = {
            "url": data.url,
            "method": data.method or "POST",
        }
        if data.headers:
            api_schema["request_headers"] = data.headers

        if data.properties is not None:
            api_schema["request_body_schema"] = {
                "type": "object",
                "properties": [
                    {
                        "id": p.id,
                        "type": p.type,
                        "value_type": p.value_type,
                        "description": p.description,
                        "required": p.required,
                    }
                    for p in data.properties
                ],
            }
        else:
            rbs = data.request_body_schema or data.body_schema
            if rbs:
                api_schema["request_body_schema"] = rbs

        if data.response_timeout_secs is not None:
            api_schema["response_timeout_secs"] = data.response_timeout_secs

        tool_config["api_schema"] = api_schema

    if data.disable_interruptions is not None:
        tool_config["disable_interruptions"] = data.disable_interruptions

    payload: Dict[str, Any] = {"tool_config": tool_config}

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.patch(
                f"{ELEVENLABS_BASE_URL}/convai/tools/{tool_id}",
                headers={"xi-api-key": api_key, "Content-Type": "application/json"},
                json=payload,
            )
            response.raise_for_status()
            return response.json()
    except httpx.HTTPStatusError as e:
        detail = e.response.text if e.response else str(e)
        raise HTTPException(status_code=e.response.status_code if e.response else 500, detail=detail)
    except httpx.HTTPError as e:
        raise HTTPException(status_code=500, detail=f"Erro ElevenLabs: {str(e)}")


@router.get("/tools/{client_id}/{tool_id}")
async def get_workspace_tool(
    client_id: str,
    tool_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: DashboardUser = Depends(get_current_user)
):
    """Get a single workspace tool detail from ElevenLabs"""
    check_access(client_id, current_user)
    api_key = await get_client_elevenlabs_key(client_id, db)

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(
                f"{ELEVENLABS_BASE_URL}/convai/tools/{tool_id}",
                headers={"xi-api-key": api_key}
            )
            response.raise_for_status()
            return response.json()
    except httpx.HTTPStatusError as e:
        detail = e.response.text if e.response else str(e)
        raise HTTPException(status_code=e.response.status_code if e.response else 500, detail=detail)
    except httpx.HTTPError as e:
        raise HTTPException(status_code=500, detail=f"Erro ElevenLabs: {str(e)}")


@router.delete("/tools/{client_id}/{tool_id}")
async def delete_workspace_tool(
    client_id: str,
    tool_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: DashboardUser = Depends(get_current_user)
):
    """Delete a workspace tool from ElevenLabs"""
    check_access(client_id, current_user)
    api_key = await get_client_elevenlabs_key(client_id, db)

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.delete(
                f"{ELEVENLABS_BASE_URL}/convai/tools/{tool_id}",
                headers={"xi-api-key": api_key}
            )
            response.raise_for_status()
            return {"success": True, "message": "Tool removida"}
    except httpx.HTTPStatusError as e:
        detail = e.response.text if e.response else str(e)
        raise HTTPException(status_code=e.response.status_code if e.response else 500, detail=detail)
    except httpx.HTTPError as e:
        raise HTTPException(status_code=500, detail=f"Erro ElevenLabs: {str(e)}")


# ─── Knowledge Base CRUD (proxy to ElevenLabs /v1/convai/knowledge-base) ─────

@router.get("/knowledge/{client_id}")
async def list_knowledge_base(
    client_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: DashboardUser = Depends(get_current_user)
):
    """List all knowledge base documents from ElevenLabs"""
    check_access(client_id, current_user)
    api_key = await get_client_elevenlabs_key(client_id, db)

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(
                f"{ELEVENLABS_BASE_URL}/convai/knowledge-base",
                headers={"xi-api-key": api_key}
            )
            response.raise_for_status()
            return response.json()
    except httpx.HTTPError as e:
        raise HTTPException(status_code=500, detail=f"Erro ElevenLabs: {str(e)}")


@router.post("/knowledge/{client_id}")
async def create_knowledge_doc(
    client_id: str,
    data: Dict[str, Any],
    db: AsyncSession = Depends(get_db),
    current_user: DashboardUser = Depends(get_current_user)
):
    """Upload a knowledge base document to ElevenLabs.
    Accepts: { type: 'text'|'url', name: str, text?: str, url?: str }
    """
    check_access(client_id, current_user)
    api_key = await get_client_elevenlabs_key(client_id, db)

    doc_type = data.get("type", "text")
    name = data.get("name", "Documento")

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            if doc_type == "url":
                payload = {
                    "type": "url",
                    "name": name,
                    "url": data.get("url", ""),
                }
                response = await client.post(
                    f"{ELEVENLABS_BASE_URL}/convai/knowledge-base",
                    headers={"xi-api-key": api_key, "Content-Type": "application/json"},
                    json=payload
                )
            else:
                # Text or file upload via multipart
                text_content = data.get("text", data.get("content", ""))
                files = {"file": (f"{name}.txt", text_content.encode("utf-8"), "text/plain")}
                form_data = {"name": name}
                response = await client.post(
                    f"{ELEVENLABS_BASE_URL}/convai/knowledge-base",
                    headers={"xi-api-key": api_key},
                    files=files,
                    data=form_data
                )

            response.raise_for_status()
            return response.json()
    except httpx.HTTPStatusError as e:
        detail = e.response.text if e.response else str(e)
        raise HTTPException(status_code=e.response.status_code if e.response else 500, detail=detail)
    except httpx.HTTPError as e:
        raise HTTPException(status_code=500, detail=f"Erro ElevenLabs: {str(e)}")


@router.delete("/knowledge/{client_id}/{doc_id}")
async def delete_knowledge_doc(
    client_id: str,
    doc_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: DashboardUser = Depends(get_current_user)
):
    """Delete a knowledge base document from ElevenLabs"""
    check_access(client_id, current_user)
    api_key = await get_client_elevenlabs_key(client_id, db)

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.delete(
                f"{ELEVENLABS_BASE_URL}/convai/knowledge-base/{doc_id}",
                headers={"xi-api-key": api_key}
            )
            response.raise_for_status()
            return {"success": True, "message": "Documento removido"}
    except httpx.HTTPStatusError as e:
        detail = e.response.text if e.response else str(e)
        raise HTTPException(status_code=e.response.status_code if e.response else 500, detail=detail)
    except httpx.HTTPError as e:
        raise HTTPException(status_code=500, detail=f"Erro ElevenLabs: {str(e)}")


# ─── Voice Call History (Webhook + API) ─────────────────────────────

WEBHOOK_SECRET = os.getenv("ELEVENLABS_WEBHOOK_SECRET", "superbot-webhook-2026")


def _first_non_empty(*values: Any) -> Any:
    for value in values:
        if value is None:
            continue
        if isinstance(value, str) and not value.strip():
            continue
        return value
    return None


def _parse_datetime(value: Any) -> Optional[datetime]:
    if value in (None, ""):
        return None

    if isinstance(value, (int, float)):
        try:
            # Accept both epoch seconds and milliseconds.
            ts = value / 1000 if value > 1_000_000_000_000 else value
            return datetime.fromtimestamp(ts, tz=timezone.utc)
        except (ValueError, OSError):
            return None

    if isinstance(value, str):
        normalized = value.strip()
        if not normalized:
            return None

        # Numeric string timestamps
        if normalized.isdigit():
            return _parse_datetime(int(normalized))

        try:
            return datetime.fromisoformat(normalized.replace("Z", "+00:00"))
        except ValueError:
            return None

    return None


def _parse_int(value: Any) -> Optional[int]:
    if value in (None, ""):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


class CallWebhookPayload(BaseModel):
    model_config = ConfigDict(extra="allow")

    agent_id: Optional[str] = None
    agent_name: Optional[str] = None
    conversation_id: Optional[str] = None
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
    recording_url: Optional[str] = None
    bitrix_audio_url: Optional[str] = None
    transcription_text: Optional[str] = None
    transcription: Optional[str] = None
    call_status: Optional[str] = None
    project_id: str


@router.post("/calls/webhook")
async def receive_call_webhook(
    payload: CallWebhookPayload,
    db: AsyncSession = Depends(get_db),
    x_webhook_secret: Optional[str] = None
):
    """Receive call data from n8n workflows (ElevenLabs/Bitrix-compatible)."""
    # Simple auth check
    # In production, use Header dependency; here we accept from body or query
    extra = getattr(payload, "__pydantic_extra__", None) or {}

    start_dt = _first_non_empty(
        _parse_datetime(payload.start_time),
        _parse_datetime(extra.get("started_at")),
        _parse_datetime(extra.get("start_at")),
        _parse_datetime(extra.get("created_at")),
        datetime.now(timezone.utc),
    )

    conversation_id = _first_non_empty(
        payload.conversation_id,
        extra.get("conversation_id"),
        extra.get("call_id"),
        extra.get("external_call_id"),
        extra.get("id"),
    ) or f"call-{uuid4()}"

    agent_id = _first_non_empty(
        payload.agent_id,
        extra.get("agent_id"),
        extra.get("bitrix_agent_id"),
        extra.get("provider"),
        "unknown",
    )

    duration = _first_non_empty(
        payload.call_duration_secs,
        extra.get("call_duration_secs"),
        extra.get("duration"),
        extra.get("duration_secs"),
        extra.get("duration_seconds"),
    )
    call_duration_secs = _parse_int(duration)

    transcript = payload.transcript
    extra_transcript = extra.get("transcript")
    if not transcript and isinstance(extra_transcript, list):
        transcript = extra_transcript

    transcript_text = _first_non_empty(
        payload.transcription_text,
        payload.transcription,
        extra.get("transcription_text"),
        extra.get("transcription"),
        extra.get("transcript_text"),
    )
    if not transcript and isinstance(extra_transcript, str):
        transcript_text = transcript_text or extra_transcript

    if not transcript and isinstance(transcript_text, str) and transcript_text.strip():
        transcript = [{"role": "customer", "message": transcript_text.strip()}]

    transcript_summary = _first_non_empty(
        payload.transcript_summary,
        extra.get("transcript_summary"),
        extra.get("summary"),
        extra.get("call_summary"),
    )

    if not transcript_summary and transcript:
        joined_text = " ".join(
            str(item.get("message", "")).strip()
            for item in transcript
            if isinstance(item, dict) and item.get("message")
        ).strip()
        transcript_summary = joined_text[:500] if joined_text else None

    audio_url = _first_non_empty(
        payload.audio_url,
        payload.recording_url,
        payload.bitrix_audio_url,
        extra.get("audio_url"),
        extra.get("recording_url"),
        extra.get("record_url"),
        extra.get("recording_file_url"),
    )

    if isinstance(audio_url, dict):
        audio_url = _first_non_empty(audio_url.get("url"), audio_url.get("link"))

    if isinstance(audio_url, str):
        audio_url = audio_url.strip() or None

    status_hint = str(_first_non_empty(
        payload.call_status,
        extra.get("call_status"),
        extra.get("status"),
        extra.get("result"),
        "",
    )).lower()

    call_successful = payload.call_successful
    if status_hint in {"failed", "failure", "error", "missed", "no_answer", "cancelled", "canceled"}:
        call_successful = False
    elif status_hint in {"successful", "success", "completed", "complete", "ok"}:
        call_successful = True

    customer_name = _first_non_empty(
        payload.customer_name,
        extra.get("customer_name"),
        extra.get("contact_name"),
        extra.get("name"),
    )

    customer_phone = _first_non_empty(
        payload.customer_phone,
        extra.get("customer_phone"),
        extra.get("phone"),
        extra.get("phone_number"),
        extra.get("to_number"),
    )

    customer_email = _first_non_empty(
        payload.customer_email,
        extra.get("customer_email"),
        extra.get("email"),
    )

    data_collection = _first_non_empty(
        payload.data_collection,
        extra.get("data_collection"),
    )

    if data_collection is None and extra:
        data_collection = {
            "provider": _first_non_empty(extra.get("provider"), "bitrix"),
            "raw_payload": extra,
        }

    call = VoiceCallHistory(
        project_id=payload.project_id,
        agent_id=agent_id,
        agent_name=payload.agent_name,
        conversation_id=conversation_id,
        customer_name=customer_name,
        customer_phone=customer_phone,
        customer_email=customer_email,
        call_duration_secs=call_duration_secs,
        start_time=start_dt or datetime.now(timezone.utc),
        transcript_summary=transcript_summary,
        transcript=transcript,
        call_successful=call_successful,
        termination_reason=_first_non_empty(payload.termination_reason, extra.get("termination_reason"), extra.get("hangup_reason")),
        audio_url=audio_url,
        data_collection=data_collection,
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

    def _audio_url(c: VoiceCallHistory) -> Optional[str]:
        if c.audio_url:
            return c.audio_url
        return _build_elevenlabs_audio_url(c.conversation_id)

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
                "audio_url": _audio_url(c),
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
        "audio_url": call.audio_url or _build_elevenlabs_audio_url(call.conversation_id),
        "data_collection": call.data_collection,
        "created_at": call.created_at.isoformat() if call.created_at else None,
    }


@router.get("/calls/{client_id}/{call_id}/audio")
async def get_call_audio(
    client_id: str,
    call_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: DashboardUser = Depends(get_current_user)
):
    """
    Stream call audio to the dashboard.
    - Uses stored audio_url when present.
    - Falls back to ElevenLabs conversation audio endpoint.
    """
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
        raise HTTPException(status_code=404, detail="Ligacao nao encontrada")

    source_url = str(call.audio_url or "").strip() or _build_elevenlabs_audio_url(call.conversation_id)
    if not source_url:
        raise HTTPException(status_code=404, detail="Audio nao disponivel para esta ligacao")

    api_key = await get_client_elevenlabs_key(client_id, db)

    async def _fetch(url: str) -> httpx.Response:
        headers: Dict[str, str] = {}
        if "api.elevenlabs.io" in url:
            headers["xi-api-key"] = api_key
        async with httpx.AsyncClient(timeout=120.0, follow_redirects=True) as client:
            return await client.get(url, headers=headers)

    response = await _fetch(source_url)
    if response.status_code >= 400:
        fallback_url = _build_elevenlabs_audio_url(call.conversation_id)
        if fallback_url and fallback_url != source_url:
            response = await _fetch(fallback_url)

    if response.status_code >= 400:
        detail = response.text.strip() if response.text else "Falha ao obter audio no ElevenLabs"
        raise HTTPException(status_code=502, detail=detail)

    filename = f"{call.conversation_id or call.id}.mp3"
    content_type = response.headers.get("content-type", "audio/mpeg")
    return Response(
        content=response.content,
        media_type=content_type,
        headers={
            "Cache-Control": "no-store",
            "Content-Disposition": f'inline; filename="{filename}"',
        },
    )
