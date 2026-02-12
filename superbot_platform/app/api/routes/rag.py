"""
RAG (Knowledge Base) management routes
"""
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
import httpx
import os

from app.db.database import get_db
from app.db.models import DashboardUser
from app.api.routes.auth import get_current_user
from app.core.tenancy import resolve_project_id_for_user

router = APIRouter(prefix="/api/rag", tags=["rag"])

# n8n webhook URL
N8N_BASE_URL = os.getenv("N8N_BASE_URL", "https://n8n.superbot.digital")
RAG_INGEST_WEBHOOK = f"{N8N_BASE_URL}/webhook/rag-ingest"


# Schemas
class DocumentUpload(BaseModel):
    project_id: str
    content: str
    title: str
    source: str = "DASHBOARD"


class DocumentResponse(BaseModel):
    id: str
    project_id: str
    content: str
    metadata: dict
    created_at: datetime
    
    class Config:
        from_attributes = True


class IngestResponse(BaseModel):
    success: bool
    chunks_created: int
    ids: List[str]
    message: str


async def resolve_project_id(project_id: str, current_user: DashboardUser, db: AsyncSession) -> str:
    return await resolve_project_id_for_user(project_id, current_user, db)


# Routes
@router.post("/ingest", response_model=IngestResponse)
async def ingest_document(
    data: DocumentUpload,
    db: AsyncSession = Depends(get_db),
    current_user: DashboardUser = Depends(get_current_user)
):
    """
    Ingest document into RAG via n8n webhook
    The webhook will chunk, embed, and store in PostgreSQL
    """
    resolved_project_id = await resolve_project_id(data.project_id, current_user, db)
    
    # Prepare payload for n8n
    payload = {
        "project_id": resolved_project_id,
        "content": data.content,
        "metadata": {
            "title": data.title,
            "source": data.source,
            "uploaded_by": current_user.email,
            "uploaded_at": datetime.utcnow().isoformat()
        }
    }
    
    # Call n8n webhook
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(RAG_INGEST_WEBHOOK, json=payload)
            response.raise_for_status()
            result = response.json()
        
        return {
            "success": result.get("success", True),
            "chunks_created": result.get("chunks_created", 0),
            "ids": result.get("ids", []),
            "message": f"Documento '{data.title}' processado com sucesso!"
        }
    
    except httpx.HTTPError as e:
        raise HTTPException(
            status_code=500,
            detail=f"Erro ao processar documento: {str(e)}"
        )


@router.post("/ingest/file")
async def ingest_file(
    project_id: str,
    title: str,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: DashboardUser = Depends(get_current_user)
):
    """
    Upload and ingest a file (txt, md, etc)
    """
    resolved_project_id = await resolve_project_id(project_id, current_user, db)
    
    # Read file content
    content = await file.read()
    
    # Decode based on file type
    try:
        text_content = content.decode('utf-8')
    except UnicodeDecodeError:
        raise HTTPException(
            status_code=400,
            detail="Arquivo deve ser texto UTF-8 (.txt, .md, etc)"
        )
    
    # Ingest via webhook
    payload = {
        "project_id": resolved_project_id,
        "content": text_content,
        "metadata": {
            "title": title,
            "source": "FILE_UPLOAD",
            "filename": file.filename,
            "uploaded_by": current_user.email,
            "uploaded_at": datetime.utcnow().isoformat()
        }
    }
    
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(RAG_INGEST_WEBHOOK, json=payload)
            response.raise_for_status()
            result = response.json()
        
        return {
            "success": result.get("success", True),
            "chunks_created": result.get("chunks_created", 0),
            "ids": result.get("ids", []),
            "message": f"Arquivo '{file.filename}' processado com sucesso!"
        }
    
    except httpx.HTTPError as e:
        raise HTTPException(
            status_code=500,
            detail=f"Erro ao processar arquivo: {str(e)}"
        )


@router.get("/documents/{project_id}")
async def list_documents(
    project_id: str,
    limit: int = 100,
    db: AsyncSession = Depends(get_db),
    current_user: DashboardUser = Depends(get_current_user)
):
    """
    List all RAG chunks for a project
    """
    resolved_project_id = await resolve_project_id(project_id, current_user, db)

    # Query project_knowledge_base table
    query = text("""
        SELECT
            id,
            project_id,
            content,
            metadata,
            created_at
        FROM project_knowledge_base
        WHERE project_id = (:project_id)::uuid
        ORDER BY created_at DESC
        LIMIT :limit
    """)

    result = await db.execute(query, {"project_id": resolved_project_id, "limit": limit})
    rows = result.fetchall()

    documents = []
    for row in rows:
        documents.append({
            "id": str(row[0]),
            "project_id": str(row[1]),
            "content": row[2],
            "metadata": row[3],
            "created_at": row[4]
        })

    return documents


@router.delete("/documents/{project_id}/{document_id}")
async def delete_document(
    project_id: str,
    document_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: DashboardUser = Depends(get_current_user)
):
    """
    Delete a RAG chunk
    """
    resolved_project_id = await resolve_project_id(project_id, current_user, db)

    query = text("""
        DELETE FROM project_knowledge_base
        WHERE id = (:document_id)::uuid AND project_id = (:project_id)::uuid
    """)

    result = await db.execute(query, {"document_id": document_id, "project_id": resolved_project_id})
    await db.flush()

    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Documento não encontrado")

    return {"success": True, "message": "Documento removido"}


@router.post("/query/{project_id}")
async def query_rag(
    project_id: str,
    query: str,
    limit: int = 5,
    db: AsyncSession = Depends(get_db),
    current_user: DashboardUser = Depends(get_current_user)
):
    """
    Test RAG query (for debugging)
    This would typically be called by the AI agent, not directly
    """
    resolved_project_id = await resolve_project_id(project_id, current_user, db)

    query_sql = text("""
        SELECT
            id,
            content,
            metadata,
            created_at
        FROM project_knowledge_base
        WHERE project_id = (:project_id)::uuid
        AND content ILIKE :search
        ORDER BY created_at DESC
        LIMIT :limit
    """)

    result = await db.execute(
        query_sql,
        {
            "project_id": resolved_project_id,
            "search": f"%{query}%",
            "limit": limit
        }
    )
    rows = result.fetchall()

    results = []
    for row in rows:
        results.append({
            "id": str(row[0]),
            "content": row[1],
            "metadata": row[2],
            "created_at": row[3]
        })

    return {
        "query": query,
        "results": results,
        "count": len(results)
    }
