"""
SuperBot Platform - Schemas Pydantic para API
"""
from pydantic import BaseModel, Field
from typing import Optional, List, Any
from datetime import datetime
from enum import IntEnum


class ProjectStep(IntEnum):
    DISCOVERY = 1
    DESIGN = 2
    CONFIGURATION = 3
    APPROVAL = 4
    TESTING = 5
    LAUNCH = 6
    DASHBOARD = 7


# ==================== Company ====================

class CompanyCreate(BaseModel):
    name: str
    industry: Optional[str] = None
    contact_name: Optional[str] = None
    contact_email: Optional[str] = None
    contact_phone: Optional[str] = None


class CompanyResponse(BaseModel):
    id: str
    name: str
    industry: Optional[str] = None
    plan: str = "starter"
    contact_name: Optional[str] = None
    contact_email: Optional[str] = None
    created_at: datetime


# ==================== Project ====================

class ProjectCreate(BaseModel):
    company_id: str
    agent_name: Optional[str] = "Luna"


class ProjectResponse(BaseModel):
    id: str
    company_id: str
    current_step: int
    max_unlocked_step: int
    agent_name: str
    discovery_completed: bool
    design_completed: bool
    config_completed: bool
    is_launched: bool
    created_at: datetime


class ProjectDetail(ProjectResponse):
    discovery_data: dict = {}
    design_data: dict = {}
    config_data: dict = {}
    journeys: list = []
    faqs: list = []
    system_prompt: Optional[str] = None
    voice_id: Optional[str] = None
    rag_store_id: Optional[str] = None
    test_conversations: int = 0
    resolution_rate: float = 0.0
    satisfaction_score: float = 0.0


class AdvanceStepRequest(BaseModel):
    step: int


# ==================== Discovery ====================

class DiscoveryMessage(BaseModel):
    message: str
    audio_base64: Optional[str] = None


class DiscoveryResponse(BaseModel):
    text: str
    audio_url: Optional[str] = None
    data_extracted: dict = {}
    is_complete: bool = False


class DiscoveryComplete(BaseModel):
    company_name: str
    industry: str
    contact_name: str
    contact_email: str
    contact_phone: Optional[str] = None
    main_services: List[str] = []
    typical_customer: Optional[str] = None
    pain_points: List[str] = []
    desired_behavior: Optional[str] = None
    tone: str = "friendly"


# ==================== Design ====================

class Journey(BaseModel):
    id: Optional[str] = None
    trigger: str  # "Quando o cliente quer..."
    action: str   # "O agente deve..."
    is_active: bool = True


class FAQ(BaseModel):
    id: Optional[str] = None
    question: str
    answer: str


class DesignUpdate(BaseModel):
    journeys: Optional[List[Journey]] = None
    faqs: Optional[List[FAQ]] = None
    business_hours: Optional[dict] = None
    basic_info: Optional[dict] = None


class KnowledgeUpload(BaseModel):
    content: str
    name: str = "document.txt"


class KnowledgeTest(BaseModel):
    query: str


class KnowledgeTestResponse(BaseModel):
    answer: str
    sources: List[str] = []


# ==================== Configuration ====================

class ChannelConnect(BaseModel):
    channel_type: str  # whatsapp, instagram, messenger, phone
    channel_identifier: Optional[str] = None
    settings: dict = {}


class ChannelResponse(BaseModel):
    id: str
    channel_type: str
    channel_identifier: Optional[str] = None
    status: str
    created_at: datetime


class IntegrationRequest(BaseModel):
    description: str


class IntegrationEstimate(BaseModel):
    is_feasible: bool
    summary: str
    estimated_cost_min: float
    estimated_cost_max: float
    estimated_days: int


# ==================== Tools ====================

class ToolCreate(BaseModel):
    name: str
    description: str
    webhook_url: str
    parameters: List[dict] = []


class ToolResponse(BaseModel):
    id: str
    name: str
    description: str
    tool_type: str
    webhook_url: Optional[str] = None
    is_active: bool


# ==================== Chat/Testing ====================

class ChatMessage(BaseModel):
    message: str
    audio_base64: Optional[str] = None


class ChatResponse(BaseModel):
    text: str
    audio_url: Optional[str] = None
    tool_calls: List[dict] = []
    model_used: str
    response_time_ms: int


# ==================== Dashboard ====================

class DashboardMetrics(BaseModel):
    total_conversations: int
    resolution_rate: float
    satisfaction_score: float
    avg_response_time_ms: int
    conversations_today: int
    conversations_week: int
    transfer_rate: float
    abandonment_rate: float


class ConversationSummary(BaseModel):
    id: str
    contact_name: Optional[str] = None
    contact_phone: Optional[str] = None
    channel_type: str
    status: str
    message_count: int
    started_at: datetime
    summary: Optional[str] = None


class InsightItem(BaseModel):
    type: str  # warning, success, info
    title: str
    description: str
    action: Optional[str] = None
    action_label: Optional[str] = None


# ==================== Webhooks ====================

class MetaWebhookPayload(BaseModel):
    object: str
    entry: List[dict]


# ==================== Voices ====================

class VoiceResponse(BaseModel):
    voice_id: str
    name: str
    category: Optional[str] = None
    preview_url: Optional[str] = None


class VoiceClone(BaseModel):
    name: str
    description: Optional[str] = ""


# ==================== Generic ====================

class SuccessResponse(BaseModel):
    status: str = "ok"
    message: Optional[str] = None


class ErrorResponse(BaseModel):
    error: str
    detail: Optional[str] = None
