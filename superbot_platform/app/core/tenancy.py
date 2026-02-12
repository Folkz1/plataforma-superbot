import json
import re
from typing import Any, Optional
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import DashboardUser


def normalize_slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (value or "").lower())


def _parse_json_maybe(value: Any) -> dict:
    if value is None:
        return {}
    if isinstance(value, dict):
        return value
    if isinstance(value, str) and value.strip():
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, dict) else {}
        except Exception:
            return {}
    return {}


async def resolve_project_id_from_client_id(client_id: str, db: AsyncSession) -> str:
    """
    Resolve the n8n/multitenant `projects.id` for a given dashboard `clients.id`.

    Priority:
    1) clients.settings.project_id
    2) projects.project_slug == clients.settings.project_slug (or clients.slug)
    3) normalized slug match (fallback)
    """
    try:
        UUID(str(client_id))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"client_id inválido: {e}")

    res = await db.execute(
        text("SELECT id::text AS id, slug, settings FROM clients WHERE id = (:id)::uuid"),
        {"id": str(client_id)},
    )
    row = res.mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Cliente não encontrado")

    settings = _parse_json_maybe(row.get("settings"))
    project_id = str(settings.get("project_id") or "").strip()
    if project_id:
        return project_id

    slug = str(settings.get("project_slug") or row.get("slug") or "").strip()
    if not slug:
        raise HTTPException(status_code=400, detail="Cliente sem slug/configuração de projeto")

    # 1) exact match
    res = await db.execute(
        text("SELECT id::text FROM projects WHERE project_slug = :slug LIMIT 1"),
        {"slug": slug},
    )
    exact = res.scalar_one_or_none()
    if exact:
        return str(exact)

    # 2) normalized match
    norm = normalize_slug(slug)
    res = await db.execute(text("SELECT id::text AS id, project_slug FROM projects"))
    for proj in res.mappings().all():
        if normalize_slug(str(proj.get("project_slug") or "")) == norm:
            return str(proj.get("id"))

    raise HTTPException(
        status_code=404,
        detail=f"Nenhum projeto encontrado para o cliente '{slug}'. Configure clients.settings.project_id.",
    )


async def resolve_project_id_for_user(
    tenant_or_project_id: str,
    current_user: DashboardUser,
    db: AsyncSession,
) -> str:
    """
    Resolve project_id for requests that pass an identifier.

    - If admin: accepts either project_id (projects.id) or client_id (clients.id).
    - If client: accepts either their own client_id or their resolved project_id.
    """
    if current_user.role == "admin":
        # If it looks like a project UUID and exists, use it.
        try:
            UUID(str(tenant_or_project_id))
            chk = await db.execute(
                text("SELECT 1 FROM projects WHERE id = (:id)::uuid LIMIT 1"),
                {"id": str(tenant_or_project_id)},
            )
            if chk.scalar_one_or_none() == 1:
                return str(tenant_or_project_id)
        except Exception:
            pass

        # Otherwise treat as client_id.
        return await resolve_project_id_from_client_id(str(tenant_or_project_id), db)

    if not current_user.client_id:
        raise HTTPException(status_code=403, detail="Usuário sem client_id")

    client_id = str(current_user.client_id)
    project_id = await resolve_project_id_from_client_id(client_id, db)

    if str(tenant_or_project_id) not in {client_id, project_id}:
        raise HTTPException(status_code=403, detail="Acesso negado a este projeto")

    return project_id
