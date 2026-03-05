"""
User management routes for SuperBot Dashboard.
Roles: admin (super), manager (client admin), client (basic user).
- Admin: full CRUD on all users
- Manager: CRUD on users of their own client_id (can create client/manager)
- Client: read-only on self
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

VALID_ROLES = {"admin", "manager", "client"}


# ==================== Schemas ====================

class CreateUserRequest(BaseModel):
    email: str
    password: str
    name: str
    role: str = "client"
    client_id: Optional[str] = None


class UpdateUserRequest(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    password: Optional[str] = None
    is_active: Optional[bool] = None
    role: Optional[str] = None


# ==================== Helpers ====================

def require_admin_or_manager(current_user: DashboardUser = Depends(get_current_user)):
    """Allow admin or manager roles."""
    if current_user.role not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Acesso restrito a administradores e gerentes")
    return current_user


def _user_to_dict(u: DashboardUser, client_name: str = None) -> dict:
    return {
        "id": str(u.id),
        "email": u.email,
        "name": u.name,
        "role": u.role,
        "client_id": str(u.client_id) if u.client_id else None,
        "client_name": client_name,
        "is_active": u.is_active,
        "last_login": u.last_login.isoformat() if u.last_login else None,
        "created_at": u.created_at.isoformat() if u.created_at else None,
    }


# ==================== Routes ====================

@router.get("/")
async def list_users(
    client_id: Optional[str] = None,
    search: Optional[str] = None,
    role: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: DashboardUser = Depends(require_admin_or_manager),
):
    """List users. Admin sees all; manager sees only their client's users."""
    query = select(DashboardUser).order_by(DashboardUser.created_at.desc())

    # Manager can only see users of their own client
    if current_user.role == "manager":
        query = query.where(DashboardUser.client_id == current_user.client_id)
    elif client_id:
        query = query.where(DashboardUser.client_id == client_id)

    if role and role in VALID_ROLES:
        query = query.where(DashboardUser.role == role)

    if search:
        search_filter = f"%{search}%"
        query = query.where(
            DashboardUser.name.ilike(search_filter) | DashboardUser.email.ilike(search_filter)
        )

    result = await db.execute(query)
    users = result.scalars().all()

    # Batch resolve client names
    client_ids = list({str(u.client_id) for u in users if u.client_id})
    client_names = {}
    if client_ids:
        cr = await db.execute(select(Client.id, Client.name).where(Client.id.in_(client_ids)))
        client_names = {str(row[0]): row[1] for row in cr.all()}

    return [
        _user_to_dict(u, client_names.get(str(u.client_id)) if u.client_id else None)
        for u in users
    ]


@router.get("/{user_id}")
async def get_user(
    user_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: DashboardUser = Depends(require_admin_or_manager),
):
    """Get a single user detail."""
    result = await db.execute(select(DashboardUser).where(DashboardUser.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Usuario nao encontrado")

    # Manager can only see users of their own client
    if current_user.role == "manager" and str(user.client_id) != str(current_user.client_id):
        raise HTTPException(status_code=403, detail="Acesso negado")

    client_name = None
    if user.client_id:
        cr = await db.execute(select(Client.name).where(Client.id == user.client_id))
        client_name = cr.scalar_one_or_none()

    return _user_to_dict(user, client_name)


@router.post("/", status_code=201)
async def create_user(
    req: CreateUserRequest,
    db: AsyncSession = Depends(get_db),
    current_user: DashboardUser = Depends(require_admin_or_manager),
):
    """Create a new user. Manager can only create client/manager for their own client."""
    # Validate role
    if req.role not in VALID_ROLES:
        raise HTTPException(status_code=400, detail=f"Role invalido. Use: {', '.join(VALID_ROLES)}")

    # Manager restrictions
    if current_user.role == "manager":
        if req.role == "admin":
            raise HTTPException(status_code=403, detail="Gerentes nao podem criar administradores")
        # Force manager's client_id
        req.client_id = str(current_user.client_id)

    # Check duplicate email
    existing = await db.execute(
        select(DashboardUser).where(DashboardUser.email == req.email)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Email ja cadastrado")

    # Validate client_id for non-admin roles
    client_name = None
    if req.role in ("client", "manager"):
        if not req.client_id:
            raise HTTPException(status_code=400, detail="client_id obrigatorio para role client/manager")
        cr = await db.execute(select(Client).where(Client.id == req.client_id))
        client = cr.scalar_one_or_none()
        if not client:
            raise HTTPException(status_code=404, detail="Cliente nao encontrado")
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

    return _user_to_dict(user, client_name)


@router.patch("/{user_id}")
async def update_user(
    user_id: str,
    req: UpdateUserRequest,
    db: AsyncSession = Depends(get_db),
    current_user: DashboardUser = Depends(require_admin_or_manager),
):
    """Update user. Manager can only update users of their own client."""
    result = await db.execute(select(DashboardUser).where(DashboardUser.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Usuario nao encontrado")

    # Manager restrictions
    if current_user.role == "manager":
        if str(user.client_id) != str(current_user.client_id):
            raise HTTPException(status_code=403, detail="Acesso negado")
        if req.role == "admin":
            raise HTTPException(status_code=403, detail="Gerentes nao podem promover a admin")

    if req.name is not None:
        user.name = req.name
    if req.email is not None:
        # Check duplicate
        existing = await db.execute(
            select(DashboardUser).where(DashboardUser.email == req.email, DashboardUser.id != user_id)
        )
        if existing.scalar_one_or_none():
            raise HTTPException(status_code=400, detail="Email ja cadastrado")
        user.email = req.email
    if req.password is not None:
        user.password_hash = hash_password(req.password)
    if req.is_active is not None:
        user.is_active = req.is_active
    if req.role is not None:
        if req.role not in VALID_ROLES:
            raise HTTPException(status_code=400, detail=f"Role invalido. Use: {', '.join(VALID_ROLES)}")
        # Only admin can set admin role
        if req.role == "admin" and current_user.role != "admin":
            raise HTTPException(status_code=403, detail="Apenas admin pode definir role admin")
        user.role = req.role

    await db.commit()

    client_name = None
    if user.client_id:
        cr = await db.execute(select(Client.name).where(Client.id == user.client_id))
        client_name = cr.scalar_one_or_none()

    return _user_to_dict(user, client_name)


@router.delete("/{user_id}")
async def delete_user(
    user_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: DashboardUser = Depends(require_admin_or_manager),
):
    """Delete a user. Manager can only delete users of their own client."""
    result = await db.execute(select(DashboardUser).where(DashboardUser.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Usuario nao encontrado")

    # Prevent deleting yourself
    if str(user.id) == str(current_user.id):
        raise HTTPException(status_code=400, detail="Nao e possivel deletar seu proprio usuario")

    # Manager restrictions
    if current_user.role == "manager":
        if str(user.client_id) != str(current_user.client_id):
            raise HTTPException(status_code=403, detail="Acesso negado")
        if user.role == "admin":
            raise HTTPException(status_code=403, detail="Gerentes nao podem deletar administradores")

    await db.delete(user)
    await db.commit()
    return {"success": True}
