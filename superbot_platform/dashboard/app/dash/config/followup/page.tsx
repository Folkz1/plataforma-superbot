'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import {
  Clock, Save, Plus, Trash2, CheckCircle, AlertCircle,
  Loader2, ToggleLeft, ToggleRight, MessageSquare
} from 'lucide-react';

interface FollowupTemplate {
  id: string;
  name: string;
  message: string;
  delay_hours: number;
  channel: 'whatsapp' | 'all';
}

interface FollowupConfig {
  templates: FollowupTemplate[];
  auto_followup: boolean;
  default_delay_hours: number;
  max_followups: number;
}

const DEFAULT_CONFIG: FollowupConfig = {
  templates: [],
  auto_followup: false,
  default_delay_hours: 24,
  max_followups: 3,
};

export default function FollowupConfigPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tenantId, setTenantId] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [config, setConfig] = useState<FollowupConfig>(DEFAULT_CONFIG);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Edit template modal
  const [editingTemplate, setEditingTemplate] = useState<FollowupTemplate | null>(null);
  const [showTemplateModal, setShowTemplateModal] = useState(false);

  useEffect(() => {
    const userData = localStorage.getItem('user');
    if (!userData) { router.push('/login'); return; }
    const parsedUser = JSON.parse(userData);
    const tId = parsedUser.role === 'admin'
      ? localStorage.getItem('active_tenant_id')
      : parsedUser.client_id;
    if (!tId) { router.push(parsedUser.role === 'admin' ? '/admin' : '/login'); return; }
    setTenantId(tId);
    loadConfig(tId);
  }, [router]);

  const loadConfig = async (tId: string) => {
    try {
      const res = await api.get(`/api/config/meta/${tId}`);
      const secrets = res.data.secrets || {};
      setEnabled(secrets.followup_enabled || false);
      setConfig({
        ...DEFAULT_CONFIG,
        ...(secrets.followup_config || {}),
      });
    } catch (error) {
      console.error('Erro ao carregar config:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      await api.patch(`/api/config/meta/${tenantId}`, {
        followup_enabled: enabled,
        followup_config: config,
      });
      setMessage({ type: 'success', text: 'Configuracao salva!' });
    } catch (error: any) {
      setMessage({ type: 'error', text: error.response?.data?.detail || 'Erro ao salvar' });
    } finally {
      setSaving(false);
    }
  };

  const addTemplate = () => {
    setEditingTemplate({
      id: crypto.randomUUID(),
      name: '',
      message: '',
      delay_hours: config.default_delay_hours,
      channel: 'whatsapp',
    });
    setShowTemplateModal(true);
  };

  const editTemplate = (template: FollowupTemplate) => {
    setEditingTemplate({ ...template });
    setShowTemplateModal(true);
  };

  const saveTemplate = () => {
    if (!editingTemplate || !editingTemplate.name || !editingTemplate.message) return;
    const existing = config.templates.findIndex(t => t.id === editingTemplate.id);
    const newTemplates = [...config.templates];
    if (existing >= 0) {
      newTemplates[existing] = editingTemplate;
    } else {
      newTemplates.push(editingTemplate);
    }
    setConfig(prev => ({ ...prev, templates: newTemplates }));
    setShowTemplateModal(false);
    setEditingTemplate(null);
  };

  const deleteTemplate = (id: string) => {
    setConfig(prev => ({
      ...prev,
      templates: prev.templates.filter(t => t.id !== id),
    }));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 max-w-4xl">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Follow-up</h1>
        <p className="text-sm text-gray-500 mt-1">
          Configure templates e regras de follow-up automatico
        </p>
      </div>

      {/* Toggle Enable/Disable */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Follow-up Automatico</h2>
            <p className="text-sm text-gray-500 mt-1">
              Quando ativado, o sistema envia mensagens de acompanhamento automaticamente
            </p>
          </div>
          <button
            onClick={() => setEnabled(!enabled)}
            className="flex items-center gap-2"
          >
            {enabled ? (
              <ToggleRight className="w-10 h-10 text-blue-600" />
            ) : (
              <ToggleLeft className="w-10 h-10 text-gray-400" />
            )}
            <span className={`text-sm font-medium ${enabled ? 'text-blue-600' : 'text-gray-400'}`}>
              {enabled ? 'Ativado' : 'Desativado'}
            </span>
          </button>
        </div>
      </div>

      {/* General Settings */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Configuracoes Gerais</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Intervalo padrao (horas)
            </label>
            <input
              type="number"
              min={1}
              max={168}
              value={config.default_delay_hours}
              onChange={(e) => setConfig(prev => ({ ...prev, default_delay_hours: Number(e.target.value) }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <p className="text-xs text-gray-400 mt-1">Tempo antes de enviar follow-up</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Maximo de follow-ups por conversa
            </label>
            <input
              type="number"
              min={1}
              max={10}
              value={config.max_followups}
              onChange={(e) => setConfig(prev => ({ ...prev, max_followups: Number(e.target.value) }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <p className="text-xs text-gray-400 mt-1">Limite de mensagens de follow-up</p>
          </div>
        </div>
      </div>

      {/* Templates */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Templates de Mensagem</h2>
          <button
            onClick={addTemplate}
            className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition text-sm font-medium"
          >
            <Plus className="w-4 h-4" />
            Novo Template
          </button>
        </div>

        {config.templates.length === 0 ? (
          <div className="text-center py-8">
            <MessageSquare className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500">Nenhum template criado</p>
            <p className="text-sm text-gray-400 mt-1">
              Crie templates para padronizar as mensagens de follow-up
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {config.templates.map((template) => (
              <div
                key={template.id}
                className="flex items-start justify-between gap-4 p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition cursor-pointer"
                onClick={() => editTemplate(template)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-sm font-semibold text-gray-900">{template.name}</h3>
                    <span className="text-xs text-gray-500 bg-gray-200 px-2 py-0.5 rounded-full">
                      {template.delay_hours}h
                    </span>
                    <span className="text-xs text-gray-500 bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                      {template.channel === 'all' ? 'Todos' : 'WhatsApp'}
                    </span>
                  </div>
                  <p className="text-sm text-gray-600 truncate">{template.message}</p>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); deleteTemplate(template.id); }}
                  className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition flex-shrink-0"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Save Button */}
      <div className="flex items-center justify-between">
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
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 bg-blue-600 text-white px-6 py-2.5 rounded-lg hover:bg-blue-700 transition font-medium disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Salvar Configuracao
        </button>
      </div>

      {/* Template Modal */}
      {showTemplateModal && editingTemplate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4">
            <div className="px-6 py-4 border-b">
              <h3 className="text-lg font-semibold text-gray-900">
                {config.templates.find(t => t.id === editingTemplate.id) ? 'Editar' : 'Novo'} Template
              </h3>
            </div>
            <div className="px-6 py-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nome do template</label>
                <input
                  type="text"
                  value={editingTemplate.name}
                  onChange={(e) => setEditingTemplate(prev => prev ? { ...prev, name: e.target.value } : null)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Ex: Lembrete 24h"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Mensagem</label>
                <textarea
                  value={editingTemplate.message}
                  onChange={(e) => setEditingTemplate(prev => prev ? { ...prev, message: e.target.value } : null)}
                  rows={4}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Ola {{nome}}, tudo bem? Notei que voce demonstrou interesse em..."
                />
                <p className="text-xs text-gray-400 mt-1">
                  Use {'{{nome}}'}, {'{{telefone}}'}, {'{{email}}'} como variaveis
                </p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Delay (horas)</label>
                  <input
                    type="number"
                    min={1}
                    max={168}
                    value={editingTemplate.delay_hours}
                    onChange={(e) => setEditingTemplate(prev => prev ? { ...prev, delay_hours: Number(e.target.value) } : null)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Canal</label>
                  <select
                    value={editingTemplate.channel}
                    onChange={(e) => setEditingTemplate(prev => prev ? { ...prev, channel: e.target.value as 'whatsapp' | 'all' } : null)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <option value="whatsapp">WhatsApp</option>
                    <option value="all">Todos os canais</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="px-6 py-4 border-t flex justify-end gap-3">
              <button
                onClick={() => { setShowTemplateModal(false); setEditingTemplate(null); }}
                className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition"
              >
                Cancelar
              </button>
              <button
                onClick={saveTemplate}
                disabled={!editingTemplate.name || !editingTemplate.message}
                className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition disabled:opacity-50"
              >
                Salvar Template
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
