'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import {
  Bot, Plus, Loader2, AlertCircle,
  Wrench, BookOpen, Phone, Globe, MessageSquare, Link2, Power
} from 'lucide-react';

// ─── Types ─────────────────────────────────────────────────

interface AgentCard {
  agent_id: string;
  name: string;
  channel_type: string;
  active: boolean;
  tools_count: number;
  kb_count: number;
}

interface WorkspaceAgent {
  agent_id: string;
  name?: string;
  metadata?: { name?: string };
  platform_settings?: { widget_settings?: { name?: string } };
}

// ─── Constants ─────────────────────────────────────────────

const CHANNEL_CONFIG: Record<string, { icon: any; label: string; color: string }> = {
  phone: { icon: Phone, label: 'Telefone', color: 'bg-blue-100 text-blue-700' },
  web: { icon: Globe, label: 'Web', color: 'bg-purple-100 text-purple-700' },
  widget: { icon: Globe, label: 'Widget', color: 'bg-purple-100 text-purple-700' },
  text: { icon: MessageSquare, label: 'Texto', color: 'bg-green-100 text-green-700' },
  whatsapp: { icon: MessageSquare, label: 'WhatsApp', color: 'bg-emerald-100 text-emerald-700' },
};

// ─── Component ─────────────────────────────────────────────

export default function AgentsConfigPage() {
  const router = useRouter();
  const [tenantId, setTenantId] = useState('');
  const [loading, setLoading] = useState(true);
  const [agents, setAgents] = useState<AgentCard[]>([]);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Link agent modal
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [wsAgents, setWsAgents] = useState<WorkspaceAgent[]>([]);
  const [wsLoading, setWsLoading] = useState(false);
  const [linkForm, setLinkForm] = useState({ agent_id: '', label: '', channel_type: 'phone' });
  const [linking, setLinking] = useState(false);

  // Create agent modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState({ name: '', system_prompt: '', first_message: '', language: 'pt', voice_id: 'pFZP5JQG7iQjIQuC4Bku' });

  // ─── Init ──────────────────────────────────────────────

  useEffect(() => {
    const userData = localStorage.getItem('user');
    if (!userData) return;
    const user = JSON.parse(userData);
    const tId = user.role === 'admin'
      ? localStorage.getItem('active_tenant_id')
      : user.client_id;
    if (tId) setTenantId(tId);
  }, []);

  // ─── Load Agents ──────────────────────────────────────

  const loadAgents = useCallback(async (tId: string) => {
    setLoading(true);
    try {
      const res = await api.get(`/api/elevenlabs/agents/${tId}`);
      const list = res.data?.agents || [];
      const cards: AgentCard[] = list.map((a: any) => ({
        agent_id: a.agent_id,
        name: a._configured_label || a.name || a.platform_settings?.widget_settings?.name || a.agent_id,
        channel_type: a._configured_channel_type || 'phone',
        active: a._configured_active !== false,
        tools_count: a.conversation_config?.agent?.prompt?.tools?.length || 0,
        kb_count: a.conversation_config?.agent?.prompt?.knowledge_base?.length || 0,
      }));
      setAgents(cards);
    } catch {
      setAgents([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tenantId) loadAgents(tenantId);
  }, [tenantId, loadAgents]);

  useEffect(() => {
    if (msg) {
      const t = setTimeout(() => setMsg(null), 4000);
      return () => clearTimeout(t);
    }
  }, [msg]);

  // ─── Link Agent Modal ─────────────────────────────────

  const openLinkModal = async () => {
    setShowLinkModal(true);
    setWsLoading(true);
    try {
      const res = await api.get(`/api/elevenlabs/workspace-agents/${tenantId}`);
      const all = res.data?.agents || [];
      // Filter out already linked
      const linkedIds = new Set(agents.map(a => a.agent_id));
      setWsAgents(all.filter((a: WorkspaceAgent) => !linkedIds.has(a.agent_id)));
    } catch {
      setWsAgents([]);
    } finally {
      setWsLoading(false);
    }
  };

  const linkAgent = async () => {
    if (!linkForm.agent_id) return;
    setLinking(true);
    try {
      await api.post(`/api/elevenlabs/active-agents/${tenantId}`, {
        agent_id: linkForm.agent_id,
        label: linkForm.label || undefined,
        channel_type: linkForm.channel_type,
        active: true,
      });
      setMsg({ type: 'success', text: 'Agente vinculado com sucesso' });
      setShowLinkModal(false);
      setLinkForm({ agent_id: '', label: '', channel_type: 'phone' });
      loadAgents(tenantId);
    } catch (e: any) {
      setMsg({ type: 'error', text: e?.response?.data?.detail || 'Erro ao vincular agente' });
    } finally {
      setLinking(false);
    }
  };

  // ─── Create Agent ──────────────────────────────────────

  const createAgent = async () => {
    if (!createForm.name || !createForm.system_prompt) return;
    setCreating(true);
    try {
      const res = await api.post(`/api/elevenlabs/agents/${tenantId}`, {
        name: createForm.name,
        system_prompt: createForm.system_prompt,
        first_message: createForm.first_message,
        language: createForm.language,
        voice_id: createForm.voice_id,
      });
      const newAgentId = res.data?.agent_id;
      // Link to tenant
      if (newAgentId) {
        await api.post(`/api/elevenlabs/active-agents/${tenantId}`, {
          agent_id: newAgentId,
          label: createForm.name,
          channel_type: 'text',
          active: true,
        });
      }
      setMsg({ type: 'success', text: 'Agente criado com sucesso' });
      setShowCreateModal(false);
      setCreateForm({ name: '', system_prompt: '', first_message: '', language: 'pt', voice_id: 'pFZP5JQG7iQjIQuC4Bku' });
      loadAgents(tenantId);
      if (newAgentId) router.push(`/dash/agents-config/${newAgentId}`);
    } catch (e: any) {
      setMsg({ type: 'error', text: e?.response?.data?.detail || 'Erro ao criar agente' });
    } finally {
      setCreating(false);
    }
  };

  // ─── Render ───────────────────────────────────────────

  const ChannelBadge = ({ type }: { type: string }) => {
    const cfg = CHANNEL_CONFIG[type] || CHANNEL_CONFIG.phone;
    const Icon = cfg.icon;
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.color}`}>
        <Icon size={12} />
        {cfg.label}
      </span>
    );
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Bot size={28} />
            Agentes de IA
          </h1>
          <p className="text-gray-500 mt-1">Gerencie seus agentes, tools e base de conhecimento</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={openLinkModal}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 text-sm font-medium"
          >
            <Link2 size={16} />
            Vincular Agente
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium"
          >
            <Plus size={16} />
            Criar Agente
          </button>
        </div>
      </div>

      {/* Messages */}
      {msg && (
        <div className={`mb-4 p-3 rounded-lg flex items-center gap-2 text-sm ${
          msg.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'
        }`}>
          <AlertCircle size={16} />
          {msg.text}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="animate-spin text-blue-500" size={32} />
        </div>
      )}

      {/* Empty State */}
      {!loading && agents.length === 0 && (
        <div className="text-center py-20 text-gray-500">
          <Bot size={48} className="mx-auto mb-4 opacity-30" />
          <p className="text-lg font-medium">Nenhum agente vinculado</p>
          <p className="text-sm mt-1">Vincule um agente existente ou crie um novo</p>
        </div>
      )}

      {/* Agent Cards Grid */}
      {!loading && agents.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {agents.map((agent) => (
            <div
              key={agent.agent_id}
              onClick={() => router.push(`/dash/agents-config/${agent.agent_id}`)}
              className="bg-white border border-gray-200 rounded-xl p-5 hover:shadow-md hover:border-blue-300 transition-all cursor-pointer group"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0 group-hover:bg-blue-100 transition-colors">
                    <Bot size={20} className="text-blue-600" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-semibold text-gray-900 truncate">{agent.name}</h3>
                    <p className="text-xs text-gray-400 font-mono truncate">{agent.agent_id.slice(0, 20)}...</p>
                  </div>
                </div>
                <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                  agent.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                }`}>
                  <Power size={10} />
                  {agent.active ? 'Ativo' : 'Inativo'}
                </span>
              </div>

              <div className="flex items-center gap-2 mb-3">
                <ChannelBadge type={agent.channel_type} />
              </div>

              <div className="flex items-center gap-4 text-xs text-gray-500">
                {agent.tools_count > 0 && (
                  <span className="flex items-center gap-1">
                    <Wrench size={12} />
                    {agent.tools_count} tools
                  </span>
                )}
                {agent.kb_count > 0 && (
                  <span className="flex items-center gap-1">
                    <BookOpen size={12} />
                    {agent.kb_count} docs
                  </span>
                )}
                {agent.tools_count === 0 && agent.kb_count === 0 && (
                  <span className="text-gray-400">Clique para configurar</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Link Agent Modal */}
      {showLinkModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 p-6">
            <h2 className="text-lg font-bold mb-4">Vincular Agente do Workspace</h2>

            {wsLoading ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="animate-spin text-blue-500" size={24} />
              </div>
            ) : wsAgents.length === 0 ? (
              <p className="text-gray-500 text-sm py-6 text-center">Nenhum agente disponivel para vincular</p>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Agente</label>
                  <select
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    value={linkForm.agent_id}
                    onChange={e => setLinkForm(f => ({ ...f, agent_id: e.target.value }))}
                  >
                    <option value="">Selecione...</option>
                    {wsAgents.map(a => (
                      <option key={a.agent_id} value={a.agent_id}>
                        {a.name || a.platform_settings?.widget_settings?.name || a.metadata?.name || a.agent_id}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Label (opcional)</label>
                  <input
                    type="text"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    placeholder="Ex: Giulia TEXT"
                    value={linkForm.label}
                    onChange={e => setLinkForm(f => ({ ...f, label: e.target.value }))}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Canal</label>
                  <select
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    value={linkForm.channel_type}
                    onChange={e => setLinkForm(f => ({ ...f, channel_type: e.target.value }))}
                  >
                    <option value="phone">Telefone</option>
                    <option value="web">Web</option>
                    <option value="text">Texto</option>
                    <option value="whatsapp">WhatsApp</option>
                  </select>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={() => { setShowLinkModal(false); setLinkForm({ agent_id: '', label: '', channel_type: 'phone' }); }}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
              >
                Cancelar
              </button>
              <button
                onClick={linkAgent}
                disabled={!linkForm.agent_id || linking}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
              >
                {linking && <Loader2 size={14} className="animate-spin" />}
                Vincular
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Agent Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 p-6">
            <h2 className="text-lg font-bold mb-4">Criar Novo Agente</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nome</label>
                <input type="text" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  placeholder="Ex: Giulia Atendimento" value={createForm.name}
                  onChange={e => setCreateForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">System Prompt</label>
                <textarea className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono min-h-[100px]"
                  placeholder="Voce e um agente de atendimento..." value={createForm.system_prompt}
                  onChange={e => setCreateForm(f => ({ ...f, system_prompt: e.target.value }))} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Primeira Mensagem</label>
                <input type="text" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  placeholder="Ola, como posso ajudar?" value={createForm.first_message}
                  onChange={e => setCreateForm(f => ({ ...f, first_message: e.target.value }))} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Idioma</label>
                <select className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  value={createForm.language} onChange={e => setCreateForm(f => ({ ...f, language: e.target.value }))}>
                  <option value="pt">Portugues</option>
                  <option value="en">English</option>
                  <option value="es">Espanol</option>
                  <option value="it">Italiano</option>
                  <option value="multi">Multilingual</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setShowCreateModal(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">
                Cancelar
              </button>
              <button onClick={createAgent} disabled={!createForm.name || !createForm.system_prompt || creating}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
                {creating && <Loader2 size={14} className="animate-spin" />}
                Criar Agente
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
