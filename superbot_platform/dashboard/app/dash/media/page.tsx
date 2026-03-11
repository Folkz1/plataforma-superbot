'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import {
  Edit2,
  ExternalLink,
  FileText,
  Filter,
  Image,
  Loader2,
  Music,
  Plus,
  Save,
  Search,
  Trash2,
  Upload,
  Video,
  X,
} from 'lucide-react';

interface MediaItem {
  id: string;
  media_type: 'image' | 'video' | 'audio' | 'document';
  url: string;
  filename: string;
  description: string;
  tags: string[];
  size_bytes: number;
  created_at: string;
}

interface MediaForm {
  media_type: string;
  url: string;
  filename: string;
  description: string;
  tags: string;
  size_bytes: number;
}

const MEDIA_TYPES = [
  { value: 'image', label: 'Imagem', icon: Image, color: 'text-blue-600', bg: 'bg-blue-50' },
  { value: 'video', label: 'Video', icon: Video, color: 'text-purple-600', bg: 'bg-purple-50' },
  { value: 'audio', label: 'Audio', icon: Music, color: 'text-green-600', bg: 'bg-green-50' },
  { value: 'document', label: 'Documento', icon: FileText, color: 'text-orange-600', bg: 'bg-orange-50' },
];

const EMPTY_FORM: MediaForm = {
  media_type: 'image',
  url: '',
  filename: '',
  description: '',
  tags: '',
  size_bytes: 0,
};

function getTypeConfig(type: string) {
  return MEDIA_TYPES.find((item) => item.value === type) || MEDIA_TYPES[0];
}

function formatSize(bytes: number): string {
  if (!bytes) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getApiErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'object' && error && 'response' in error) {
    const detail = (
      error as { response?: { data?: { detail?: string } } }
    ).response?.data?.detail;
    if (typeof detail === 'string' && detail.trim()) {
      return detail;
    }
  }
  return fallback;
}

export default function MediaPage() {
  const router = useRouter();

  const [tenantId, setTenantId] = useState('');
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('');

  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState<MediaForm>({ ...EMPTY_FORM });
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDesc, setEditDesc] = useState('');
  const [editTags, setEditTags] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<MediaItem | null>(null);
  const [previewTarget, setPreviewTarget] = useState<MediaItem | null>(null);

  useEffect(() => {
    const userData = localStorage.getItem('user');
    if (!userData) {
      router.push('/login');
      return;
    }

    const user = JSON.parse(userData);
    const nextTenantId =
      user.role === 'admin'
        ? localStorage.getItem('active_tenant_id')
        : user.client_id;

    if (!nextTenantId) {
      router.push(user.role === 'admin' ? '/admin' : '/login');
      return;
    }

    setTenantId(nextTenantId);
    void loadMedia(nextTenantId);
  }, [router]);

  useEffect(() => {
    if (!msg) return;
    const timer = window.setTimeout(() => setMsg(null), 4000);
    return () => window.clearTimeout(timer);
  }, [msg]);

  const loadMedia = async (nextTenantId: string) => {
    setLoading(true);
    try {
      const res = await api.get(`/api/media/${nextTenantId}`);
      setMedia(res.data?.media || []);
      setTotal(res.data?.total || 0);
    } catch {
      setMsg({ type: 'error', text: 'Erro ao carregar biblioteca de media' });
    } finally {
      setLoading(false);
    }
  };

  const filteredMedia = useMemo(() => {
    let items = media;
    if (filterType) {
      items = items.filter((item) => item.media_type === filterType);
    }
    if (search.trim()) {
      const query = search.toLowerCase();
      items = items.filter(
        (item) =>
          item.filename.toLowerCase().includes(query) ||
          item.description?.toLowerCase().includes(query)
      );
    }
    return items;
  }, [filterType, media, search]);

  const openAddModal = () => {
    setAddForm({ ...EMPTY_FORM });
    setUploadFile(null);
    setShowAddModal(true);
  };

  const handleFileSelection = (file: File | null) => {
    setUploadFile(file);
    if (!file) return;

    const inferredType = file.type.startsWith('image/')
      ? 'image'
      : file.type.startsWith('video/')
        ? 'video'
        : file.type.startsWith('audio/')
          ? 'audio'
          : 'document';

    setAddForm((current) => ({
      ...current,
      media_type: inferredType,
      filename: file.name,
      size_bytes: file.size,
    }));
  };

  const handleAdd = async () => {
    if (!tenantId) return;
    setSaving(true);

    try {
      if (uploadFile) {
        const formData = new FormData();
        formData.append('file', uploadFile);
        formData.append('description', addForm.description);
        formData.append('tags', addForm.tags);
        await api.post(`/api/media/${tenantId}/upload`, formData);
      } else {
        if (!addForm.url || !addForm.filename) {
          setMsg({ type: 'error', text: 'URL e nome do arquivo sao obrigatorios' });
          setSaving(false);
          return;
        }
        const tags = addForm.tags
          ? addForm.tags.split(',').map((tag) => tag.trim()).filter(Boolean)
          : [];
        await api.post(`/api/media/${tenantId}`, {
          media_type: addForm.media_type,
          url: addForm.url,
          filename: addForm.filename,
          description: addForm.description,
          tags,
          size_bytes: addForm.size_bytes || 0,
        });
      }

      setMsg({ type: 'success', text: 'Media adicionada com sucesso' });
      setShowAddModal(false);
      setAddForm({ ...EMPTY_FORM });
      setUploadFile(null);
      await loadMedia(tenantId);
    } catch (err: unknown) {
      setMsg({
        type: 'error',
        text: getApiErrorMessage(err, 'Erro ao adicionar media'),
      });
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (item: MediaItem) => {
    setEditingId(item.id);
    setEditDesc(item.description || '');
    setEditTags((item.tags || []).join(', '));
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditDesc('');
    setEditTags('');
  };

  const handleEdit = async () => {
    if (!editingId) return;
    setEditSaving(true);
    try {
      const tags = editTags
        ? editTags.split(',').map((tag) => tag.trim()).filter(Boolean)
        : [];
      await api.patch(`/api/media/${tenantId}/${editingId}`, {
        description: editDesc,
        tags,
      });
      setMsg({ type: 'success', text: 'Media atualizada' });
      cancelEdit();
      await loadMedia(tenantId);
    } catch (err: unknown) {
      setMsg({
        type: 'error',
        text: getApiErrorMessage(err, 'Erro ao atualizar media'),
      });
    } finally {
      setEditSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await api.delete(`/api/media/${tenantId}/${deleteTarget.id}`);
      setMsg({ type: 'success', text: `${deleteTarget.filename} removido` });
      setDeleteTarget(null);
      await loadMedia(tenantId);
    } catch (err: unknown) {
      setMsg({
        type: 'error',
        text: getApiErrorMessage(err, 'Erro ao deletar media'),
      });
    }
  };

  const renderPreview = (item: MediaItem, className: string) => {
    if (item.media_type === 'image') {
      return (
        <img
          src={item.url}
          alt={item.filename}
          className={`${className} object-cover`}
        />
      );
    }
    if (item.media_type === 'video') {
      return <video src={item.url} className={`${className} object-cover`} controls />;
    }
    if (item.media_type === 'audio') {
      return (
        <div className={`${className} bg-green-50 border border-green-100 flex items-center justify-center p-3`}>
          <audio src={item.url} controls className="w-full" />
        </div>
      );
    }
    if (item.url.toLowerCase().includes('.pdf')) {
      return (
        <iframe
          src={item.url}
          title={item.filename}
          className={`${className} bg-white`}
        />
      );
    }
    return (
      <div className={`${className} bg-orange-50 border border-orange-100 flex items-center justify-center`}>
        <FileText className="w-10 h-10 text-orange-500" />
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-blue-500" size={32} />
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center">
            <Image size={20} className="text-blue-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Biblioteca de Media</h1>
            <p className="text-sm text-gray-500">{total} arquivo(s)</p>
          </div>
        </div>
        <button
          onClick={openAddModal}
          className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
        >
          <Plus size={16} />
          Adicionar Media
        </button>
      </div>

      {msg && (
        <div className={`mb-4 p-3 rounded-lg flex items-center gap-2 text-sm ${
          msg.type === 'success'
            ? 'bg-green-50 text-green-700 border border-green-200'
            : 'bg-red-50 text-red-700 border border-red-200'
        }`}>
          {msg.text}
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[220px] relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nome ou descricao..."
              className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 rounded-lg text-sm"
            />
          </div>
          <div className="flex items-center gap-2">
            <Filter size={16} className="text-gray-400" />
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="px-4 py-2.5 bg-white border border-gray-200 rounded-lg text-sm"
            >
              <option value="">Todos os tipos</option>
              {MEDIA_TYPES.map((type) => (
                <option key={type.value} value={type.value}>{type.label}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {filteredMedia.length === 0 ? (
        <div className="text-center py-16">
          <Image size={48} className="mx-auto mb-3 text-gray-300" />
          <h3 className="text-lg font-medium text-gray-900 mb-1">Nenhuma media encontrada</h3>
          <p className="text-sm text-gray-500">Adicione arquivos para montar sua biblioteca</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredMedia.map((item) => {
            const cfg = getTypeConfig(item.media_type);
            const TypeIcon = cfg.icon;
            const isEditing = editingId === item.id;

            return (
              <div
                key={item.id}
                className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 hover:shadow-md transition"
              >
                <button
                  onClick={() => setPreviewTarget(item)}
                  className="w-full mb-3 text-left"
                >
                  {renderPreview(item, 'h-44 w-full rounded-xl border border-gray-200')}
                </button>

                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`w-10 h-10 rounded-lg ${cfg.bg} flex items-center justify-center flex-shrink-0`}>
                      <TypeIcon size={20} className={cfg.color} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate" title={item.filename}>
                        {item.filename}
                      </p>
                      <p className="text-xs text-gray-400">
                        {cfg.label} · {formatSize(item.size_bytes)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {isEditing ? (
                      <>
                        <button
                          onClick={handleEdit}
                          disabled={editSaving}
                          className="p-1.5 text-green-600 hover:bg-green-50 rounded"
                        >
                          {editSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                        </button>
                        <button
                          onClick={cancelEdit}
                          className="p-1.5 text-gray-400 hover:bg-gray-100 rounded"
                        >
                          <X size={14} />
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => startEdit(item)}
                          className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded"
                        >
                          <Edit2 size={14} />
                        </button>
                        <button
                          onClick={() => setDeleteTarget(item)}
                          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                        >
                          <Trash2 size={14} />
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {isEditing ? (
                  <div className="space-y-2 mb-3">
                    <input
                      type="text"
                      value={editDesc}
                      onChange={(e) => setEditDesc(e.target.value)}
                      placeholder="Descricao..."
                      className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
                    />
                    <input
                      type="text"
                      value={editTags}
                      onChange={(e) => setEditTags(e.target.value)}
                      placeholder="Tags (separadas por virgula)"
                      className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
                    />
                  </div>
                ) : (
                  <>
                    {item.description && (
                      <p className="text-sm text-gray-600 mb-3 line-clamp-2">{item.description}</p>
                    )}
                    {item.tags?.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mb-3">
                        {item.tags.map((tag, index) => (
                          <span
                            key={`${item.id}-${tag}-${index}`}
                            className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600 border border-gray-200"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </>
                )}

                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-blue-500 hover:underline truncate"
                >
                  <ExternalLink size={12} />
                  {item.url}
                </a>

                <p className="text-xs text-gray-400 mt-2">
                  {item.created_at
                    ? new Date(item.created_at).toLocaleDateString('pt-BR', {
                        day: '2-digit',
                        month: '2-digit',
                        year: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    : '-'}
                </p>
              </div>
            );
          })}
        </div>
      )}

      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl">
            <div className="flex items-center justify-between p-4 border-b">
              <h2 className="text-lg font-bold">Adicionar Media</h2>
              <button onClick={() => setShowAddModal(false)} className="p-1 hover:bg-gray-100 rounded">
                <X size={18} />
              </button>
            </div>

            <div className="p-4 space-y-4">
              <div className="rounded-xl border border-dashed border-blue-200 bg-blue-50/50 p-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Upload de arquivo
                </label>
                <input
                  type="file"
                  onChange={(e) => handleFileSelection(e.target.files?.[0] || null)}
                  className="block w-full text-sm text-gray-600"
                />
                {uploadFile && (
                  <p className="mt-2 text-xs text-gray-500">
                    {uploadFile.name} · {formatSize(uploadFile.size)}
                  </p>
                )}
              </div>

              <div className="text-xs uppercase tracking-wide text-gray-400">Ou adicionar por URL</div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <select
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  value={addForm.media_type}
                  onChange={(e) =>
                    setAddForm((current) => ({ ...current, media_type: e.target.value }))
                  }
                >
                  {MEDIA_TYPES.map((type) => (
                    <option key={type.value} value={type.value}>{type.label}</option>
                  ))}
                </select>
                <input
                  type="text"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  placeholder="Nome do arquivo"
                  value={addForm.filename}
                  onChange={(e) =>
                    setAddForm((current) => ({ ...current, filename: e.target.value }))
                  }
                />
              </div>

              <input
                type="url"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                placeholder="https://example.com/arquivo.jpg"
                value={addForm.url}
                onChange={(e) => setAddForm((current) => ({ ...current, url: e.target.value }))}
                disabled={Boolean(uploadFile)}
              />

              <textarea
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none"
                rows={3}
                placeholder="Descricao do arquivo..."
                value={addForm.description}
                onChange={(e) =>
                  setAddForm((current) => ({ ...current, description: e.target.value }))
                }
              />

              <input
                type="text"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                placeholder="Tags (separadas por virgula)"
                value={addForm.tags}
                onChange={(e) => setAddForm((current) => ({ ...current, tags: e.target.value }))}
              />
            </div>

            <div className="flex justify-end gap-2 p-4 border-t">
              <button
                onClick={() => setShowAddModal(false)}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
              >
                Cancelar
              </button>
              <button
                onClick={handleAdd}
                disabled={saving}
                className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                Adicionar
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Confirmar exclusao</h3>
            <p className="text-sm text-gray-600 mb-6">
              Tem certeza que deseja excluir <strong>{deleteTarget.filename}</strong>?
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
              >
                Cancelar
              </button>
              <button
                onClick={handleDelete}
                className="px-4 py-2 text-sm text-white bg-red-600 rounded-lg hover:bg-red-700"
              >
                Excluir
              </button>
            </div>
          </div>
        </div>
      )}

      {previewTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-4xl bg-white rounded-2xl shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b">
              <div>
                <h3 className="text-base font-semibold text-gray-900">{previewTarget.filename}</h3>
                <p className="text-sm text-gray-500">{previewTarget.description || 'Sem descricao'}</p>
              </div>
              <button onClick={() => setPreviewTarget(null)} className="p-2 hover:bg-gray-100 rounded-lg">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4">
              {renderPreview(previewTarget, 'max-h-[70vh] w-full rounded-xl border border-gray-200')}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
