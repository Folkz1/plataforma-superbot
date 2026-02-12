"""
SuperBot Platform - Modelos de Banco de Dados
Refletem o schema REAL do PostgreSQL em producao.
"""
from sqlalchemy import (
    Column, String, Text, Boolean, DateTime, ForeignKey,
    JSON, Integer, Float, Numeric, func, Uuid, ARRAY, Date
)
from sqlalchemy.orm import declarative_base, relationship
from datetime import datetime
import uuid

Base = declarative_base()


# =====================================================
# Tabelas Reais do Multitenant (gerenciadas pelo n8n)
# =====================================================

class Company(Base):
    """Empresa dona de um ou mais projetos."""
    __tablename__ = "companies"
    __table_args__ = {"extend_existing": True}

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    projects = relationship("Project", back_populates="company")


class Project(Base):
    """Projeto/Bot no sistema multitenant."""
    __tablename__ = "projects"
    __table_args__ = {"extend_existing": True}

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id = Column(Uuid(as_uuid=True), ForeignKey("companies.id"))
    agent_workflow_id = Column(Text)
    project_slug = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow)
    webhook_path = Column(Text)

    company = relationship("Company", back_populates="projects")
    channels = relationship("Channel", back_populates="project")
    voice_agents = relationship("ProjectVoiceAgent", back_populates="project")


class Channel(Base):
    """Canal conectado a um projeto (WhatsApp, Messenger, Instagram)."""
    __tablename__ = "channels"
    __table_args__ = {"extend_existing": True}

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(Uuid(as_uuid=True), ForeignKey("projects.id"))
    channel_identifier = Column(Text)
    channel_type = Column(Text)
    access_token = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow)

    project = relationship("Project", back_populates="channels")


# =====================================================
# Conversas (dados reais dos bots)
# =====================================================

class ConversationEvent(Base):
    """Evento imutavel de conversa (log completo de mensagens)."""
    __tablename__ = "conversation_events"
    __table_args__ = {"extend_existing": True}

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(Uuid(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    channel_identifier = Column(Text, nullable=False)
    channel_type = Column(Text, nullable=False)
    conversation_id = Column(Text, nullable=False)
    direction = Column(Text, nullable=False)  # 'in', 'out', 'system'
    message_type = Column(Text, nullable=False)
    text = Column(Text)
    media = Column(JSON)
    raw_payload = Column(JSON)
    metadata_json = Column("metadata", JSON)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class ConversationState(Base):
    """Estado atual de uma conversa (snapshot mutavel)."""
    __tablename__ = "conversation_states"
    __table_args__ = {"extend_existing": True}

    project_id = Column(Uuid(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), primary_key=True)
    channel_type = Column(Text, primary_key=True)
    conversation_id = Column(Text, primary_key=True)

    channel_identifier = Column(Text)
    status = Column(Text, default="open")
    closed_at = Column(DateTime(timezone=True))
    closed_reason = Column(Text)

    last_event_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    last_in_at = Column(DateTime(timezone=True))
    last_out_at = Column(DateTime(timezone=True))
    last_direction = Column(Text)
    last_message_type = Column(Text)
    last_text = Column(Text)

    ai_state = Column(Text)
    ai_reason = Column(Text)
    ai_confidence = Column(Numeric)
    ai_last_checked_at = Column(DateTime(timezone=True))

    summary_short = Column(Text)
    summary_updated_at = Column(DateTime(timezone=True))
    last_notified_at = Column(DateTime(timezone=True))

    followup_stage = Column(Integer, default=0)
    next_followup_at = Column(DateTime(timezone=True))

    metadata_json = Column("metadata", JSON)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class ConversationFeedback(Base):
    """Feedback de satisfacao do cliente."""
    __tablename__ = "conversation_feedback"
    __table_args__ = {"extend_existing": True}

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    request_id = Column(Uuid(as_uuid=True), ForeignKey("conversation_feedback_requests.id"), nullable=False)
    project_id = Column(Uuid(as_uuid=True), ForeignKey("projects.id"), nullable=False)
    channel_type = Column(Text, nullable=False)
    conversation_id = Column(Text, nullable=False)
    rating = Column(Integer)
    has_problem = Column(Boolean, default=False)
    problem_text = Column(Text)
    comment = Column(Text)
    raw_payload = Column(JSON)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class ConversationFeedbackRequest(Base):
    """Solicitacao de feedback enviada ao cliente."""
    __tablename__ = "conversation_feedback_requests"
    __table_args__ = {"extend_existing": True}

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(Uuid(as_uuid=True), ForeignKey("projects.id"), nullable=False)
    channel_type = Column(Text, nullable=False)
    conversation_id = Column(Text, nullable=False)
    token = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    used_at = Column(DateTime(timezone=True))
    expires_at = Column(DateTime(timezone=True))
    metadata_json = Column("metadata", JSON)


# =====================================================
# Contatos / Leads (CRM do bot)
# =====================================================

class Contact(Base):
    """Contato/Lead capturado pelo bot."""
    __tablename__ = "users"
    __table_args__ = {"extend_existing": True}

    id = Column(Text, primary_key=True)  # phone number
    name = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    project_id = Column(Uuid(as_uuid=True), ForeignKey("projects.id"), nullable=False)
    metadata_json = Column("metadata", JSON, default=dict)


# =====================================================
# Configuracoes por Projeto
# =====================================================

class ProjectSecrets(Base):
    """Chaves e configuracoes por projeto."""
    __tablename__ = "project_secrets"
    __table_args__ = {"extend_existing": True}

    project_id = Column(Uuid(as_uuid=True), ForeignKey("projects.id"), primary_key=True)
    meta_master_token = Column(Text)
    openrouter_api_key = Column(Text)
    elevenlabs_api_key = Column(Text)
    gemini_api_key = Column(Text)
    nextcloud_base_url = Column(Text)
    nextcloud_username = Column(Text)
    nextcloud_password = Column(Text)
    nextcloud_media_root = Column(Text, default="SuperBotMedia")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    notification_email = Column(Text)
    notification_phone = Column(Text)
    followup_enabled = Column(Boolean, default=False)
    followup_config = Column(JSON, default=dict)
    feedback_enabled = Column(Boolean, default=True)
    feedback_config = Column(JSON, default=dict)


class ProjectVoiceAgent(Base):
    """Agente de voz ElevenLabs vinculado a um projeto."""
    __tablename__ = "project_voice_agents"
    __table_args__ = {"extend_existing": True}

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(Uuid(as_uuid=True), ForeignKey("projects.id"), nullable=False)
    agent_id = Column(Text, nullable=False)
    label = Column(Text)
    channel_type = Column(Text, default="phone")
    active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    project = relationship("Project", back_populates="voice_agents")


class ProjectKnowledgeBase(Base):
    """Chunk de conhecimento RAG com embedding."""
    __tablename__ = "project_knowledge_base"
    __table_args__ = {"extend_existing": True}

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(Uuid(as_uuid=True), ForeignKey("projects.id"), nullable=False)
    content = Column(Text, nullable=False)
    metadata_json = Column("metadata", JSON, default=dict)
    # embedding column exists but we skip it (vector type)
    created_at = Column(DateTime, default=datetime.utcnow)


class ProjectToolsKnowledge(Base):
    """Definicao de tools/webhooks do agente."""
    __tablename__ = "project_tools_knowledge"
    __table_args__ = {"extend_existing": True}

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(Uuid(as_uuid=True), ForeignKey("projects.id"))
    tool_name = Column(Text, nullable=False)
    instructions = Column(Text, nullable=False)
    api_endpoint = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow)


class ProjectDataAccess(Base):
    """Controle de acesso a dados por projeto."""
    __tablename__ = "project_data_access"
    __table_args__ = {"extend_existing": True}

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(Uuid(as_uuid=True), ForeignKey("projects.id"))
    table_name = Column(Text, nullable=False)
    allowed_columns = Column(ARRAY(Text))
    can_write = Column(Boolean, default=False)


class GlobalSecrets(Base):
    """Chaves globais compartilhadas."""
    __tablename__ = "global_secrets"
    __table_args__ = {"extend_existing": True}

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    meta_page_access_token = Column(Text)
    openrouter_api_key = Column(Text)
    elevenlabs_api_key = Column(Text)
    nextcloud_username = Column(Text)
    nextcloud_password = Column(Text)
    nextcloud_base_url = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class PatientReminder(Base):
    """Lembretes de consulta (Dentaly)."""
    __tablename__ = "patient_reminders"
    __table_args__ = {"extend_existing": True}

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    phone = Column(Text, nullable=False)
    appointment_id = Column(Text)
    date = Column(Date)
    time = Column(Text)
    status = Column(Text, default="pending")
    metadata_json = Column("metadata", JSON)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    subscriber_id = Column(Text)


class N8nChatHistory(Base):
    """Historico de chat do n8n."""
    __tablename__ = "n8n_chat_histories"
    __table_args__ = {"extend_existing": True}

    id = Column(Integer, primary_key=True, autoincrement=True)
    session_id = Column(String(255), nullable=False)
    message = Column(JSON, nullable=False)


# =====================================================
# Dashboard (tabelas proprias da plataforma)
# =====================================================

class Client(Base):
    """Cliente (tenant) da plataforma SuperBot Dashboard."""
    __tablename__ = "clients"
    __table_args__ = {"extend_existing": True}

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(Text, nullable=False)
    slug = Column(Text, unique=True, nullable=False)
    status = Column(Text, default="active")

    # Meta Config
    meta_page_id = Column(Text)
    meta_phone_id = Column(Text)
    meta_ig_id = Column(Text)
    meta_waba_id = Column(Text)
    meta_access_token = Column(Text)

    # ElevenLabs Config
    elevenlabs_agent_id = Column(Text)
    elevenlabs_voice_id = Column(Text)
    elevenlabs_api_key = Column(Text)

    # Settings
    timezone = Column(Text, default="America/Sao_Paulo")
    settings = Column(JSON, default=dict)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    users = relationship("DashboardUser", back_populates="client")


class DashboardUser(Base):
    """Usuario do dashboard (admin ou cliente)."""
    __tablename__ = "dashboard_users"
    __table_args__ = {"extend_existing": True}

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(Text, unique=True, nullable=False)
    password_hash = Column(Text, nullable=False)
    name = Column(Text, nullable=False)
    role = Column(Text, nullable=False)  # 'admin' or 'client'

    client_id = Column(Uuid(as_uuid=True), ForeignKey("clients.id", ondelete="CASCADE"))

    is_active = Column(Boolean, default=True)
    email_verified = Column(Boolean, default=False)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    last_login = Column(DateTime(timezone=True))

    client = relationship("Client", back_populates="users")
    sessions = relationship("Session", back_populates="user")


class Session(Base):
    """Sessao de autenticacao JWT."""
    __tablename__ = "sessions"
    __table_args__ = {"extend_existing": True}

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(Uuid(as_uuid=True), ForeignKey("dashboard_users.id", ondelete="CASCADE"), nullable=False)
    token = Column(Text, unique=True, nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    ip_address = Column(Text)
    user_agent = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    user = relationship("DashboardUser", back_populates="sessions")


class VoiceCallHistory(Base):
    """Historico de ligacoes ElevenLabs."""
    __tablename__ = "voice_call_history"
    __table_args__ = {"extend_existing": True}

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(Uuid(as_uuid=True), ForeignKey("projects.id"))
    agent_id = Column(Text)
    agent_name = Column(Text)
    conversation_id = Column(Text)  # ElevenLabs conversation_id
    customer_name = Column(Text)
    customer_phone = Column(Text)
    customer_email = Column(Text)
    call_duration_secs = Column(Integer)
    start_time = Column(DateTime(timezone=True))
    transcript_summary = Column(Text)
    transcript = Column(JSON)
    call_successful = Column(Boolean, default=True)
    termination_reason = Column(Text)
    audio_url = Column(Text)
    data_collection = Column(JSON)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
