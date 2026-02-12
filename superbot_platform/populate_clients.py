"""
Popula os clients existentes com project_id e dados dos canais reais.
"""
import asyncio
import json
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy import text

DATABASE_URL = "postgresql+asyncpg://postgres:c56d0e4d3c613eb66684@72.60.13.22:3030/aplicativos"

# Mapeamento real descoberto do banco
CLIENTS = {
    "pacific-surf": {
        "project_id": "0624f30a-8774-4b19-9ba8-f029ab396144",
        "project_slug": "pacificsurf",
        "meta_phone_id": "918516351342682",
        "meta_page_id": "97134127600",
        "meta_ig_id": "17841402310092000",
    },
    "dentaly": {
        "project_id": "1785d020-50f9-49a9-81d7-64927e3e6f96",
        "project_slug": "dentaly",
        "meta_phone_id": "974324942422221",
        "meta_page_id": "100416489740216",
        "meta_ig_id": "17841479774657796",
    },
    "famiglia-gianni": {
        "project_id": "b31efa28-58b1-404c-95dc-236a88fff6b5",
        "project_slug": "famiglia-gianni",
        "meta_phone_id": "974597825733636",
        "meta_page_id": None,
        "meta_ig_id": None,
    },
}


async def populate():
    engine = create_async_engine(DATABASE_URL, echo=False)
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with async_session() as db:
        for slug, data in CLIENTS.items():
            settings_json = json.dumps({
                "project_id": data["project_id"],
                "project_slug": data["project_slug"],
            })

            await db.execute(
                text("""
                    UPDATE clients
                    SET settings = CAST(:settings AS jsonb),
                        meta_phone_id = COALESCE(:meta_phone_id, meta_phone_id),
                        meta_page_id = COALESCE(:meta_page_id, meta_page_id),
                        meta_ig_id = COALESCE(:meta_ig_id, meta_ig_id)
                    WHERE slug = :slug
                """),
                {
                    "settings": settings_json,
                    "meta_phone_id": data["meta_phone_id"],
                    "meta_page_id": data["meta_page_id"],
                    "meta_ig_id": data["meta_ig_id"],
                    "slug": slug,
                },
            )
            print(f"[OK] {slug} -> project_id={data['project_id']}")

        await db.commit()

        # Verificar
        print("\n--- Verificacao ---")
        res = await db.execute(text(
            "SELECT name, slug, settings, meta_phone_id, meta_page_id, meta_ig_id FROM clients ORDER BY name"
        ))
        for row in res.fetchall():
            print(f"  {row[0]} | slug={row[1]} | settings={row[2]} | phone={row[3]} | page={row[4]} | ig={row[5]}")

    await engine.dispose()
    print("\nDONE!")


if __name__ == "__main__":
    asyncio.run(populate())
