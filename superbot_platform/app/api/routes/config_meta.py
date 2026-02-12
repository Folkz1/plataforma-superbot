"""
Multitenant configuration endpoints (channels + project_secrets).

These endpoints are meant to support the dashboard onboarding/config UX:
- Set notification phone/email
- Enable/configure follow-ups and feedback
- Upsert connected channels (WhatsApp/Messenger/Instagram)

Tables used (public schema):
- projects
- channels
- project_secrets
- clients (optional, for tenant display)
"""

from __future__ import annotations

import json
from typing import Any, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.routes.auth import get_current_user
from app.core.tenancy import resolve_project_id_for_user
from app.db.database import get_db
from app.db.models import DashboardUser


router = APIRouter(prefix="/api/config", tags=["config"])


class MetaSecretsUpdate(BaseModel):
    notification_phone: Optional[str] = None
    notification_email: Optional[str] = None
    followup_enabled: Optional[bool] = None
    followup_config: Optional[dict[str, Any]] = None
    feedback_enabled: Optional[bool] = None
    feedback_config: Optional[dict[str, Any]] = None


class ChannelUpsert(BaseModel):
    channel_type: str = Field(..., description="whatsapp|instagram|messenger|phone")
    channel_identifier: str = Field(..., description="phone_number_id/page_id/ig_id/etc")
    access_token: Optional[str] = Field(
        default=None,
        description="Meta Cloud API token (when applicable). Omit to keep existing token.",
    )


async def _get_tenant_row(tenant_or_project_id: str, project_id: str, db: AsyncSession) -> Optional[dict[str, Any]]:
    # 1) If the path param matches a client id, use it
    row = await db.execute(
        text(
            """
            SELECT
              id::text AS id,
              name,
              slug,
              status,
              meta_page_id,
              meta_phone_id,
              meta_ig_id,
              meta_waba_id,
              timezone,
              settings
            FROM clients
            WHERE id = (:cid)::uuid
            """
        ),
        {"cid": tenant_or_project_id},
    )
    tenant = row.mappings().first()
    if tenant:
        return dict(tenant)

    # 2) Try settings.project_id mapping
    row = await db.execute(
        text(
            """
            SELECT
              id::text AS id,
              name,
              slug,
              status,
              meta_page_id,
              meta_phone_id,
              meta_ig_id,
              meta_waba_id,
              timezone,
              settings
            FROM clients
            WHERE (settings->>'project_id') = :pid
            LIMIT 1
            """
        ),
        {"pid": project_id},
    )
    tenant = row.mappings().first()
    if tenant:
        return dict(tenant)

    # 3) Try slug == project_slug
    row = await db.execute(
        text(
            """
            SELECT
              c.id::text AS id,
              c.name,
              c.slug,
              c.status,
              c.meta_page_id,
              c.meta_phone_id,
              c.meta_ig_id,
              c.meta_waba_id,
              c.timezone,
              c.settings
            FROM clients c
            JOIN projects p ON p.project_slug = c.slug
            WHERE p.id = (:pid)::uuid
            LIMIT 1
            """
        ),
        {"pid": project_id},
    )
    tenant = row.mappings().first()
    return dict(tenant) if tenant else None


@router.get("/meta/{tenant_or_project_id}")
async def get_meta_config(
    tenant_or_project_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: DashboardUser = Depends(get_current_user),
) -> dict[str, Any]:
    project_id = await resolve_project_id_for_user(tenant_or_project_id, current_user, db)
    project_uuid = UUID(project_id)

    proj_res = await db.execute(
        text(
            """
            SELECT
              id::text AS id,
              project_slug,
              webhook_path,
              agent_workflow_id
            FROM projects
            WHERE id = (:pid)::uuid
            """
        ),
        {"pid": str(project_uuid)},
    )
    project = proj_res.mappings().first()
    if not project:
        raise HTTPException(status_code=404, detail="Projeto não encontrado")

    channels_res = await db.execute(
        text(
            """
            SELECT
              id::text AS id,
              channel_type,
              channel_identifier,
              created_at,
              CASE WHEN access_token IS NULL OR access_token = '' THEN false ELSE true END AS has_access_token
            FROM channels
            WHERE project_id = (:pid)::uuid
            ORDER BY created_at DESC
            """
        ),
        {"pid": str(project_uuid)},
    )
    channels = [dict(r) for r in channels_res.mappings().all()]

    secrets_res = await db.execute(
        text(
            """
            SELECT
              notification_phone,
              notification_email,
              followup_enabled,
              followup_config,
              feedback_enabled,
              feedback_config,
              updated_at
            FROM project_secrets
            WHERE project_id = (:pid)::uuid
            """
        ),
        {"pid": str(project_uuid)},
    )
    secrets = secrets_res.mappings().first()
    secrets_obj: dict[str, Any] = dict(secrets) if secrets else {
        "notification_phone": "",
        "notification_email": "",
        "followup_enabled": False,
        "followup_config": {},
        "feedback_enabled": True,
        "feedback_config": {},
        "updated_at": None,
    }

    tenant = await _get_tenant_row(tenant_or_project_id, project_id, db)

    return {
        "tenant_or_project_id": tenant_or_project_id,
        "resolved_project_id": str(project_uuid),
        "tenant": tenant,
        "project": dict(project),
        "channels": channels,
        "secrets": secrets_obj,
    }


@router.patch("/meta/{tenant_or_project_id}")
async def update_meta_secrets(
    tenant_or_project_id: str,
    data: MetaSecretsUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: DashboardUser = Depends(get_current_user),
) -> dict[str, Any]:
    project_id = await resolve_project_id_for_user(tenant_or_project_id, current_user, db)
    project_uuid = UUID(project_id)

    payload = data.model_dump(exclude_unset=True)

    # Normalize JSON fields to strings for safe casting
    followup_config = payload.get("followup_config")
    feedback_config = payload.get("feedback_config")

    params = {
        "pid": str(project_uuid),
        "notification_phone": payload.get("notification_phone"),
        "notification_email": payload.get("notification_email"),
        "followup_enabled": payload.get("followup_enabled"),
        "followup_config": json.dumps(followup_config) if followup_config is not None else None,
        "feedback_enabled": payload.get("feedback_enabled"),
        "feedback_config": json.dumps(feedback_config) if feedback_config is not None else None,
    }

    res = await db.execute(
        text(
            """
            INSERT INTO project_secrets (
              project_id,
              notification_phone,
              notification_email,
              followup_enabled,
              followup_config,
              feedback_enabled,
              feedback_config,
              created_at,
              updated_at
            )
            VALUES (
              (:pid)::uuid,
              :notification_phone,
              :notification_email,
              :followup_enabled,
              CASE WHEN :followup_config IS NULL THEN NULL ELSE (:followup_config)::jsonb END,
              :feedback_enabled,
              CASE WHEN :feedback_config IS NULL THEN NULL ELSE (:feedback_config)::jsonb END,
              now(),
              now()
            )
            ON CONFLICT (project_id) DO UPDATE SET
              notification_phone = COALESCE(EXCLUDED.notification_phone, project_secrets.notification_phone),
              notification_email = COALESCE(EXCLUDED.notification_email, project_secrets.notification_email),
              followup_enabled = COALESCE(EXCLUDED.followup_enabled, project_secrets.followup_enabled),
              followup_config = COALESCE(EXCLUDED.followup_config, project_secrets.followup_config),
              feedback_enabled = COALESCE(EXCLUDED.feedback_enabled, project_secrets.feedback_enabled),
              feedback_config = COALESCE(EXCLUDED.feedback_config, project_secrets.feedback_config),
              updated_at = now()
            RETURNING
              notification_phone,
              notification_email,
              followup_enabled,
              followup_config,
              feedback_enabled,
              feedback_config,
              updated_at
            """
        ),
        params,
    )
    await db.flush()

    updated = res.mappings().first()
    return {"success": True, "project_id": str(project_uuid), "secrets": dict(updated) if updated else {}}


@router.post("/channels/{tenant_or_project_id}")
async def upsert_channel(
    tenant_or_project_id: str,
    data: ChannelUpsert,
    db: AsyncSession = Depends(get_db),
    current_user: DashboardUser = Depends(get_current_user),
) -> dict[str, Any]:
    project_id = await resolve_project_id_for_user(tenant_or_project_id, current_user, db)
    project_uuid = UUID(project_id)

    channel_type = data.channel_type.strip().lower()
    channel_identifier = data.channel_identifier.strip()
    access_token = data.access_token.strip() if data.access_token is not None else None

    if not channel_type or not channel_identifier:
        raise HTTPException(status_code=400, detail="channel_type e channel_identifier são obrigatórios")

    res = await db.execute(
        text(
            """
            INSERT INTO channels (
              id,
              project_id,
              channel_identifier,
              channel_type,
              access_token,
              created_at
            )
            VALUES (
              gen_random_uuid(),
              (:pid)::uuid,
              :channel_identifier,
              :channel_type,
              :access_token,
              now()
            )
            ON CONFLICT (channel_identifier) DO UPDATE SET
              project_id = EXCLUDED.project_id,
              channel_type = EXCLUDED.channel_type,
              access_token = COALESCE(EXCLUDED.access_token, channels.access_token)
            RETURNING
              id::text AS id,
              project_id::text AS project_id,
              channel_identifier,
              channel_type,
              created_at,
              CASE WHEN access_token IS NULL OR access_token = '' THEN false ELSE true END AS has_access_token
            """
        ),
        {
            "pid": str(project_uuid),
            "channel_identifier": channel_identifier,
            "channel_type": channel_type,
            "access_token": access_token,
        },
    )
    await db.flush()

    row = res.mappings().first()
    return {"success": True, "project_id": str(project_uuid), "channel": dict(row) if row else None}


@router.delete("/channels/{tenant_or_project_id}/{channel_identifier}")
async def delete_channel(
    tenant_or_project_id: str,
    channel_identifier: str,
    db: AsyncSession = Depends(get_db),
    current_user: DashboardUser = Depends(get_current_user),
) -> dict[str, Any]:
    project_id = await resolve_project_id_for_user(tenant_or_project_id, current_user, db)
    project_uuid = UUID(project_id)

    result = await db.execute(
        text(
            "DELETE FROM channels WHERE project_id = (:pid)::uuid AND channel_identifier = :cid"
        ),
        {"pid": str(project_uuid), "cid": channel_identifier},
    )
    await db.flush()

    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Canal não encontrado")

    return {"success": True, "project_id": str(project_uuid), "deleted": channel_identifier}
