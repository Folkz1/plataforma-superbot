'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import {
  Plus, Edit, Trash2, Users, BarChart3, X, Bot,
  Link2, CheckCircle, AlertCircle, Loader2, LogOut,
  UserPlus, Key, Eye, EyeOff, ChevronRight, ChevronLeft,
  Rocket, MessageCircle, Cpu, UserCheck, ClipboardList
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

  // User management
  const [showUserModal, setShowUserModal] = useState(false);
  const [userModalClientId, setUserModalClientId] = useState<string>('');
  const [userForm, setUserForm] = useState({ email: '', password: '', name: '' });
  const [userSaving, setUserSaving] = useState(false);
  const [userMessage, setUserMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [clientUsers, setClientUsers] = useState<Record<string, any[]>>({});
  const [showPassword, setShowPassword] = useState(false);
  const [expandedUsers, setExpandedUsers] = useState<string | null>(null);

  // Onboarding Wizard
  const [showWizard, setShowWizard] = useState(false);
  const [wizardStep, setWizardStep] = useState(0);
  const [wizardSaving, setWizardSaving] = useState(false);
  const [wizardError, setWizardError] = useState<string | null>(null);
  const [wizardResult, setWizardResult] = useState<any>(null);
  const [wizardData, setWizardData] = useState({
    company_name: '', project_slug: '', client_name: '', client_slug: '',
    timezone: 'America/Sao_Paulo',
    channel_type: 'whatsapp', channel_identifier: '', meta_access_token: '',
    meta_page_id: '', meta_ig_id: '',
    agent_name: '', agent_system_prompt: '', agent_llm_model: 'gemini-2.0-flash',
    user_name: '', user_email: '', user_password: '',
  });

  useEffect(() => {
    const userData = localStorage.getItem('user');
    if (!userData) { router.push('/login'); return; }
    const parsedUser = JSON.parse(userData);
    if (parsedUser.role !== 'admin') { router.push('/dash'); return; }
    setUser(parsedUser);
    loadClients();
    loadAllUsers();
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

  const loadAllUsers = async () => {
    try {
      const res = await api.get('/api/users');
      const grouped: Record<string, any[]> = {};
      for (const u of res.data) {
        if (u.client_id) {
          if (!grouped[u.client_id]) grouped[u.client_id] = [];
          grouped[u.client_id].push(u);
        }
      }
      setClientUsers(grouped);
    } catch {}
  };

  const openUserModal = (clientId: string) => {
    setUserModalClientId(clientId);
    setUserForm({ email: '', password: '', name: '' });
    setUserMessage(null);
    setShowPassword(false);
    setShowUserModal(true);
  };

  const handleCreateUser = async () => {
    if (!userForm.email || !userForm.password || !userForm.name) {
      setUserMessage({ type: 'error', text: 'Preencha todos os campos' });
      return;
    }
    setUserSaving(true);
    setUserMessage(null);
    try {
      await api.post('/api/users', {
        email: userForm.email,
        password: userForm.password,
        name: userForm.name,
        role: 'client',
        client_id: userModalClientId,
      });
      setUserMessage({ type: 'success', text: 'Usuário criado com sucesso!' });
      await loadAllUsers();
      setTimeout(() => setShowUserModal(false), 800);
    } catch (err: any) {
      setUserMessage({ type: 'error', text: err.response?.data?.detail || 'Erro ao criar usuário' });
    } finally {
      setUserSaving(false);
    }
  };

  const handleDeleteUser = async (userId: string) => {
    if (!confirm('Tem certeza que deseja excluir este usuário?')) return;
    try {
      await api.delete(`/api/users/${userId}`);
      await loadAllUsers();
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Erro ao excluir');
    }
  };

  const handleToggleUserActive = async (userId: string, isActive: boolean) => {
    try {
      await api.patch(`/api/users/${userId}`, { is_active: !isActive });
      await loadAllUsers();
    } catch {}
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
    setWizardStep(0);
    setWizardError(null);
    setWizardResult(null);
    setWizardData({
      company_name: '', project_slug: '', client_name: '', client_slug: '',
      timezone: 'America/Sao_Paulo',
      channel_type: 'whatsapp', channel_identifier: '', meta_access_token: '',
      meta_page_id: '', meta_ig_id: '',
      agent_name: '', agent_system_prompt: '', agent_llm_model: 'gemini-2.0-flash',
      user_name: '', user_email: '', user_password: '',
    });
    setShowWizard(true);
  };

  const handleWizardProvision = async () => {
    setWizardSaving(true);
    setWizardError(null);
    try {
      const channels: any[] = [];
      if (wizardData.channel_identifier) {
        channels.push({
          channel_type: wizardData.channel_type,
          channel_identifier: wizardData.channel_identifier,
          access_token: wizardData.meta_access_token || '',
        });
      }
      const payload: any = {
        company_name: wizardData.company_name,
        project_slug: wizardData.project_slug,
        client_name: wizardData.client_name || wizardData.company_name,
        client_slug: wizardData.client_slug || wizardData.project_slug,
        timezone: wizardData.timezone,
        user_email: wizardData.user_email,
        user_password: wizardData.user_password,
        user_name: wizardData.user_name,
        channels,
        seed_pipeline: true,
      };
      if (wizardData.agent_name) {
        payload.agent_name = wizardData.agent_name;
        payload.agent_system_prompt = wizardData.agent_system_prompt || undefined;
        payload.agent_llm_model = wizardData.agent_llm_model;
      }
      const res = await api.post('/api/onboarding/provision', payload);
      setWizardResult(res.data);
      setWizardStep(5); // success step
      await loadClients();
      await loadAllUsers();
    } catch (err: any) {
      setWizardError(err.response?.data?.detail || 'Erro ao provisionar cliente');
    } finally {
      setWizardSaving(false);
    }
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
                  <React.Fragment key={client.id}>
                  <tr className="hover:bg-gray-50 transition">
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
                          onClick={() => openUserModal(client.id)}
                          className="p-2 text-green-600 hover:bg-green-50 rounded-lg transition"
                          title="Criar Login para Cliente"
                        >
                          <UserPlus className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setExpandedUsers(expandedUsers === client.id ? null : client.id)}
                          className={`p-2 rounded-lg transition ${clientUsers[client.id]?.length ? 'text-indigo-600 hover:bg-indigo-50' : 'text-gray-300 cursor-default'}`}
                          title={clientUsers[client.id]?.length ? `${clientUsers[client.id].length} usuário(s)` : 'Sem usuários'}
                          disabled={!clientUsers[client.id]?.length}
                        >
                          <Key className="w-4 h-4" />
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
                  {expandedUsers === client.id && clientUsers[client.id] && (
                    <tr>
                      <td colSpan={6} className="px-6 py-3 bg-indigo-50/50">
                        <div className="text-xs font-medium text-indigo-700 mb-2">Usuários com acesso ao dashboard:</div>
                        <div className="space-y-1">
                          {clientUsers[client.id].map((u: any) => (
                            <div key={u.id} className="flex items-center gap-3 py-1.5 px-3 bg-white rounded-lg border border-indigo-100">
                              <span className="text-sm font-medium text-gray-900 flex-1">{u.name}</span>
                              <span className="text-xs text-gray-500">{u.email}</span>
                              <span className={`text-xs px-2 py-0.5 rounded-full ${u.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                                {u.is_active ? 'Ativo' : 'Inativo'}
                              </span>
                              <button
                                onClick={() => handleToggleUserActive(u.id, u.is_active)}
                                className="text-xs text-blue-600 hover:underline"
                              >
                                {u.is_active ? 'Desativar' : 'Ativar'}
                              </button>
                              <button
                                onClick={() => handleDeleteUser(u.id)}
                                className="text-xs text-red-600 hover:underline"
                              >
                                Excluir
                              </button>
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
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

      {/* Create User Modal */}
      {showUserModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4">
            <div className="px-6 py-4 border-b flex justify-between items-center">
              <h3 className="text-lg font-semibold text-gray-900">Criar Login para Cliente</h3>
              <button onClick={() => setShowUserModal(false)} className="p-1 hover:bg-gray-100 rounded-lg">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>
            <div className="px-6 py-4 space-y-4">
              <p className="text-sm text-gray-500">
                O cliente poderá acessar o dashboard com este login e ver apenas: Dashboard, Conversas e Ligações.
              </p>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nome</label>
                <input
                  type="text"
                  value={userForm.name}
                  onChange={(e) => setUserForm(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white focus:ring-2 focus:ring-blue-500"
                  placeholder="Nome do usuário"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email (login)</label>
                <input
                  type="email"
                  value={userForm.email}
                  onChange={(e) => setUserForm(prev => ({ ...prev, email: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white focus:ring-2 focus:ring-blue-500"
                  placeholder="cliente@email.com"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Senha</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={userForm.password}
                    onChange={(e) => setUserForm(prev => ({ ...prev, password: e.target.value }))}
                    className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-lg text-gray-900 bg-white focus:ring-2 focus:ring-blue-500"
                    placeholder="Senha do cliente"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              {userMessage && (
                <div className={`flex items-center gap-2 text-sm ${userMessage.type === 'success' ? 'text-green-700' : 'text-red-700'}`}>
                  {userMessage.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                  {userMessage.text}
                </div>
              )}
            </div>
            <div className="px-6 py-4 border-t flex justify-end gap-3">
              <button
                onClick={() => setShowUserModal(false)}
                className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition"
              >
                Cancelar
              </button>
              <button
                onClick={handleCreateUser}
                disabled={userSaving}
                className="px-6 py-2 text-sm text-white bg-green-600 rounded-lg hover:bg-green-700 transition disabled:opacity-50 flex items-center gap-2"
              >
                {userSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                Criar Login
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Onboarding Wizard */}
      {showWizard && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] flex flex-col">
            {/* Wizard Header */}
            <div className="px-6 py-4 border-b flex justify-between items-center flex-shrink-0">
              <div className="flex items-center gap-3">
                <Rocket className="w-5 h-5 text-blue-600" />
                <h3 className="text-lg font-semibold text-gray-900">Novo Cliente - Onboarding</h3>
              </div>
              <button onClick={() => setShowWizard(false)} className="p-1 hover:bg-gray-100 rounded-lg">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            {/* Steps indicator */}
            {wizardStep < 5 && (
              <div className="px-6 pt-4 flex items-center gap-2 flex-shrink-0">
                {[
                  { icon: <Users className="w-3.5 h-3.5" />, label: 'Empresa' },
                  { icon: <MessageCircle className="w-3.5 h-3.5" />, label: 'Canal' },
                  { icon: <Cpu className="w-3.5 h-3.5" />, label: 'Agente IA' },
                  { icon: <UserCheck className="w-3.5 h-3.5" />, label: 'Usuario' },
                  { icon: <ClipboardList className="w-3.5 h-3.5" />, label: 'Revisar' },
                ].map((s, i) => (
                  <React.Fragment key={i}>
                    {i > 0 && <ChevronRight className="w-4 h-4 text-gray-300 flex-shrink-0" />}
                    <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition ${
                      i === wizardStep ? 'bg-blue-100 text-blue-700' : i < wizardStep ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                    }`}>
                      {i < wizardStep ? <CheckCircle className="w-3.5 h-3.5" /> : s.icon}
                      <span className="hidden sm:inline">{s.label}</span>
                    </div>
                  </React.Fragment>
                ))}
              </div>
            )}

            {/* Wizard Body */}
            <div className="px-6 py-5 overflow-y-auto flex-1">
              {/* Step 0: Company */}
              {wizardStep === 0 && (
                <div className="space-y-4">
                  <h4 className="text-base font-semibold text-gray-900">Dados da empresa</h4>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Nome da empresa</label>
                    <input type="text" value={wizardData.company_name}
                      onChange={(e) => {
                        const name = e.target.value;
                        const slug = slugify(name);
                        setWizardData(prev => ({ ...prev, company_name: name, project_slug: slug, client_name: name, client_slug: slug }));
                      }}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white focus:ring-2 focus:ring-blue-500"
                      placeholder="Ex: Famiglia Gianni" />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Slug</label>
                      <input type="text" value={wizardData.project_slug}
                        onChange={(e) => setWizardData(prev => ({ ...prev, project_slug: e.target.value, client_slug: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                        placeholder="famiglia-gianni" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Timezone</label>
                      <select value={wizardData.timezone}
                        onChange={(e) => setWizardData(prev => ({ ...prev, timezone: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white focus:ring-2 focus:ring-blue-500">
                        {timezones.map(tz => <option key={tz} value={tz}>{tz}</option>)}
                      </select>
                    </div>
                  </div>
                </div>
              )}

              {/* Step 1: Channel */}
              {wizardStep === 1 && (
                <div className="space-y-4">
                  <h4 className="text-base font-semibold text-gray-900">Canal de comunicacao</h4>
                  <p className="text-sm text-gray-500">Configure o canal principal. Pode pular e configurar depois.</p>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Tipo de canal</label>
                    <select value={wizardData.channel_type}
                      onChange={(e) => setWizardData(prev => ({ ...prev, channel_type: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white focus:ring-2 focus:ring-blue-500">
                      <option value="whatsapp">WhatsApp</option>
                      <option value="instagram">Instagram</option>
                      <option value="messenger">Messenger</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {wizardData.channel_type === 'whatsapp' ? 'Phone Number ID' : wizardData.channel_type === 'instagram' ? 'Instagram Account ID' : 'Page ID'}
                    </label>
                    <input type="text" value={wizardData.channel_identifier}
                      onChange={(e) => setWizardData(prev => ({ ...prev, channel_identifier: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white focus:ring-2 focus:ring-blue-500"
                      placeholder="Ex: 123456789" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Access Token (Meta)</label>
                    <input type="password" value={wizardData.meta_access_token}
                      onChange={(e) => setWizardData(prev => ({ ...prev, meta_access_token: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white focus:ring-2 focus:ring-blue-500"
                      placeholder="EAAx..." />
                  </div>
                </div>
              )}

              {/* Step 2: Agent */}
              {wizardStep === 2 && (
                <div className="space-y-4">
                  <h4 className="text-base font-semibold text-gray-900">Agente de IA</h4>
                  <p className="text-sm text-gray-500">Configure o bot que vai atender. Pode pular e configurar depois.</p>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Nome do agente</label>
                    <input type="text" value={wizardData.agent_name}
                      onChange={(e) => setWizardData(prev => ({ ...prev, agent_name: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white focus:ring-2 focus:ring-blue-500"
                      placeholder="Ex: Giulia, Assistente Virtual" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Modelo LLM</label>
                    <select value={wizardData.agent_llm_model}
                      onChange={(e) => setWizardData(prev => ({ ...prev, agent_llm_model: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white focus:ring-2 focus:ring-blue-500">
                      <option value="gemini-2.0-flash">Gemini 2.0 Flash (rapido)</option>
                      <option value="gemini-2.0-pro">Gemini 2.0 Pro (avancado)</option>
                      <option value="gpt-4o-mini">GPT-4o Mini</option>
                      <option value="gpt-4o">GPT-4o</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">System Prompt</label>
                    <textarea value={wizardData.agent_system_prompt}
                      onChange={(e) => setWizardData(prev => ({ ...prev, agent_system_prompt: e.target.value }))}
                      rows={5}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white focus:ring-2 focus:ring-blue-500 text-sm"
                      placeholder="Voce e um assistente virtual da empresa X. Ajude os clientes com..." />
                  </div>
                </div>
              )}

              {/* Step 3: User */}
              {wizardStep === 3 && (
                <div className="space-y-4">
                  <h4 className="text-base font-semibold text-gray-900">Primeiro usuario</h4>
                  <p className="text-sm text-gray-500">Login para o cliente acessar o dashboard.</p>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Nome</label>
                    <input type="text" value={wizardData.user_name}
                      onChange={(e) => setWizardData(prev => ({ ...prev, user_name: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white focus:ring-2 focus:ring-blue-500"
                      placeholder="Nome do usuario" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                    <input type="email" value={wizardData.user_email}
                      onChange={(e) => setWizardData(prev => ({ ...prev, user_email: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white focus:ring-2 focus:ring-blue-500"
                      placeholder="cliente@email.com" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Senha</label>
                    <input type="password" value={wizardData.user_password}
                      onChange={(e) => setWizardData(prev => ({ ...prev, user_password: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white focus:ring-2 focus:ring-blue-500"
                      placeholder="Senha segura" />
                  </div>
                </div>
              )}

              {/* Step 4: Review */}
              {wizardStep === 4 && (
                <div className="space-y-4">
                  <h4 className="text-base font-semibold text-gray-900">Revisar e criar</h4>
                  <div className="space-y-3">
                    <div className="p-3 bg-gray-50 rounded-lg">
                      <p className="text-xs font-medium text-gray-500 uppercase mb-1">Empresa</p>
                      <p className="text-sm text-gray-900">{wizardData.company_name} <code className="text-xs bg-gray-200 px-1.5 py-0.5 rounded">{wizardData.project_slug}</code></p>
                      <p className="text-xs text-gray-500">{wizardData.timezone}</p>
                    </div>
                    <div className="p-3 bg-gray-50 rounded-lg">
                      <p className="text-xs font-medium text-gray-500 uppercase mb-1">Canal</p>
                      <p className="text-sm text-gray-900">{wizardData.channel_identifier ? `${wizardData.channel_type}: ${wizardData.channel_identifier}` : 'Nenhum (configurar depois)'}</p>
                    </div>
                    <div className="p-3 bg-gray-50 rounded-lg">
                      <p className="text-xs font-medium text-gray-500 uppercase mb-1">Agente IA</p>
                      <p className="text-sm text-gray-900">{wizardData.agent_name ? `${wizardData.agent_name} (${wizardData.agent_llm_model})` : 'Nenhum (configurar depois)'}</p>
                    </div>
                    <div className="p-3 bg-gray-50 rounded-lg">
                      <p className="text-xs font-medium text-gray-500 uppercase mb-1">Usuario</p>
                      <p className="text-sm text-gray-900">{wizardData.user_name} ({wizardData.user_email})</p>
                    </div>
                  </div>
                  {wizardError && (
                    <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 p-3 rounded-lg">
                      <AlertCircle className="w-4 h-4 flex-shrink-0" />
                      {wizardError}
                    </div>
                  )}
                </div>
              )}

              {/* Step 5: Success */}
              {wizardStep === 5 && wizardResult && (
                <div className="space-y-4">
                  <div className="text-center py-4">
                    <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-3" />
                    <h4 className="text-lg font-semibold text-gray-900">Cliente provisionado!</h4>
                    <p className="text-sm text-gray-500 mt-1">{wizardResult.message || 'Tudo criado com sucesso.'}</p>
                  </div>
                  {wizardResult.checklist && (
                    <div className="space-y-1.5">
                      {wizardResult.checklist.map((item: any, i: number) => (
                        <div key={i} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${
                          item.status === 'done' ? 'bg-green-50 text-green-700' : item.status === 'manual' ? 'bg-amber-50 text-amber-700' : 'bg-gray-50 text-gray-500'
                        }`}>
                          {item.status === 'done' ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                          <span className="flex-1">{item.step}</span>
                          {item.detail && <span className="text-xs opacity-75">{item.detail}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Wizard Footer */}
            <div className="px-6 py-4 border-t flex justify-between items-center flex-shrink-0">
              <div>
                {wizardStep > 0 && wizardStep < 5 && (
                  <button onClick={() => setWizardStep(wizardStep - 1)}
                    className="flex items-center gap-1 px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition">
                    <ChevronLeft className="w-4 h-4" /> Voltar
                  </button>
                )}
              </div>
              <div className="flex gap-3">
                {wizardStep === 5 ? (
                  <button onClick={() => setShowWizard(false)}
                    className="px-6 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition">
                    Fechar
                  </button>
                ) : wizardStep === 4 ? (
                  <button onClick={handleWizardProvision} disabled={wizardSaving || !wizardData.user_email || !wizardData.user_password || !wizardData.user_name}
                    className="flex items-center gap-2 px-6 py-2 text-sm text-white bg-green-600 rounded-lg hover:bg-green-700 transition disabled:opacity-50">
                    {wizardSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Rocket className="w-4 h-4" />}
                    Provisionar
                  </button>
                ) : (
                  <div className="flex gap-2">
                    {(wizardStep === 1 || wizardStep === 2) && (
                      <button onClick={() => setWizardStep(wizardStep + 1)}
                        className="px-4 py-2 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition">
                        Pular
                      </button>
                    )}
                    <button onClick={() => setWizardStep(wizardStep + 1)}
                      disabled={wizardStep === 0 && (!wizardData.company_name || !wizardData.project_slug)}
                      className="flex items-center gap-1 px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition disabled:opacity-50">
                      Proximo <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
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
                  {tab === 'geral' ? 'Geral' : tab === 'meta' ? 'Meta/Facebook' : tab === 'elevenlabs' ? 'Voz' : 'Settings'}
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

              {/* Voz Tab */}
              {activeTab === 'elevenlabs' && (
                <div className="space-y-4">
                  <p className="text-xs text-gray-500 mb-2">Configuração do agente de voz</p>
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
