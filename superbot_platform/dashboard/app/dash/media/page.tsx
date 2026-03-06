'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import {
  Image, Video, Music, FileText, Plus, Trash2, Search,
  Edit2, Save, X, Loader2, Filter,
} from 'lucide-react';

// ─── Types ─────────────────────────────────────────────────

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
  return MEDIA_TYPES.find(t => t.value === type) || MEDIA_TYPES[0];
}

function formatSize(bytes: number): string {
  if (!bytes) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── Component ─────────────────────────────────────────────

export default function MediaPage() {
  const router = useRouter();
  const [tenantId, setTenantId] = useState('');
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('');

  // Add modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState<MediaForm>({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);

  // Inline edit
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDesc, setEditDesc] = useState('');
  const [editTags, setEditTags] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  // Delete
  const [deleteTarget, setDeleteTarget] = useState<MediaItem | null>(null);

  // ─── Init ──────────────────────────────────────────────

  useEffect(() => {
    const userData = localStorage.getItem('user');
    if (!userData) { router.push('/login'); return; }
    const user = JSON.parse(userData);

    const tId = user.role === 'admin'
      ? localStorage.getItem('active_tenant_id')
      : user.client_id;

    if (!tId) {
      router.push(user.role === 'admin' ? '/admin' : '/login');
      return;
    }

    setTenantId(tId);
    loadMedia(tId);
  }, [router]);

  useEffect(() => {
    if (msg) {
      const t = setTimeout(() => setMsg(null), 4000);
      return () => clearTimeout(t);
    }
  }, [msg]);

  // ─── Data ──────────────────────────────────────────────

  const loadMedia = useCallback(async (tId: string) => {
    setLoading(true);
    try {
      const res = await api.get(`/api/media/${tId}`);
      setMedia(res.data.media || []);
      setTotal(res.data.total || 0);
    } catch (err) {
      console.error('Erro ao carregar media:', err);
      setMsg({ type: 'error', text: 'Erro ao carregar biblioteca de media' });
    } finally {
      setLoading(false);
    }
  }, []);

  // ─── Filtered ──────────────────────────────────────────

  const filteredMedia = useMemo(() => {
    let list = media;
    if (filterType) {
      list = list.filter(m => m.media_type === filterType);
    }
    if (search.trim()) {
      const s = search.toLowerCase();
      list = list.filter(m =>
        m.filename.toLowerCase().includes(s) ||
        m.description?.toLowerCase().includes(s)
      );
    }
    return list;
  }, [media, filterType, search]);

  // ─── Add ──────────────────────────────────────────────

  const handleAdd = async () => {
    if (!addForm.url || !addForm.filename) {
      setMsg({ type: 'error', text: 'URL e nome do arquivo sao obrigatorios' });
      return;
    }
    setSaving(true);
    try {
      const tags = addForm.tags
        ? addForm.tags.split(',').map(t => t.trim()).filter(Boolean)
        : [];
      await api.post(`/api/media/${tenantId}`, {
        media_type: addForm.media_type,
        url: addForm.url,
        filename: addForm.filename,
        description: addForm.description,
        tags,
        size_bytes: addForm.size_bytes || 0,
      });
      setMsg({ type: 'success', text: 'Media adicionada com sucesso' });
      setShowAddModal(false);
      setAddForm({ ...EMPTY_FORM });
      await loadMedia(tenantId);
    } catch (e: any) {
      setMsg({ type: 'error', text: e?.response?.data?.detail || 'Erro ao adicionar media' });
    } finally {
      setSaving(false);
    }
  };

  // ─── Edit ──────────────────────────────────────────────

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
        ? editTags.split(',').map(t => t.trim()).filter(Boolean)
        : [];
      await api.patch(`/api/media/${tenantId}/${editingId}`, {
        description: editDesc,
        tags,
      });
      setMsg({ type: 'success', text: 'Media atualizada' });
      cancelEdit();
      await loadMedia(tenantId);
    } catch (e: any) {
      setMsg({ type: 'error', text: e?.response?.data?.detail || 'Erro ao atualizar media' });
    } finally {
      setEditSaving(false);
    }
  };

  // ─── Delete ──────────────────────────────────────────

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await api.delete(`/api/media/${tenantId}/${deleteTarget.id}`);
      setMsg({ type: 'success', text: `${deleteTarget.filename} removido` });
      setDeleteTarget(null);
      await loadMedia(tenantId);
    } catch (e: any) {
      setMsg({ type: 'error', text: e?.response?.data?.detail || 'Erro ao deletar media' });
    }
  };

  // ─── Render ──────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-blue-500" size={32} />
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8">
      {/* Header */}
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
          onClick={() => { setAddForm({ ...EMPTY_FORM }); setShowAddModal(true); }}
          className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
        >
          <Plus size={16} />
          Adicionar Media
        </button>
      </div>

      {/* Messages */}
      {msg && (
        <div className={`mb-4 p-3 rounded-lg flex items-center gap-2 text-sm ${
          msg.type === 'success'
            ? 'bg-green-50 text-green-700 border border-green-200'
            : 'bg-red-50 text-red-700 border border-red-200'
        }`}>
          {msg.text}
        </div>
      )}

      {/* Filters */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[220px] relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nome ou descricao..."
              className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="flex items-center gap-2">
            <Filter size={16} className="text-gray-400" />
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="px-4 py-2.5 bg-white border border-gray-200 rounded-lg text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Todos os tipos</option>
              {MEDIA_TYPES.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Media Grid */}
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
                {/* Header */}
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
                        {cfg.label} &middot; {formatSize(item.size_bytes)}
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
                          title="Salvar"
                        >
                          {editSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                        </button>
                        <button
                          onClick={cancelEdit}
                          className="p-1.5 text-gray-400 hover:bg-gray-100 rounded"
                          title="Cancelar"
                        >
                          <X size={14} />
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => startEdit(item)}
                          className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded"
                          title="Editar"
                        >
                          <Edit2 size={14} />
                        </button>
                        <button
                          onClick={() => setDeleteTarget(item)}
                          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                          title="Deletar"
                        >
                          <Trash2 size={14} />
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Description */}
                {isEditing ? (
                  <div className="space-y-2 mb-3">
                    <input
                      type="text"
                      value={editDesc}
                      onChange={(e) => setEditDesc(e.target.value)}
                      placeholder="Descricao..."
                      className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <input
                      type="text"
                      value={editTags}
                      onChange={(e) => setEditTags(e.target.value)}
                      placeholder="Tags (separadas por virgula)"
                      className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                ) : (
                  <>
                    {item.description && (
                      <p className="text-sm text-gray-600 mb-3 line-clamp-2">{item.description}</p>
                    )}
                  </>
                )}

                {/* Tags */}
                {!isEditing && item.tags && item.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {item.tags.map((tag, idx) => (
                      <span
                        key={idx}
                        className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600 border border-gray-200"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}

                {/* URL */}
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-blue-500 hover:underline truncate block"
                  title={item.url}
                >
                  {item.url}
                </a>

                {/* Date */}
                <p className="text-xs text-gray-400 mt-2">
                  {item.created_at
                    ? new Date(item.created_at).toLocaleDateString('pt-BR', {
                        day: '2-digit', month: '2-digit', year: '2-digit',
                        hour: '2-digit', minute: '2-digit',
                      })
                    : '-'}
                </p>
              </div>
            );
          })}
        </div>
      )}

      {/* Add Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4">
            <div className="flex items-center justify-between p-4 border-b">
              <h2 className="text-lg font-bold">Adicionar Media</h2>
              <button onClick={() => setShowAddModal(false)} className="p-1 hover:bg-gray-100 rounded">
                <X size={18} />
              </button>
            </div>

            <div className="p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tipo</label>
                <select
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  value={addForm.media_type}
                  onChange={e => setAddForm(f => ({ ...f, media_type: e.target.value }))}
                >
                  {MEDIA_TYPES.map(t => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">URL</label>
                <input
                  type="url"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  placeholder="https://example.com/arquivo.jpg"
                  value={addForm.url}
                  onChange={e => setAddForm(f => ({ ...f, url: e.target.value }))}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nome do arquivo</label>
                <input
                  type="text"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  placeholder="foto-produto.jpg"
                  value={addForm.filename}
                  onChange={e => setAddForm(f => ({ ...f, filename: e.target.value }))}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Descricao</label>
                <textarea
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none"
                  rows={3}
                  placeholder="Descricao do arquivo..."
                  value={addForm.description}
                  onChange={e => setAddForm(f => ({ ...f, description: e.target.value }))}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tags (separadas por virgula)</label>
                <input
                  type="text"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  placeholder="produto, marketing, banner"
                  value={addForm.tags}
                  onChange={e => setAddForm(f => ({ ...f, tags: e.target.value }))}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tamanho (bytes)</label>
                <input
                  type="number"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  placeholder="0"
                  value={addForm.size_bytes || ''}
                  onChange={e => setAddForm(f => ({ ...f, size_bytes: parseInt(e.target.value) || 0 }))}
                />
              </div>
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
                {saving && <Loader2 size={14} className="animate-spin" />}
                Adicionar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm mx-4 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Confirmar exclusao</h3>
            <p className="text-sm text-gray-600 mb-1">
              Tem certeza que deseja excluir <strong>{deleteTarget.filename}</strong>?
            </p>
            <p className="text-xs text-gray-400 mb-6">
              Esta acao nao pode ser desfeita.
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
    </div>
  );
}
