"""
SuperBot Platform - Agents API
CRUD de agentes IA vinculados a projetos.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
from typing import Optional, Any

from app.db.database import get_db
from app.db.models import DashboardUser
from app.api.routes.auth import get_current_user
from app.core.tenancy import resolve_project_id_for_user
from app.core.agent_manager import AgentManager

router = APIRouter(prefix="/api/agents", tags=["agents"])


# ==================== Schemas ====================

class CreateAgentRequest(BaseModel):
    name: str
    system_prompt: str
    llm_model: str = "gemini-2.0-flash"
    first_message: str = ""
    voice_id: Optional[str] = None
    send_audio: bool = False
    settings: Optional[dict[str, Any]] = None


class UpdateAgentRequest(BaseModel):
    name: Optional[str] = None
    system_prompt: Optional[str] = None
    llm_model: Optional[str] = None
    first_message: Optional[str] = None
    voice_id: Optional[str] = None
    send_audio: Optional[bool] = None
    rag_store_id: Optional[str] = None
    settings: Optional[dict[str, Any]] = None
    is_active: Optional[bool] = None


class AddToolRequest(BaseModel):
    name: str
    description: str
    webhook_url: str
    parameters: Optional[list] = None


class AddKnowledgeRequest(BaseModel):
    content: str
    metadata: Optional[dict[str, Any]] = None


# ==================== Agent CRUD ====================

@router.get("/{tenant_id}")
async def list_agents(
    tenant_id: str,
    current_user: DashboardUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Lista todos os agentes de um projeto."""
    project_id = await resolve_project_id_for_user(tenant_id, current_user, db)
    mgr = AgentManager(db=db)
    agents = await mgr.list_agents(project_id)
    return {"agents": agents, "project_id": project_id}


@router.get("/{tenant_id}/active")
async def get_active_agent(
    tenant_id: str,
    current_user: DashboardUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Busca o agente ativo de um projeto."""
    project_id = await resolve_project_id_for_user(tenant_id, current_user, db)
    mgr = AgentManager(db=db)
    agent = await mgr.get_active_agent_for_project(project_id)
    if not agent:
        return {"agent": None, "project_id": project_id}
    return {"agent": agent, "project_id": project_id}


@router.post("/{tenant_id}")
async def create_agent(
    tenant_id: str,
    body: CreateAgentRequest,
    current_user: DashboardUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Cria um novo agente (desativa o anterior automaticamente)."""
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Apenas admin pode criar agentes")

    project_id = await resolve_project_id_for_user(tenant_id, current_user, db)
    mgr = AgentManager(db=db)

    agent = await mgr.create_agent(
        project_id=project_id,
        name=body.name,
        system_prompt=body.system_prompt,
        llm_model=body.llm_model,
        first_message=body.first_message,
        voice_id=body.voice_id,
        send_audio=body.send_audio,
        settings=body.settings
    )
    await db.commit()
    return {"agent": agent, "project_id": project_id}


@router.patch("/{tenant_id}/{agent_id}")
async def update_agent(
    tenant_id: str,
    agent_id: str,
    body: UpdateAgentRequest,
    current_user: DashboardUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Atualiza um agente existente."""
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Apenas admin pode editar agentes")

    project_id = await resolve_project_id_for_user(tenant_id, current_user, db)
    mgr = AgentManager(db=db)

    updates = body.model_dump(exclude_none=True)
    if not updates:
        raise HTTPException(status_code=400, detail="Nenhum campo para atualizar")

    agent = await mgr.update_agent(agent_id, updates)
    if not agent:
        raise HTTPException(status_code=404, detail="Agente não encontrado")

    await db.commit()
    return {"agent": agent, "project_id": project_id}


@router.delete("/{tenant_id}/{agent_id}")
async def delete_agent(
    tenant_id: str,
    agent_id: str,
    current_user: DashboardUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Deleta um agente."""
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Apenas admin pode deletar agentes")

    await resolve_project_id_for_user(tenant_id, current_user, db)
    mgr = AgentManager(db=db)

    deleted = await mgr.delete_agent(agent_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Agente não encontrado")

    await db.commit()
    return {"deleted": True, "agent_id": agent_id}


# ==================== Tools CRUD ====================

@router.get("/{tenant_id}/tools")
async def list_tools(
    tenant_id: str,
    current_user: DashboardUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Lista tools do projeto."""
    project_id = await resolve_project_id_for_user(tenant_id, current_user, db)
    mgr = AgentManager(db=db)
    tools = await mgr.get_agent_tools(project_id)
    return {"tools": tools, "project_id": project_id}


@router.post("/{tenant_id}/tools")
async def add_tool(
    tenant_id: str,
    body: AddToolRequest,
    current_user: DashboardUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Adiciona uma tool ao projeto."""
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Apenas admin pode gerenciar tools")

    project_id = await resolve_project_id_for_user(tenant_id, current_user, db)
    mgr = AgentManager(db=db)

    tool = await mgr.add_tool(
        project_id=project_id,
        name=body.name,
        description=body.description,
        webhook_url=body.webhook_url,
        parameters=body.parameters
    )
    await db.commit()
    return {"tool": tool, "project_id": project_id}


@router.delete("/{tenant_id}/tools/{tool_id}")
async def remove_tool(
    tenant_id: str,
    tool_id: str,
    current_user: DashboardUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Remove uma tool do projeto."""
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Apenas admin pode gerenciar tools")

    project_id = await resolve_project_id_for_user(tenant_id, current_user, db)
    mgr = AgentManager(db=db)

    deleted = await mgr.remove_tool(project_id, tool_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Tool não encontrada")

    await db.commit()
    return {"deleted": True, "tool_id": tool_id}


# ==================== Knowledge Base CRUD ====================

@router.get("/{tenant_id}/knowledge")
async def list_knowledge(
    tenant_id: str,
    current_user: DashboardUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Lista chunks de conhecimento do projeto."""
    project_id = await resolve_project_id_for_user(tenant_id, current_user, db)
    mgr = AgentManager(db=db)
    items = await mgr.list_knowledge(project_id)
    return {"knowledge": items, "project_id": project_id}


@router.post("/{tenant_id}/knowledge")
async def add_knowledge(
    tenant_id: str,
    body: AddKnowledgeRequest,
    current_user: DashboardUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Adiciona chunk de conhecimento ao projeto."""
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Apenas admin pode gerenciar conhecimento")

    project_id = await resolve_project_id_for_user(tenant_id, current_user, db)
    mgr = AgentManager(db=db)

    item = await mgr.add_knowledge(
        project_id=project_id,
        content=body.content,
        metadata=body.metadata
    )
    await db.commit()
    return {"knowledge": item, "project_id": project_id}


@router.delete("/{tenant_id}/knowledge/{knowledge_id}")
async def delete_knowledge(
    tenant_id: str,
    knowledge_id: str,
    current_user: DashboardUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Remove chunk de conhecimento."""
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Apenas admin pode gerenciar conhecimento")

    project_id = await resolve_project_id_for_user(tenant_id, current_user, db)
    mgr = AgentManager(db=db)

    deleted = await mgr.delete_knowledge(project_id, knowledge_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Item não encontrado")

    await db.commit()
    return {"deleted": True, "knowledge_id": knowledge_id}
