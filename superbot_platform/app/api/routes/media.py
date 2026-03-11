"""
SuperBot Platform - Media Library API
Upload, CRUD e busca de midias compartilhadas.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from sqlalchemy import text as sa_text
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel, Field
from typing import Optional

from app.api.routes.auth import get_current_user
from app.core.media_storage import (
    detect_media_type,
    parse_tags_csv,
    sanitize_filename,
    store_uploaded_media,
)
from app.core.tenancy import resolve_project_id_for_user
from app.db.database import get_db
from app.db.models import DashboardUser

router = APIRouter(prefix="/api/media", tags=["media"])


class CreateMediaRequest(BaseModel):
    media_type: str
    url: str
    filename: str
    description: str = ""
    tags: list[str] = Field(default_factory=list)
    size_bytes: int = 0


class UpdateMediaRequest(BaseModel):
    description: Optional[str] = None
    tags: Optional[list[str]] = None
    filename: Optional[str] = None


@router.get("/{tenant_id}")
async def list_media(
    tenant_id: str,
    media_type: Optional[str] = Query(None, description="Filter: image, video, audio, document"),
    tag: Optional[str] = Query(None, description="Filter by tag"),
    search: Optional[str] = Query(None, description="Search filename/description"),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    current_user: DashboardUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Lista midias do projeto."""
    project_id = await resolve_project_id_for_user(tenant_id, current_user, db)

    where = ["project_id = CAST(:pid AS uuid)"]
    params: dict = {"pid": project_id, "lim": limit, "off": offset}

    if media_type:
        where.append("media_type = :mtype")
        params["mtype"] = media_type

    if tag:
        where.append(":tag = ANY(tags)")
        params["tag"] = tag

    if search:
        where.append("(filename ILIKE :search OR description ILIKE :search)")
        params["search"] = f"%{search}%"

    where_sql = " AND ".join(where)

    result = await db.execute(
        sa_text(
            f"""
            SELECT id, project_id, media_type, url, filename, description, tags,
                   size_bytes, created_at
            FROM media_library
            WHERE {where_sql}
            ORDER BY created_at DESC
            LIMIT :lim OFFSET :off
            """
        ),
        params,
    )
    items = [dict(r) for r in result.mappings().all()]

    count_result = await db.execute(
        sa_text(f"SELECT COUNT(*) FROM media_library WHERE {where_sql}"),
        params,
    )
    total = count_result.scalar() or 0

    return {"media": items, "total": total}


@router.post("/{tenant_id}")
async def create_media(
    tenant_id: str,
    body: CreateMediaRequest,
    current_user: DashboardUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Adiciona midia a biblioteca via URL."""
    if current_user.role not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Sem permissao")

    project_id = await resolve_project_id_for_user(tenant_id, current_user, db)

    if body.media_type not in ("image", "video", "audio", "document"):
        raise HTTPException(status_code=400, detail="media_type invalido")

    result = await db.execute(
        sa_text(
            """
            INSERT INTO media_library (project_id, media_type, url, filename, description, tags, size_bytes)
            VALUES (CAST(:pid AS uuid), :mtype, :url, :fname, :desc, :tags, :size)
            RETURNING id, project_id, media_type, url, filename, description, tags, size_bytes, created_at
            """
        ),
        {
            "pid": project_id,
            "mtype": body.media_type,
            "url": body.url,
            "fname": sanitize_filename(body.filename),
            "desc": body.description,
            "tags": body.tags,
            "size": body.size_bytes,
        },
    )
    item = dict(result.mappings().first())
    await db.commit()
    return {"media": item}


@router.post("/{tenant_id}/upload")
async def upload_media(
    tenant_id: str,
    request: Request,
    file: UploadFile = File(...),
    description: str = Form(""),
    tags: str = Form(""),
    current_user: DashboardUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Faz upload real de arquivo para storage e cadastra na media library."""
    if current_user.role not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Sem permissao")

    project_id = await resolve_project_id_for_user(tenant_id, current_user, db)
    original_filename = file.filename or "upload.bin"
    content = await file.read()

    if not content:
        raise HTTPException(status_code=400, detail="Arquivo vazio")

    try:
        stored = await store_uploaded_media(
            db=db,
            project_id=str(project_id),
            filename=original_filename,
            data=content,
            content_type=file.content_type,
        )
    except Exception as exc:
        await db.rollback()
        raise HTTPException(status_code=502, detail=f"Falha no upload: {exc}") from exc

    file_url = stored.get("url")
    if not file_url and stored.get("url_path"):
        file_url = f"{str(request.base_url).rstrip('/')}{stored['url_path']}"

    if not file_url:
        await db.rollback()
        raise HTTPException(status_code=500, detail="Storage nao retornou URL")

    media_type = detect_media_type(file.content_type, original_filename)

    result = await db.execute(
        sa_text(
            """
            INSERT INTO media_library (project_id, media_type, url, filename, description, tags, size_bytes)
            VALUES (CAST(:pid AS uuid), :mtype, :url, :fname, :desc, :tags, :size)
            RETURNING id, project_id, media_type, url, filename, description, tags, size_bytes, created_at
            """
        ),
        {
            "pid": project_id,
            "mtype": media_type,
            "url": file_url,
            "fname": sanitize_filename(original_filename),
            "desc": description or "",
            "tags": parse_tags_csv(tags),
            "size": len(content),
        },
    )
    item = dict(result.mappings().first())
    await db.commit()
    return {"media": item}


@router.patch("/{tenant_id}/{media_id}")
async def update_media(
    tenant_id: str,
    media_id: str,
    body: UpdateMediaRequest,
    current_user: DashboardUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Atualiza midia."""
    if current_user.role not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Sem permissao")

    project_id = await resolve_project_id_for_user(tenant_id, current_user, db)
    updates = body.model_dump(exclude_none=True)
    if not updates:
        raise HTTPException(status_code=400, detail="Nenhum campo")

    if "filename" in updates:
        updates["filename"] = sanitize_filename(updates["filename"])

    set_clauses = []
    params = {"mid": media_id, "pid": project_id}
    for key, value in updates.items():
        set_clauses.append(f"{key} = :{key}")
        params[key] = value

    sql = f"""
        UPDATE media_library SET {', '.join(set_clauses)}
        WHERE id = CAST(:mid AS uuid) AND project_id = CAST(:pid AS uuid)
        RETURNING id, project_id, media_type, url, filename, description, tags, size_bytes, created_at
    """
    result = await db.execute(sa_text(sql), params)
    row = result.mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Midia nao encontrada")
    await db.commit()
    return {"media": dict(row)}


@router.delete("/{tenant_id}/{media_id}")
async def delete_media(
    tenant_id: str,
    media_id: str,
    current_user: DashboardUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Remove midia."""
    if current_user.role not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Sem permissao")

    project_id = await resolve_project_id_for_user(tenant_id, current_user, db)

    result = await db.execute(
        sa_text(
            """
            DELETE FROM media_library
            WHERE id = CAST(:mid AS uuid) AND project_id = CAST(:pid AS uuid)
            RETURNING id
            """
        ),
        {"mid": media_id, "pid": project_id},
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Midia nao encontrada")
    await db.commit()
    return {"deleted": True}
