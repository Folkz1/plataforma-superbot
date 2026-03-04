'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import {
  Bot, ArrowLeft, Save, Loader2, AlertCircle, CheckCircle,
  Wrench, BookOpen, Variable, Settings2, Plus, X, Trash2,
  Phone, Globe, MessageSquare
} from 'lucide-react';

// ─── Types ─────────────────────────────────────────────────

interface AgentDetail {
  agent_id: string;
  name?: string;
  _configured_label?: string;
  _configured_channel_type?: string;
  _configured_active?: boolean;
  conversation_config?: {
    agent?: {
      prompt?: { prompt?: string; llm?: { model_id?: string; model_temperature?: number; max_tokens?: number } };
      first_message?: string;
      language?: string;
      tools?: AgentTool[];
      knowledge_base?: AgentKB[];
    };
    max_duration_seconds?: number;
  };
  platform_settings?: { widget_settings?: { name?: string } };
}

interface AgentTool {
  type?: string;
  tool_id?: string;
  name?: string;
  description?: string;
}

interface AgentKB {
  type?: string;
  id?: string;
  name?: string;
}

interface WorkspaceTool {
  tool_id?: string;
  id?: string;
  name: string;
  description?: string;
  type?: string;
  api_schema?: { url?: string; method?: string };
}

interface KBDoc {
  id?: string;
  knowledge_base_id?: string;
  name?: string;
  type?: string;
}

// ─── Constants ─────────────────────────────────────────────

const MODEL_OPTIONS = [
  { value: 'gpt-4.1-mini', label: 'GPT-4.1 Mini (rapido)' },
  { value: 'gpt-4o', label: 'GPT-4o' },
  { value: 'gpt-4.1', label: 'GPT-4.1' },
  { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
  { value: 'claude-3.5-sonnet', label: 'Claude 3.5 Sonnet' },
];

const LANGUAGE_OPTIONS = [
  { value: 'pt', label: 'Portugues' },
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Espanol' },
  { value: 'it', label: 'Italiano' },
  { value: 'multi', label: 'Multilingual' },
];

const CHANNEL_CONFIG: Record<string, { icon: any; label: string }> = {
  phone: { icon: Phone, label: 'Telefone' },
  web: { icon: Globe, label: 'Web' },
  widget: { icon: Globe, label: 'Widget' },
  text: { icon: MessageSquare, label: 'Texto' },
  whatsapp: { icon: MessageSquare, label: 'WhatsApp' },
};

type Tab = 'config' | 'tools' | 'knowledge' | 'variables';

// ─── Component ─────────────────────────────────────────────

export default function AgentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const agentId = params.agentId as string;

  const [tenantId, setTenantId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [agent, setAgent] = useState<AgentDetail | null>(null);
  const [tab, setTab] = useState<Tab>('config');
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Config form
  const [form, setForm] = useState({
    name: '',
    system_prompt: '',
    first_message: '',
    language: 'pt',
    model: 'gpt-4.1-mini',
    temperature: 0.5,
    max_tokens: 400,
    max_duration_seconds: 300,
  });

  // Tools
  const [wsTools, setWsTools] = useState<WorkspaceTool[]>([]);
  const [showToolModal, setShowToolModal] = useState(false);
  const [toolsLoading, setToolsLoading] = useState(false);
  const [selectedToolIds, setSelectedToolIds] = useState<Set<string>>(new Set());

  // Knowledge
  const [wsKB, setWsKB] = useState<KBDoc[]>([]);
  const [showKBModal, setShowKBModal] = useState(false);
  const [kbLoading, setKBLoading] = useState(false);
  const [selectedKBIds, setSelectedKBIds] = useState<Set<string>>(new Set());

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

  // ─── Load Agent + Workspace Tools/KB ───────────────────

  const loadAgent = useCallback(async (tId: string) => {
    setLoading(true);
    try {
      const [agentRes, toolsRes, kbRes] = await Promise.allSettled([
        api.get(`/api/elevenlabs/agents/${tId}/${agentId}`),
        api.get(`/api/elevenlabs/tools/${tId}`),
        api.get(`/api/elevenlabs/knowledge/${tId}`),
      ]);

      if (agentRes.status === 'fulfilled') {
        const data: AgentDetail = agentRes.value.data;
        setAgent(data);

        const cfg = data.conversation_config?.agent;
        const llm = cfg?.prompt?.llm;
        setForm({
          name: data._configured_label || data.name || data.platform_settings?.widget_settings?.name || '',
          system_prompt: cfg?.prompt?.prompt || '',
          first_message: cfg?.first_message || '',
          language: cfg?.language || 'pt',
          model: llm?.model_id || 'gpt-4.1-mini',
          temperature: llm?.model_temperature ?? 0.5,
          max_tokens: llm?.max_tokens ?? 400,
          max_duration_seconds: data.conversation_config?.max_duration_seconds ?? 300,
        });
      } else {
        setMsg({ type: 'error', text: 'Erro ao carregar agente' });
      }

      if (toolsRes.status === 'fulfilled') {
        const list = toolsRes.value.data?.tools || toolsRes.value.data || [];
        setWsTools(Array.isArray(list) ? list : []);
      }

      if (kbRes.status === 'fulfilled') {
        const list = kbRes.value.data?.knowledge_base || kbRes.value.data?.documents || kbRes.value.data || [];
        setWsKB(Array.isArray(list) ? list : []);
      }
    } catch {
      setMsg({ type: 'error', text: 'Erro ao carregar dados' });
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    if (tenantId && agentId) loadAgent(tenantId);
  }, [tenantId, agentId, loadAgent]);

  useEffect(() => {
    if (msg) {
      const t = setTimeout(() => setMsg(null), 4000);
      return () => clearTimeout(t);
    }
  }, [msg]);

  // ─── Save Config ───────────────────────────────────────

  const saveConfig = async () => {
    setSaving(true);
    try {
      await api.patch(`/api/elevenlabs/agents/${tenantId}/${agentId}`, {
        name: form.name,
        system_prompt: form.system_prompt,
        first_message: form.first_message,
        language: form.language,
        model: form.model,
        temperature: form.temperature,
        max_tokens: form.max_tokens,
        max_duration_seconds: form.max_duration_seconds,
      });
      setMsg({ type: 'success', text: 'Configuracao salva' });
      loadAgent(tenantId);
    } catch (e: any) {
      setMsg({ type: 'error', text: e?.response?.data?.detail || 'Erro ao salvar' });
    } finally {
      setSaving(false);
    }
  };

  // ─── Tools Management ─────────────────────────────────

  const agentTools = agent?.conversation_config?.agent?.tools || [];
  const agentToolIds = useMemo(() => new Set(agentTools.map(t => t.tool_id).filter(Boolean)), [agentTools]);

  // Map tool_id -> workspace tool info for name resolution
  const toolNameMap = useMemo(() => {
    const map: Record<string, WorkspaceTool> = {};
    for (const t of wsTools) {
      const id = t.tool_id || t.id || '';
      if (id) map[id] = t;
    }
    return map;
  }, [wsTools]);

  const openToolModal = async () => {
    setShowToolModal(true);
    setToolsLoading(true);
    setSelectedToolIds(new Set());
    try {
      const res = await api.get(`/api/elevenlabs/tools/${tenantId}`);
      const all = res.data?.tools || res.data || [];
      setWsTools(Array.isArray(all) ? all : []);
    } catch {
      setWsTools([]);
    } finally {
      setToolsLoading(false);
    }
  };

  const toggleTool = (toolId: string) => {
    setSelectedToolIds(prev => {
      const next = new Set(prev);
      if (next.has(toolId)) next.delete(toolId);
      else next.add(toolId);
      return next;
    });
  };

  const addTools = async () => {
    if (selectedToolIds.size === 0) return;
    setSaving(true);
    try {
      const currentIds = agentTools.map(t => t.tool_id).filter(Boolean) as string[];
      const newIds = [...new Set([...currentIds, ...selectedToolIds])];
      await api.patch(`/api/elevenlabs/agents/${tenantId}/${agentId}`, { tool_ids: newIds });
      setMsg({ type: 'success', text: `${selectedToolIds.size} tool(s) adicionada(s)` });
      setShowToolModal(false);
      loadAgent(tenantId);
    } catch (e: any) {
      setMsg({ type: 'error', text: e?.response?.data?.detail || 'Erro ao adicionar tools' });
    } finally {
      setSaving(false);
    }
  };

  const removeTool = async (toolId: string) => {
    setSaving(true);
    try {
      const currentIds = agentTools.map(t => t.tool_id).filter(Boolean) as string[];
      const newIds = currentIds.filter(id => id !== toolId);
      await api.patch(`/api/elevenlabs/agents/${tenantId}/${agentId}`, { tool_ids: newIds });
      setMsg({ type: 'success', text: 'Tool desvinculada' });
      loadAgent(tenantId);
    } catch (e: any) {
      setMsg({ type: 'error', text: e?.response?.data?.detail || 'Erro ao remover tool' });
    } finally {
      setSaving(false);
    }
  };

  // ─── Knowledge Management ─────────────────────────────

  const agentKB = agent?.conversation_config?.agent?.knowledge_base || [];
  const agentKBIds = useMemo(() => new Set(agentKB.map(k => k.id).filter(Boolean)), [agentKB]);

  // Map kb_id -> workspace KB info for name resolution
  const kbNameMap = useMemo(() => {
    const map: Record<string, KBDoc> = {};
    for (const d of wsKB) {
      const id = d.id || d.knowledge_base_id || '';
      if (id) map[id] = d;
    }
    return map;
  }, [wsKB]);

  const openKBModal = async () => {
    setShowKBModal(true);
    setKBLoading(true);
    setSelectedKBIds(new Set());
    try {
      const res = await api.get(`/api/elevenlabs/knowledge/${tenantId}`);
      const all = res.data?.knowledge_base || res.data?.documents || res.data || [];
      setWsKB(Array.isArray(all) ? all : []);
    } catch {
      setWsKB([]);
    } finally {
      setKBLoading(false);
    }
  };

  const toggleKB = (kbId: string) => {
    setSelectedKBIds(prev => {
      const next = new Set(prev);
      if (next.has(kbId)) next.delete(kbId);
      else next.add(kbId);
      return next;
    });
  };

  const addKBDocs = async () => {
    if (selectedKBIds.size === 0) return;
    setSaving(true);
    try {
      const currentIds = agentKB.map(k => k.id).filter(Boolean) as string[];
      const newIds = [...new Set([...currentIds, ...selectedKBIds])];
      await api.patch(`/api/elevenlabs/agents/${tenantId}/${agentId}`, { knowledge_base_ids: newIds });
      setMsg({ type: 'success', text: `${selectedKBIds.size} doc(s) adicionado(s)` });
      setShowKBModal(false);
      loadAgent(tenantId);
    } catch (e: any) {
      setMsg({ type: 'error', text: e?.response?.data?.detail || 'Erro ao adicionar docs' });
    } finally {
      setSaving(false);
    }
  };

  const removeKB = async (kbId: string) => {
    setSaving(true);
    try {
      const currentIds = agentKB.map(k => k.id).filter(Boolean) as string[];
      const newIds = currentIds.filter(id => id !== kbId);
      await api.patch(`/api/elevenlabs/agents/${tenantId}/${agentId}`, { knowledge_base_ids: newIds });
      setMsg({ type: 'success', text: 'Documento desvinculado' });
      loadAgent(tenantId);
    } catch (e: any) {
      setMsg({ type: 'error', text: e?.response?.data?.detail || 'Erro ao remover doc' });
    } finally {
      setSaving(false);
    }
  };

  // ─── Variables ─────────────────────────────────────────

  const extractedVars = useMemo(() => {
    const prompt = form.system_prompt || '';
    const matches = prompt.match(/\{\{(\w+)\}\}/g) || [];
    return [...new Set(matches.map(m => m.replace(/\{\{|\}\}/g, '')))];
  }, [form.system_prompt]);

  const systemVars = ['system__time', 'system__call_duration_secs', 'system__caller_id'];

  // ─── Render ───────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-blue-500" size={32} />
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="p-6 max-w-4xl mx-auto text-center py-20">
        <AlertCircle size={48} className="mx-auto mb-4 text-red-400" />
        <p className="text-lg text-gray-600">Agente nao encontrado</p>
        <button onClick={() => router.push('/dash/agents-config')} className="mt-4 text-blue-600 hover:underline">
          Voltar
        </button>
      </div>
    );
  }

  const channelType = agent._configured_channel_type || 'phone';
  const channelCfg = CHANNEL_CONFIG[channelType] || CHANNEL_CONFIG.phone;
  const ChannelIcon = channelCfg.icon;

  const tabs: { key: Tab; label: string; icon: any; count?: number }[] = [
    { key: 'config', label: 'Configuracao', icon: Settings2 },
    { key: 'tools', label: 'Tools', icon: Wrench, count: agentTools.length },
    { key: 'knowledge', label: 'Conhecimento', icon: BookOpen, count: agentKB.length },
    { key: 'variables', label: 'Variaveis', icon: Variable, count: extractedVars.length },
  ];

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => router.push('/dash/agents-config')} className="p-2 hover:bg-gray-100 rounded-lg">
          <ArrowLeft size={20} />
        </button>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center">
            <Bot size={20} className="text-blue-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">{form.name || agentId}</h1>
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <ChannelIcon size={14} />
              <span>{channelCfg.label}</span>
              <span className="text-gray-300">|</span>
              <span className="font-mono text-xs">{agentId}</span>
            </div>
          </div>
        </div>
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

      {/* Tabs */}
      <div className="flex border-b border-gray-200 mb-6">
        {tabs.map(t => {
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                tab === t.key
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <Icon size={16} />
              {t.label}
              {t.count !== undefined && (
                <span className={`ml-1 px-1.5 py-0.5 rounded-full text-xs ${
                  tab === t.key ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'
                }`}>
                  {t.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ─── Tab: Config ─────────────────────────────────── */}
      {tab === 'config' && (
        <div className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nome do Agente</label>
            <input
              type="text"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">System Prompt</label>
            <textarea
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono min-h-[200px]"
              value={form.system_prompt}
              onChange={e => setForm(f => ({ ...f, system_prompt: e.target.value }))}
            />
            <p className="text-xs text-gray-400 mt-1">Use {'{{variavel}}'} para variaveis dinamicas</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Primeira Mensagem</label>
            <textarea
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm min-h-[80px]"
              value={form.first_message}
              onChange={e => setForm(f => ({ ...f, first_message: e.target.value }))}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Idioma</label>
              <select
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                value={form.language}
                onChange={e => setForm(f => ({ ...f, language: e.target.value }))}
              >
                {LANGUAGE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Modelo</label>
              <select
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                value={form.model}
                onChange={e => setForm(f => ({ ...f, model: e.target.value }))}
              >
                {MODEL_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Temperature: {form.temperature.toFixed(2)}
              </label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                className="w-full"
                value={form.temperature}
                onChange={e => setForm(f => ({ ...f, temperature: parseFloat(e.target.value) }))}
              />
              <div className="flex justify-between text-xs text-gray-400">
                <span>Preciso</span>
                <span>Criativo</span>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Max Tokens</label>
              <input
                type="number"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                value={form.max_tokens}
                onChange={e => setForm(f => ({ ...f, max_tokens: parseInt(e.target.value) || 400 }))}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Duracao Max (seg)</label>
              <input
                type="number"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                value={form.max_duration_seconds}
                onChange={e => setForm(f => ({ ...f, max_duration_seconds: parseInt(e.target.value) || 300 }))}
              />
            </div>
          </div>

          <div className="flex justify-end pt-4 border-t">
            <button
              onClick={saveConfig}
              disabled={saving}
              className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
              Salvar Configuracao
            </button>
          </div>
        </div>
      )}

      {/* ─── Tab: Tools ──────────────────────────────────── */}
      {tab === 'tools' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-gray-500">{agentTools.length} tool(s) vinculada(s)</p>
            <button
              onClick={openToolModal}
              className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"
            >
              <Plus size={14} />
              Adicionar Tool
            </button>
          </div>

          {agentTools.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <Wrench size={32} className="mx-auto mb-2 opacity-40" />
              <p>Nenhuma tool vinculada</p>
            </div>
          ) : (
            <div className="space-y-2">
              {agentTools.map((tool, i) => {
                const resolved = tool.tool_id ? toolNameMap[tool.tool_id] : undefined;
                const displayName = tool.name || resolved?.name || tool.tool_id || `Tool ${i + 1}`;
                const displayDesc = tool.description || resolved?.description;
                return (
                <div key={tool.tool_id || i} className="flex items-center justify-between p-3 bg-white border border-gray-200 rounded-lg">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{displayName}</p>
                    {displayDesc && <p className="text-xs text-gray-500 mt-0.5">{displayDesc}</p>}
                    {tool.tool_id && <p className="text-xs text-gray-400 font-mono mt-0.5">{tool.tool_id}</p>}
                  </div>
                  <button
                    onClick={() => tool.tool_id && removeTool(tool.tool_id)}
                    disabled={saving}
                    className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded"
                    title="Desvincular"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                ); })}
            </div>
          )}
        </div>
      )}

      {/* ─── Tab: Knowledge ──────────────────────────────── */}
      {tab === 'knowledge' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-gray-500">{agentKB.length} documento(s) vinculado(s)</p>
            <button
              onClick={openKBModal}
              className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"
            >
              <Plus size={14} />
              Adicionar Documento
            </button>
          </div>

          {agentKB.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <BookOpen size={32} className="mx-auto mb-2 opacity-40" />
              <p>Nenhum documento vinculado</p>
            </div>
          ) : (
            <div className="space-y-2">
              {agentKB.map((doc, i) => {
                const resolved = doc.id ? kbNameMap[doc.id] : undefined;
                const displayName = doc.name || resolved?.name || doc.id || `Doc ${i + 1}`;
                return (
                <div key={doc.id || i} className="flex items-center justify-between p-3 bg-white border border-gray-200 rounded-lg">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{displayName}</p>
                    {doc.id && <p className="text-xs text-gray-400 font-mono mt-0.5">{doc.id}</p>}
                  </div>
                  <button
                    onClick={() => doc.id && removeKB(doc.id)}
                    disabled={saving}
                    className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded"
                    title="Desvincular"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                ); })}
            </div>
          )}
        </div>
      )}

      {/* ─── Tab: Variables ──────────────────────────────── */}
      {tab === 'variables' && (
        <div>
          {extractedVars.length > 0 && (
            <div className="mb-6">
              <h3 className="text-sm font-medium text-gray-700 mb-3">Variaveis do Prompt</h3>
              <div className="space-y-2">
                {extractedVars.map(v => (
                  <div key={v} className="flex items-center gap-3 p-3 bg-white border border-gray-200 rounded-lg">
                    <code className="text-sm font-mono text-blue-600 bg-blue-50 px-2 py-0.5 rounded">{`{{${v}}}`}</code>
                    <span className="text-sm text-gray-500 flex-1">{v}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <h3 className="text-sm font-medium text-gray-700 mb-3">Variaveis do Sistema</h3>
            <div className="space-y-2">
              {systemVars.map(v => (
                <div key={v} className="flex items-center gap-3 p-3 bg-gray-50 border border-gray-200 rounded-lg">
                  <code className="text-sm font-mono text-gray-600 bg-gray-100 px-2 py-0.5 rounded">{`{{${v}}}`}</code>
                  <span className="text-xs text-gray-400">Sistema</span>
                </div>
              ))}
            </div>
          </div>

          {extractedVars.length === 0 && (
            <div className="text-center py-8 text-gray-400 mt-6 border-t">
              <Variable size={32} className="mx-auto mb-2 opacity-40" />
              <p className="text-sm">Nenhuma variavel custom no prompt</p>
              <p className="text-xs mt-1">{'Use {{nome}} no prompt para criar variaveis'}</p>
            </div>
          )}

          <div className="mt-6 pt-4 border-t">
            <button
              onClick={() => router.push('/dash/chat-lab')}
              className="text-sm text-blue-600 hover:underline"
            >
              Testar no Chat Lab →
            </button>
          </div>
        </div>
      )}

      {/* ─── Tool Modal ──────────────────────────────────── */}
      {showToolModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b">
              <h2 className="text-lg font-bold">Adicionar Tools</h2>
              <button onClick={() => setShowToolModal(false)} className="p-1 hover:bg-gray-100 rounded">
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {toolsLoading ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 className="animate-spin text-blue-500" size={24} />
                </div>
              ) : (
                <div className="space-y-2">
                  {wsTools.filter(t => !agentToolIds.has(t.tool_id || t.id || '')).map(tool => {
                    const tid = tool.tool_id || tool.id || '';
                    return (
                      <label key={tid} className="flex items-start gap-3 p-3 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedToolIds.has(tid)}
                          onChange={() => toggleTool(tid)}
                          className="mt-0.5"
                        />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-900">{tool.name}</p>
                          {tool.description && <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{tool.description}</p>}
                          {tool.api_schema?.url && <p className="text-xs text-gray-400 font-mono mt-0.5 truncate">{tool.api_schema.url}</p>}
                        </div>
                      </label>
                    );
                  })}
                  {wsTools.filter(t => !agentToolIds.has(t.tool_id || t.id || '')).length === 0 && (
                    <p className="text-sm text-gray-400 text-center py-6">Todas as tools ja estao vinculadas</p>
                  )}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 p-4 border-t">
              <button onClick={() => setShowToolModal(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">
                Cancelar
              </button>
              <button
                onClick={addTools}
                disabled={selectedToolIds.size === 0 || saving}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
              >
                {saving && <Loader2 size={14} className="animate-spin" />}
                Vincular ({selectedToolIds.size})
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── KB Modal ────────────────────────────────────── */}
      {showKBModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b">
              <h2 className="text-lg font-bold">Adicionar Documentos</h2>
              <button onClick={() => setShowKBModal(false)} className="p-1 hover:bg-gray-100 rounded">
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {kbLoading ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 className="animate-spin text-blue-500" size={24} />
                </div>
              ) : (
                <div className="space-y-2">
                  {wsKB.filter(d => !agentKBIds.has(d.id || d.knowledge_base_id || '')).map(doc => {
                    const did = doc.id || doc.knowledge_base_id || '';
                    return (
                      <label key={did} className="flex items-start gap-3 p-3 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedKBIds.has(did)}
                          onChange={() => toggleKB(did)}
                          className="mt-0.5"
                        />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-900">{doc.name || did}</p>
                          {doc.type && <span className="text-xs text-gray-400">{doc.type}</span>}
                        </div>
                      </label>
                    );
                  })}
                  {wsKB.filter(d => !agentKBIds.has(d.id || d.knowledge_base_id || '')).length === 0 && (
                    <p className="text-sm text-gray-400 text-center py-6">Todos os documentos ja estao vinculados</p>
                  )}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 p-4 border-t">
              <button onClick={() => setShowKBModal(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">
                Cancelar
              </button>
              <button
                onClick={addKBDocs}
                disabled={selectedKBIds.size === 0 || saving}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
              >
                {saving && <Loader2 size={14} className="animate-spin" />}
                Vincular ({selectedKBIds.size})
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
