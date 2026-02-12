"""
SuperBot Platform - Configurações centralizadas
"""
from pydantic_settings import BaseSettings, SettingsConfigDict
from functools import lru_cache
import os


class Settings(BaseSettings):
    """Configurações da aplicação carregadas do .env"""
    
    # === APIs de IA ===
    gemini_api_key: str = ""
    openrouter_api_key: str = ""
    elevenlabs_api_key: str = ""
    
    # === Meta/Facebook ===
    meta_access_token: str = ""
    meta_verify_token: str = "pacific-token"
    
    # === Banco de Dados ===
    # SQLite para desenvolvimento local, PostgreSQL para produção
    database_url: str = "sqlite+aiosqlite:///./superbot.db"
    redis_url: str = "redis://localhost:6379/0"
    
    # === API Server ===
    api_host: str = "0.0.0.0"
    api_port: int = 8000
    api_debug: bool = True
    
    # === LLM Padrão ===
    default_llm_provider: str = "gemini"  # gemini, openrouter
    default_llm_model: str = "gemini-2.0-flash"
    
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )


@lru_cache()
def get_settings() -> Settings:
    """Retorna instância cacheada das configurações."""
    return Settings()
