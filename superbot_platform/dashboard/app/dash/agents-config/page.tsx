'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import {
  Bot, Plus, Trash2, Save, Loader2, CheckCircle, AlertCircle,
  Wrench, Settings2, BookOpen, X
} from 'lucide-react';

interface Agent {
  id: string;
  name: string;
  system_prompt: string;
  llm_model: string;
  first_message: string;
  voice_id?: string;
  send_audio: boolean;
  is_active: boolean;
  settings?: Record<string, any>;
}

interface Tool {
  id: string;
  name: string;
  description: string;
  webhook_url: string;
  parameters?: any[];
}

interface KnowledgeItem {
  id: string;
  content: string;
  metadata?: Record<string, any>;
  created_at?: string;
}

const MODEL_OPTIONS = [
  { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash (rapido)' },
  { value: 'gemini-2.0-pro', label: 'Gemini 2.0 Pro (avancado)' },
  { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
  { value: 'gpt-4o', label: 'GPT-4o' },
  { value: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4' },
];

export default function AgentsConfigPage() {
  const [tenantId, setTenantId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Agent
  const [agent, setAgent] = useState<Agent | null>(null);
  const [agentForm, setAgentForm] = useState({
    name: '', system_prompt: '', llm_model: 'gemini-2.0-flash',
    first_message: '', send_audio: false,
  });

  // Tools
  const [tools, setTools] = useState<Tool[]>([]);
  const [showToolForm, setShowToolForm] = useState(false);
  const [toolForm, setToolForm] = useState({ name: '', description: '', webhook_url: '' });
  const [toolSaving, setToolSaving] = useState(false);

  // Knowledge
  const [knowledge, setKnowledge] = useState<KnowledgeItem[]>([]);
  const [showKnowledgeForm, setShowKnowledgeForm] = useState(false);
  const [knowledgeForm, setKnowledgeForm] = useState({ content: '' });
  const [knowledgeSaving, setKnowledgeSaving] = useState(false);

  // Active tab
  const [tab, setTab] = useState<'agent' | 'tools' | 'knowledge'>('agent');

  useEffect(() => {
    const userData = localStorage.getItem('user');
    if (!userData) return;
    const user = JSON.parse(userData);
    const tId = user.role === 'admin'
      ? localStorage.getItem('active_tenant_id')
      : user.client_id;
    if (tId) setTenantId(tId);
  }, []);

  const loadAll = useCallback(async (tId: string) => {
    setLoading(true);
    try {
      const [agentRes, toolsRes, knowledgeRes] = await Promise.allSettled([
        api.get(`/api/agents/${tId}/active`),
        api.get(`/api/agents/${tId}/tools`),
        api.get(`/api/agents/${tId}/knowledge`),
      ]);

      if (agentRes.status === 'fulfilled' && agentRes.value.data?.agent) {
        const a = agentRes.value.data.agent;
        setAgent(a);
        setAgentForm({
          name: a.name || '',
          system_prompt: a.system_prompt || '',
          llm_model: a.llm_model || 'gemini-2.0-flash',
          first_message: a.first_message || '',
          send_audio: a.send_audio || false,
        });
      } else {
        setAgent(null);
      }

      if (toolsRes.status === 'fulfilled') {
        setTools(toolsRes.value.data?.tools || []);
      }

      if (knowledgeRes.status === 'fulfilled') {
        setKnowledge(knowledgeRes.value.data?.knowledge || []);
      }
    } catch {
      setMsg({ type: 'error', text: 'Erro ao carregar dados do agente' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tenantId) loadAll(tenantId);
  }, [tenantId, loadAll]);

  const handleSaveAgent = async () => {
    if (!tenantId) return;
    setSaving(true);
    setMsg(null);
    try {
      if (agent) {
        await api.patch(`/api/agents/${tenantId}/${agent.id}`, agentForm);
      } else {
        await api.post(`/api/agents/${tenantId}`, agentForm);
      }
      setMsg({ type: 'success', text: 'Agente salvo!' });
      await loadAll(tenantId);
    } catch (err: any) {
      setMsg({ type: 'error', text: err.response?.data?.detail || 'Erro ao salvar agente' });
    } finally {
      setSaving(false);
    }
  };

  const handleAddTool = async () => {
    if (!tenantId || !toolForm.name || !toolForm.webhook_url) return;
    setToolSaving(true);
    try {
      await api.post(`/api/agents/${tenantId}/tools`, toolForm);
      setShowToolForm(false);
      setToolForm({ name: '', description: '', webhook_url: '' });
      await loadAll(tenantId);
    } catch (err: any) {
      setMsg({ type: 'error', text: err.response?.data?.detail || 'Erro ao adicionar tool' });
    } finally {
      setToolSaving(false);
    }
  };

  const handleDeleteTool = async (toolId: string) => {
    if (!tenantId || !confirm('Remover esta tool?')) return;
    try {
      await api.delete(`/api/agents/${tenantId}/tools/${toolId}`);
      await loadAll(tenantId);
    } catch {}
  };

  const handleAddKnowledge = async () => {
    if (!tenantId || !knowledgeForm.content) return;
    setKnowledgeSaving(true);
    try {
      await api.post(`/api/agents/${tenantId}/knowledge`, { content: knowledgeForm.content });
      setShowKnowledgeForm(false);
      setKnowledgeForm({ content: '' });
      await loadAll(tenantId);
    } catch (err: any) {
      setMsg({ type: 'error', text: err.response?.data?.detail || 'Erro ao adicionar conhecimento' });
    } finally {
      setKnowledgeSaving(false);
    }
  };

  const handleDeleteKnowledge = async (kId: string) => {
    if (!tenantId || !confirm('Remover este item?')) return;
    try {
      await api.delete(`/api/agents/${tenantId}/knowledge/${kId}`);
      await loadAll(tenantId);
    } catch {}
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6 max-w-5xl">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
          <Bot className="w-6 h-6 text-blue-600" />
          Agente de IA
        </h1>
        <p className="text-sm text-gray-500 mt-1">Configure o agente de texto, tools e base de conhecimento</p>
      </div>

      {/* Message */}
      {msg && (
        <div className={`flex items-center gap-2 mb-4 px-4 py-3 rounded-lg text-sm ${
          msg.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
        }`}>
          {msg.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          {msg.text}
          <button onClick={() => setMsg(null)} className="ml-auto"><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b">
        {[
          { key: 'agent' as const, label: 'Agente', icon: <Settings2 className="w-4 h-4" /> },
          { key: 'tools' as const, label: `Tools (${tools.length})`, icon: <Wrench className="w-4 h-4" /> },
          { key: 'knowledge' as const, label: `Conhecimento (${knowledge.length})`, icon: <BookOpen className="w-4 h-4" /> },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-lg transition ${
              tab === t.key ? 'bg-blue-50 text-blue-700 border-b-2 border-blue-600' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
            }`}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* Agent Tab */}
      {tab === 'agent' && (
        <div className="bg-white rounded-xl border border-gray-100 p-6 space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nome do agente</label>
            <input type="text" value={agentForm.name}
              onChange={(e) => setAgentForm(prev => ({ ...prev, name: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white focus:ring-2 focus:ring-blue-500"
              placeholder="Ex: Giulia" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Modelo LLM</label>
            <select value={agentForm.llm_model}
              onChange={(e) => setAgentForm(prev => ({ ...prev, llm_model: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white focus:ring-2 focus:ring-blue-500">
              {MODEL_OPTIONS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">System Prompt</label>
            <textarea value={agentForm.system_prompt}
              onChange={(e) => setAgentForm(prev => ({ ...prev, system_prompt: e.target.value }))}
              rows={8}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white focus:ring-2 focus:ring-blue-500 text-sm font-mono"
              placeholder="Voce e um assistente virtual..." />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Primeira mensagem</label>
            <input type="text" value={agentForm.first_message}
              onChange={(e) => setAgentForm(prev => ({ ...prev, first_message: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white focus:ring-2 focus:ring-blue-500"
              placeholder="Ola! Como posso ajudar?" />
          </div>
          <div className="flex items-center gap-3">
            <label className="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" checked={agentForm.send_audio}
                onChange={(e) => setAgentForm(prev => ({ ...prev, send_audio: e.target.checked }))}
                className="sr-only peer" />
              <div className="w-9 h-5 bg-gray-200 peer-focus:ring-2 peer-focus:ring-blue-300 rounded-full peer peer-checked:bg-blue-600 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-full" />
            </label>
            <span className="text-sm text-gray-700">Enviar respostas em audio</span>
          </div>
          <div className="pt-2">
            <button onClick={handleSaveAgent} disabled={saving || !agentForm.name}
              className="flex items-center gap-2 px-6 py-2.5 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition disabled:opacity-50">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {agent ? 'Salvar alteracoes' : 'Criar agente'}
            </button>
          </div>
        </div>
      )}

      {/* Tools Tab */}
      {tab === 'tools' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-sm text-gray-500">Webhooks que o agente pode chamar durante as conversas.</p>
            <button onClick={() => setShowToolForm(true)}
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition">
              <Plus className="w-4 h-4" /> Adicionar Tool
            </button>
          </div>

          {tools.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-100 p-8 text-center">
              <Wrench className="w-10 h-10 text-gray-300 mx-auto mb-3" />
              <p className="text-sm font-medium text-gray-900">Nenhuma tool configurada</p>
              <p className="text-xs text-gray-500 mt-1">Adicione webhooks para o agente usar como ferramentas.</p>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
              <table className="w-full">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">Nome</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">Descricao</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">URL</th>
                    <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500 uppercase">Acao</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {tools.map(tool => (
                    <tr key={tool.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">{tool.name}</td>
                      <td className="px-4 py-3 text-sm text-gray-600 max-w-[200px] truncate">{tool.description}</td>
                      <td className="px-4 py-3 text-xs text-gray-500 font-mono max-w-[200px] truncate">{tool.webhook_url}</td>
                      <td className="px-4 py-3 text-right">
                        <button onClick={() => handleDeleteTool(tool.id)}
                          className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Cal.com Template */}
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
            <p className="text-sm font-medium text-blue-800 mb-2">Templates de tools</p>
            <button onClick={() => {
              setToolForm({
                name: 'check_availability',
                description: 'Verificar disponibilidade de horarios e agendar reunioes',
                webhook_url: '',
              });
              setShowToolForm(true);
            }}
              className="inline-flex items-center gap-2 px-3 py-2 text-sm text-blue-700 bg-white border border-blue-200 rounded-lg hover:bg-blue-50 transition">
              <Plus className="w-4 h-4" />
              Cal.com - Agendamento
            </button>
          </div>

          {/* Add Tool Modal */}
          {showToolForm && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
              <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4">
                <div className="px-6 py-4 border-b flex justify-between items-center">
                  <h3 className="text-lg font-semibold text-gray-900">Nova Tool</h3>
                  <button onClick={() => setShowToolForm(false)} className="p-1 hover:bg-gray-100 rounded-lg">
                    <X className="w-5 h-5 text-gray-500" />
                  </button>
                </div>
                <div className="px-6 py-4 space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Nome (function name)</label>
                    <input type="text" value={toolForm.name}
                      onChange={(e) => setToolForm(prev => ({ ...prev, name: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white focus:ring-2 focus:ring-blue-500"
                      placeholder="check_availability" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Descricao</label>
                    <textarea value={toolForm.description}
                      onChange={(e) => setToolForm(prev => ({ ...prev, description: e.target.value }))}
                      rows={3}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white focus:ring-2 focus:ring-blue-500 text-sm"
                      placeholder="O que esta tool faz..." />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Webhook URL</label>
                    <input type="url" value={toolForm.webhook_url}
                      onChange={(e) => setToolForm(prev => ({ ...prev, webhook_url: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                      placeholder="https://..." />
                  </div>
                </div>
                <div className="px-6 py-4 border-t flex justify-end gap-3">
                  <button onClick={() => setShowToolForm(false)}
                    className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition">
                    Cancelar
                  </button>
                  <button onClick={handleAddTool} disabled={toolSaving || !toolForm.name || !toolForm.webhook_url}
                    className="flex items-center gap-2 px-6 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition disabled:opacity-50">
                    {toolSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                    Adicionar
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Knowledge Tab */}
      {tab === 'knowledge' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-sm text-gray-500">Documentos e informacoes que o agente usa como contexto (RAG).</p>
            <button onClick={() => setShowKnowledgeForm(true)}
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition">
              <Plus className="w-4 h-4" /> Adicionar
            </button>
          </div>

          {knowledge.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-100 p-8 text-center">
              <BookOpen className="w-10 h-10 text-gray-300 mx-auto mb-3" />
              <p className="text-sm font-medium text-gray-900">Nenhum conhecimento adicionado</p>
              <p className="text-xs text-gray-500 mt-1">Adicione textos, FAQs ou documentos para o agente consultar.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {knowledge.map(item => (
                <div key={item.id} className="bg-white rounded-xl border border-gray-100 p-4">
                  <div className="flex justify-between items-start gap-3">
                    <p className="text-sm text-gray-700 whitespace-pre-wrap line-clamp-4">{item.content}</p>
                    <button onClick={() => handleDeleteKnowledge(item.id)}
                      className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition flex-shrink-0">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  {item.created_at && (
                    <p className="text-xs text-gray-400 mt-2">{new Date(item.created_at).toLocaleDateString('pt-BR')}</p>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Add Knowledge Modal */}
          {showKnowledgeForm && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
              <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4">
                <div className="px-6 py-4 border-b flex justify-between items-center">
                  <h3 className="text-lg font-semibold text-gray-900">Adicionar Conhecimento</h3>
                  <button onClick={() => setShowKnowledgeForm(false)} className="p-1 hover:bg-gray-100 rounded-lg">
                    <X className="w-5 h-5 text-gray-500" />
                  </button>
                </div>
                <div className="px-6 py-4">
                  <textarea value={knowledgeForm.content}
                    onChange={(e) => setKnowledgeForm({ content: e.target.value })}
                    rows={8}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white focus:ring-2 focus:ring-blue-500 text-sm"
                    placeholder="Cole aqui o texto, FAQ, descricao de produto, regras de atendimento..." />
                </div>
                <div className="px-6 py-4 border-t flex justify-end gap-3">
                  <button onClick={() => setShowKnowledgeForm(false)}
                    className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition">
                    Cancelar
                  </button>
                  <button onClick={handleAddKnowledge} disabled={knowledgeSaving || !knowledgeForm.content}
                    className="flex items-center gap-2 px-6 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition disabled:opacity-50">
                    {knowledgeSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                    Adicionar
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
