'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import {
  Bot, ArrowLeft, Save, Loader2, AlertCircle, CheckCircle,
  Wrench, BookOpen, Settings2, Plus, X, Trash2,
  Phone, Globe, MessageSquare, Upload, Pencil, ChevronDown, HelpCircle
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
      prompt?: {
        prompt?: string;
        llm?: { model_id?: string; model_temperature?: number; max_tokens?: number };
        tools?: AgentTool[];
        tool_ids?: string[];
        knowledge_base?: AgentKB[];
      };
      first_message?: string;
      language?: string;
    };
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

// Workspace tool format from ElevenLabs API: { id, tool_config: { name, description, type, api_schema } }
interface WorkspaceTool {
  id: string;
  tool_config?: {
    type?: string;
    name?: string;
    description?: string;
    api_schema?: { url?: string; method?: string };
  };
}

interface KBDoc {
  id?: string;
  knowledge_base_id?: string;
  name?: string;
  type?: string;
}

interface ToolPropertyRow {
  id: string;
  type: 'string' | 'number' | 'boolean';
  value_type: 'llm_prompt' | 'constant' | 'dynamic_variable';
  description: string;
  required: boolean;
}

// ─── Helpers ───────────────────────────────────────────────

function getToolId(t: WorkspaceTool): string { return t.id || ''; }
function getToolName(t: WorkspaceTool): string { return t.tool_config?.name || t.id || '?'; }
function getToolDesc(t: WorkspaceTool): string { return t.tool_config?.description || ''; }
function getToolUrl(t: WorkspaceTool): string { return t.tool_config?.api_schema?.url || ''; }
function getKBId(d: KBDoc): string { return d.id || d.knowledge_base_id || ''; }

// ─── Constants ─────────────────────────────────────────────

const MODEL_OPTIONS = [
  { value: 'gpt-4.1-mini', label: 'GPT-4.1 Mini' },
  { value: 'gpt-4o', label: 'GPT-4o' },
  { value: 'gpt-4.1', label: 'GPT-4.1' },
  { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
  { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  { value: 'claude-3.5-sonnet', label: 'Claude 3.5 Sonnet' },
  { value: 'x-ai/grok-4.1-fast', label: 'Grok 4.1 Fast (OpenRouter)' },
  { value: 'x-ai/grok-3-mini', label: 'Grok 3 Mini (OpenRouter)' },
  { value: 'custom-llm', label: 'Custom LLM (OpenRouter)' },
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

type Tab = 'config' | 'tools' | 'knowledge';

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
  });

  // Tools
  const [wsTools, setWsTools] = useState<WorkspaceTool[]>([]);
  const [showToolModal, setShowToolModal] = useState(false);
  const [toolsLoading, setToolsLoading] = useState(false);
  const [selectedToolIds, setSelectedToolIds] = useState<Set<string>>(new Set());
  const [showCreateTool, setShowCreateTool] = useState(false);
  const [newTool, setNewTool] = useState({ name: '', description: '', url: '', method: 'POST', bodySchemaJson: '{\n  "type": "object",\n  "properties": {},\n  "required": []\n}' });
  const [creatingTool, setCreatingTool] = useState(false);
  const [toolProperties, setToolProperties] = useState<ToolPropertyRow[]>([]);
  const [useJsonMode, setUseJsonMode] = useState(false);
  const [toolTimeout, setToolTimeout] = useState(20);
  const [toolDisableInterruptions, setToolDisableInterruptions] = useState(false);
  const [toolHeaders, setToolHeaders] = useState<{ key: string; value: string }[]>([]);
  const [editingToolId, setEditingToolId] = useState<string | null>(null);
  const [loadingToolDetail, setLoadingToolDetail] = useState(false);
  const [deletingToolId, setDeletingToolId] = useState<string | null>(null);

  // Knowledge
  const [wsKB, setWsKB] = useState<KBDoc[]>([]);
  const [showKBModal, setShowKBModal] = useState(false);
  const [kbLoading, setKBLoading] = useState(false);
  const [selectedKBIds, setSelectedKBIds] = useState<Set<string>>(new Set());
  const [showCreateKB, setShowCreateKB] = useState(false);
  const [newKB, setNewKB] = useState({ name: '', type: 'text' as 'text' | 'url', content: '' });
  const [creatingKB, setCreatingKB] = useState(false);

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

  const agentTools = agent?.conversation_config?.agent?.prompt?.tools || [];
  const agentToolIds = useMemo(() => new Set(agentTools.map(t => t.tool_id).filter(Boolean)), [agentTools]);

  // Map tool_id -> workspace tool info for name resolution
  const toolNameMap = useMemo(() => {
    const map: Record<string, WorkspaceTool> = {};
    for (const t of wsTools) {
      const id = getToolId(t);
      if (id) map[id] = t;
    }
    return map;
  }, [wsTools]);

  const openToolModal = async () => {
    setShowToolModal(true);
    setShowCreateTool(false);
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

  const resetToolForm = () => {
    setNewTool({ name: '', description: '', url: '', method: 'POST', bodySchemaJson: '{\n  "type": "object",\n  "properties": {},\n  "required": []\n}' });
    setToolProperties([]);
    setUseJsonMode(false);
    setToolTimeout(20);
    setToolDisableInterruptions(false);
    setToolHeaders([]);
    setEditingToolId(null);
  };

  const buildToolPayload = () => {
    const payload: any = {
      name: newTool.name,
      description: newTool.description,
      type: 'webhook',
      url: newTool.url,
      method: newTool.method,
      response_timeout_secs: toolTimeout,
      disable_interruptions: toolDisableInterruptions,
    };
    if (toolHeaders.length > 0) {
      const h: Record<string, string> = {};
      toolHeaders.forEach(kv => { if (kv.key) h[kv.key] = kv.value; });
      if (Object.keys(h).length > 0) payload.headers = h;
    }
    if (useJsonMode) {
      try {
        if (newTool.bodySchemaJson.trim()) {
          payload.request_body_schema = JSON.parse(newTool.bodySchemaJson);
        }
      } catch {
        return null; // invalid JSON
      }
    } else {
      payload.properties = toolProperties.map(p => ({
        id: p.id,
        type: p.type,
        value_type: p.value_type,
        description: p.description,
        required: p.required,
      }));
    }
    return payload;
  };

  const createTool = async () => {
    if (!newTool.name || !newTool.url) return;
    const payload = buildToolPayload();
    if (!payload) {
      setMsg({ type: 'error', text: 'JSON do Body Schema invalido' });
      return;
    }
    setCreatingTool(true);
    try {
      await api.post(`/api/elevenlabs/tools/${tenantId}`, payload);
      setMsg({ type: 'success', text: `Tool "${newTool.name}" criada` });
      resetToolForm();
      setShowCreateTool(false);
      const res = await api.get(`/api/elevenlabs/tools/${tenantId}`);
      const all = res.data?.tools || res.data || [];
      setWsTools(Array.isArray(all) ? all : []);
    } catch (e: any) {
      setMsg({ type: 'error', text: e?.response?.data?.detail || 'Erro ao criar tool' });
    } finally {
      setCreatingTool(false);
    }
  };

  const startEditTool = async (toolId: string) => {
    setLoadingToolDetail(true);
    setEditingToolId(toolId);
    setShowCreateTool(true);
    try {
      const res = await api.get(`/api/elevenlabs/tools/${tenantId}/${toolId}`);
      const t = res.data;
      const tc = t?.tool_config || {};
      const schema = tc?.api_schema || {};
      setNewTool({
        name: tc.name || '',
        description: tc.description || '',
        url: schema.url || '',
        method: schema.method || 'POST',
        bodySchemaJson: schema.request_body_schema ? JSON.stringify(schema.request_body_schema, null, 2) : '{}',
      });
      setToolTimeout(schema.response_timeout_secs ?? 20);
      setToolDisableInterruptions(tc.disable_interruptions ?? false);
      // Parse headers
      const rh = schema.request_headers || {};
      setToolHeaders(Object.entries(rh).map(([key, value]) => ({ key, value: String(value) })));
      // Parse properties
      const rbs = schema.request_body_schema;
      if (rbs && Array.isArray(rbs.properties)) {
        setUseJsonMode(false);
        setToolProperties(rbs.properties.map((p: any) => ({
          id: p.id || '',
          type: p.type || 'string',
          value_type: p.value_type || 'llm_prompt',
          description: p.description || '',
          required: p.required ?? false,
        })));
      } else {
        setUseJsonMode(true);
        setToolProperties([]);
      }
    } catch (e: any) {
      setMsg({ type: 'error', text: 'Erro ao carregar tool' });
      setShowCreateTool(false);
      setEditingToolId(null);
    } finally {
      setLoadingToolDetail(false);
    }
  };

  const saveEditTool = async () => {
    if (!editingToolId || !newTool.name || !newTool.url) return;
    const payload = buildToolPayload();
    if (!payload) {
      setMsg({ type: 'error', text: 'JSON do Body Schema invalido' });
      return;
    }
    setCreatingTool(true);
    try {
      await api.patch(`/api/elevenlabs/tools/${tenantId}/${editingToolId}`, payload);
      setMsg({ type: 'success', text: `Tool "${newTool.name}" atualizada` });
      resetToolForm();
      setShowCreateTool(false);
      const res = await api.get(`/api/elevenlabs/tools/${tenantId}`);
      const all = res.data?.tools || res.data || [];
      setWsTools(Array.isArray(all) ? all : []);
    } catch (e: any) {
      setMsg({ type: 'error', text: e?.response?.data?.detail || 'Erro ao atualizar tool' });
    } finally {
      setCreatingTool(false);
    }
  };

  const deleteWorkspaceTool = async (toolId: string) => {
    setDeletingToolId(toolId);
    try {
      await api.delete(`/api/elevenlabs/tools/${tenantId}/${toolId}`);
      setMsg({ type: 'success', text: 'Tool removida do workspace' });
      const res = await api.get(`/api/elevenlabs/tools/${tenantId}`);
      const all = res.data?.tools || res.data || [];
      setWsTools(Array.isArray(all) ? all : []);
      // Reload agent to update linked tools
      loadAgent(tenantId);
    } catch (e: any) {
      setMsg({ type: 'error', text: e?.response?.data?.detail || 'Erro ao deletar tool' });
    } finally {
      setDeletingToolId(null);
    }
  };

  // ─── Knowledge Management ─────────────────────────────

  const agentKB = agent?.conversation_config?.agent?.prompt?.knowledge_base || [];
  const agentKBIds = useMemo(() => new Set(agentKB.map(k => k.id).filter(Boolean)), [agentKB]);

  const kbNameMap = useMemo(() => {
    const map: Record<string, KBDoc> = {};
    for (const d of wsKB) {
      const id = getKBId(d);
      if (id) map[id] = d;
    }
    return map;
  }, [wsKB]);

  const openKBModal = async () => {
    setShowKBModal(true);
    setShowCreateKB(false);
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

  const createKBDoc = async () => {
    if (!newKB.name || !newKB.content) return;
    setCreatingKB(true);
    try {
      await api.post(`/api/elevenlabs/knowledge/${tenantId}`, {
        name: newKB.name,
        type: newKB.type,
        ...(newKB.type === 'url' ? { url: newKB.content } : { text: newKB.content }),
      });
      setMsg({ type: 'success', text: `Documento "${newKB.name}" criado` });
      setNewKB({ name: '', type: 'text', content: '' });
      setShowCreateKB(false);
      // Reload KB list
      const res = await api.get(`/api/elevenlabs/knowledge/${tenantId}`);
      const all = res.data?.knowledge_base || res.data?.documents || res.data || [];
      setWsKB(Array.isArray(all) ? all : []);
    } catch (e: any) {
      setMsg({ type: 'error', text: e?.response?.data?.detail || 'Erro ao criar documento' });
    } finally {
      setCreatingKB(false);
    }
  };

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
              <label className="block text-sm font-medium text-gray-700 mb-1">Modelo LLM</label>
              <select
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                value={form.model}
                onChange={e => setForm(f => ({ ...f, model: e.target.value }))}
              >
                {MODEL_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
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
                const displayName = tool.name || getToolName(resolved as any) || tool.tool_id || `Tool ${i + 1}`;
                const displayDesc = tool.description || (resolved ? getToolDesc(resolved) : '');
                return (
                  <div key={tool.tool_id || i} className="flex items-center justify-between p-3 bg-white border border-gray-200 rounded-lg">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-900">{displayName}</p>
                      {displayDesc && <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">{displayDesc}</p>}
                      {resolved && getToolUrl(resolved) && (
                        <p className="text-xs text-gray-400 font-mono mt-0.5 truncate">{getToolUrl(resolved)}</p>
                      )}
                    </div>
                    <button
                      onClick={() => tool.tool_id && removeTool(tool.tool_id)}
                      disabled={saving}
                      className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded ml-2"
                      title="Desvincular"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                );
              })}
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
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ─── Tool Modal ──────────────────────────────────── */}
      {showToolModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b">
              <h2 className="text-lg font-bold">{showCreateTool ? (editingToolId ? 'Editar Tool' : 'Criar Nova Tool') : 'Adicionar Tools'}</h2>
              <button onClick={() => setShowToolModal(false)} className="p-1 hover:bg-gray-100 rounded">
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {showCreateTool ? (
                loadingToolDetail ? (
                  <div className="flex items-center justify-center py-10">
                    <Loader2 className="animate-spin text-blue-500" size={24} />
                  </div>
                ) : (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Nome <span className="text-gray-400 font-normal" title="Identificador unico da tool (snake_case)">(?)</span></label>
                    <input type="text" className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Ex: send_whatsapp_order"
                      value={newTool.name} onChange={e => setNewTool(f => ({ ...f, name: e.target.value }))} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Descricao <span className="text-gray-400 font-normal" title="Explique ao agente quando e por que usar essa tool">(?)</span></label>
                    <textarea className="w-full border rounded-lg px-3 py-2 text-sm min-h-[60px]" placeholder="Ex: Envia pedido para o sistema de delivery..."
                      value={newTool.description} onChange={e => setNewTool(f => ({ ...f, description: e.target.value }))} />
                  </div>
                  <div className="grid grid-cols-[1fr_auto] gap-2">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">URL do Webhook</label>
                      <input type="text" className="w-full border rounded-lg px-3 py-2 text-sm font-mono" placeholder="https://n8n.example.com/webhook/..."
                        value={newTool.url} onChange={e => setNewTool(f => ({ ...f, url: e.target.value }))} />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Metodo</label>
                      <select className="w-full border rounded-lg px-3 py-2 text-sm"
                        value={newTool.method} onChange={e => setNewTool(f => ({ ...f, method: e.target.value }))}>
                        <option value="POST">POST</option>
                        <option value="GET">GET</option>
                        <option value="PUT">PUT</option>
                      </select>
                    </div>
                  </div>

                  {/* Parameters section */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-xs font-medium text-gray-600">
                        Parametros <span className="text-gray-400 font-normal" title="Dados que o agente coleta e envia ao webhook">(?)</span>
                      </label>
                      <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">
                        <input type="checkbox" checked={useJsonMode} onChange={e => setUseJsonMode(e.target.checked)} className="rounded" />
                        JSON manual
                      </label>
                    </div>

                    {useJsonMode ? (
                      <div>
                        <textarea
                          className="w-full border rounded-lg px-3 py-2 text-sm font-mono min-h-[120px]"
                          placeholder={'{\n  "type": "object",\n  "properties": {\n    "message": { "type": "string", "description": "..." }\n  },\n  "required": ["message"]\n}'}
                          value={newTool.bodySchemaJson}
                          onChange={e => setNewTool(f => ({ ...f, bodySchemaJson: e.target.value }))}
                        />
                      </div>
                    ) : (
                      <div className="border rounded-lg overflow-hidden">
                        {toolProperties.length > 0 && (
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="bg-gray-50 text-gray-500">
                                <th className="px-2 py-1.5 text-left font-medium">Nome</th>
                                <th className="px-2 py-1.5 text-left font-medium">Tipo</th>
                                <th className="px-2 py-1.5 text-left font-medium">Descricao</th>
                                <th className="px-2 py-1.5 text-center font-medium" title="Campo obrigatorio">Req</th>
                                <th className="px-1 py-1.5"></th>
                              </tr>
                            </thead>
                            <tbody>
                              {toolProperties.map((prop, idx) => (
                                <tr key={idx} className="border-t">
                                  <td className="px-2 py-1">
                                    <input type="text" className="w-full border rounded px-1.5 py-1 text-xs font-mono"
                                      placeholder="customer_name" value={prop.id}
                                      onChange={e => { const next = [...toolProperties]; next[idx] = { ...next[idx], id: e.target.value }; setToolProperties(next); }} />
                                  </td>
                                  <td className="px-2 py-1">
                                    <select className="w-full border rounded px-1 py-1 text-xs" value={prop.type}
                                      onChange={e => { const next = [...toolProperties]; next[idx] = { ...next[idx], type: e.target.value as any }; setToolProperties(next); }}>
                                      <option value="string">string</option>
                                      <option value="number">number</option>
                                      <option value="boolean">boolean</option>
                                    </select>
                                  </td>
                                  <td className="px-2 py-1">
                                    <input type="text" className="w-full border rounded px-1.5 py-1 text-xs"
                                      placeholder="Nome do cliente" value={prop.description}
                                      onChange={e => { const next = [...toolProperties]; next[idx] = { ...next[idx], description: e.target.value }; setToolProperties(next); }} />
                                  </td>
                                  <td className="px-2 py-1 text-center">
                                    <input type="checkbox" checked={prop.required}
                                      onChange={e => { const next = [...toolProperties]; next[idx] = { ...next[idx], required: e.target.checked }; setToolProperties(next); }} />
                                  </td>
                                  <td className="px-1 py-1">
                                    <button onClick={() => setToolProperties(p => p.filter((_, i) => i !== idx))}
                                      className="p-0.5 text-red-400 hover:text-red-600"><X size={12} /></button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                        <button onClick={() => setToolProperties(p => [...p, { id: '', type: 'string', value_type: 'llm_prompt', description: '', required: false }])}
                          className="w-full px-3 py-2 text-xs text-blue-600 hover:bg-blue-50 flex items-center gap-1 justify-center">
                          <Plus size={12} /> Adicionar parametro
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Advanced options */}
                  <details className="border rounded-lg">
                    <summary className="px-3 py-2 text-xs font-medium text-gray-600 cursor-pointer flex items-center gap-1 hover:bg-gray-50">
                      <ChevronDown size={12} /> Opcoes Avancadas
                    </summary>
                    <div className="px-3 pb-3 space-y-3 border-t pt-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1" title="Tempo maximo de espera pela resposta do webhook">
                            Timeout (s) <span className="text-gray-400">(?)</span>
                          </label>
                          <input type="number" min={1} max={120} className="w-full border rounded-lg px-3 py-1.5 text-sm"
                            value={toolTimeout} onChange={e => setToolTimeout(parseInt(e.target.value) || 20)} />
                        </div>
                        <div className="flex items-end pb-1">
                          <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer" title="Impede o agente de falar enquanto aguarda resposta da tool">
                            <input type="checkbox" checked={toolDisableInterruptions} onChange={e => setToolDisableInterruptions(e.target.checked)} />
                            Desabilitar interrupcoes
                          </label>
                        </div>
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <label className="text-xs font-medium text-gray-600">Headers HTTP</label>
                          <button onClick={() => setToolHeaders(h => [...h, { key: '', value: '' }])}
                            className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-0.5"><Plus size={10} /> Adicionar</button>
                        </div>
                        {toolHeaders.map((h, idx) => (
                          <div key={idx} className="flex gap-1 mb-1">
                            <input type="text" className="flex-1 border rounded px-2 py-1 text-xs font-mono" placeholder="Authorization"
                              value={h.key} onChange={e => { const next = [...toolHeaders]; next[idx] = { ...next[idx], key: e.target.value }; setToolHeaders(next); }} />
                            <input type="text" className="flex-[2] border rounded px-2 py-1 text-xs font-mono" placeholder="Bearer ..."
                              value={h.value} onChange={e => { const next = [...toolHeaders]; next[idx] = { ...next[idx], value: e.target.value }; setToolHeaders(next); }} />
                            <button onClick={() => setToolHeaders(hh => hh.filter((_, i) => i !== idx))}
                              className="p-0.5 text-red-400 hover:text-red-600"><X size={12} /></button>
                          </div>
                        ))}
                        {toolHeaders.length === 0 && <p className="text-xs text-gray-400">Nenhum header extra</p>}
                      </div>
                    </div>
                  </details>
                </div>
                )
              ) : toolsLoading ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 className="animate-spin text-blue-500" size={24} />
                </div>
              ) : (
                <div className="space-y-2">
                  {wsTools.filter(t => !agentToolIds.has(getToolId(t))).map(tool => {
                    const tid = getToolId(tool);
                    return (
                      <div key={tid} className="flex items-start gap-3 p-3 border border-gray-200 rounded-lg hover:bg-gray-50">
                        <input type="checkbox" checked={selectedToolIds.has(tid)} onChange={() => toggleTool(tid)} className="mt-1 cursor-pointer" />
                        <label className="min-w-0 flex-1 cursor-pointer" onClick={() => toggleTool(tid)}>
                          <p className="text-sm font-medium text-gray-900">{getToolName(tool)}</p>
                          {getToolDesc(tool) && <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{getToolDesc(tool)}</p>}
                          {getToolUrl(tool) && <p className="text-xs text-gray-400 font-mono mt-0.5 truncate">{getToolUrl(tool)}</p>}
                        </label>
                        <div className="flex gap-1 shrink-0">
                          <button onClick={() => startEditTool(tid)} className="p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded" title="Editar tool">
                            <Pencil size={13} />
                          </button>
                          <button onClick={() => { if (confirm(`Deletar tool "${getToolName(tool)}" do workspace? Isso remove de TODOS os agentes.`)) deleteWorkspaceTool(tid); }}
                            disabled={deletingToolId === tid}
                            className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded" title="Deletar do workspace">
                            {deletingToolId === tid ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                  {wsTools.filter(t => !agentToolIds.has(getToolId(t))).length === 0 && (
                    <p className="text-sm text-gray-400 text-center py-6">Todas as tools ja estao vinculadas</p>
                  )}
                </div>
              )}
            </div>

            <div className="flex justify-between gap-2 p-4 border-t">
              <div>
                {!showCreateTool && (
                  <button onClick={() => { resetToolForm(); setShowCreateTool(true); }} className="flex items-center gap-1 px-3 py-2 text-sm text-blue-600 hover:bg-blue-50 rounded-lg">
                    <Plus size={14} /> Criar Nova
                  </button>
                )}
                {showCreateTool && (
                  <button onClick={() => { resetToolForm(); setShowCreateTool(false); }} className="px-3 py-2 text-sm text-gray-600 hover:text-gray-800">
                    ← Voltar
                  </button>
                )}
              </div>
              <div className="flex gap-2">
                <button onClick={() => { resetToolForm(); setShowToolModal(false); }} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">
                  Cancelar
                </button>
                {showCreateTool ? (
                  editingToolId ? (
                    <button onClick={saveEditTool} disabled={!newTool.name || !newTool.url || creatingTool}
                      className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 flex items-center gap-2">
                      {creatingTool && <Loader2 size={14} className="animate-spin" />}
                      Salvar Alteracoes
                    </button>
                  ) : (
                    <button onClick={createTool} disabled={!newTool.name || !newTool.url || creatingTool}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
                      {creatingTool && <Loader2 size={14} className="animate-spin" />}
                      Criar Tool
                    </button>
                  )
                ) : (
                  <button onClick={addTools} disabled={selectedToolIds.size === 0 || saving}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
                    {saving && <Loader2 size={14} className="animate-spin" />}
                    Vincular ({selectedToolIds.size})
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── KB Modal ────────────────────────────────────── */}
      {showKBModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b">
              <h2 className="text-lg font-bold">{showCreateKB ? 'Criar Documento' : 'Adicionar Documentos'}</h2>
              <button onClick={() => setShowKBModal(false)} className="p-1 hover:bg-gray-100 rounded">
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {showCreateKB ? (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Nome</label>
                    <input type="text" className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Ex: Cardápio Gianni"
                      value={newKB.name} onChange={e => setNewKB(f => ({ ...f, name: e.target.value }))} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Tipo</label>
                    <select className="w-full border rounded-lg px-3 py-2 text-sm"
                      value={newKB.type} onChange={e => setNewKB(f => ({ ...f, type: e.target.value as 'text' | 'url' }))}>
                      <option value="text">Texto</option>
                      <option value="url">URL</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      {newKB.type === 'url' ? 'URL' : 'Conteudo'}
                    </label>
                    {newKB.type === 'url' ? (
                      <input type="text" className="w-full border rounded-lg px-3 py-2 text-sm font-mono" placeholder="https://..."
                        value={newKB.content} onChange={e => setNewKB(f => ({ ...f, content: e.target.value }))} />
                    ) : (
                      <textarea className="w-full border rounded-lg px-3 py-2 text-sm font-mono min-h-[120px]"
                        placeholder="Cole o conteudo aqui..."
                        value={newKB.content} onChange={e => setNewKB(f => ({ ...f, content: e.target.value }))} />
                    )}
                  </div>
                </div>
              ) : kbLoading ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 className="animate-spin text-blue-500" size={24} />
                </div>
              ) : (
                <div className="space-y-2">
                  {wsKB.filter(d => !agentKBIds.has(getKBId(d))).map(doc => {
                    const did = getKBId(doc);
                    return (
                      <label key={did} className="flex items-start gap-3 p-3 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer">
                        <input type="checkbox" checked={selectedKBIds.has(did)} onChange={() => toggleKB(did)} className="mt-0.5" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-900">{doc.name || did}</p>
                          {doc.type && <span className="text-xs text-gray-400">{doc.type}</span>}
                        </div>
                      </label>
                    );
                  })}
                  {wsKB.filter(d => !agentKBIds.has(getKBId(d))).length === 0 && (
                    <p className="text-sm text-gray-400 text-center py-6">Todos os documentos ja estao vinculados</p>
                  )}
                </div>
              )}
            </div>

            <div className="flex justify-between gap-2 p-4 border-t">
              <div>
                {!showCreateKB && (
                  <button onClick={() => setShowCreateKB(true)} className="flex items-center gap-1 px-3 py-2 text-sm text-blue-600 hover:bg-blue-50 rounded-lg">
                    <Upload size={14} /> Criar Novo
                  </button>
                )}
                {showCreateKB && (
                  <button onClick={() => setShowCreateKB(false)} className="px-3 py-2 text-sm text-gray-600 hover:text-gray-800">
                    ← Voltar
                  </button>
                )}
              </div>
              <div className="flex gap-2">
                <button onClick={() => setShowKBModal(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">
                  Cancelar
                </button>
                {showCreateKB ? (
                  <button onClick={createKBDoc} disabled={!newKB.name || !newKB.content || creatingKB}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
                    {creatingKB && <Loader2 size={14} className="animate-spin" />}
                    Criar Documento
                  </button>
                ) : (
                  <button onClick={addKBDocs} disabled={selectedKBIds.size === 0 || saving}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
                    {saving && <Loader2 size={14} className="animate-spin" />}
                    Vincular ({selectedKBIds.size})
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
