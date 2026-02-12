"""
Descoberta COMPLETA da estrutura do banco PostgreSQL.
"""
import asyncio
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy import text

DATABASE_URL = "postgresql+asyncpg://postgres:c56d0e4d3c613eb66684@72.60.13.22:3030/aplicativos"


async def discover_full():
    engine = create_async_engine(DATABASE_URL, echo=False)
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with async_session() as db:
        # 1) Todas as tabelas com contagem de registros
        print("=" * 80)
        print("TODAS AS TABELAS COM CONTAGEM DE REGISTROS")
        print("=" * 80)
        res = await db.execute(text(
            "SELECT table_name FROM information_schema.tables "
            "WHERE table_schema = 'public' ORDER BY table_name"
        ))
        tables = [row[0] for row in res.fetchall()]

        for table in tables:
            try:
                count_res = await db.execute(text(f'SELECT COUNT(*) FROM "{table}"'))
                count = count_res.scalar()
                print(f"  {table}: {count} registros")
            except Exception as e:
                print(f"  {table}: ERRO - {e}")

        # 2) Estrutura detalhada de cada tabela
        for table in tables:
            print(f"\n{'=' * 80}")
            print(f"TABELA: {table}")
            print(f"{'=' * 80}")

            # Colunas
            res = await db.execute(text(
                "SELECT column_name, data_type, is_nullable, column_default "
                "FROM information_schema.columns "
                "WHERE table_name = :table ORDER BY ordinal_position"
            ), {"table": table})
            cols = res.fetchall()
            for col in cols:
                nullable = "NULL" if col[2] == "YES" else "NOT NULL"
                default = f" DEFAULT {col[3]}" if col[3] else ""
                print(f"  {col[0]}: {col[1]} {nullable}{default}")

            # Amostra de dados (primeiros 3 registros)
            try:
                col_names = [c[0] for c in cols]
                safe_cols = ', '.join(f'"{c}"' for c in col_names[:10])  # limit columns
                res = await db.execute(text(f'SELECT {safe_cols} FROM "{table}" LIMIT 3'))
                rows = res.fetchall()
                if rows:
                    print(f"\n  AMOSTRA ({len(rows)} registros):")
                    for row in rows:
                        data = dict(zip(col_names[:10], row))
                        # Truncate long values
                        for k, v in data.items():
                            if isinstance(v, str) and len(v) > 100:
                                data[k] = v[:100] + "..."
                        print(f"    {data}")
            except Exception as e:
                print(f"  AMOSTRA ERRO: {e}")

        # 3) Foreign keys
        print(f"\n{'=' * 80}")
        print("FOREIGN KEYS")
        print(f"{'=' * 80}")
        res = await db.execute(text("""
            SELECT
                tc.table_name AS source_table,
                kcu.column_name AS source_column,
                ccu.table_name AS target_table,
                ccu.column_name AS target_column
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
                ON tc.constraint_name = kcu.constraint_name
            JOIN information_schema.constraint_column_usage ccu
                ON tc.constraint_name = ccu.constraint_name
            WHERE tc.constraint_type = 'FOREIGN KEY'
            ORDER BY tc.table_name
        """))
        for row in res.fetchall():
            print(f"  {row[0]}.{row[1]} -> {row[2]}.{row[3]}")

        # 4) Dados dos projetos com detalhes
        print(f"\n{'=' * 80}")
        print("PROJETOS DETALHADOS")
        print(f"{'=' * 80}")
        res = await db.execute(text("SELECT * FROM projects"))
        cols = list(res.keys())
        for row in res.fetchall():
            data = dict(zip(cols, row))
            print(f"  {data}")

        # 5) project_secrets
        print(f"\n{'=' * 80}")
        print("PROJECT SECRETS (sem valores sensíveis)")
        print(f"{'=' * 80}")
        try:
            res = await db.execute(text(
                "SELECT project_id, key_name, LENGTH(key_value) as val_len, created_at "
                "FROM project_secrets"
            ))
            for row in res.fetchall():
                print(f"  project={row[0]} key={row[1]} val_len={row[2]} created={row[3]}")
        except Exception as e:
            print(f"  Erro: {e}")

        # 6) project_voice_agents
        print(f"\n{'=' * 80}")
        print("VOICE AGENTS")
        print(f"{'=' * 80}")
        try:
            res = await db.execute(text("SELECT * FROM project_voice_agents"))
            cols = list(res.keys())
            for row in res.fetchall():
                data = dict(zip(cols, row))
                # Truncate long strings
                for k, v in data.items():
                    if isinstance(v, str) and len(v) > 80:
                        data[k] = v[:80] + "..."
                print(f"  {data}")
        except Exception as e:
            print(f"  Erro: {e}")

        # 7) project_knowledge_base
        print(f"\n{'=' * 80}")
        print("KNOWLEDGE BASE")
        print(f"{'=' * 80}")
        try:
            res = await db.execute(text(
                "SELECT project_id, title, source_type, LENGTH(content) as content_len, created_at "
                "FROM project_knowledge_base LIMIT 10"
            ))
            for row in res.fetchall():
                print(f"  project={row[0]} title={row[1]} type={row[2]} content_len={row[3]} created={row[4]}")
        except Exception as e:
            print(f"  Erro: {e}")

        # 8) project_tools_knowledge
        print(f"\n{'=' * 80}")
        print("TOOLS KNOWLEDGE")
        print(f"{'=' * 80}")
        try:
            res = await db.execute(text("SELECT * FROM project_tools_knowledge LIMIT 5"))
            cols = list(res.keys())
            for row in res.fetchall():
                data = dict(zip(cols, row))
                for k, v in data.items():
                    if isinstance(v, str) and len(v) > 100:
                        data[k] = v[:100] + "..."
                print(f"  {data}")
        except Exception as e:
            print(f"  Erro: {e}")

        # 9) global_secrets
        print(f"\n{'=' * 80}")
        print("GLOBAL SECRETS (sem valores)")
        print(f"{'=' * 80}")
        try:
            res = await db.execute(text(
                "SELECT key_name, LENGTH(key_value) as val_len FROM global_secrets"
            ))
            for row in res.fetchall():
                print(f"  key={row[0]} val_len={row[1]}")
        except Exception as e:
            print(f"  Erro: {e}")

        # 10) conversation_feedback + requests
        print(f"\n{'=' * 80}")
        print("CONVERSATION FEEDBACK")
        print(f"{'=' * 80}")
        try:
            res = await db.execute(text("SELECT * FROM conversation_feedback LIMIT 5"))
            cols = list(res.keys())
            for row in res.fetchall():
                data = dict(zip(cols, row))
                print(f"  {data}")
        except Exception as e:
            print(f"  Erro: {e}")

        try:
            res = await db.execute(text("SELECT * FROM conversation_feedback_requests LIMIT 5"))
            cols = list(res.keys())
            for row in res.fetchall():
                data = dict(zip(cols, row))
                for k, v in data.items():
                    if isinstance(v, str) and len(v) > 100:
                        data[k] = v[:100] + "..."
                print(f"  feedback_request: {data}")
        except Exception as e:
            print(f"  Erro: {e}")

        # 11) n8n_chat_histories
        print(f"\n{'=' * 80}")
        print("N8N CHAT HISTORIES (amostra)")
        print(f"{'=' * 80}")
        try:
            res = await db.execute(text(
                "SELECT id, session_id, LENGTH(message::text) as msg_len "
                "FROM n8n_chat_histories LIMIT 5"
            ))
            for row in res.fetchall():
                print(f"  id={row[0]} session={row[1]} msg_len={row[2]}")

            # Count
            res = await db.execute(text("SELECT COUNT(*) FROM n8n_chat_histories"))
            print(f"  Total: {res.scalar()} registros")
        except Exception as e:
            print(f"  Erro: {e}")

        # 12) project_data_access
        print(f"\n{'=' * 80}")
        print("PROJECT DATA ACCESS")
        print(f"{'=' * 80}")
        try:
            res = await db.execute(text("SELECT * FROM project_data_access"))
            cols = list(res.keys())
            for row in res.fetchall():
                print(f"  {dict(zip(cols, row))}")
        except Exception as e:
            print(f"  Erro: {e}")

        # 13) users table
        print(f"\n{'=' * 80}")
        print("USERS TABLE")
        print(f"{'=' * 80}")
        try:
            res = await db.execute(text(
                "SELECT id, email, name, role, is_active, created_at FROM users LIMIT 10"
            ))
            for row in res.fetchall():
                print(f"  id={row[0]} email={row[1]} name={row[2]} role={row[3]} active={row[4]} created={row[5]}")
        except Exception as e:
            print(f"  Erro: {e}")

        # 14) emails_vector_history
        print(f"\n{'=' * 80}")
        print("EMAILS VECTOR HISTORY")
        print(f"{'=' * 80}")
        try:
            res = await db.execute(text(
                "SELECT column_name, data_type FROM information_schema.columns "
                "WHERE table_name = 'emails_vector_history' ORDER BY ordinal_position"
            ))
            for row in res.fetchall():
                print(f"  {row[0]}: {row[1]}")
            res = await db.execute(text("SELECT COUNT(*) FROM emails_vector_history"))
            print(f"  Total: {res.scalar()} registros")
        except Exception as e:
            print(f"  Erro: {e}")

        # 15) patient_reminders
        print(f"\n{'=' * 80}")
        print("PATIENT REMINDERS")
        print(f"{'=' * 80}")
        try:
            res = await db.execute(text("SELECT * FROM patient_reminders LIMIT 5"))
            cols = list(res.keys())
            for row in res.fetchall():
                data = dict(zip(cols, row))
                for k, v in data.items():
                    if isinstance(v, str) and len(v) > 80:
                        data[k] = v[:80] + "..."
                print(f"  {data}")
        except Exception as e:
            print(f"  Erro: {e}")

    await engine.dispose()
    print("\n\nDONE!")


if __name__ == "__main__":
    asyncio.run(discover_full())
