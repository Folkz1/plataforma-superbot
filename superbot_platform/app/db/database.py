"""
SuperBot Platform - Conexao com Banco de Dados
Conecta ao PostgreSQL de producao. NAO cria/altera tabelas reais do multitenant.
"""
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from contextlib import asynccontextmanager
from app.config import get_settings

settings = get_settings()

# Engine async
engine = create_async_engine(
    settings.database_url,
    echo=settings.api_debug,
    future=True,
)

# Session factory
async_session = sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


async def init_db():
    """
    Cria APENAS as tabelas do dashboard (clients, dashboard_users, sessions).
    NAO toca nas tabelas reais do multitenant (projects, conversation_*, etc).
    """
    from app.db.models import Base, Client, DashboardUser, Session as SessionModel, VoiceCallHistory

    dashboard_tables = [
        Client.__table__,
        DashboardUser.__table__,
        SessionModel.__table__,
        VoiceCallHistory.__table__,
    ]

    async with engine.begin() as conn:
        await conn.run_sync(
            lambda sync_conn: Base.metadata.create_all(
                sync_conn, tables=dashboard_tables
            )
        )


async def get_db():
    """Dependency para FastAPI - fornece AsyncSession."""
    async with async_session() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
