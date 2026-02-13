'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { 
  Bot, Edit, Trash2, Mic, 
  Loader2, CheckCircle, AlertCircle 
} from 'lucide-react';

interface Agent {
  agent_id: string;
  name?: string;
  platform_settings?: {
    widget_settings?: { name?: string };
  };
  conversation_config?: {
    agent?: {
      prompt?: { prompt?: string };
      first_message?: string;
      language?: string;
      tools?: any[];
    };
  };
  tts_config?: {
    voice_id?: string;
  };
}

interface Voice {
  voice_id: string;
  name: string;
  category: string;
}

export default function ElevenLabsAgentsPage() {
  const router = useRouter();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<any>(null);
  const [tenantId, setTenantId] = useState<string>('');
  const [tenantName, setTenantName] = useState<string>('');
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  
  // Editor state
  const [editName, setEditName] = useState('');
  const [editPrompt, setEditPrompt] = useState('');
  const [editFirstMessage, setEditFirstMessage] = useState('');
  const [editVoiceId, setEditVoiceId] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  const getAgentName = (agent: Agent) =>
    agent.name ||
    agent.platform_settings?.widget_settings?.name ||
    (agent.agent_id ? `Agent ${agent.agent_id.slice(0, 8)}` : 'Agent');

  const getLanguage = (agent: Agent) => agent.conversation_config?.agent?.language || '';
  const getPrompt = (agent: Agent) => agent.conversation_config?.agent?.prompt?.prompt || '';
  const getToolsCount = (agent: Agent) => agent.conversation_config?.agent?.tools?.length || 0;

  useEffect(() => {
    const userData = localStorage.getItem('user');
    if (!userData) {
      router.push('/login');
      return;
    }

    const parsedUser = JSON.parse(userData);
    setUser(parsedUser);

    const tId = parsedUser.role === 'admin'
      ? localStorage.getItem('active_tenant_id')
      : parsedUser.client_id;

    const name = parsedUser.role === 'admin'
      ? (localStorage.getItem('active_tenant_name') || '')
      : (parsedUser.client_name || '');
    setTenantName(name);

    if (!tId) {
      router.push(parsedUser.role === 'admin' ? '/admin' : '/login');
      return;
    }

    setTenantId(tId);
    loadData(tId);
  }, [router]);

  const loadData = async (clientId: string) => {
    try {
      const [agentsRes, voicesRes] = await Promise.all([
        api.get(`/api/elevenlabs/agents/${clientId}`),
        api.get(`/api/elevenlabs/voices/${clientId}`)
      ]);
      
      const rawAgents = Array.isArray(agentsRes.data?.agents) ? agentsRes.data.agents : [];
      setAgents(rawAgents.filter((a: any) => a && typeof a === 'object' && a.agent_id));
      setVoices(Array.isArray(voicesRes.data?.voices) ? voicesRes.data.voices : []);
    } catch (error) {
      console.error('Erro ao carregar dados:', error);
      setMessage({ type: 'error', text: 'Erro ao carregar agents' });
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = async (agent: Agent) => {
    setMessage(null);
    try {
      // List endpoint can return partial data; fetch full config before editing.
      const res = await api.get(`/api/elevenlabs/agents/${tenantId}/${agent.agent_id}`);
      const full: Agent = res.data || agent;

      setSelectedAgent(full);
      setEditName(getAgentName(full));
      setEditPrompt(getPrompt(full));
      setEditFirstMessage(full.conversation_config?.agent?.first_message || '');
      setEditVoiceId(full.tts_config?.voice_id || '');
      setShowEditor(true);
    } catch (error) {
      console.error('Erro ao carregar agent:', error);
      // Fallback to whatever we have, but keep UI safe.
      setSelectedAgent(agent);
      setEditName(getAgentName(agent));
      setEditPrompt(getPrompt(agent));
      setEditFirstMessage(agent.conversation_config?.agent?.first_message || '');
      setEditVoiceId(agent.tts_config?.voice_id || '');
      setShowEditor(true);
      setMessage({ type: 'error', text: 'Erro ao carregar detalhes do agent' });
    }
  };

  const handleSave = async () => {
    if (!selectedAgent) return;

    setSaving(true);
    setMessage(null);

    try {
      await api.patch(`/api/elevenlabs/agents/${tenantId}/${selectedAgent.agent_id}`, {
        name: editName,
        system_prompt: editPrompt,
        first_message: editFirstMessage
      });

      setMessage({ type: 'success', text: 'Agent atualizado!' });
      setShowEditor(false);
      await loadData(tenantId);
    } catch (error: any) {
      setMessage({ 
        type: 'error', 
        text: error.response?.data?.detail || 'Erro ao salvar' 
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (agentId: string) => {
    if (!confirm('Remover este agent?')) return;

    try {
      await api.delete(`/api/elevenlabs/agents/${tenantId}/${agentId}`);
      setMessage({ type: 'success', text: 'Agent removido' });
      await loadData(tenantId);
    } catch (error) {
      setMessage({ type: 'error', text: 'Erro ao remover agent' });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Agentes de Voz</h1>
        <p className="text-sm text-gray-500 mt-1">ElevenLabs - Gerenciar agentes</p>
      </div>

      <div>
        {/* Message */}
        {message && (
          <div className={`mb-6 p-4 rounded-lg flex items-start gap-3 ${
            message.type === 'success'
              ? 'bg-green-50 border border-green-200'
              : 'bg-red-50 border border-red-200'
          }`}>
            {message.type === 'success' ? (
              <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            )}
            <p className={`text-sm ${
              message.type === 'success' ? 'text-green-800' : 'text-red-800'
            }`}>
              {message.text}
            </p>
          </div>
        )}

        {/* Agents Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {agents.map((agent) => (
            <div key={agent.agent_id} className="bg-white rounded-lg shadow p-6">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-purple-100 rounded-lg">
                    <Mic className="w-5 h-5 text-purple-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">{getAgentName(agent)}</h3>
                    <p className="text-xs text-gray-500">
                      {getLanguage(agent) || '—'}
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-2 mb-4">
                <div>
                  <p className="text-xs text-gray-500">System Prompt</p>
                  <p className="text-sm text-gray-700 line-clamp-3">
                    {getPrompt(agent) || '—'}
                  </p>
                </div>
                
                {getToolsCount(agent) > 0 && (
                  <div>
                    <p className="text-xs text-gray-500">Tools</p>
                    <p className="text-sm text-gray-700">
                      {getToolsCount(agent)} configuradas
                    </p>
                  </div>
                )}
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => handleEdit(agent)}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm"
                >
                  <Edit className="w-4 h-4" />
                  Editar
                </button>
                <button
                  onClick={() => handleDelete(agent.agent_id)}
                  className="px-3 py-2 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}

          {agents.length === 0 && (
            <div className="col-span-full text-center py-12">
              <Bot className="w-12 h-12 text-gray-400 mx-auto mb-3" />
              <p className="text-gray-600">Nenhum agent configurado</p>
            </div>
          )}
        </div>
      </div>

      {/* Editor Modal */}
      {showEditor && selectedAgent && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b">
              <h2 className="text-xl font-bold text-gray-900">Editar Agent</h2>
            </div>

            <div className="p-6 space-y-4">
              {/* Name */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Nome
                </label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white text-gray-900"
                />
              </div>

              {/* System Prompt */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  System Prompt
                </label>
                <textarea
                  value={editPrompt}
                  onChange={(e) => setEditPrompt(e.target.value)}
                  rows={12}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 font-mono text-sm bg-white text-gray-900"
                />
              </div>

              {/* First Message */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Primeira Mensagem
                </label>
                <textarea
                  value={editFirstMessage}
                  onChange={(e) => setEditFirstMessage(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white text-gray-900"
                />
              </div>

              {/* Voice */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Voz Atual
                </label>
                <p className="text-sm text-gray-600">
                  {voices.find(v => v.voice_id === editVoiceId)?.name || editVoiceId}
                </p>
              </div>
            </div>

            <div className="p-6 border-t flex gap-3">
              <button
                onClick={() => setShowEditor(false)}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition"
              >
                Cancelar
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition disabled:opacity-50"
              >
                {saving ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
