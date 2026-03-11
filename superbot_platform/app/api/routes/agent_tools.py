"""
Agent Tools Webhook API — ElevenLabs calls these endpoints when the AI agent
triggers a tool. Each tool is registered in the ToolRegistry marketplace.

Endpoints:
  POST /api/tools/webhook/{tool_name}  — Execute a tool by name
  GET  /api/tools/list                 — List available tools (marketplace)
"""
import logging
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.core.tools.base import ToolRegistry

logger = logging.getLogger("superbot.agent_tools")

router = APIRouter(prefix="/api/tools", tags=["agent-tools"])


@router.post("/webhook/{tool_name}")
async def execute_tool(tool_name: str, request: Request):
    """
    Webhook endpoint for ElevenLabs tool calls.

    ElevenLabs sends: {"purchase_id": "12345"} or {"phone_number": "(858) 555-0123"}
    We resolve the tool, execute it, and return the result.
    """
    tool = ToolRegistry.get(tool_name)
    if not tool:
        logger.warning(f"[TOOLS] Unknown tool: {tool_name}")
        return JSONResponse(
            status_code=404,
            content={"error": f"Tool '{tool_name}' not found"}
        )

    try:
        body = await request.json()
    except Exception:
        body = {}

    logger.info(f"[TOOLS] Executing: {tool_name} with params={body}")

    try:
        result = await tool.execute(body)
        # ElevenLabs expects the response as a JSON array (like N8N respondToWebhook)
        if isinstance(result, dict):
            return JSONResponse(content=[result])
        return JSONResponse(content=result)
    except Exception as e:
        logger.error(f"[TOOLS] Error in {tool_name}: {e}", exc_info=True)
        return JSONResponse(
            status_code=500,
            content=[{"error": str(e)}]
        )


@router.get("/list")
async def list_tools():
    """List all registered tools (marketplace view)."""
    return {"tools": ToolRegistry.list_tools()}
