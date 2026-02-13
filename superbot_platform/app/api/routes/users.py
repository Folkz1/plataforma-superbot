"""
User management routes for SuperBot Dashboard (admin only)
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from typing import Optional
import uuid

from app.db.database import get_db
from app.db.models import DashboardUser, Client
from app.api.routes.auth import get_current_user, hash_password

router = APIRouter(prefix="/api/users", tags=["users"])


# ==================== Schemas ====================

class CreateUserRequest(BaseModel):
    email: str
    password: str
    name: str
    role: str = "client"
    client_id: Optional[str] = None


class UpdateUserRequest(BaseModel):
    name: Optional[str] = None
    password: Optional[str] = None
    is_active: Optional[bool] = None


class UserOut(BaseModel):
    id: str
    email: str
    name: str
    role: str
    client_id: Optional[str]
    client_name: Optional[str]
    is_active: bool
    last_login: Optional[str]
    created_at: Optional[str]


# ==================== Helpers ====================

def require_admin(current_user: DashboardUser = Depends(get_current_user)):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Acesso restrito a administradores")
    return current_user


# ==================== Routes ====================

@router.get("/")
async def list_users(
    client_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    admin: DashboardUser = Depends(require_admin),
):
    """List all dashboard users (admin only). Optionally filter by client_id."""
    query = select(DashboardUser).order_by(DashboardUser.created_at.desc())
    if client_id:
        query = query.where(DashboardUser.client_id == client_id)

    result = await db.execute(query)
    users = result.scalars().all()

    # Batch resolve client names
    client_ids = list({str(u.client_id) for u in users if u.client_id})
    client_names = {}
    if client_ids:
        cr = await db.execute(select(Client.id, Client.name).where(Client.id.in_(client_ids)))
        client_names = {str(row[0]): row[1] for row in cr.all()}

    return [
        {
            "id": str(u.id),
            "email": u.email,
            "name": u.name,
            "role": u.role,
            "client_id": str(u.client_id) if u.client_id else None,
            "client_name": client_names.get(str(u.client_id)) if u.client_id else None,
            "is_active": u.is_active,
            "last_login": u.last_login.isoformat() if u.last_login else None,
            "created_at": u.created_at.isoformat() if u.created_at else None,
        }
        for u in users
    ]


@router.post("/", status_code=201)
async def create_user(
    req: CreateUserRequest,
    db: AsyncSession = Depends(get_db),
    admin: DashboardUser = Depends(require_admin),
):
    """Create a new dashboard user (admin only)."""
    # Check duplicate email
    existing = await db.execute(
        select(DashboardUser).where(DashboardUser.email == req.email)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Email já cadastrado")

    # Validate client_id if role=client
    client_name = None
    if req.role == "client":
        if not req.client_id:
            raise HTTPException(status_code=400, detail="client_id obrigatório para role=client")
        cr = await db.execute(select(Client).where(Client.id == req.client_id))
        client = cr.scalar_one_or_none()
        if not client:
            raise HTTPException(status_code=404, detail="Cliente não encontrado")
        client_name = client.name

    user = DashboardUser(
        id=uuid.uuid4(),
        email=req.email,
        password_hash=hash_password(req.password),
        name=req.name,
        role=req.role,
        client_id=req.client_id if req.client_id else None,
        is_active=True,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    return {
        "id": str(user.id),
        "email": user.email,
        "name": user.name,
        "role": user.role,
        "client_id": str(user.client_id) if user.client_id else None,
        "client_name": client_name,
        "is_active": user.is_active,
    }


@router.patch("/{user_id}")
async def update_user(
    user_id: str,
    req: UpdateUserRequest,
    db: AsyncSession = Depends(get_db),
    admin: DashboardUser = Depends(require_admin),
):
    """Update user name, password or active status (admin only)."""
    result = await db.execute(select(DashboardUser).where(DashboardUser.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")

    if req.name is not None:
        user.name = req.name
    if req.password is not None:
        user.password_hash = hash_password(req.password)
    if req.is_active is not None:
        user.is_active = req.is_active

    await db.commit()
    return {"success": True}


@router.delete("/{user_id}")
async def delete_user(
    user_id: str,
    db: AsyncSession = Depends(get_db),
    admin: DashboardUser = Depends(require_admin),
):
    """Delete a dashboard user (admin only)."""
    result = await db.execute(select(DashboardUser).where(DashboardUser.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")

    # Prevent deleting yourself
    if str(user.id) == str(admin.id):
        raise HTTPException(status_code=400, detail="Não é possível deletar seu próprio usuário")

    await db.delete(user)
    await db.commit()
    return {"success": True}
