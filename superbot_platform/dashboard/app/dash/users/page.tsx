'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import {
  Users, Plus, Search, Loader2, AlertCircle, CheckCircle,
  X, Trash2, Pencil, Eye, EyeOff, Shield, ShieldCheck, User,
  ToggleLeft, ToggleRight
} from 'lucide-react';

// ─── Types ─────────────────────────────────────────────────

interface UserData {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'manager' | 'client';
  client_id: string | null;
  client_name: string | null;
  is_active: boolean;
  last_login: string | null;
  created_at: string | null;
}

interface ClientOption {
  id: string;
  name: string;
}

const ROLE_CONFIG: Record<string, { label: string; color: string; icon: any; bg: string }> = {
  admin: { label: 'Admin', color: 'text-purple-700', icon: ShieldCheck, bg: 'bg-purple-50 border-purple-200' },
  manager: { label: 'Gerente', color: 'text-blue-700', icon: Shield, bg: 'bg-blue-50 border-blue-200' },
  client: { label: 'Usuario', color: 'text-gray-700', icon: User, bg: 'bg-gray-50 border-gray-200' },
};

// ─── Component ─────────────────────────────────────────────

export default function UsersPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [users, setUsers] = useState<UserData[]>([]);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [filterRole, setFilterRole] = useState('');
  const [filterClient, setFilterClient] = useState('');

  // Modal
  const [showModal, setShowModal] = useState(false);
  const [editingUser, setEditingUser] = useState<UserData | null>(null);
  const [formData, setFormData] = useState({ name: '', email: '', password: '', role: 'client', client_id: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);

  // Delete
  const [deleteTarget, setDeleteTarget] = useState<UserData | null>(null);

  // ─── Init ──────────────────────────────────────────────

  useEffect(() => {
    const userData = localStorage.getItem('user');
    if (!userData) { router.push('/login'); return; }
    const parsed = JSON.parse(userData);
    if (parsed.role !== 'admin' && parsed.role !== 'manager') {
      router.push('/dash');
      return;
    }
    setCurrentUser(parsed);
  }, [router]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [usersRes, clientsRes] = await Promise.allSettled([
        api.get('/api/users'),
        api.get('/api/clients'),
      ]);
      if (usersRes.status === 'fulfilled') {
        setUsers(usersRes.value.data || []);
      }
      if (clientsRes.status === 'fulfilled') {
        const list = clientsRes.value.data || [];
        setClients(list.map((c: any) => ({ id: c.id, name: c.name })));
      }
    } catch {} finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (currentUser) loadData();
  }, [currentUser, loadData]);

  useEffect(() => {
    if (msg) {
      const t = setTimeout(() => setMsg(null), 4000);
      return () => clearTimeout(t);
    }
  }, [msg]);

  // ─── Filtered users ──────────────────────────────────

  const filteredUsers = useMemo(() => {
    let list = users;
    if (search) {
      const s = search.toLowerCase();
      list = list.filter(u => u.name.toLowerCase().includes(s) || u.email.toLowerCase().includes(s));
    }
    if (filterRole) {
      list = list.filter(u => u.role === filterRole);
    }
    if (filterClient) {
      list = list.filter(u => u.client_id === filterClient);
    }
    return list;
  }, [users, search, filterRole, filterClient]);

  // ─── Stats ──────────────────────────────────────────

  const stats = useMemo(() => ({
    total: users.length,
    active: users.filter(u => u.is_active).length,
    admins: users.filter(u => u.role === 'admin').length,
    managers: users.filter(u => u.role === 'manager').length,
    clients: users.filter(u => u.role === 'client').length,
  }), [users]);

  // ─── CRUD ──────────────────────────────────────────

  const openCreateModal = () => {
    setEditingUser(null);
    const defaultClientId = currentUser?.role === 'manager'
      ? (currentUser.client_id || '')
      : '';
    setFormData({ name: '', email: '', password: '', role: 'client', client_id: defaultClientId });
    setShowPassword(false);
    setShowModal(true);
  };

  const openEditModal = (user: UserData) => {
    setEditingUser(user);
    setFormData({
      name: user.name,
      email: user.email,
      password: '',
      role: user.role,
      client_id: user.client_id || '',
    });
    setShowPassword(false);
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!formData.name || !formData.email) {
      setMsg({ type: 'error', text: 'Nome e email sao obrigatorios' });
      return;
    }
    if (!editingUser && !formData.password) {
      setMsg({ type: 'error', text: 'Senha obrigatoria para novo usuario' });
      return;
    }
    setSaving(true);
    try {
      if (editingUser) {
        // Update
        const payload: any = { name: formData.name, email: formData.email, role: formData.role };
        if (formData.password) payload.password = formData.password;
        await api.patch(`/api/users/${editingUser.id}`, payload);
        setMsg({ type: 'success', text: 'Usuario atualizado' });
      } else {
        // Create
        await api.post('/api/users', {
          name: formData.name,
          email: formData.email,
          password: formData.password,
          role: formData.role,
          client_id: formData.client_id || undefined,
        });
        setMsg({ type: 'success', text: 'Usuario criado' });
      }
      setShowModal(false);
      await loadData();
    } catch (e: any) {
      setMsg({ type: 'error', text: e?.response?.data?.detail || 'Erro ao salvar' });
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (user: UserData) => {
    try {
      await api.patch(`/api/users/${user.id}`, { is_active: !user.is_active });
      setMsg({ type: 'success', text: `${user.name} ${user.is_active ? 'desativado' : 'ativado'}` });
      await loadData();
    } catch (e: any) {
      setMsg({ type: 'error', text: e?.response?.data?.detail || 'Erro ao alterar status' });
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await api.delete(`/api/users/${deleteTarget.id}`);
      setMsg({ type: 'success', text: `${deleteTarget.name} removido` });
      setDeleteTarget(null);
      await loadData();
    } catch (e: any) {
      setMsg({ type: 'error', text: e?.response?.data?.detail || 'Erro ao deletar' });
    }
  };

  // ─── Helpers ──────────────────────────────────────

  const formatDate = (iso: string | null) => {
    if (!iso) return '-';
    return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
  };

  const isAdmin = currentUser?.role === 'admin';
  const isManager = currentUser?.role === 'manager';
  const availableRoles = isAdmin
    ? [{ value: 'admin', label: 'Admin' }, { value: 'manager', label: 'Gerente' }, { value: 'client', label: 'Usuario' }]
    : [{ value: 'manager', label: 'Gerente' }, { value: 'client', label: 'Usuario' }];

  // ─── Render ──────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-blue-500" size={32} />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center">
            <Users size={20} className="text-indigo-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Usuarios</h1>
            <p className="text-sm text-gray-500">{stats.total} usuario(s) | {stats.active} ativo(s)</p>
          </div>
        </div>
        <button
          onClick={openCreateModal}
          className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
        >
          <Plus size={16} />
          Novo Usuario
        </button>
      </div>

      {/* Messages */}
      {msg && (
        <div className={`mb-4 p-3 rounded-lg flex items-center gap-2 text-sm ${
          msg.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'
        }`}>
          {msg.type === 'success' ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
          {msg.text}
        </div>
      )}

      {/* Stats cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="bg-white border rounded-lg p-3">
          <p className="text-xs text-gray-500">Total</p>
          <p className="text-2xl font-bold text-gray-900">{stats.total}</p>
        </div>
        <div className="bg-white border rounded-lg p-3">
          <p className="text-xs text-purple-600">Admins</p>
          <p className="text-2xl font-bold text-purple-700">{stats.admins}</p>
        </div>
        <div className="bg-white border rounded-lg p-3">
          <p className="text-xs text-blue-600">Gerentes</p>
          <p className="text-2xl font-bold text-blue-700">{stats.managers}</p>
        </div>
        <div className="bg-white border rounded-lg p-3">
          <p className="text-xs text-gray-500">Usuarios</p>
          <p className="text-2xl font-bold text-gray-700">{stats.clients}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm"
            placeholder="Buscar por nome ou email..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <select
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
          value={filterRole}
          onChange={e => setFilterRole(e.target.value)}
        >
          <option value="">Todos os roles</option>
          <option value="admin">Admin</option>
          <option value="manager">Gerente</option>
          <option value="client">Usuario</option>
        </select>
        {isAdmin && (
          <select
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
            value={filterClient}
            onChange={e => setFilterClient(e.target.value)}
          >
            <option value="">Todos os clientes</option>
            {clients.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        )}
      </div>

      {/* Users table */}
      <div className="bg-white border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Usuario</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Role</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Cliente</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Ultimo login</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Acoes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredUsers.map(user => {
                const rc = ROLE_CONFIG[user.role] || ROLE_CONFIG.client;
                const RoleIcon = rc.icon;
                const isSelf = user.id === currentUser?.id;
                return (
                  <tr key={user.id} className={`hover:bg-gray-50 transition ${!user.is_active ? 'opacity-50' : ''}`}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-gray-200 rounded-full flex items-center justify-center text-sm font-medium text-gray-600">
                          {user.name[0]?.toUpperCase() || '?'}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-900">
                            {user.name}
                            {isSelf && <span className="ml-1 text-xs text-blue-500">(voce)</span>}
                          </p>
                          <p className="text-xs text-gray-500">{user.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${rc.bg} ${rc.color}`}>
                        <RoleIcon size={11} />
                        {rc.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {user.client_name || (user.role === 'admin' ? <span className="text-gray-400">-</span> : <span className="text-gray-400">Sem cliente</span>)}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                        user.is_active
                          ? 'bg-green-50 text-green-700 border border-green-200'
                          : 'bg-red-50 text-red-600 border border-red-200'
                      }`}>
                        {user.is_active ? 'Ativo' : 'Inativo'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {formatDate(user.last_login)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => openEditModal(user)}
                          className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded"
                          title="Editar"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => handleToggleActive(user)}
                          disabled={isSelf}
                          className={`p-1.5 rounded ${isSelf ? 'text-gray-300 cursor-not-allowed' : 'text-gray-400 hover:text-yellow-600 hover:bg-yellow-50'}`}
                          title={user.is_active ? 'Desativar' : 'Ativar'}
                        >
                          {user.is_active ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
                        </button>
                        <button
                          onClick={() => setDeleteTarget(user)}
                          disabled={isSelf}
                          className={`p-1.5 rounded ${isSelf ? 'text-gray-300 cursor-not-allowed' : 'text-gray-400 hover:text-red-600 hover:bg-red-50'}`}
                          title="Deletar"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filteredUsers.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-gray-400">
                    <Users size={32} className="mx-auto mb-2 opacity-40" />
                    <p>Nenhum usuario encontrado</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4">
            <div className="flex items-center justify-between p-4 border-b">
              <h2 className="text-lg font-bold">{editingUser ? 'Editar Usuario' : 'Novo Usuario'}</h2>
              <button onClick={() => setShowModal(false)} className="p-1 hover:bg-gray-100 rounded">
                <X size={18} />
              </button>
            </div>

            <div className="p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nome</label>
                <input
                  type="text"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  placeholder="Nome completo"
                  value={formData.name}
                  onChange={e => setFormData(f => ({ ...f, name: e.target.value }))}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <input
                  type="email"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  placeholder="email@exemplo.com"
                  value={formData.email}
                  onChange={e => setFormData(f => ({ ...f, email: e.target.value }))}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {editingUser ? 'Nova Senha (deixe vazio para manter)' : 'Senha'}
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 pr-10 text-sm"
                    placeholder={editingUser ? 'Manter senha atual' : 'Senha segura'}
                    value={formData.password}
                    onChange={e => setFormData(f => ({ ...f, password: e.target.value }))}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
                  <select
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    value={formData.role}
                    onChange={e => setFormData(f => ({ ...f, role: e.target.value }))}
                  >
                    {availableRoles.map(r => (
                      <option key={r.value} value={r.value}>{r.label}</option>
                    ))}
                  </select>
                </div>

                {(formData.role === 'client' || formData.role === 'manager') && isAdmin && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Cliente</label>
                    <select
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                      value={formData.client_id}
                      onChange={e => setFormData(f => ({ ...f, client_id: e.target.value }))}
                    >
                      <option value="">Selecionar...</option>
                      {clients.map(c => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {/* Role description */}
              <div className="bg-gray-50 rounded-lg p-3 text-xs text-gray-500">
                {formData.role === 'admin' && 'Admin: Acesso total. Gerencia todos os clientes, usuarios e configuracoes.'}
                {formData.role === 'manager' && 'Gerente: Gerencia usuarios do seu cliente. Acessa dashboard completo e pode criar logins.'}
                {formData.role === 'client' && 'Usuario: Acesso basico ao dashboard. Ve conversas, contatos e ligacoes do seu cliente.'}
              </div>
            </div>

            <div className="flex justify-end gap-2 p-4 border-t">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
              >
                Cancelar
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                {saving && <Loader2 size={14} className="animate-spin" />}
                {editingUser ? 'Salvar' : 'Criar Usuario'}
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
              Tem certeza que deseja excluir <strong>{deleteTarget.name}</strong>?
            </p>
            <p className="text-xs text-gray-400 mb-6">
              {deleteTarget.email} - Esta acao nao pode ser desfeita.
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
