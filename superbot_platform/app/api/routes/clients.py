"""
Client management routes for Admin Dashboard
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel, ConfigDict
from typing import Optional
from datetime import datetime
from uuid import UUID

from app.db.database import get_db
from app.db.models import Client, DashboardUser
from app.api.routes.auth import get_current_user

router = APIRouter(prefix="/api/clients", tags=["clients"])


# Schemas
class ClientCreate(BaseModel):
    name: str
    slug: str
    timezone: str = "America/Sao_Paulo"
    
    # Meta Config (optional)
    meta_page_id: Optional[str] = None
    meta_phone_id: Optional[str] = None
    meta_ig_id: Optional[str] = None
    meta_waba_id: Optional[str] = None
    meta_access_token: Optional[str] = None
    
    # ElevenLabs Config (optional)
    elevenlabs_agent_id: Optional[str] = None
    elevenlabs_voice_id: Optional[str] = None
    elevenlabs_api_key: Optional[str] = None


class ClientUpdate(BaseModel):
    name: Optional[str] = None
    status: Optional[str] = None
    timezone: Optional[str] = None
    
    # Meta Config
    meta_page_id: Optional[str] = None
    meta_phone_id: Optional[str] = None
    meta_ig_id: Optional[str] = None
    meta_waba_id: Optional[str] = None
    meta_access_token: Optional[str] = None
    
    # ElevenLabs Config
    elevenlabs_agent_id: Optional[str] = None
    elevenlabs_voice_id: Optional[str] = None
    elevenlabs_api_key: Optional[str] = None
    
    # Settings
    settings: Optional[dict] = None


class ClientResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    slug: str
    status: str
    timezone: str

    # Meta Config
    meta_page_id: Optional[str] = None
    meta_phone_id: Optional[str] = None
    meta_ig_id: Optional[str] = None
    meta_waba_id: Optional[str] = None

    # ElevenLabs Config
    elevenlabs_agent_id: Optional[str] = None
    elevenlabs_voice_id: Optional[str] = None

    # Settings (project_id mapping)
    settings: Optional[dict] = None

    # Metadata
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


# Helper: Check if user is admin
async def require_admin(current_user: DashboardUser = Depends(get_current_user)):
    """Ensure user is admin"""
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Acesso negado. Apenas administradores."
        )
    return current_user


# Routes
@router.get("/", response_model=list[ClientResponse])
async def list_clients(
    db: AsyncSession = Depends(get_db),
    current_user: DashboardUser = Depends(get_current_user)
):
    """List all clients (admin) or current client (client role)"""
    if current_user.role == "admin":
        result = await db.execute(select(Client).order_by(Client.name))
        clients = result.scalars().all()
    else:
        # Client users can only see their own client
        if not current_user.client_id:
            raise HTTPException(status_code=404, detail="Cliente não encontrado")
        result = await db.execute(select(Client).where(Client.id == current_user.client_id))
        clients = result.scalars().all()

    return clients


@router.get("/{client_id}", response_model=ClientResponse)
async def get_client(
    client_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: DashboardUser = Depends(get_current_user)
):
    """Get client by ID"""
    result = await db.execute(select(Client).where(Client.id == client_id))
    client = result.scalar_one_or_none()

    if not client:
        raise HTTPException(status_code=404, detail="Cliente não encontrado")

    # Client users can only access their own client
    if current_user.role == "client" and str(current_user.client_id) != client_id:
        raise HTTPException(status_code=403, detail="Acesso negado")

    return client


@router.post("/", response_model=ClientResponse)
async def create_client(
    data: ClientCreate,
    db: AsyncSession = Depends(get_db),
    admin: DashboardUser = Depends(require_admin)
):
    """Create new client (admin only)"""
    # Check if slug already exists
    result = await db.execute(select(Client).where(Client.slug == data.slug))
    existing = result.scalar_one_or_none()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Slug '{data.slug}' já existe"
        )

    client = Client(
        name=data.name,
        slug=data.slug,
        timezone=data.timezone,
        meta_page_id=data.meta_page_id,
        meta_phone_id=data.meta_phone_id,
        meta_ig_id=data.meta_ig_id,
        meta_waba_id=data.meta_waba_id,
        meta_access_token=data.meta_access_token,
        elevenlabs_agent_id=data.elevenlabs_agent_id,
        elevenlabs_voice_id=data.elevenlabs_voice_id,
        elevenlabs_api_key=data.elevenlabs_api_key
    )

    db.add(client)
    await db.flush()
    await db.refresh(client)

    return client


@router.patch("/{client_id}", response_model=ClientResponse)
async def update_client(
    client_id: str,
    data: ClientUpdate,
    db: AsyncSession = Depends(get_db),
    admin: DashboardUser = Depends(require_admin)
):
    """Update client (admin only)"""
    result = await db.execute(select(Client).where(Client.id == client_id))
    client = result.scalar_one_or_none()

    if not client:
        raise HTTPException(status_code=404, detail="Cliente não encontrado")

    # Update fields
    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(client, field, value)

    await db.flush()
    await db.refresh(client)

    return client


@router.delete("/{client_id}")
async def delete_client(
    client_id: str,
    db: AsyncSession = Depends(get_db),
    admin: DashboardUser = Depends(require_admin)
):
    """Delete client (admin only)"""
    result = await db.execute(select(Client).where(Client.id == client_id))
    client = result.scalar_one_or_none()

    if not client:
        raise HTTPException(status_code=404, detail="Cliente não encontrado")

    await db.delete(client)
    await db.flush()

    return {"success": True, "message": f"Cliente {client.name} removido"}
