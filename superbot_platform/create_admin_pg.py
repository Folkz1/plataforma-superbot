"""
Script para criar usuário admin no PostgreSQL
"""
import asyncio
import hashlib
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy import text

DATABASE_URL = "postgresql+asyncpg://postgres:c56d0e4d3c613eb66684@72.60.13.22:3030/aplicativos"

async def create_admin():
    engine = create_async_engine(DATABASE_URL, echo=True)
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    
    async with async_session() as session:
        # Verificar se as tabelas existem
        try:
            # Criar tabela clients se não existir
            await session.execute(text("""
                CREATE TABLE IF NOT EXISTS clients (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    name VARCHAR(255) NOT NULL,
                    slug VARCHAR(255) NOT NULL UNIQUE,
                    status VARCHAR(50) DEFAULT 'active',
                    meta_page_id VARCHAR(255),
                    meta_phone_id VARCHAR(255),
                    meta_ig_id VARCHAR(255),
                    meta_waba_id VARCHAR(255),
                    meta_access_token VARCHAR(255),
                    elevenlabs_agent_id VARCHAR(255),
                    elevenlabs_voice_id VARCHAR(255),
                    elevenlabs_api_key VARCHAR(255),
                    timezone VARCHAR(100) DEFAULT 'America/Sao_Paulo',
                    settings JSONB DEFAULT '{}',
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW()
                )
            """))
            
            # Criar tabela dashboard_users se não existir
            await session.execute(text("""
                CREATE TABLE IF NOT EXISTS dashboard_users (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    email VARCHAR(255) NOT NULL UNIQUE,
                    password_hash VARCHAR(255) NOT NULL,
                    name VARCHAR(255) NOT NULL,
                    role VARCHAR(50) NOT NULL,
                    client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
                    is_active BOOLEAN DEFAULT true,
                    email_verified BOOLEAN DEFAULT false,
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW(),
                    last_login TIMESTAMP
                )
            """))
            
            # Criar tabela sessions se não existir
            await session.execute(text("""
                CREATE TABLE IF NOT EXISTS sessions (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    user_id UUID NOT NULL REFERENCES dashboard_users(id) ON DELETE CASCADE,
                    token TEXT NOT NULL,
                    expires_at TIMESTAMP NOT NULL,
                    ip_address VARCHAR(50),
                    user_agent TEXT,
                    created_at TIMESTAMP DEFAULT NOW()
                )
            """))
            
            await session.commit()
            print("[OK] Tabelas criadas/verificadas")
            
            # Verificar se cliente existe
            result = await session.execute(text("SELECT id FROM clients WHERE slug = 'superbot-admin'"))
            client = result.fetchone()
            
            if not client:
                # Criar cliente
                await session.execute(text("""
                    INSERT INTO clients (name, slug, status)
                    VALUES ('SuperBot Admin', 'superbot-admin', 'active')
                """))
                await session.commit()
                print("[OK] Cliente SuperBot Admin criado")
            
            # Pegar client_id
            result = await session.execute(text("SELECT id FROM clients WHERE slug = 'superbot-admin'"))
            client = result.fetchone()
            client_id = client[0]
            
            # Verificar se usuário existe
            result = await session.execute(text("SELECT id FROM dashboard_users WHERE email = 'admin'"))
            user = result.fetchone()
            
            if user:
                # Atualizar senha
                password_hash = hashlib.sha256('admin123'.encode()).hexdigest()
                await session.execute(text("""
                    UPDATE dashboard_users 
                    SET password_hash = :password_hash, is_active = true
                    WHERE email = 'admin'
                """), {"password_hash": password_hash})
                print("[OK] Senha do admin atualizada")
            else:
                # Criar usuário
                password_hash = hashlib.sha256('admin123'.encode()).hexdigest()
                await session.execute(text("""
                    INSERT INTO dashboard_users (email, password_hash, name, role, client_id, is_active)
                    VALUES ('admin', :password_hash, 'Administrador', 'admin', :client_id, true)
                """), {"password_hash": password_hash, "client_id": str(client_id)})
                print("[OK] Usuário admin criado")
            
            await session.commit()
            print("\n[SUCCESS] PRONTO! Login: admin / admin123")
            
        except Exception as e:
            print(f"[ERROR] Erro: {e}")
            await session.rollback()
            raise

if __name__ == "__main__":
    asyncio.run(create_admin())
