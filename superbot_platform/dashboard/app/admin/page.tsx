'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import {
  Plus, Edit, Trash2, Users, BarChart3, X, Bot,
  Link2, Copy, CheckCircle, AlertCircle, Loader2, LogOut
} from 'lucide-react';

interface Client {
  id: string;
  name: string;
  slug: string;
  status: string;
  timezone: string;
  meta_page_id?: string;
  meta_phone_id?: string;
  meta_ig_id?: string;
  meta_waba_id?: string;
  elevenlabs_agent_id?: string;
  elevenlabs_voice_id?: string;
  elevenlabs_api_key?: string;
  settings?: { project_id?: string };
  created_at: string;
}

interface ModalData {
  name: string;
  slug: string;
  timezone: string;
  status: string;
  meta_page_id: string;
  meta_phone_id: string;
  meta_ig_id: string;
  meta_waba_id: string;
  meta_access_token: string;
  elevenlabs_agent_id: string;
  elevenlabs_voice_id: string;
  elevenlabs_api_key: string;
  project_id: string;
}

const emptyModal: ModalData = {
  name: '', slug: '', timezone: 'America/Sao_Paulo', status: 'active',
  meta_page_id: '', meta_phone_id: '', meta_ig_id: '', meta_waba_id: '', meta_access_token: '',
  elevenlabs_agent_id: '', elevenlabs_voice_id: '', elevenlabs_api_key: '',
  project_id: '',
};

const timezones = [
  'America/Sao_Paulo', 'America/Manaus', 'America/Bahia',
  'America/Fortaleza', 'America/Recife', 'America/Belem',
  'America/Cuiaba', 'America/Porto_Velho', 'America/Rio_Branco',
  'America/New_York', 'America/Chicago', 'America/Los_Angeles',
  'Europe/Lisbon', 'Europe/London', 'UTC',
];

export default function AdminDashboard() {
  const router = useRouter();
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<any>(null);

  // Modal
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [modalData, setModalData] = useState<ModalData>(emptyModal);
  const [activeTab, setActiveTab] = useState<'geral' | 'meta' | 'elevenlabs' | 'settings'>('geral');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Delete confirm
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // Portal link
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    const userData = localStorage.getItem('user');
    if (!userData) { router.push('/login'); return; }
    const parsedUser = JSON.parse(userData);
    if (parsedUser.role !== 'admin') { router.push('/dash'); return; }
    setUser(parsedUser);
    loadClients();
  }, [router]);

  const loadClients = async () => {
    try {
      const response = await api.get('/api/clients');
      setClients(response.data);
    } catch (error) {
      console.error('Erro ao carregar clientes:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('active_tenant_id');
    localStorage.removeItem('active_tenant_name');
    router.push('/login');
  };

  const handleOpenDashboard = (client: Client) => {
    localStorage.setItem('active_tenant_id', client.id);
    localStorage.setItem('active_tenant_name', client.name);
    router.push('/dash');
  };

  const slugify = (text: string) =>
    text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

  const openCreateModal = () => {
    setEditingId(null);
    setModalData({ ...emptyModal });
    setActiveTab('geral');
    setMessage(null);
    setShowModal(true);
  };

  const openEditModal = async (client: Client) => {
    setEditingId(client.id);
    setActiveTab('geral');
    setMessage(null);

    // Load full client data
    try {
      const res = await api.get(`/api/clients/${client.id}`);
      const c = res.data;
      setModalData({
        name: c.name || '',
        slug: c.slug || '',
        timezone: c.timezone || 'America/Sao_Paulo',
        status: c.status || 'active',
        meta_page_id: c.meta_page_id || '',
        meta_phone_id: c.meta_phone_id || '',
        meta_ig_id: c.meta_ig_id || '',
        meta_waba_id: c.meta_waba_id || '',
        meta_access_token: '',
        elevenlabs_agent_id: c.elevenlabs_agent_id || '',
        elevenlabs_voice_id: c.elevenlabs_voice_id || '',
        elevenlabs_api_key: '',
        project_id: c.settings?.project_id || '',
      });
    } catch {
      setModalData({
        ...emptyModal,
        name: client.name,
        slug: client.slug,
        timezone: client.timezone,
        status: client.status,
      });
    }
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!modalData.name || !modalData.slug) {
      setMessage({ type: 'error', text: 'Nome e slug sao obrigatorios' });
      return;
    }
    setSaving(true);
    setMessage(null);

    try {
      if (editingId) {
        // Update
        const payload: any = {
          name: modalData.name,
          status: modalData.status,
          timezone: modalData.timezone,
        };
        if (modalData.meta_page_id) payload.meta_page_id = modalData.meta_page_id;
        if (modalData.meta_phone_id) payload.meta_phone_id = modalData.meta_phone_id;
        if (modalData.meta_ig_id) payload.meta_ig_id = modalData.meta_ig_id;
        if (modalData.meta_waba_id) payload.meta_waba_id = modalData.meta_waba_id;
        if (modalData.meta_access_token) payload.meta_access_token = modalData.meta_access_token;
        if (modalData.elevenlabs_agent_id) payload.elevenlabs_agent_id = modalData.elevenlabs_agent_id;
        if (modalData.elevenlabs_voice_id) payload.elevenlabs_voice_id = modalData.elevenlabs_voice_id;
        if (modalData.elevenlabs_api_key) payload.elevenlabs_api_key = modalData.elevenlabs_api_key;
        if (modalData.project_id) payload.settings = { project_id: modalData.project_id };

        await api.patch(`/api/clients/${editingId}`, payload);
        setMessage({ type: 'success', text: 'Cliente atualizado!' });
      } else {
        // Create
        await api.post('/api/clients', {
          name: modalData.name,
          slug: modalData.slug,
          timezone: modalData.timezone,
          meta_page_id: modalData.meta_page_id || undefined,
          meta_phone_id: modalData.meta_phone_id || undefined,
          meta_ig_id: modalData.meta_ig_id || undefined,
          meta_waba_id: modalData.meta_waba_id || undefined,
          meta_access_token: modalData.meta_access_token || undefined,
          elevenlabs_agent_id: modalData.elevenlabs_agent_id || undefined,
          elevenlabs_voice_id: modalData.elevenlabs_voice_id || undefined,
          elevenlabs_api_key: modalData.elevenlabs_api_key || undefined,
        });
        setMessage({ type: 'success', text: 'Cliente criado!' });
      }
      await loadClients();
      setTimeout(() => setShowModal(false), 800);
    } catch (error: any) {
      setMessage({ type: 'error', text: error.response?.data?.detail || 'Erro ao salvar' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (clientId: string) => {
    try {
      await api.delete(`/api/clients/${clientId}`);
      setDeleteId(null);
      await loadClients();
    } catch (error: any) {
      alert(error.response?.data?.detail || 'Erro ao excluir');
    }
  };

  const handleGeneratePortal = async (client: Client) => {
    const projectId = client.settings?.project_id;
    if (!projectId) {
      alert('Este cliente não tem project_id configurado. Edite o cliente e preencha em Settings.');
      return;
    }
    try {
      const res = await api.post('/api/live/create-portal', { project_id: projectId });
      const token = res.data.token;
      const portalUrl = `${window.location.origin}/live/${token}`;
      await navigator.clipboard.writeText(portalUrl);
      setCopiedId(client.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (error: any) {
      const detail = error.response?.data?.detail;
      alert(typeof detail === 'string' ? detail : 'Erro ao gerar portal');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  const activeClients = clients.filter(c => c.status === 'active').length;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-gray-900 text-white shadow-lg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
                <Bot className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-lg font-bold">SuperBot Admin</h1>
                <p className="text-xs text-gray-400">Gerenciamento de Clientes</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-sm text-gray-300">{user?.name || user?.email}</span>
              <button onClick={handleLogout} className="p-2 hover:bg-gray-800 rounded-lg transition" title="Sair">
                <LogOut className="w-4 h-4 text-gray-400" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Total Clientes</p>
                <p className="text-3xl font-bold text-gray-900 mt-1">{clients.length}</p>
              </div>
              <div className="w-12 h-12 bg-blue-50 rounded-xl flex items-center justify-center">
                <Users className="w-6 h-6 text-blue-600" />
              </div>
            </div>
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Ativos</p>
                <p className="text-3xl font-bold text-green-600 mt-1">{activeClients}</p>
              </div>
              <div className="w-12 h-12 bg-green-50 rounded-xl flex items-center justify-center">
                <div className="w-4 h-4 bg-green-500 rounded-full"></div>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Inativos</p>
                <p className="text-3xl font-bold text-gray-400 mt-1">{clients.length - activeClients}</p>
              </div>
              <div className="w-12 h-12 bg-gray-50 rounded-xl flex items-center justify-center">
                <div className="w-4 h-4 bg-gray-400 rounded-full"></div>
              </div>
            </div>
          </div>
        </div>

        {/* Clients Table */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100">
          <div className="px-6 py-4 border-b flex justify-between items-center">
            <h2 className="text-lg font-semibold text-gray-900">Clientes</h2>
            <button
              onClick={openCreateModal}
              className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition text-sm font-medium"
            >
              <Plus className="w-4 h-4" />
              Novo Cliente
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Nome</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Slug</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Timezone</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Criado em</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Acoes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {clients.map((client) => (
                  <tr key={client.id} className="hover:bg-gray-50 transition">
                    <td className="px-6 py-4">
                      <div className="text-sm font-medium text-gray-900">{client.name}</div>
                    </td>
                    <td className="px-6 py-4">
                      <code className="text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded">{client.slug}</code>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2.5 py-1 text-xs font-medium rounded-full ${
                        client.status === 'active'
                          ? 'bg-green-50 text-green-700 border border-green-200'
                          : 'bg-gray-50 text-gray-600 border border-gray-200'
                      }`}>
                        {client.status === 'active' ? 'Ativo' : 'Inativo'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">{client.timezone}</td>
                    <td className="px-6 py-4 text-sm text-gray-600">
                      {new Date(client.created_at).toLocaleDateString('pt-BR')}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => handleOpenDashboard(client)}
                          className="p-2 text-purple-600 hover:bg-purple-50 rounded-lg transition"
                          title="Abrir Dashboard"
                        >
                          <BarChart3 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleGeneratePortal(client)}
                          className="p-2 text-teal-600 hover:bg-teal-50 rounded-lg transition"
                          title="Copiar Link Portal"
                        >
                          {copiedId === client.id ? <CheckCircle className="w-4 h-4" /> : <Link2 className="w-4 h-4" />}
                        </button>
                        <button
                          onClick={() => openEditModal(client)}
                          className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition"
                          title="Editar"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setDeleteId(client.id)}
                          className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition"
                          title="Excluir"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {clients.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-gray-500">
                      Nenhum cliente cadastrado
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      {/* Delete Confirmation */}
      {deleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Confirmar exclusao</h3>
            <p className="text-sm text-gray-600 mb-6">
              Tem certeza que deseja excluir este cliente? Esta acao nao pode ser desfeita.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setDeleteId(null)}
                className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition"
              >
                Cancelar
              </button>
              <button
                onClick={() => handleDelete(deleteId)}
                className="px-4 py-2 text-sm text-white bg-red-600 rounded-lg hover:bg-red-700 transition"
              >
                Excluir
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] flex flex-col">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b flex justify-between items-center flex-shrink-0">
              <h3 className="text-lg font-semibold text-gray-900">
                {editingId ? 'Editar Cliente' : 'Novo Cliente'}
              </h3>
              <button onClick={() => setShowModal(false)} className="p-1 hover:bg-gray-100 rounded-lg">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            {/* Tabs */}
            <div className="px-6 pt-4 flex gap-1 border-b flex-shrink-0">
              {(['geral', 'meta', 'elevenlabs', 'settings'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-4 py-2 text-sm font-medium rounded-t-lg transition ${
                    activeTab === tab
                      ? 'bg-blue-50 text-blue-700 border-b-2 border-blue-600'
                      : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {tab === 'geral' ? 'Geral' : tab === 'meta' ? 'Meta/Facebook' : tab === 'elevenlabs' ? 'ElevenLabs' : 'Settings'}
                </button>
              ))}
            </div>

            {/* Modal Body */}
            <div className="px-6 py-4 overflow-y-auto flex-1">
              {/* Geral Tab */}
              {activeTab === 'geral' && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Nome</label>
                    <input
                      type="text"
                      value={modalData.name}
                      onChange={(e) => {
                        const name = e.target.value;
                        setModalData(prev => ({
                          ...prev,
                          name,
                          slug: !editingId ? slugify(name) : prev.slug,
                        }));
                      }}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="Nome do cliente"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Slug</label>
                    <input
                      type="text"
                      value={modalData.slug}
                      onChange={(e) => setModalData(prev => ({ ...prev, slug: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="slug-do-cliente"
                      disabled={!!editingId}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Timezone</label>
                      <select
                        value={modalData.timezone}
                        onChange={(e) => setModalData(prev => ({ ...prev, timezone: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      >
                        {timezones.map(tz => <option key={tz} value={tz}>{tz}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                      <select
                        value={modalData.status}
                        onChange={(e) => setModalData(prev => ({ ...prev, status: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      >
                        <option value="active">Ativo</option>
                        <option value="inactive">Inativo</option>
                      </select>
                    </div>
                  </div>
                </div>
              )}

              {/* Meta Tab */}
              {activeTab === 'meta' && (
                <div className="space-y-4">
                  <p className="text-xs text-gray-500 mb-2">IDs e tokens do Facebook/Meta Business</p>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Page ID</label>
                    <input type="text" value={modalData.meta_page_id}
                      onChange={(e) => setModalData(prev => ({ ...prev, meta_page_id: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="Ex: 123456789" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Phone Number ID</label>
                    <input type="text" value={modalData.meta_phone_id}
                      onChange={(e) => setModalData(prev => ({ ...prev, meta_phone_id: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="Ex: 123456789" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Instagram ID</label>
                    <input type="text" value={modalData.meta_ig_id}
                      onChange={(e) => setModalData(prev => ({ ...prev, meta_ig_id: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="Ex: 17841400..." />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">WABA ID</label>
                    <input type="text" value={modalData.meta_waba_id}
                      onChange={(e) => setModalData(prev => ({ ...prev, meta_waba_id: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="Ex: 123456789" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Access Token</label>
                    <input type="password" value={modalData.meta_access_token}
                      onChange={(e) => setModalData(prev => ({ ...prev, meta_access_token: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder={editingId ? '(manter atual)' : 'EAAx...'} />
                  </div>
                </div>
              )}

              {/* ElevenLabs Tab */}
              {activeTab === 'elevenlabs' && (
                <div className="space-y-4">
                  <p className="text-xs text-gray-500 mb-2">Configuracao do agente de voz ElevenLabs</p>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Agent ID</label>
                    <input type="text" value={modalData.elevenlabs_agent_id}
                      onChange={(e) => setModalData(prev => ({ ...prev, elevenlabs_agent_id: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="Ex: agent_..." />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Voice ID</label>
                    <input type="text" value={modalData.elevenlabs_voice_id}
                      onChange={(e) => setModalData(prev => ({ ...prev, elevenlabs_voice_id: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="Ex: voice_..." />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">API Key</label>
                    <input type="password" value={modalData.elevenlabs_api_key}
                      onChange={(e) => setModalData(prev => ({ ...prev, elevenlabs_api_key: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder={editingId ? '(manter atual)' : 'sk_...'} />
                  </div>
                </div>
              )}

              {/* Settings Tab */}
              {activeTab === 'settings' && (
                <div className="space-y-4">
                  <p className="text-xs text-gray-500 mb-2">Vincular ao projeto multitenant existente</p>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Project ID (UUID)</label>
                    <input type="text" value={modalData.project_id}
                      onChange={(e) => setModalData(prev => ({ ...prev, project_id: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
                      placeholder="Ex: 0624f30a-8774-4b19-9ba8-f029ab396144" />
                    <p className="text-xs text-gray-400 mt-1">UUID do projeto na tabela `projects`</p>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 border-t flex justify-between items-center flex-shrink-0">
              <div>
                {message && (
                  <div className={`flex items-center gap-2 text-sm ${
                    message.type === 'success' ? 'text-green-700' : 'text-red-700'
                  }`}>
                    {message.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                    {message.text}
                  </div>
                )}
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-6 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition disabled:opacity-50 flex items-center gap-2"
                >
                  {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                  {editingId ? 'Salvar' : 'Criar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
