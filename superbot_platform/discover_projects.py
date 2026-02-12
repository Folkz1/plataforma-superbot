"""
Script para descobrir os projetos reais no banco PostgreSQL.
Uso temporário - pode deletar depois.
"""
import asyncio
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy import text

DATABASE_URL = "postgresql+asyncpg://postgres:c56d0e4d3c613eb66684@72.60.13.22:3030/aplicativos"


async def discover():
    engine = create_async_engine(DATABASE_URL, echo=False)
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with async_session() as db:
        # 1) Listar todas as tabelas do banco
        print("=" * 60)
        print("TABELAS NO BANCO")
        print("=" * 60)
        res = await db.execute(text(
            "SELECT table_name FROM information_schema.tables "
            "WHERE table_schema = 'public' ORDER BY table_name"
        ))
        for row in res.fetchall():
            print(f"  - {row[0]}")

        # 2) Ver colunas da tabela projects
        print("\n" + "=" * 60)
        print("COLUNAS DA TABELA 'projects' (se existir)")
        print("=" * 60)
        try:
            res = await db.execute(text(
                "SELECT column_name, data_type FROM information_schema.columns "
                "WHERE table_name = 'projects' ORDER BY ordinal_position"
            ))
            for row in res.fetchall():
                print(f"  {row[0]}: {row[1]}")
        except Exception as e:
            print(f"  Erro: {e}")

        # 3) Listar projetos
        print("\n" + "=" * 60)
        print("PROJETOS EXISTENTES")
        print("=" * 60)
        try:
            res = await db.execute(text("SELECT * FROM projects LIMIT 20"))
            cols = res.keys()
            rows = res.fetchall()
            print(f"  Colunas: {list(cols)}")
            for row in rows:
                print(f"  {dict(zip(cols, row))}")
        except Exception as e:
            print(f"  Erro: {e}")

        # 4) Ver conversation_states agrupados por project_id
        print("\n" + "=" * 60)
        print("CONVERSAS POR PROJECT_ID")
        print("=" * 60)
        try:
            res = await db.execute(text(
                "SELECT project_id, COUNT(*) as total, "
                "MIN(created_at) as first, MAX(last_event_at) as last "
                "FROM conversation_states "
                "GROUP BY project_id ORDER BY total DESC"
            ))
            for row in res.fetchall():
                print(f"  project_id={row[0]}  total={row[1]}  first={row[2]}  last={row[3]}")
        except Exception as e:
            print(f"  Erro: {e}")

        # 5) Ver conversation_events agrupados por project_id
        print("\n" + "=" * 60)
        print("EVENTOS POR PROJECT_ID")
        print("=" * 60)
        try:
            res = await db.execute(text(
                "SELECT project_id, COUNT(*) as total "
                "FROM conversation_events "
                "GROUP BY project_id ORDER BY total DESC"
            ))
            for row in res.fetchall():
                print(f"  project_id={row[0]}  total={row[1]}")
        except Exception as e:
            print(f"  Erro: {e}")

        # 6) Ver clientes existentes na tabela clients
        print("\n" + "=" * 60)
        print("CLIENTES NA TABELA 'clients'")
        print("=" * 60)
        try:
            res = await db.execute(text("SELECT id, name, slug, status, settings FROM clients"))
            for row in res.fetchall():
                print(f"  id={row[0]}  name={row[1]}  slug={row[2]}  status={row[3]}  settings={row[4]}")
        except Exception as e:
            print(f"  Erro: {e}")

        # 7) Tabela empresas (se existir)
        print("\n" + "=" * 60)
        print("TABELA 'empresas' (primeiras colunas)")
        print("=" * 60)
        try:
            res = await db.execute(text(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_name = 'empresas' ORDER BY ordinal_position LIMIT 15"
            ))
            cols = [r[0] for r in res.fetchall()]
            print(f"  Colunas: {cols}")

            if cols:
                res = await db.execute(text(
                    f"SELECT {', '.join(cols[:8])} FROM empresas LIMIT 10"
                ))
                for row in res.fetchall():
                    print(f"  {dict(zip(cols[:8], row))}")
        except Exception as e:
            print(f"  Erro: {e}")

    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(discover())
