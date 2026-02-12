"""
Authentication routes for SuperBot Dashboard
"""
from fastapi import APIRouter, Depends, HTTPException, status, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from datetime import datetime, timedelta
import hashlib
import jwt
import os

from app.db.database import get_db
from app.db.models import DashboardUser, Session as DBSession, Client

router = APIRouter(prefix="/api/auth", tags=["auth"])
security = HTTPBearer()

# JWT Config
SECRET_KEY = os.getenv("JWT_SECRET_KEY", "your-secret-key-change-in-production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = 24


# Schemas
class LoginRequest(BaseModel):
    username: str
    password: str


class UserResponse(BaseModel):
    id: str
    email: str
    name: str
    role: str
    client_id: str | None
    client_name: str | None


# Helper functions
def hash_password(password: str) -> str:
    """Hash password with SHA256 for dev."""
    return hashlib.sha256(password.encode()).hexdigest()


def verify_password(password: str, hashed: str) -> bool:
    """Verify password against hash (SHA256)."""
    return hashlib.sha256(password.encode()).hexdigest() == hashed


def create_access_token(user_id: str, email: str, role: str) -> tuple[str, datetime]:
    """Create JWT access token"""
    expires_at = datetime.utcnow() + timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS)
    payload = {
        "sub": user_id,
        "email": email,
        "role": role,
        "exp": expires_at
    }
    token = jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)
    return token, expires_at


def decode_token(token: str) -> dict:
    """Decode and verify JWT token"""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expirado")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Token inválido")


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: AsyncSession = Depends(get_db)
) -> DashboardUser:
    """Get current authenticated user"""
    token = credentials.credentials
    payload = decode_token(token)
    
    result = await db.execute(
        select(DashboardUser).where(DashboardUser.id == payload["sub"])
    )
    user = result.scalar_one_or_none()
    
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="Usuário não encontrado ou inativo")
    
    return user


# Routes
@router.post("/login")
async def login(
    request: LoginRequest,
    req: Request,
    db: AsyncSession = Depends(get_db)
):
    """Login endpoint"""
    # Find user by email (username é tratado como email)
    result = await db.execute(
        select(DashboardUser).where(DashboardUser.email == request.username)
    )
    user = result.scalar_one_or_none()
    
    if not user or not verify_password(request.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Usuário ou senha incorretos"
        )
    
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Usuário inativo"
        )
    
    # Create token
    token, expires_at = create_access_token(str(user.id), user.email, user.role)
    
    # Save session
    session = DBSession(
        user_id=user.id,
        token=token,
        expires_at=expires_at,
        ip_address=req.client.host if req.client else None,
        user_agent=req.headers.get("user-agent")
    )
    db.add(session)
    
    # Update last login
    user.last_login = datetime.utcnow()
    await db.commit()
    
    # Get client info if exists
    client_name = None
    if user.client_id:
        result = await db.execute(
            select(Client).where(Client.id == user.client_id)
        )
        client = result.scalar_one_or_none()
        client_name = client.name if client else None
    
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": str(user.id),
            "email": user.email,
            "name": user.name,
            "role": user.role,
            "client_id": str(user.client_id) if user.client_id else None,
            "client_name": client_name
        },
        "expires_at": expires_at.isoformat()
    }


@router.post("/logout")
async def logout(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: AsyncSession = Depends(get_db)
):
    """Logout endpoint"""
    token = credentials.credentials
    
    # Delete session
    result = await db.execute(
        select(DBSession).where(DBSession.token == token)
    )
    session = result.scalar_one_or_none()
    if session:
        await db.delete(session)
        await db.commit()
    
    return {"success": True}


@router.get("/me", response_model=UserResponse)
async def get_me(
    current_user: DashboardUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Get current user info"""
    client_name = None
    if current_user.client_id:
        result = await db.execute(
            select(Client).where(Client.id == current_user.client_id)
        )
        client = result.scalar_one_or_none()
        client_name = client.name if client else None
    
    return {
        "id": str(current_user.id),
        "email": current_user.email,
        "name": current_user.name,
        "role": current_user.role,
        "client_id": str(current_user.client_id) if current_user.client_id else None,
        "client_name": client_name
    }
