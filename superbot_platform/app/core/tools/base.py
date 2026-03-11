"""
BaseTool and ToolRegistry — marketplace pattern for reusable agent tools.

Each tool:
  - Has a unique name (used in ElevenLabs webhook URL)
  - Declares its parameters schema
  - Executes async and returns a dict
  - Can be assigned to multiple agents/projects
"""
import logging
from abc import ABC, abstractmethod
from typing import Any

logger = logging.getLogger("superbot.tools")


class BaseTool(ABC):
    """Abstract base for all agent tools."""

    name: str = ""
    description: str = ""

    @abstractmethod
    async def execute(self, params: dict[str, Any], context: dict[str, Any] | None = None) -> dict:
        """
        Execute the tool.

        Args:
            params: Parameters from the AI agent (e.g. purchase_id, phone_number)
            context: Optional context (project_id, sender_id, channel, etc.)

        Returns:
            dict that ElevenLabs will forward to the agent as tool response
        """
        ...


class ToolRegistry:
    """Registry of available tools — the marketplace."""

    _tools: dict[str, BaseTool] = {}

    @classmethod
    def register(cls, tool: BaseTool) -> None:
        cls._tools[tool.name] = tool
        logger.info(f"[TOOLS] Registered: {tool.name}")

    @classmethod
    def get(cls, name: str) -> BaseTool | None:
        return cls._tools.get(name)

    @classmethod
    def list_tools(cls) -> list[dict]:
        return [
            {"name": t.name, "description": t.description}
            for t in cls._tools.values()
        ]

    @classmethod
    def register_all(cls) -> None:
        """Import and register all built-in tools."""
        from app.core.tools.pacific_booking import SearchPurchaseTool, SearchPhoneTool
        from app.core.tools.email_sender import SendEmailTool

        for tool_cls in [SearchPurchaseTool, SearchPhoneTool, SendEmailTool]:
            cls.register(tool_cls())
