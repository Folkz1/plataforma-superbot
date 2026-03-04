'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import {
  Bot, Plus, Trash2, Save, Loader2, CheckCircle, AlertCircle,
  Wrench, Settings2, BookOpen, X, Copy, Pencil, Power, Variable,
  Globe, Phone, MessageSquare, ChevronDown, ChevronRight, Link2, Unlink
} from 'lucide-react';

// ─── Types ─────────────────────────────────────────────────

interface ElevenLabsAgent {
  agent_id: string;
  name?: string;
  _missing?: boolean;
  _configured_label?: string;
  _configured_channel_type?: string;
  _configured_active?: boolean;
  conversation_config?: {
    agent?: {
      prompt?: { prompt?: string };
      first_message?: string;
      language?: string;
      tools?: any[];
    };
  };
  tts_config?: { voice_id?: string };
  platform_settings?: { widget_settings?: { name?: string } };
}

interface WorkspaceTool {
  tool_id?: string;
  id?: string;
  name: string;
  description?: string;
  type?: string;
  api_schema?: {
    url?: string;
    method?: string;
    headers?: Record<string, string>;
    request_body_schema?: any;
  };
}

interface KBDoc {
  id?: string;
  knowledge_base_id?: string;
  name?: string;
  type?: string;
  created_at?: string;
}

interface Voice {
  voice_id: string;
  name: string;
  category?: string;
  labels?: Record<string, string>;
}

// ─── Constants ─────────────────────────────────────────────

const CHANNEL_ICONS: Record<string, any> = {
  phone: Phone,
  web: Globe,
  whatsapp: MessageSquare,
  widget: Globe,
  text: MessageSquare,
};

const MODEL_OPTIONS = [
  { value: 'gpt-4.1-mini', label: 'GPT-4.1 Mini (rapido)' },
  { value: 'gpt-4o', label: 'GPT-4o' },
  { value: 'gpt-4.1', label: 'GPT-4.1' },
];

const LANGUAGE_OPTIONS = [
  { value: 'pt', label: 'Portugues' },
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Espanol' },
  { value: 'it', label: 'Italiano' },
  { value: 'multi', label: 'Multilingual' },
];

// ─── Component ─────────────────────────────────────────────

export default function AgentsConfigPage() {
  const [tenantId, setTenantId] = useState('');
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Tab state
  const [tab, setTab] = useState<'agents' | 'tools' | 'knowledge' | 'variables'>('agents');

  // Agents
  const [agents, setAgents] = useState<ElevenLabsAgent[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<ElevenLabsAgent | null>(null);
  const [showAgentModal, setShowAgentModal] = useState(false);
  const [agentSaving, setAgentSaving] = useState(false);
  const [agentForm, setAgentForm] = useState({
    name: '', system_prompt: '', first_message: '', language: 'pt',
    voice_id: '', model: 'gpt-4.1-mini',
  });

  // Voices (for agent create/edit)
  const [voices, setVoices] = useState<Voice[]>([]);

  // Tools
  const [tools, setTools] = useState<WorkspaceTool[]>([]);
  const [showToolModal, setShowToolModal] = useState(false);
  const [editingTool, setEditingTool] = useState<WorkspaceTool | null>(null);
  const [toolSaving, setToolSaving] = useState(false);
  const [toolForm, setToolForm] = useState({
    name: '', description: '', type: 'webhook', url: '', method: 'POST',
    body_schema: '{}',
  });

  // Knowledge Base
  const [kbDocs, setKbDocs] = useState<KBDoc[]>([]);
  const [showKBModal, setShowKBModal] = useState(false);
  const [kbSaving, setKbSaving] = useState(false);
  const [kbForm, setKbForm] = useState({ name: '', type: 'text', text: '', url: '' });

  // Dynamic Variables
  const [dynamicVars, setDynamicVars] = useState<Record<string, string>>({});

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

  // ─── Load Data ─────────────────────────────────────────

  const loadAgents = useCallback(async (tId: string) => {
    try {
      const res = await api.get(`/api/elevenlabs/agents/${tId}`);
      const list = res.data?.agents || [];
      setAgents(list);
    } catch { setAgents([]); }
  }, []);

  const loadTools = useCallback(async (tId: string) => {
    try {
      const res = await api.get(`/api/elevenlabs/tools/${tId}`);
      const list = res.data?.tools || res.data || [];
      setTools(Array.isArray(list) ? list : []);
    } catch { setTools([]); }
  }, []);

  const loadKB = useCallback(async (tId: string) => {
    try {
      const res = await api.get(`/api/elevenlabs/knowledge/${tId}`);
      const list = res.data?.knowledge_base || res.data?.documents || res.data || [];
      setKbDocs(Array.isArray(list) ? list : []);
    } catch { setKbDocs([]); }
  }, []);

  const loadVoices = useCallback(async (tId: string) => {
    try {
      const res = await api.get(`/api/elevenlabs/voices/${tId}`);
      setVoices(res.data?.voices || []);
    } catch { setVoices([]); }
  }, []);

  const loadAll = useCallback(async (tId: string) => {
    setLoading(true);
    await Promise.allSettled([loadAgents(tId), loadTools(tId), loadKB(tId), loadVoices(tId)]);
    setLoading(false);
  }, [loadAgents, loadTools, loadKB, loadVoices]);

  useEffect(() => {
    if (tenantId) loadAll(tenantId);
  }, [tenantId, loadAll]);

  // Auto-dismiss messages
  useEffect(() => {
    if (msg) {
      const t = setTimeout(() => setMsg(null), 4000);
      return () => clearTimeout(t);
    }
  }, [msg]);

  // ─── Agent Handlers ────────────────────────────────────

  const openAgentCreate = () => {
    setSelectedAgent(null);
    setAgentForm({ name: '', system_prompt: '', first_message: '', language: 'pt', voice_id: '', model: 'gpt-4.1-mini' });
    setShowAgentModal(true);
  };

  const openAgentEdit = (agent: ElevenLabsAgent) => {
    setSelectedAgent(agent);
    const cfg = agent.conversation_config?.agent;
    setAgentForm({
      name: agent.name || agent.platform_settings?.widget_settings?.name || '',
      system_prompt: cfg?.prompt?.prompt || '',
      first_message: cfg?.first_message || '',
      language: cfg?.language || 'pt',
      voice_id: agent.tts_config?.voice_id || '',
      model: 'gpt-4.1-mini',
    });
    // Extract dynamic variables from prompt
    const prompt = cfg?.prompt?.prompt || '';
    const varMatches = prompt.match(/\{\{(\w+)\}\}/g) || [];
    const vars: Record<string, string> = {};
    varMatches.forEach(m => {
      const key = m.replace(/\{\{|\}\}/g, '');
      if (!key.startsWith('system__')) vars[key] = '';
    });
    setDynamicVars(vars);
    setShowAgentModal(true);
  };

  const handleSaveAgent = async () => {
    if (!tenantId || !agentForm.name) return;
    setAgentSaving(true);
    try {
      if (selectedAgent) {
        await api.patch(`/api/elevenlabs/agents/${tenantId}/${selectedAgent.agent_id}`, {
          name: agentForm.name,
          system_prompt: agentForm.system_prompt,
          first_message: agentForm.first_message,
          language: agentForm.language,
        });
        setMsg({ type: 'success', text: 'Agente atualizado!' });
      } else {
        await api.post(`/api/elevenlabs/agents/${tenantId}`, {
          name: agentForm.name,
          system_prompt: agentForm.system_prompt,
          first_message: agentForm.first_message,
          language: agentForm.language,
          voice_id: agentForm.voice_id || 'JBFqnCBsd6RMkjVDRZzb',
        });
        setMsg({ type: 'success', text: 'Agente criado!' });
      }
      setShowAgentModal(false);
      await loadAgents(tenantId);
    } catch (err: any) {
      setMsg({ type: 'error', text: err.response?.data?.detail || 'Erro ao salvar agente' });
    } finally {
      setAgentSaving(false);
    }
  };

  const handleToggleAgent = async (agent: ElevenLabsAgent) => {
    if (!tenantId) return;
    const isActive = agent._configured_active !== false;
    try {
      if (isActive) {
        await api.delete(`/api/elevenlabs/active-agents/${tenantId}/${agent.agent_id}`);
        setMsg({ type: 'success', text: 'Agente desativado' });
      } else {
        await api.post(`/api/elevenlabs/active-agents/${tenantId}`, {
          agent_id: agent.agent_id,
          channel_type: agent._configured_channel_type || 'phone',
          active: true,
        });
        setMsg({ type: 'success', text: 'Agente ativado' });
      }
      await loadAgents(tenantId);
    } catch (err: any) {
      setMsg({ type: 'error', text: err.response?.data?.detail || 'Erro ao alterar status' });
    }
  };

  const handleDeleteAgent = async (agent: ElevenLabsAgent) => {
    if (!tenantId || !confirm(`Remover agente "${agent.name || agent.agent_id}"? Isso remove do ElevenLabs permanentemente.`)) return;
    try {
      await api.delete(`/api/elevenlabs/agents/${tenantId}/${agent.agent_id}`);
      setMsg({ type: 'success', text: 'Agente removido' });
      await loadAgents(tenantId);
    } catch (err: any) {
      setMsg({ type: 'error', text: err.response?.data?.detail || 'Erro ao remover agente' });
    }
  };

  // ─── Tool Handlers ─────────────────────────────────────

  const openToolCreate = () => {
    setEditingTool(null);
    setToolForm({ name: '', description: '', type: 'webhook', url: '', method: 'POST', body_schema: '{}' });
    setShowToolModal(true);
  };

  const openToolEdit = (tool: WorkspaceTool) => {
    setEditingTool(tool);
    setToolForm({
      name: tool.name,
      description: tool.description || '',
      type: tool.type || 'webhook',
      url: tool.api_schema?.url || '',
      method: tool.api_schema?.method || 'POST',
      body_schema: JSON.stringify(tool.api_schema?.request_body_schema || {}, null, 2),
    });
    setShowToolModal(true);
  };

  const handleSaveTool = async () => {
    if (!tenantId || !toolForm.name) return;
    setToolSaving(true);
    let bodySchema = {};
    try { bodySchema = JSON.parse(toolForm.body_schema); } catch {}
    const payload = {
      name: toolForm.name,
      description: toolForm.description,
      type: toolForm.type,
      url: toolForm.url,
      method: toolForm.method,
      body_schema: bodySchema,
    };
    try {
      const toolId = editingTool?.tool_id || editingTool?.id;
      if (toolId) {
        await api.patch(`/api/elevenlabs/tools/${tenantId}/${toolId}`, payload);
        setMsg({ type: 'success', text: 'Tool atualizada!' });
      } else {
        await api.post(`/api/elevenlabs/tools/${tenantId}`, payload);
        setMsg({ type: 'success', text: 'Tool criada!' });
      }
      setShowToolModal(false);
      await loadTools(tenantId);
    } catch (err: any) {
      setMsg({ type: 'error', text: err.response?.data?.detail || 'Erro ao salvar tool' });
    } finally {
      setToolSaving(false);
    }
  };

  const handleDeleteTool = async (tool: WorkspaceTool) => {
    const toolId = tool.tool_id || tool.id;
    if (!tenantId || !toolId || !confirm(`Remover tool "${tool.name}"?`)) return;
    try {
      await api.delete(`/api/elevenlabs/tools/${tenantId}/${toolId}`);
      setMsg({ type: 'success', text: 'Tool removida' });
      await loadTools(tenantId);
    } catch (err: any) {
      setMsg({ type: 'error', text: err.response?.data?.detail || 'Erro ao remover tool' });
    }
  };

  const applyToolTemplate = (template: string) => {
    if (template === 'calcom') {
      setToolForm({
        name: 'check_availability',
        description: 'Verificar disponibilidade de horarios e agendar reunioes via Cal.com',
        type: 'webhook', url: '', method: 'POST',
        body_schema: JSON.stringify({ date: { type: 'string', description: 'Data no formato YYYY-MM-DD' } }, null, 2),
      });
    } else if (template === 'save_info') {
      setToolForm({
        name: 'save_user_info',
        description: 'Salvar informacoes coletadas do usuario (nome, email, telefone)',
        type: 'webhook', url: '', method: 'POST',
        body_schema: JSON.stringify({ name: { type: 'string' }, email: { type: 'string' }, phone: { type: 'string' } }, null, 2),
      });
    } else if (template === 'transfer') {
      setToolForm({
        name: 'transfer_to_human',
        description: 'Transferir conversa para atendente humano quando necessario',
        type: 'webhook', url: '', method: 'POST',
        body_schema: JSON.stringify({ reason: { type: 'string', description: 'Motivo da transferencia' } }, null, 2),
      });
    }
    setShowToolModal(true);
    setEditingTool(null);
  };

  // ─── KB Handlers ───────────────────────────────────────

  const handleAddKB = async () => {
    if (!tenantId || !kbForm.name) return;
    setKbSaving(true);
    try {
      await api.post(`/api/elevenlabs/knowledge/${tenantId}`, {
        type: kbForm.type,
        name: kbForm.name,
        text: kbForm.text,
        url: kbForm.url,
      });
      setMsg({ type: 'success', text: 'Documento adicionado!' });
      setShowKBModal(false);
      setKbForm({ name: '', type: 'text', text: '', url: '' });
      await loadKB(tenantId);
    } catch (err: any) {
      setMsg({ type: 'error', text: err.response?.data?.detail || 'Erro ao adicionar documento' });
    } finally {
      setKbSaving(false);
    }
  };

  const handleDeleteKB = async (doc: KBDoc) => {
    const docId = doc.id || doc.knowledge_base_id;
    if (!tenantId || !docId || !confirm(`Remover "${doc.name}"?`)) return;
    try {
      await api.delete(`/api/elevenlabs/knowledge/${tenantId}/${docId}`);
      setMsg({ type: 'success', text: 'Documento removido' });
      await loadKB(tenantId);
    } catch (err: any) {
      setMsg({ type: 'error', text: err.response?.data?.detail || 'Erro ao remover documento' });
    }
  };

  // ─── Render ────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6 max-w-6xl">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <Bot className="w-6 h-6 text-blue-600" />
          Agente IA
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Gerencie agentes ElevenLabs, tools, base de conhecimento e variaveis
        </p>
      </div>

      {/* Message Toast */}
      {msg && (
        <div className={`flex items-center gap-2 mb-4 px-4 py-3 rounded-lg text-sm ${
          msg.type === 'success' ? 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300'
        }`}>
          {msg.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          {msg.text}
          <button onClick={() => setMsg(null)} className="ml-auto"><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-gray-200 dark:border-gray-700">
        {([
          { key: 'agents' as const, label: `Agentes (${agents.length})`, icon: <Bot className="w-4 h-4" /> },
          { key: 'tools' as const, label: `Tools (${tools.length})`, icon: <Wrench className="w-4 h-4" /> },
          { key: 'knowledge' as const, label: `Conhecimento (${kbDocs.length})`, icon: <BookOpen className="w-4 h-4" /> },
          { key: 'variables' as const, label: 'Variaveis', icon: <Variable className="w-4 h-4" /> },
        ]).map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-lg transition ${
              tab === t.key
                ? 'bg-blue-50 text-blue-700 border-b-2 border-blue-600 dark:bg-blue-900/20 dark:text-blue-300'
                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:bg-gray-800'
            }`}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* ═══ TAB: AGENTS ═══ */}
      {tab === 'agents' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-sm text-gray-500 dark:text-gray-400">Agentes ElevenLabs do workspace. Clique para editar.</p>
            <button onClick={openAgentCreate}
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition">
              <Plus className="w-4 h-4" /> Criar Agente
            </button>
          </div>

          {agents.length === 0 ? (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-8 text-center">
              <Bot className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
              <p className="text-sm font-medium text-gray-900 dark:text-white">Nenhum agente configurado</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Crie ou vincule agentes ElevenLabs ao projeto.</p>
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {agents.map(agent => {
                const channelType = agent._configured_channel_type || 'phone';
                const ChannelIcon = CHANNEL_ICONS[channelType] || Phone;
                const isActive = agent._configured_active !== false;
                const toolCount = agent.conversation_config?.agent?.tools?.length || 0;

                return (
                  <div key={agent.agent_id}
                    className={`bg-white dark:bg-gray-800 rounded-xl border p-4 transition hover:shadow-md cursor-pointer ${
                      isActive ? 'border-gray-200 dark:border-gray-700' : 'border-gray-100 dark:border-gray-800 opacity-60'
                    }`}
                    onClick={() => openAgentEdit(agent)}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg ${isActive ? 'bg-blue-100 dark:bg-blue-900/30' : 'bg-gray-100 dark:bg-gray-700'}`}>
                          <ChannelIcon className={`w-5 h-5 ${isActive ? 'text-blue-600 dark:text-blue-400' : 'text-gray-400'}`} />
                        </div>
                        <div>
                          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                            {agent._configured_label || agent.name || agent.platform_settings?.widget_settings?.name || agent.agent_id}
                          </h3>
                          <p className="text-xs text-gray-500 dark:text-gray-400 font-mono mt-0.5">{agent.agent_id}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                        <button onClick={() => handleToggleAgent(agent)}
                          className={`p-1.5 rounded-lg transition ${isActive ? 'text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20' : 'text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
                          title={isActive ? 'Desativar' : 'Ativar'}>
                          <Power className="w-4 h-4" />
                        </button>
                        <button onClick={() => handleDeleteAgent(agent)}
                          className="p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition"
                          title="Remover">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {/* Badges */}
                    <div className="flex flex-wrap gap-1.5 mt-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                        isActive ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
                      }`}>
                        {isActive ? 'Ativo' : 'Inativo'}
                      </span>
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
                        <ChannelIcon className="w-3 h-3" /> {channelType}
                      </span>
                      {toolCount > 0 && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                          <Wrench className="w-3 h-3" /> {toolCount} tools
                        </span>
                      )}
                      {agent._missing && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300">
                          Nao encontrado
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ═══ TAB: TOOLS ═══ */}
      {tab === 'tools' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-sm text-gray-500 dark:text-gray-400">Tools do workspace ElevenLabs. Disponiveis para todos os agentes.</p>
            <button onClick={openToolCreate}
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition">
              <Plus className="w-4 h-4" /> Nova Tool
            </button>
          </div>

          {tools.length === 0 ? (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-8 text-center">
              <Wrench className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
              <p className="text-sm font-medium text-gray-900 dark:text-white">Nenhuma tool no workspace</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Crie webhooks para os agentes usarem como ferramentas.</p>
            </div>
          ) : (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 overflow-hidden">
              <table className="w-full">
                <thead className="bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
                  <tr>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Nome</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Tipo</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase hidden md:table-cell">URL</th>
                    <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Acoes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
                  {tools.map(tool => {
                    const toolId = tool.tool_id || tool.id || tool.name;
                    return (
                      <tr key={toolId} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                        <td className="px-4 py-3">
                          <p className="text-sm font-medium text-gray-900 dark:text-white">{tool.name}</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400 max-w-[200px] truncate">{tool.description}</p>
                        </td>
                        <td className="px-4 py-3">
                          <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                            {tool.type || 'webhook'}
                          </span>
                        </td>
                        <td className="px-4 py-3 hidden md:table-cell">
                          <span className="text-xs text-gray-500 dark:text-gray-400 font-mono max-w-[250px] truncate block">
                            {tool.api_schema?.url || '-'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button onClick={() => openToolEdit(tool)}
                              className="p-1.5 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition">
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button onClick={() => handleDeleteTool(tool)}
                              className="p-1.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Templates */}
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4">
            <p className="text-sm font-medium text-blue-800 dark:text-blue-200 mb-2">Templates de tools</p>
            <div className="flex flex-wrap gap-2">
              {[
                { key: 'calcom', label: 'Cal.com - Agendamento' },
                { key: 'save_info', label: 'Salvar Info Usuario' },
                { key: 'transfer', label: 'Transferir para Humano' },
              ].map(t => (
                <button key={t.key} onClick={() => applyToolTemplate(t.key)}
                  className="inline-flex items-center gap-2 px-3 py-2 text-sm text-blue-700 dark:text-blue-300 bg-white dark:bg-gray-800 border border-blue-200 dark:border-blue-700 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/30 transition">
                  <Plus className="w-4 h-4" /> {t.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ═══ TAB: KNOWLEDGE BASE ═══ */}
      {tab === 'knowledge' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-sm text-gray-500 dark:text-gray-400">Documentos do workspace ElevenLabs usados como contexto (RAG).</p>
            <button onClick={() => { setKbForm({ name: '', type: 'text', text: '', url: '' }); setShowKBModal(true); }}
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition">
              <Plus className="w-4 h-4" /> Adicionar
            </button>
          </div>

          {kbDocs.length === 0 ? (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-8 text-center">
              <BookOpen className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
              <p className="text-sm font-medium text-gray-900 dark:text-white">Nenhum documento na base</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Adicione textos, URLs ou arquivos para os agentes consultarem.</p>
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {kbDocs.map(doc => {
                const docId = doc.id || doc.knowledge_base_id;
                return (
                  <div key={docId} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-4">
                    <div className="flex justify-between items-start gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <BookOpen className="w-4 h-4 text-blue-500 flex-shrink-0" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{doc.name || docId}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="px-1.5 py-0.5 text-xs rounded bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                              {doc.type || 'text'}
                            </span>
                            {doc.created_at && (
                              <span className="text-xs text-gray-400">{new Date(doc.created_at).toLocaleDateString('pt-BR')}</span>
                            )}
                          </div>
                        </div>
                      </div>
                      <button onClick={() => handleDeleteKB(doc)}
                        className="p-1.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition flex-shrink-0">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ═══ TAB: DYNAMIC VARIABLES ═══ */}
      {tab === 'variables' && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-6">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-1">Variaveis Dinamicas</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
              Use <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">{'{{nome_variavel}}'}</code> no prompt do agente.
              Valores sao passados ao iniciar a conversa.
            </p>

            {/* System variables */}
            <div className="mb-6">
              <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-2">Variaveis do Sistema</h4>
              <div className="grid gap-2 md:grid-cols-2">
                {[
                  { name: 'system__time', desc: 'Hora atual (automatico)' },
                  { name: 'system__call_duration_secs', desc: 'Duracao da chamada em segundos' },
                ].map(v => (
                  <div key={v.name} className="flex items-center gap-3 px-3 py-2 bg-gray-50 dark:bg-gray-900 rounded-lg">
                    <code className="text-xs text-purple-600 dark:text-purple-400 font-mono">{`{{${v.name}}}`}</code>
                    <span className="text-xs text-gray-500 dark:text-gray-400">{v.desc}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Custom variables - extracted from selected agent */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Variaveis Customizadas</h4>
                <button onClick={() => setDynamicVars(prev => ({ ...prev, [`var_${Date.now()}`]: '' }))}
                  className="flex items-center gap-1 px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition">
                  <Plus className="w-3 h-3" /> Adicionar
                </button>
              </div>

              {Object.keys(dynamicVars).length === 0 ? (
                <div className="text-center py-6">
                  <Variable className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Selecione um agente na aba Agentes para ver as variaveis do prompt,
                    ou adicione novas variaveis manualmente.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {Object.entries(dynamicVars).map(([key, val]) => (
                    <div key={key} className="flex items-center gap-2">
                      <code className="text-xs text-purple-600 dark:text-purple-400 font-mono min-w-[140px] bg-gray-50 dark:bg-gray-900 px-2 py-1.5 rounded">
                        {`{{${key}}}`}
                      </code>
                      <input type="text" value={val}
                        onChange={e => setDynamicVars(prev => ({ ...prev, [key]: e.target.value }))}
                        placeholder="Valor default"
                        className="flex-1 px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500" />
                      <button onClick={() => {
                        const copy = { ...dynamicVars };
                        delete copy[key];
                        setDynamicVars(copy);
                      }}
                        className="p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Test in Chat Lab */}
            <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
              <a href="/dash/chat-lab"
                className="inline-flex items-center gap-2 px-4 py-2 text-sm text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-700 rounded-lg hover:bg-purple-100 dark:hover:bg-purple-900/40 transition">
                <ChevronRight className="w-4 h-4" /> Testar no Chat Lab
              </a>
            </div>
          </div>
        </div>
      )}

      {/* ═══ MODAL: AGENT CREATE/EDIT ═══ */}
      {showAgentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center sticky top-0 bg-white dark:bg-gray-800">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                {selectedAgent ? 'Editar Agente' : 'Novo Agente'}
              </h3>
              <button onClick={() => setShowAgentModal(false)} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>
            <div className="px-6 py-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nome</label>
                <input type="text" value={agentForm.name}
                  onChange={e => setAgentForm(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white bg-white dark:bg-gray-700 focus:ring-2 focus:ring-blue-500"
                  placeholder="Ex: Giulia" />
              </div>
              {!selectedAgent && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Voz</label>
                    <select value={agentForm.voice_id}
                      onChange={e => setAgentForm(prev => ({ ...prev, voice_id: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white bg-white dark:bg-gray-700 focus:ring-2 focus:ring-blue-500">
                      <option value="">Selecione uma voz</option>
                      {voices.map(v => (
                        <option key={v.voice_id} value={v.voice_id}>{v.name} {v.labels?.accent ? `(${v.labels.accent})` : ''}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Idioma</label>
                    <select value={agentForm.language}
                      onChange={e => setAgentForm(prev => ({ ...prev, language: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white bg-white dark:bg-gray-700 focus:ring-2 focus:ring-blue-500">
                      {LANGUAGE_OPTIONS.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
                    </select>
                  </div>
                </>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">System Prompt</label>
                <textarea value={agentForm.system_prompt}
                  onChange={e => setAgentForm(prev => ({ ...prev, system_prompt: e.target.value }))}
                  rows={8}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white bg-white dark:bg-gray-700 focus:ring-2 focus:ring-blue-500 text-sm font-mono"
                  placeholder="Voce e um assistente virtual..." />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Primeira mensagem</label>
                <input type="text" value={agentForm.first_message}
                  onChange={e => setAgentForm(prev => ({ ...prev, first_message: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white bg-white dark:bg-gray-700 focus:ring-2 focus:ring-blue-500"
                  placeholder="Ola! Como posso ajudar?" />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3 sticky bottom-0 bg-white dark:bg-gray-800">
              <button onClick={() => setShowAgentModal(false)}
                className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition">
                Cancelar
              </button>
              <button onClick={handleSaveAgent} disabled={agentSaving || !agentForm.name}
                className="flex items-center gap-2 px-6 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition disabled:opacity-50">
                {agentSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                {selectedAgent ? 'Salvar' : 'Criar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ MODAL: TOOL CREATE/EDIT ═══ */}
      {showToolModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center sticky top-0 bg-white dark:bg-gray-800">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                {editingTool ? 'Editar Tool' : 'Nova Tool'}
              </h3>
              <button onClick={() => setShowToolModal(false)} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>
            <div className="px-6 py-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nome (function name)</label>
                <input type="text" value={toolForm.name}
                  onChange={e => setToolForm(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white bg-white dark:bg-gray-700 focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                  placeholder="check_availability" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Descricao (para o LLM)</label>
                <textarea value={toolForm.description}
                  onChange={e => setToolForm(prev => ({ ...prev, description: e.target.value }))}
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white bg-white dark:bg-gray-700 focus:ring-2 focus:ring-blue-500 text-sm"
                  placeholder="O que esta tool faz..." />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Tipo</label>
                  <select value={toolForm.type}
                    onChange={e => setToolForm(prev => ({ ...prev, type: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white bg-white dark:bg-gray-700 focus:ring-2 focus:ring-blue-500">
                    <option value="webhook">Webhook</option>
                    <option value="client">Client</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Metodo</label>
                  <select value={toolForm.method}
                    onChange={e => setToolForm(prev => ({ ...prev, method: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white bg-white dark:bg-gray-700 focus:ring-2 focus:ring-blue-500">
                    {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
              </div>
              {toolForm.type === 'webhook' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Webhook URL</label>
                  <input type="url" value={toolForm.url}
                    onChange={e => setToolForm(prev => ({ ...prev, url: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white bg-white dark:bg-gray-700 focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                    placeholder="https://..." />
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Body Schema (JSON)</label>
                <textarea value={toolForm.body_schema}
                  onChange={e => setToolForm(prev => ({ ...prev, body_schema: e.target.value }))}
                  rows={5}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white bg-white dark:bg-gray-700 focus:ring-2 focus:ring-blue-500 font-mono text-xs"
                  placeholder='{ "param": { "type": "string" } }' />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3 sticky bottom-0 bg-white dark:bg-gray-800">
              <button onClick={() => setShowToolModal(false)}
                className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition">
                Cancelar
              </button>
              <button onClick={handleSaveTool} disabled={toolSaving || !toolForm.name}
                className="flex items-center gap-2 px-6 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition disabled:opacity-50">
                {toolSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                {editingTool ? 'Salvar' : 'Criar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ MODAL: KB ADD ═══ */}
      {showKBModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-lg mx-4">
            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Adicionar Documento</h3>
              <button onClick={() => setShowKBModal(false)} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>
            <div className="px-6 py-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nome</label>
                <input type="text" value={kbForm.name}
                  onChange={e => setKbForm(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white bg-white dark:bg-gray-700 focus:ring-2 focus:ring-blue-500"
                  placeholder="FAQ, Manual do produto..." />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Tipo</label>
                <div className="flex gap-2">
                  {[
                    { value: 'text', label: 'Texto' },
                    { value: 'url', label: 'URL' },
                  ].map(t => (
                    <button key={t.value}
                      onClick={() => setKbForm(prev => ({ ...prev, type: t.value }))}
                      className={`px-4 py-2 text-sm rounded-lg border transition ${
                        kbForm.type === t.value
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600'
                      }`}>
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
              {kbForm.type === 'text' ? (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Conteudo</label>
                  <textarea value={kbForm.text}
                    onChange={e => setKbForm(prev => ({ ...prev, text: e.target.value }))}
                    rows={8}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white bg-white dark:bg-gray-700 focus:ring-2 focus:ring-blue-500 text-sm"
                    placeholder="Cole aqui o texto, FAQ, regras de atendimento..." />
                </div>
              ) : (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">URL do documento</label>
                  <input type="url" value={kbForm.url}
                    onChange={e => setKbForm(prev => ({ ...prev, url: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white bg-white dark:bg-gray-700 focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                    placeholder="https://..." />
                </div>
              )}
            </div>
            <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3">
              <button onClick={() => setShowKBModal(false)}
                className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition">
                Cancelar
              </button>
              <button onClick={handleAddKB} disabled={kbSaving || !kbForm.name || (kbForm.type === 'text' ? !kbForm.text : !kbForm.url)}
                className="flex items-center gap-2 px-6 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition disabled:opacity-50">
                {kbSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                Adicionar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
