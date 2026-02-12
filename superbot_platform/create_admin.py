"""
Script para criar usuário admin no dashboard.
Execute: python create_admin.py
"""
import asyncio
import hashlib
from app.db.database import async_session
from app.db.models import DashboardUser, Client
import uuid

def simple_hash(password: str) -> str:
    """Hash simples para dev."""
    return hashlib.sha256(password.encode()).hexdigest()

async def create_admin():
    async with async_session() as db:
        try:
            # Criar cliente com slug
            client = Client(
                id=str(uuid.uuid4()),
                name='SuperBot Admin',
                slug='superbot-admin'
            )
            db.add(client)
            await db.flush()
            
            # Criar usuario admin - usando hash simples para dev
            user = DashboardUser(
                id=str(uuid.uuid4()),
                email='admin',
                password_hash=simple_hash('admin123'),
                name='Administrador',
                role='admin',
                client_id=client.id,
                is_active=True
            )
            db.add(user)
            await db.commit()
            print('=' * 40)
            print('Usuario admin criado com sucesso!')
            print('=' * 40)
            print(f'Login: admin')
            print(f'Senha: admin123')
            print('=' * 40)
        except Exception as e:
            print(f'Erro: {e}')
            await db.rollback()
            raise

if __name__ == "__main__":
    asyncio.run(create_admin())
