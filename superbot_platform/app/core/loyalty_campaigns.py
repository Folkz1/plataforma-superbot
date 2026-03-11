"""
Loyalty campaign delivery helpers.

This module owns:
- background scheduler for scheduled campaigns
- campaign queuing/claiming
- WhatsApp delivery for loyalty campaigns
- per-recipient delivery logging
"""
from __future__ import annotations

import asyncio
import logging
import re
from contextlib import suppress
from datetime import datetime, timezone
from typing import Any, Sequence

import httpx
from sqlalchemy import text as sa_text

from app.config import get_settings
from app.db.database import async_session
from app.integrations.gemini import GeminiClient

settings = get_settings()
logger = logging.getLogger(__name__)

META_API_VERSION = "v21.0"
SCHEDULER_INTERVAL_SECONDS = 30
CAMPAIGN_SEND_DELAY_SECONDS = 1.0

_scheduler_task: asyncio.Task | None = None
_scheduler_stop: asyncio.Event | None = None


def normalize_phone(phone: str | None) -> str:
    digits = re.sub(r"\D+", "", phone or "")
    if digits.startswith("00"):
        digits = digits[2:]
    return digits


def is_valid_whatsapp_phone(phone: str | None) -> bool:
    digits = normalize_phone(phone)
    return 10 <= len(digits) <= 15


def ensure_utc(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def queue_welcome_message(
    project_id: str,
    phone: str,
    message: str,
) -> None:
    normalized_phone = normalize_phone(phone)
    if not normalized_phone or not message.strip():
        return

    asyncio.create_task(
        _execute_welcome_message(project_id, normalized_phone, message.strip()),
        name=f"loyalty-welcome-{normalized_phone}",
    )


async def start_loyalty_scheduler() -> None:
    global _scheduler_task, _scheduler_stop
    if _scheduler_task and not _scheduler_task.done():
        return
    _scheduler_stop = asyncio.Event()
    _scheduler_task = asyncio.create_task(
        _scheduler_loop(),
        name="loyalty-campaign-scheduler",
    )


async def stop_loyalty_scheduler() -> None:
    global _scheduler_task, _scheduler_stop
    if _scheduler_stop:
        _scheduler_stop.set()
    if _scheduler_task:
        _scheduler_task.cancel()
        with suppress(asyncio.CancelledError):
            await _scheduler_task
    _scheduler_task = None
    _scheduler_stop = None


async def queue_campaign_send(
    campaign_id: str,
    allowed_statuses: Sequence[str],
) -> bool:
    claimed: dict[str, Any] | None = None

    async with async_session() as db:
        claimed = await _claim_campaign(db, campaign_id, allowed_statuses)
        if not claimed:
            await db.rollback()
            return False
        await db.commit()

    asyncio.create_task(
        _execute_claimed_campaign(claimed),
        name=f"loyalty-campaign-{campaign_id}",
    )
    return True


async def _scheduler_loop() -> None:
    while True:
        try:
            await _queue_due_campaigns()
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("loyalty scheduler iteration failed")

        if _scheduler_stop is None:
            return

        try:
            await asyncio.wait_for(
                _scheduler_stop.wait(),
                timeout=SCHEDULER_INTERVAL_SECONDS,
            )
        except asyncio.TimeoutError:
            continue


async def _queue_due_campaigns() -> None:
    now = datetime.now(timezone.utc)

    async with async_session() as db:
        result = await db.execute(
            sa_text(
                """
                SELECT CAST(c.id AS text) AS campaign_id
                FROM club_campaigns c
                JOIN loyalty_clubs l ON l.id = c.club_id
                WHERE c.status = 'scheduled'
                  AND c.scheduled_at IS NOT NULL
                  AND c.scheduled_at <= :now
                  AND l.active = true
                ORDER BY c.scheduled_at ASC
                LIMIT 20
                """
            ),
            {"now": now},
        )
        due_campaign_ids = [row["campaign_id"] for row in result.mappings().all()]

    for campaign_id in due_campaign_ids:
        await queue_campaign_send(campaign_id, ("scheduled",))


async def _claim_campaign(
    db,
    campaign_id: str,
    allowed_statuses: Sequence[str],
) -> dict[str, Any] | None:
    if not allowed_statuses:
        return None

    safe_statuses = []
    for status in allowed_statuses:
        if not re.fullmatch(r"[a-z_]+", status):
            raise ValueError(f"invalid campaign status: {status}")
        safe_statuses.append(f"'{status}'")

    result = await db.execute(
        sa_text(
            f"""
            UPDATE club_campaigns AS c
            SET status = 'sending'
            FROM loyalty_clubs AS l
            WHERE c.id = CAST(:campaign_id AS uuid)
              AND l.id = c.club_id
              AND c.status IN ({", ".join(safe_statuses)})
            RETURNING
              CAST(c.id AS text) AS id,
              CAST(c.club_id AS text) AS club_id,
              CAST(l.project_id AS text) AS project_id,
              c.name,
              c.campaign_type,
              c.template_name,
              c.ai_prompt,
              c.media_ids,
              c.scheduled_at,
              l.name AS club_name
            """
        ),
        {"campaign_id": campaign_id},
    )
    row = result.mappings().first()
    return dict(row) if row else None


async def _execute_claimed_campaign(campaign: dict[str, Any]) -> None:
    campaign_id = campaign["id"]
    project_id = campaign["project_id"]
    club_id = campaign["club_id"]
    media_ids = campaign.get("media_ids") or []

    try:
        credentials = await _load_whatsapp_credentials(project_id)
        members = await _load_club_members(club_id)
        media_items = await _load_media_items(project_id, media_ids)
        gemini_api_key = await _load_gemini_api_key(project_id)

        if not credentials:
            await _finalize_campaign(
                campaign_id,
                status="failed",
                recipients_count=0,
                sent_at=None,
            )
            return

        if not members:
            await _finalize_campaign(
                campaign_id,
                status="failed",
                recipients_count=0,
                sent_at=None,
            )
            return

        if not campaign.get("template_name") and not campaign.get("ai_prompt") and not media_items:
            await _finalize_campaign(
                campaign_id,
                status="failed",
                recipients_count=0,
                sent_at=None,
            )
            return

        success_count = 0
        failure_count = 0

        async with httpx.AsyncClient(timeout=30) as client:
            for index, member in enumerate(members):
                normalized_phone = normalize_phone(member.get("phone"))
                now = datetime.now(timezone.utc)

                if not is_valid_whatsapp_phone(normalized_phone):
                    failure_count += 1
                    await _upsert_delivery(
                        campaign_id=campaign_id,
                        member_id=member.get("id"),
                        phone=normalized_phone or str(member.get("phone") or ""),
                        member_name=member.get("name") or "",
                        status="failed",
                        error_message="numero de telefone invalido",
                        meta_message_id=None,
                        sent_at=None,
                    )
                    continue

                try:
                    primary_message_id: str | None = None
                    text_body = ""

                    if campaign.get("template_name"):
                        template_response = await _send_whatsapp_template(
                            client=client,
                            access_token=credentials["access_token"],
                            phone_number_id=credentials["phone_number_id"],
                            to=normalized_phone,
                            template_name=campaign["template_name"],
                        )
                        primary_message_id = _extract_message_id(template_response)
                    elif campaign.get("ai_prompt"):
                        if not gemini_api_key:
                            raise RuntimeError(
                                "gemini_api_key nao configurada para campanhas com ai_prompt"
                            )

                        text_body = await _generate_member_message(
                            gemini_api_key=gemini_api_key,
                            club_name=campaign.get("club_name") or "",
                            campaign_name=campaign.get("name") or "",
                            ai_prompt=campaign.get("ai_prompt") or "",
                            member=member,
                        )
                        if text_body.strip():
                            text_response = await _send_whatsapp_text(
                                client=client,
                                access_token=credentials["access_token"],
                                phone_number_id=credentials["phone_number_id"],
                                to=normalized_phone,
                                text=text_body,
                            )
                            primary_message_id = _extract_message_id(text_response)

                    if media_items:
                        for media_item in media_items:
                            media_response = await _send_whatsapp_media(
                                client=client,
                                access_token=credentials["access_token"],
                                phone_number_id=credentials["phone_number_id"],
                                to=normalized_phone,
                                media_item=media_item,
                            )
                            primary_message_id = primary_message_id or _extract_message_id(
                                media_response
                            )

                    success_count += 1
                    await _upsert_delivery(
                        campaign_id=campaign_id,
                        member_id=member.get("id"),
                        phone=normalized_phone,
                        member_name=member.get("name") or "",
                        status="sent",
                        error_message="",
                        meta_message_id=primary_message_id,
                        sent_at=now,
                    )
                except Exception as exc:
                    failure_count += 1
                    logger.warning(
                        "campaign %s failed for member %s: %s",
                        campaign_id,
                        normalized_phone,
                        exc,
                    )
                    await _upsert_delivery(
                        campaign_id=campaign_id,
                        member_id=member.get("id"),
                        phone=normalized_phone,
                        member_name=member.get("name") or "",
                        status="failed",
                        error_message=str(exc)[:500],
                        meta_message_id=None,
                        sent_at=None,
                    )

                if index < len(members) - 1:
                    await asyncio.sleep(CAMPAIGN_SEND_DELAY_SECONDS)

        final_status = "sent" if success_count > 0 else "failed"
        await _finalize_campaign(
            campaign_id,
            status=final_status,
            recipients_count=success_count,
            sent_at=datetime.now(timezone.utc) if success_count > 0 else None,
        )

        if failure_count:
            logger.info(
                "campaign %s completed with %s success and %s failures",
                campaign_id,
                success_count,
                failure_count,
            )
    except Exception:
        logger.exception("campaign %s execution crashed", campaign_id)
        await _finalize_campaign(
            campaign_id,
            status="failed",
            recipients_count=0,
            sent_at=None,
        )


async def _load_whatsapp_credentials(project_id: str) -> dict[str, str] | None:
    async with async_session() as db:
        result = await db.execute(
            sa_text(
                """
                SELECT
                  c.channel_identifier AS phone_number_id,
                  COALESCE(NULLIF(c.access_token, ''), ps.meta_master_token, :default_token) AS access_token
                FROM channels c
                LEFT JOIN project_secrets ps ON ps.project_id = c.project_id
                WHERE c.project_id = CAST(:project_id AS uuid)
                  AND c.channel_type = 'whatsapp'
                ORDER BY c.created_at ASC
                LIMIT 1
                """
            ),
            {
                "project_id": project_id,
                "default_token": settings.meta_access_token or "",
            },
        )
        row = result.mappings().first()
        if not row:
            return None

        phone_number_id = (row.get("phone_number_id") or "").strip()
        access_token = (row.get("access_token") or "").strip()
        if not phone_number_id or not access_token:
            return None

        return {
            "phone_number_id": phone_number_id,
            "access_token": access_token,
        }


async def _load_gemini_api_key(project_id: str) -> str:
    async with async_session() as db:
        result = await db.execute(
            sa_text(
                """
                SELECT gemini_api_key
                FROM project_secrets
                WHERE project_id = CAST(:project_id AS uuid)
                LIMIT 1
                """
            ),
            {"project_id": project_id},
        )
        row = result.mappings().first()
        project_key = (row.get("gemini_api_key") or "").strip() if row else ""
        return project_key or (settings.gemini_api_key or "")


async def _load_club_members(club_id: str) -> list[dict[str, Any]]:
    async with async_session() as db:
        result = await db.execute(
            sa_text(
                """
                SELECT
                  CAST(id AS text) AS id,
                  phone,
                  name,
                  email
                FROM club_members
                WHERE club_id = CAST(:club_id AS uuid)
                ORDER BY joined_at ASC
                """
            ),
            {"club_id": club_id},
        )
        return [dict(row) for row in result.mappings().all()]


async def _load_media_items(
    project_id: str,
    media_ids: list[str],
) -> list[dict[str, Any]]:
    if not media_ids:
        return []

    async with async_session() as db:
        result = await db.execute(
            sa_text(
                """
                SELECT
                  CAST(id AS text) AS id,
                  media_type,
                  url,
                  filename,
                  description
                FROM media_library
                WHERE project_id = CAST(:project_id AS uuid)
                  AND CAST(id AS text) = ANY(:media_ids)
                ORDER BY created_at ASC
                """
            ),
            {"project_id": project_id, "media_ids": media_ids},
        )
        return [dict(row) for row in result.mappings().all()]


async def _generate_member_message(
    gemini_api_key: str,
    club_name: str,
    campaign_name: str,
    ai_prompt: str,
    member: dict[str, Any],
) -> str:
    gemini = GeminiClient(api_key=gemini_api_key)
    member_name = (member.get("name") or "").strip() or "cliente"
    member_email = (member.get("email") or "").strip()
    member_phone = normalize_phone(member.get("phone"))
    first_name = member_name.split()[0] if member_name else "cliente"

    response = await gemini.chat(
        messages=[
            {
                "role": "system",
                "content": (
                    "Voce escreve mensagens curtas de WhatsApp para campanhas de clube de fidelidade. "
                    "Responda apenas com a mensagem final, sem aspas, sem markdown e sem explicar o processo."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"Clube: {club_name}\n"
                    f"Campanha: {campaign_name}\n"
                    f"Nome: {member_name}\n"
                    f"Primeiro nome: {first_name}\n"
                    f"Email: {member_email or '-'}\n"
                    f"Telefone: {member_phone}\n\n"
                    f"Instrucoes:\n{ai_prompt}"
                ),
            },
        ],
        model=settings.default_llm_model or "gemini-2.0-flash",
        temperature=0.7,
        max_tokens=400,
    )
    return (response.get("text") or "").strip()


async def _send_whatsapp_text(
    client: httpx.AsyncClient,
    access_token: str,
    phone_number_id: str,
    to: str,
    text: str,
) -> dict[str, Any]:
    if not text.strip():
        return {}

    payload = {
        "messaging_product": "whatsapp",
        "recipient_type": "individual",
        "to": to,
        "type": "text",
        "text": {"body": text},
    }
    return await _post_whatsapp_payload(client, access_token, phone_number_id, payload)


async def _send_whatsapp_template(
    client: httpx.AsyncClient,
    access_token: str,
    phone_number_id: str,
    to: str,
    template_name: str,
    language_code: str = "pt_BR",
) -> dict[str, Any]:
    payload = {
        "messaging_product": "whatsapp",
        "to": to,
        "type": "template",
        "template": {
            "name": template_name,
            "language": {"code": language_code},
        },
    }
    return await _post_whatsapp_payload(client, access_token, phone_number_id, payload)


async def _send_whatsapp_media(
    client: httpx.AsyncClient,
    access_token: str,
    phone_number_id: str,
    to: str,
    media_item: dict[str, Any],
) -> dict[str, Any]:
    media_type = media_item.get("media_type") or "document"
    if media_type not in {"image", "video", "audio", "document"}:
        media_type = "document"

    media_payload: dict[str, Any] = {
        "link": media_item["url"],
    }

    if media_type == "document":
        media_payload["filename"] = media_item.get("filename") or "arquivo"

    payload = {
        "messaging_product": "whatsapp",
        "recipient_type": "individual",
        "to": to,
        "type": media_type,
        media_type: media_payload,
    }
    return await _post_whatsapp_payload(client, access_token, phone_number_id, payload)


async def _post_whatsapp_payload(
    client: httpx.AsyncClient,
    access_token: str,
    phone_number_id: str,
    payload: dict[str, Any],
) -> dict[str, Any]:
    response = await client.post(
        f"https://graph.facebook.com/{META_API_VERSION}/{phone_number_id}/messages",
        headers={"Authorization": f"Bearer {access_token}"},
        json=payload,
    )
    if response.status_code not in (200, 201):
        raise RuntimeError(f"Meta API ({response.status_code}): {response.text[:500]}")
    return response.json()


def _extract_message_id(response_data: dict[str, Any] | None) -> str | None:
    if not response_data:
        return None
    messages = response_data.get("messages") or []
    if not messages:
        return None
    return messages[0].get("id")


async def _upsert_delivery(
    campaign_id: str,
    member_id: str | None,
    phone: str,
    member_name: str,
    status: str,
    error_message: str,
    meta_message_id: str | None,
    sent_at: datetime | None,
) -> None:
    async with async_session() as db:
        await db.execute(
            sa_text(
                """
                INSERT INTO campaign_deliveries (
                  campaign_id,
                  member_id,
                  phone,
                  member_name,
                  status,
                  error_message,
                  meta_message_id,
                  sent_at
                )
                VALUES (
                  CAST(:campaign_id AS uuid),
                  CAST(:member_id AS uuid),
                  :phone,
                  :member_name,
                  :status,
                  :error_message,
                  :meta_message_id,
                  :sent_at
                )
                ON CONFLICT (campaign_id, phone) DO UPDATE SET
                  member_id = EXCLUDED.member_id,
                  member_name = EXCLUDED.member_name,
                  status = EXCLUDED.status,
                  error_message = EXCLUDED.error_message,
                  meta_message_id = EXCLUDED.meta_message_id,
                  sent_at = EXCLUDED.sent_at,
                  updated_at = now()
                """
            ),
            {
                "campaign_id": campaign_id,
                "member_id": member_id,
                "phone": phone,
                "member_name": member_name,
                "status": status,
                "error_message": error_message,
                "meta_message_id": meta_message_id,
                "sent_at": sent_at,
            },
        )
        await db.commit()


async def _finalize_campaign(
    campaign_id: str,
    status: str,
    recipients_count: int,
    sent_at: datetime | None,
) -> None:
    async with async_session() as db:
        await db.execute(
            sa_text(
                """
                UPDATE club_campaigns
                SET status = :status,
                    recipients_count = :recipients_count,
                    sent_at = :sent_at
                WHERE id = CAST(:campaign_id AS uuid)
                """
            ),
            {
                "campaign_id": campaign_id,
                "status": status,
                "recipients_count": recipients_count,
                "sent_at": sent_at,
            },
        )
        await db.commit()
