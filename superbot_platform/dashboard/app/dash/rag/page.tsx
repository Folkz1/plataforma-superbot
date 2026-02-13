'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { 
  Upload, FileText, Trash2, Search, BookOpen, 
  AlertCircle, CheckCircle, Loader2 
} from 'lucide-react';

interface Document {
  id: string;
  content: string;
  metadata: {
    title: string;
    source: string;
    chunk_index?: number;
    total_chunks?: number;
  };
  created_at: string;
}

export default function RAGManagementPage() {
  const router = useRouter();
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [tenantId, setTenantId] = useState<string>('');
  const [tenantName, setTenantName] = useState<string>('');
  
  // Form states
  const [textContent, setTextContent] = useState('');
  const [title, setTitle] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploadMode, setUploadMode] = useState<'text' | 'file'>('text');
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  useEffect(() => {
    const userData = localStorage.getItem('user');
    if (!userData) {
      router.push('/login');
      return;
    }

    const parsedUser = JSON.parse(userData);
    setUser(parsedUser);

    const tId = parsedUser.role === 'admin'
      ? localStorage.getItem('active_tenant_id')
      : parsedUser.client_id;

    const name = parsedUser.role === 'admin'
      ? (localStorage.getItem('active_tenant_name') || '')
      : (parsedUser.client_name || '');

    setTenantName(name);

    if (!tId) {
      router.push(parsedUser.role === 'admin' ? '/admin' : '/login');
      return;
    }

    setTenantId(tId);
    loadDocuments(tId);
  }, [router]);

  const loadDocuments = async (projectId: string) => {
    try {
      const response = await api.get(`/api/rag/documents/${projectId}`);
      setDocuments(response.data);
    } catch (error) {
      console.error('Erro ao carregar documentos:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleTextUpload = async () => {
    if (!textContent || !title) {
      setMessage({ type: 'error', text: 'Preencha título e conteúdo' });
      return;
    }

    setUploading(true);
    setMessage(null);

    try {
      const response = await api.post('/api/rag/ingest', {
        project_id: tenantId,
        content: textContent,
        title: title,
        source: 'DASHBOARD'
      });

      setMessage({ 
        type: 'success', 
        text: `✅ ${response.data.chunks_created} chunks criados!` 
      });
      
      // Clear form
      setTextContent('');
      setTitle('');
      
      // Reload documents
      await loadDocuments(tenantId);
    } catch (error: any) {
      setMessage({ 
        type: 'error', 
        text: error.response?.data?.detail || 'Erro ao processar documento' 
      });
    } finally {
      setUploading(false);
    }
  };

  const handleFileUpload = async () => {
    if (!file || !title) {
      setMessage({ type: 'error', text: 'Selecione um arquivo e preencha o título' });
      return;
    }

    setUploading(true);
    setMessage(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('project_id', tenantId);
      formData.append('title', title);

      const response = await api.post('/api/rag/ingest/file', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });

      setMessage({ 
        type: 'success', 
        text: `✅ ${response.data.chunks_created} chunks criados!` 
      });
      
      // Clear form
      setFile(null);
      setTitle('');
      
      // Reload documents
      await loadDocuments(tenantId);
    } catch (error: any) {
      setMessage({ 
        type: 'error', 
        text: error.response?.data?.detail || 'Erro ao processar arquivo' 
      });
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (docId: string) => {
    if (!confirm('Remover este chunk?')) return;

    try {
      await api.delete(`/api/rag/documents/${tenantId}/${docId}`);
      setMessage({ type: 'success', text: 'Chunk removido' });
      await loadDocuments(tenantId);
    } catch (error) {
      setMessage({ type: 'error', text: 'Erro ao remover chunk' });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Base de Conhecimento</h1>
        <p className="text-sm text-gray-500 mt-1">RAG - Gerenciar documentos e conhecimento</p>
      </div>

      <div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Upload Panel */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">
                Adicionar Documento
              </h2>

              {/* Mode Toggle */}
              <div className="flex gap-2 mb-4">
                <button
                  onClick={() => setUploadMode('text')}
                  className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition ${
                    uploadMode === 'text'
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  Texto
                </button>
                <button
                  onClick={() => setUploadMode('file')}
                  className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition ${
                    uploadMode === 'file'
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  Arquivo
                </button>
              </div>

              {/* Title Input */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Título
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white text-gray-900"
                  placeholder="Ex: Procedimentos Dentários"
                />
              </div>

              {/* Text Mode */}
              {uploadMode === 'text' && (
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Conteúdo
                  </label>
                  <textarea
                    value={textContent}
                    onChange={(e) => setTextContent(e.target.value)}
                    rows={10}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm bg-white text-gray-900"
                    placeholder="Cole o texto aqui..."
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Suporta Markdown. Será dividido automaticamente em chunks.
                  </p>
                </div>
              )}

              {/* File Mode */}
              {uploadMode === 'file' && (
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Arquivo (.txt, .md)
                  </label>
                  <input
                    type="file"
                    accept=".txt,.md"
                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900"
                  />
                  {file && (
                    <p className="text-xs text-gray-600 mt-1">
                      📄 {file.name} ({(file.size / 1024).toFixed(1)} KB)
                    </p>
                  )}
                </div>
              )}

              {/* Upload Button */}
              <button
                onClick={uploadMode === 'text' ? handleTextUpload : handleFileUpload}
                disabled={uploading}
                className="w-full flex items-center justify-center gap-2 bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {uploading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Processando...
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4" />
                    Adicionar
                  </>
                )}
              </button>

              {/* Message */}
              {message && (
                <div className={`mt-4 p-3 rounded-lg flex items-start gap-2 ${
                  message.type === 'success'
                    ? 'bg-green-50 border border-green-200'
                    : 'bg-red-50 border border-red-200'
                }`}>
                  {message.type === 'success' ? (
                    <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                  )}
                  <p className={`text-sm ${
                    message.type === 'success' ? 'text-green-800' : 'text-red-800'
                  }`}>
                    {message.text}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Documents List */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-lg shadow">
              <div className="px-6 py-4 border-b flex justify-between items-center">
                <h2 className="text-lg font-semibold text-gray-900">
                  Documentos ({documents.length} chunks)
                </h2>
                <Search className="w-5 h-5 text-gray-400" />
              </div>

              <div className="divide-y divide-gray-200 max-h-[600px] overflow-y-auto">
                {documents.map((doc) => (
                  <div key={doc.id} className="px-6 py-4 hover:bg-gray-50">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <FileText className="w-4 h-4 text-blue-600 flex-shrink-0" />
                          <h3 className="font-medium text-gray-900 truncate">
                            {doc.metadata.title}
                          </h3>
                          {doc.metadata.chunk_index !== undefined && (
                            <span className="text-xs text-gray-500 flex-shrink-0">
                              Chunk {doc.metadata.chunk_index + 1}/{doc.metadata.total_chunks}
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-gray-600 line-clamp-2">
                          {doc.content}
                        </p>
                        <p className="text-xs text-gray-500 mt-1">
                          {new Date(doc.created_at).toLocaleString('pt-BR')}
                        </p>
                      </div>
                      <button
                        onClick={() => handleDelete(doc.id)}
                        className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition flex-shrink-0"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}

                {documents.length === 0 && (
                  <div className="px-6 py-12 text-center">
                    <BookOpen className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                    <p className="text-gray-600">
                      Nenhum documento na base de conhecimento
                    </p>
                    <p className="text-sm text-gray-500 mt-1">
                      Adicione documentos para melhorar as respostas do agente
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
