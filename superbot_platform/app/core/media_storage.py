"""
Media storage helpers.

Uploads prefer Nextcloud when credentials are configured, otherwise they fall
back to local storage mounted by the FastAPI app.
"""
from __future__ import annotations

import asyncio
import logging
import mimetypes
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote

import httpx
from sqlalchemy import text as sa_text
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

LOCAL_UPLOAD_ROOT = Path(__file__).resolve().parents[2] / "uploads" / "media"
LOCAL_UPLOAD_ROOT.mkdir(parents=True, exist_ok=True)


def sanitize_filename(filename: str | None) -> str:
    safe = re.sub(r"[^A-Za-z0-9._ -]+", "_", filename or "arquivo")
    safe = safe.strip().replace(" ", "_")
    return safe or f"arquivo_{uuid.uuid4().hex}"


def detect_media_type(content_type: str | None, filename: str | None) -> str:
    mime_type = (content_type or "").split(";")[0].strip().lower()
    guessed_type = mimetypes.guess_type(filename or "")[0] or ""
    mime = mime_type or guessed_type.lower()

    if mime.startswith("image/"):
        return "image"
    if mime.startswith("video/"):
        return "video"
    if mime.startswith("audio/"):
        return "audio"
    return "document"


def parse_tags_csv(raw_tags: str | None) -> list[str]:
    if not raw_tags:
        return []
    return [tag.strip() for tag in raw_tags.split(",") if tag.strip()]


async def store_uploaded_media(
    db: AsyncSession,
    project_id: str,
    filename: str,
    data: bytes,
    content_type: str | None,
) -> dict[str, str]:
    safe_filename = sanitize_filename(filename)
    credentials = await _load_nextcloud_credentials(db, project_id)

    if credentials:
        try:
            return await _store_in_nextcloud(
                project_id=project_id,
                filename=safe_filename,
                data=data,
                content_type=content_type,
                credentials=credentials,
            )
        except Exception:
            logger.exception("nextcloud upload failed, falling back to local storage")

    return await _store_locally(project_id, safe_filename, data)


async def _load_nextcloud_credentials(
    db: AsyncSession,
    project_id: str,
) -> dict[str, str] | None:
    global_result = await db.execute(
        sa_text(
            """
            SELECT
              nextcloud_base_url,
              nextcloud_username,
              nextcloud_password
            FROM global_secrets
            ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
            LIMIT 1
            """
        )
    )
    global_row = global_result.mappings().first()

    project_result = await db.execute(
        sa_text(
            """
            SELECT
              nextcloud_base_url,
              nextcloud_username,
              nextcloud_password,
              nextcloud_media_root
            FROM project_secrets
            WHERE project_id = CAST(:project_id AS uuid)
            LIMIT 1
            """
        ),
        {"project_id": project_id},
    )
    project_row = project_result.mappings().first()

    base_url = (
        (project_row.get("nextcloud_base_url") if project_row else None)
        or (global_row.get("nextcloud_base_url") if global_row else None)
        or ""
    ).strip()
    username = (
        (project_row.get("nextcloud_username") if project_row else None)
        or (global_row.get("nextcloud_username") if global_row else None)
        or ""
    ).strip()
    password = (
        (project_row.get("nextcloud_password") if project_row else None)
        or (global_row.get("nextcloud_password") if global_row else None)
        or ""
    ).strip()
    media_root = (
        (project_row.get("nextcloud_media_root") if project_row else None)
        or "SuperBotMedia"
    ).strip()

    if not base_url or not username or not password:
        return None

    return {
        "base_url": base_url.rstrip("/"),
        "username": username,
        "password": password,
        "media_root": media_root or "SuperBotMedia",
    }


async def _store_in_nextcloud(
    project_id: str,
    filename: str,
    data: bytes,
    content_type: str | None,
    credentials: dict[str, str],
) -> dict[str, str]:
    now = datetime.now(timezone.utc)
    unique_filename = f"{uuid.uuid4().hex}_{filename}"
    relative_parts = [
        credentials["media_root"],
        project_id,
        f"{now.year:04d}",
        f"{now.month:02d}",
        unique_filename,
    ]

    webdav_base = (
        f"{credentials['base_url']}/remote.php/dav/files/{quote(credentials['username'])}"
    )
    auth = (credentials["username"], credentials["password"])

    async with httpx.AsyncClient(timeout=60, follow_redirects=True) as client:
        await _ensure_nextcloud_directories(
            client=client,
            webdav_base=webdav_base,
            auth=auth,
            directories=relative_parts[:-1],
        )

        encoded_path = "/".join(quote(part) for part in relative_parts)
        upload_response = await client.put(
            f"{webdav_base}/{encoded_path}",
            auth=auth,
            headers={"Content-Type": content_type or "application/octet-stream"},
            content=data,
        )
        if upload_response.status_code not in (200, 201, 204):
            raise RuntimeError(
                f"nextcloud upload failed ({upload_response.status_code}): {upload_response.text[:500]}"
            )

        public_url = await _create_nextcloud_share(
            client=client,
            base_url=credentials["base_url"],
            auth=auth,
            share_path="/" + "/".join(relative_parts),
        )
        return {"url": public_url}


async def _ensure_nextcloud_directories(
    client: httpx.AsyncClient,
    webdav_base: str,
    auth: tuple[str, str],
    directories: list[str],
) -> None:
    current_parts: list[str] = []
    for part in directories:
        current_parts.append(part)
        encoded_path = "/".join(quote(piece) for piece in current_parts)
        response = await client.request(
            "MKCOL",
            f"{webdav_base}/{encoded_path}",
            auth=auth,
        )
        if response.status_code not in (201, 301, 405):
            raise RuntimeError(
                f"nextcloud MKCOL failed ({response.status_code}): {response.text[:500]}"
            )


async def _create_nextcloud_share(
    client: httpx.AsyncClient,
    base_url: str,
    auth: tuple[str, str],
    share_path: str,
) -> str:
    response = await client.post(
        f"{base_url}/ocs/v2.php/apps/files_sharing/api/v1/shares",
        auth=auth,
        headers={
            "OCS-APIRequest": "true",
            "Accept": "application/json",
        },
        data={
            "path": share_path,
            "shareType": "3",
            "permissions": "1",
        },
    )
    if response.status_code not in (200, 201):
        raise RuntimeError(
            f"nextcloud share failed ({response.status_code}): {response.text[:500]}"
        )

    payload = response.json()
    share_url = (
        payload.get("ocs", {})
        .get("data", {})
        .get("url", "")
        .strip()
    )
    if not share_url:
        raise RuntimeError("nextcloud share response missing url")

    return share_url.rstrip("/") + "/download"


async def _store_locally(
    project_id: str,
    filename: str,
    data: bytes,
) -> dict[str, str]:
    now = datetime.now(timezone.utc)
    target_dir = (
        LOCAL_UPLOAD_ROOT
        / project_id
        / f"{now.year:04d}"
        / f"{now.month:02d}"
    )
    await asyncio.to_thread(target_dir.mkdir, parents=True, exist_ok=True)

    unique_filename = f"{uuid.uuid4().hex}_{filename}"
    target_path = target_dir / unique_filename
    await asyncio.to_thread(target_path.write_bytes, data)

    relative_to_uploads = target_path.relative_to(LOCAL_UPLOAD_ROOT.parent).as_posix()
    return {"url_path": f"/uploads/{relative_to_uploads}"}
