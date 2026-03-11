"""
SuperBot Platform - Conexao com Banco de Dados
Conecta ao PostgreSQL de producao. NAO cria/altera tabelas reais do multitenant.
"""
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy import text as sa_text
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
    from app.db.models import (
        Base, Client, DashboardUser, Session as SessionModel, VoiceCallHistory,
        MediaLibrary, Pipeline, FollowupStage, LoyaltyClub, ClubMember, ClubCampaign,
        CampaignDelivery,
    )

    dashboard_tables = [
        Client.__table__,
        DashboardUser.__table__,
        SessionModel.__table__,
        VoiceCallHistory.__table__,
        MediaLibrary.__table__,
        Pipeline.__table__,
        FollowupStage.__table__,
        LoyaltyClub.__table__,
        ClubMember.__table__,
        ClubCampaign.__table__,
        CampaignDelivery.__table__,
    ]

    async with engine.begin() as conn:
        await conn.run_sync(
            lambda sync_conn: Base.metadata.create_all(
                sync_conn, tables=dashboard_tables
            )
        )

        # Keep multitenant events schema compatible with deterministic timeline ordering.
        if (conn.dialect.name or "").lower() == "postgresql":
            await conn.execute(sa_text("""
                ALTER TABLE public.conversation_events
                ADD COLUMN IF NOT EXISTS event_created_at timestamptz
            """))

            await conn.execute(sa_text("""
                CREATE OR REPLACE FUNCTION public.superbot_parse_unix_ts(ts_text text)
                RETURNS timestamptz
                LANGUAGE plpgsql
                AS $$
                DECLARE
                  parsed_num numeric;
                BEGIN
                  IF ts_text IS NULL OR btrim(ts_text) = '' THEN
                    RETURN NULL;
                  END IF;

                  BEGIN
                    parsed_num := ts_text::numeric;
                  EXCEPTION WHEN others THEN
                    RETURN NULL;
                  END;

                  IF parsed_num > 999999999999 THEN
                    RETURN to_timestamp(parsed_num / 1000.0);
                  END IF;

                  RETURN to_timestamp(parsed_num);
                END;
                $$;
            """))

            await conn.execute(sa_text("""
                CREATE OR REPLACE FUNCTION public.superbot_extract_event_created_at(
                  raw_payload jsonb,
                  fallback_ts timestamptz DEFAULT now()
                )
                RETURNS timestamptz
                LANGUAGE plpgsql
                AS $$
                DECLARE
                  source_ts text;
                  parsed_ts timestamptz;
                BEGIN
                  IF raw_payload IS NULL THEN
                    RETURN COALESCE(fallback_ts, now());
                  END IF;

                  source_ts := COALESCE(
                    raw_payload #>> '{entry,0,changes,0,value,messages,0,timestamp}',
                    raw_payload #>> '{entry,0,messaging,0,timestamp}',
                    raw_payload #>> '{entry,0,time}',
                    raw_payload #>> '{timestamp}',
                    raw_payload #>> '{sent,timestamp}'
                  );

                  parsed_ts := public.superbot_parse_unix_ts(source_ts);
                  RETURN COALESCE(parsed_ts, fallback_ts, now());
                END;
                $$;
            """))

            await conn.execute(sa_text("""
                CREATE OR REPLACE FUNCTION public.superbot_set_event_created_at()
                RETURNS trigger
                LANGUAGE plpgsql
                AS $$
                BEGIN
                  IF NEW.event_created_at IS NULL THEN
                    NEW.event_created_at := public.superbot_extract_event_created_at(NEW.raw_payload, NEW.created_at);
                  END IF;
                  RETURN NEW;
                END;
                $$;
            """))

            await conn.execute(sa_text("""
                DROP TRIGGER IF EXISTS trg_superbot_set_event_created_at ON public.conversation_events
            """))

            await conn.execute(sa_text("""
                CREATE TRIGGER trg_superbot_set_event_created_at
                BEFORE INSERT ON public.conversation_events
                FOR EACH ROW
                EXECUTE FUNCTION public.superbot_set_event_created_at()
            """))

            await conn.execute(sa_text("""
                UPDATE public.conversation_events
                SET event_created_at = public.superbot_extract_event_created_at(raw_payload, created_at)
                WHERE event_created_at IS NULL
            """))

            # Set gen_random_uuid() defaults for new tables
            for tbl in ['media_library', 'pipelines', 'followup_stages', 'loyalty_clubs', 'club_members', 'club_campaigns', 'campaign_deliveries']:
                await conn.execute(sa_text(f"""
                    ALTER TABLE {tbl} ALTER COLUMN id SET DEFAULT gen_random_uuid()
                """))

            # Unique constraint for club_members (phone per club)
            await conn.execute(sa_text("""
                CREATE UNIQUE INDEX IF NOT EXISTS idx_club_members_club_phone
                ON club_members (club_id, phone)
            """))

            await conn.execute(sa_text("""
                CREATE UNIQUE INDEX IF NOT EXISTS idx_campaign_deliveries_campaign_phone
                ON campaign_deliveries (campaign_id, phone)
            """))

            # F1: Add pipeline_id to pipeline_stages and conversation_assignments
            await conn.execute(sa_text("""
                ALTER TABLE public.pipeline_stages
                ADD COLUMN IF NOT EXISTS pipeline_id uuid REFERENCES pipelines(id) ON DELETE CASCADE
            """))
            await conn.execute(sa_text("""
                ALTER TABLE public.conversation_assignments
                ADD COLUMN IF NOT EXISTS pipeline_id uuid REFERENCES pipelines(id) ON DELETE SET NULL
            """))

            await conn.execute(sa_text("""
                CREATE INDEX IF NOT EXISTS idx_conversation_events_timeline
                ON public.conversation_events (
                  project_id,
                  channel_type,
                  conversation_id,
                  event_created_at,
                  created_at
                )
            """))


async def get_db():
    """Dependency para FastAPI - fornece AsyncSession."""
    async with async_session() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
