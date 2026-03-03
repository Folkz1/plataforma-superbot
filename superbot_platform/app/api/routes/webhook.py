"""
SuperBot Platform - Meta Webhook Endpoint
Recebe webhooks da Meta (WhatsApp, Instagram, Messenger)
e processa via channel_router dinâmico.
"""
import logging
import os
from fastapi import APIRouter, Depends, Request, Query, Response, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.config import get_settings
from app.core.channel_router import ChannelRouter, MetaWebhookHandler
from app.integrations.gemini import GeminiClient, GeminiRAGManager
from app.integrations.elevenlabs import ElevenLabsManager

logger = logging.getLogger("superbot.webhook")

router = APIRouter(tags=["webhook"])

settings = get_settings()


# ==================== Webhook Verification ====================

@router.get("/webhook/meta")
async def verify_meta_webhook(
    hub_mode: str = Query(None, alias="hub.mode"),
    hub_verify_token: str = Query(None, alias="hub.verify_token"),
    hub_challenge: str = Query(None, alias="hub.challenge"),
):
    """
    Meta webhook verification (GET).
    Meta sends this to verify the webhook URL.
    """
    verify_token = os.getenv("META_VERIFY_TOKEN", settings.meta_verify_token)

    handler = MetaWebhookHandler(verify_token=verify_token)
    result = handler.verify_webhook(hub_mode or "", hub_verify_token or "", hub_challenge or "")

    if result:
        return Response(content=result, media_type="text/plain")

    return Response(content="Verification failed", status_code=403)


# ==================== Webhook Processing ====================

@router.post("/webhook/meta")
async def receive_meta_webhook(
    request: Request,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """
    Receive and process Meta webhook (POST).
    Handles WhatsApp, Instagram, and Messenger messages.

    Flow:
    1. Parse webhook payload
    2. Resolve channel_identifier -> project via DB
    3. Process message with Gemini AI
    4. Send response back via Meta API
    5. Save everything in conversation_events + conversation_states
    """
    try:
        payload = await request.json()
    except Exception:
        return {"status": "error", "detail": "Invalid JSON"}

    # Quick acknowledge (Meta requires 200 within 20s)
    # Process in background for reliability
    obj_type = payload.get("object", "")

    if obj_type not in ("whatsapp_business_account", "page", "instagram"):
        return {"status": "ignored", "object": obj_type}

    # Tag Instagram messages
    if obj_type == "instagram":
        for entry in payload.get("entry", []):
            for messaging in entry.get("messaging", []):
                messaging["_channel"] = "instagram"

    # Process webhook
    verify_token = os.getenv("META_VERIFY_TOKEN", settings.meta_verify_token)
    handler = MetaWebhookHandler(verify_token=verify_token)

    # Initialize AI services
    gemini_api_key = os.getenv("GEMINI_API_KEY", settings.gemini_api_key)
    elevenlabs_api_key = os.getenv("ELEVENLABS_API_KEY", settings.elevenlabs_api_key)

    gemini_client = GeminiClient(api_key=gemini_api_key)
    rag_manager = GeminiRAGManager(api_key=gemini_api_key)
    elevenlabs_mgr = ElevenLabsManager(api_key=elevenlabs_api_key) if elevenlabs_api_key else None

    # Create router with DB session
    channel_router = ChannelRouter(
        db=db,
        gemini_client=gemini_client,
        rag_manager=rag_manager,
        elevenlabs_manager=elevenlabs_mgr
    )

    try:
        responses = await handler.process_webhook(payload, channel_router)

        # Send responses back via Meta API
        for resp in responses:
            try:
                await MetaWebhookHandler.send_response(resp)
            except Exception as e:
                logger.error(f"Error sending response: {e}")

        await db.commit()

        return {
            "status": "ok",
            "processed": len(responses)
        }

    except Exception as e:
        logger.error(f"Webhook processing error: {e}", exc_info=True)
        await db.rollback()
        # Still return 200 to Meta to prevent retries
        return {"status": "error", "detail": str(e)}
