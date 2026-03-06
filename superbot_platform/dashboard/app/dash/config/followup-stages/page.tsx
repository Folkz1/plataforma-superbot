'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import {
  Clock,
  MessageSquare,
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown,
  Save,
  X,
  Loader2,
  ToggleLeft,
  ToggleRight,
  Zap,
} from 'lucide-react';

type FollowupStage = {
  id: string;
  position: number;
  name: string;
  delay_hours: number;
  delay_minutes: number;
  ai_prompt: string;
  template_name: string;
  language_code: string;
  media_ids: string[];
  is_active: boolean;
};

type StageFormData = Omit<FollowupStage, 'id'> & { id?: string };

const DEFAULT_NEW_STAGE: StageFormData = {
  position: 1,
  name: '',
  delay_hours: 24,
  delay_minutes: 0,
  ai_prompt: '',
  template_name: '',
  language_code: 'pt_BR',
  media_ids: [],
  is_active: true,
};

export default function FollowupStagesPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [reordering, setReordering] = useState(false);
  const [tenantId, setTenantId] = useState('');
  const [stages, setStages] = useState<FollowupStage[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editData, setEditData] = useState<StageFormData | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [newStage, setNewStage] = useState<StageFormData>({ ...DEFAULT_NEW_STAGE });
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const showMessage = useCallback((type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    if (type === 'success') {
      setTimeout(() => setMessage(null), 4000);
    }
  }, []);

  useEffect(() => {
    const userData = localStorage.getItem('user');
    if (!userData) {
      router.push('/login');
      return;
    }
    const user = JSON.parse(userData) as { role?: string; client_id?: string };
    const tId = user.role === 'admin' ? localStorage.getItem('active_tenant_id') : user.client_id;
    if (!tId) {
      router.push(user.role === 'admin' ? '/admin' : '/login');
      return;
    }
    setTenantId(tId);
    void loadStages(tId);
  }, [router]);

  const loadStages = async (tId: string) => {
    try {
      const res = await api.get(`/api/followup-stages/${tId}`);
      const loaded = (res.data?.stages || []) as FollowupStage[];
      loaded.sort((a, b) => a.position - b.position);
      setStages(loaded);
    } catch {
      showMessage('error', 'Erro ao carregar stages de follow-up.');
    } finally {
      setLoading(false);
    }
  };

  const handleExpand = (stage: FollowupStage) => {
    if (expandedId === stage.id) {
      setExpandedId(null);
      setEditData(null);
    } else {
      setExpandedId(stage.id);
      setEditData({ ...stage });
    }
    setIsAdding(false);
  };

  const handleSaveEdit = async () => {
    if (!editData || !expandedId || !tenantId) return;
    if (!editData.name.trim()) {
      showMessage('error', 'Nome do stage e obrigatorio.');
      return;
    }
    setSaving(expandedId);
    setMessage(null);
    try {
      const payload = {
        name: editData.name.trim(),
        delay_hours: editData.delay_hours,
        delay_minutes: editData.delay_minutes,
        ai_prompt: editData.ai_prompt.trim(),
        template_name: editData.template_name.trim(),
        language_code: editData.language_code.trim() || 'pt_BR',
        media_ids: editData.media_ids,
        is_active: editData.is_active,
      };
      const res = await api.patch(`/api/followup-stages/${tenantId}/${expandedId}`, payload);
      const updated = res.data?.stage as FollowupStage | undefined;
      if (updated) {
        setStages((prev) => prev.map((s) => (s.id === expandedId ? updated : s)));
      }
      setExpandedId(null);
      setEditData(null);
      showMessage('success', 'Stage atualizado com sucesso!');
    } catch (err: any) {
      const text = err?.response?.data?.detail || err?.message || 'Erro ao salvar stage.';
      showMessage('error', text);
    } finally {
      setSaving(null);
    }
  };

  const handleAddStage = async () => {
    if (!tenantId) return;
    if (!newStage.name.trim()) {
      showMessage('error', 'Nome do stage e obrigatorio.');
      return;
    }
    setSaving('new');
    setMessage(null);
    try {
      const maxPos = stages.reduce((acc, s) => Math.max(acc, s.position), 0);
      const payload = {
        position: maxPos + 1,
        name: newStage.name.trim(),
        delay_hours: newStage.delay_hours,
        delay_minutes: newStage.delay_minutes,
        ai_prompt: newStage.ai_prompt.trim(),
        template_name: newStage.template_name.trim(),
        language_code: newStage.language_code.trim() || 'pt_BR',
        media_ids: newStage.media_ids,
        is_active: newStage.is_active,
      };
      const res = await api.post(`/api/followup-stages/${tenantId}`, payload);
      const created = res.data?.stage as FollowupStage | undefined;
      if (created) {
        setStages((prev) => [...prev, created].sort((a, b) => a.position - b.position));
      }
      setIsAdding(false);
      setNewStage({ ...DEFAULT_NEW_STAGE });
      showMessage('success', 'Stage criado com sucesso!');
    } catch (err: any) {
      const text = err?.response?.data?.detail || err?.message || 'Erro ao criar stage.';
      showMessage('error', text);
    } finally {
      setSaving(null);
    }
  };

  const handleDelete = async (stageId: string) => {
    if (!tenantId) return;
    if (!confirm('Tem certeza que deseja remover este stage?')) return;
    setDeleting(stageId);
    setMessage(null);
    try {
      await api.delete(`/api/followup-stages/${tenantId}/${stageId}`);
      setStages((prev) => prev.filter((s) => s.id !== stageId));
      if (expandedId === stageId) {
        setExpandedId(null);
        setEditData(null);
      }
      showMessage('success', 'Stage removido.');
    } catch (err: any) {
      const text = err?.response?.data?.detail || err?.message || 'Erro ao remover stage.';
      showMessage('error', text);
    } finally {
      setDeleting(null);
    }
  };

  const handleReorder = async (stageId: string, direction: 'up' | 'down') => {
    const idx = stages.findIndex((s) => s.id === stageId);
    if (idx === -1) return;
    if (direction === 'up' && idx === 0) return;
    if (direction === 'down' && idx === stages.length - 1) return;

    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    const newStages = [...stages];
    const tempPos = newStages[idx].position;
    newStages[idx] = { ...newStages[idx], position: newStages[swapIdx].position };
    newStages[swapIdx] = { ...newStages[swapIdx], position: tempPos };
    [newStages[idx], newStages[swapIdx]] = [newStages[swapIdx], newStages[idx]];
    setStages(newStages);

    setReordering(true);
    try {
      const stage_ids = newStages.map((s) => s.id);
      await api.post(`/api/followup-stages/${tenantId}/reorder`, { stage_ids });
    } catch {
      showMessage('error', 'Erro ao reordenar. Recarregue a pagina.');
      void loadStages(tenantId);
    } finally {
      setReordering(false);
    }
  };

  const handleToggleActive = async (stage: FollowupStage) => {
    if (!tenantId) return;
    const newActive = !stage.is_active;
    setStages((prev) => prev.map((s) => (s.id === stage.id ? { ...s, is_active: newActive } : s)));
    try {
      await api.patch(`/api/followup-stages/${tenantId}/${stage.id}`, { is_active: newActive });
    } catch {
      setStages((prev) => prev.map((s) => (s.id === stage.id ? { ...s, is_active: stage.is_active } : s)));
      showMessage('error', 'Erro ao alterar status do stage.');
    }
  };

  const formatDelay = (hours: number, minutes: number) => {
    const parts: string[] = [];
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}min`);
    return parts.length > 0 ? parts.join(' ') : '0min';
  };

  const truncate = (text: string, max: number) => {
    if (!text) return '(sem prompt)';
    return text.length > max ? text.slice(0, max) + '...' : text;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 max-w-5xl">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <Zap className="w-6 h-6 text-amber-500" />
          <h1 className="text-2xl font-bold text-gray-900">Follow-up Stages</h1>
        </div>
        <p className="text-sm text-gray-500">
          Configure o pipeline de follow-up com prompts de IA por etapa.
        </p>
      </div>

      {/* Message */}
      {message && (
        <div
          className={`mb-6 rounded-lg border p-3 text-sm flex items-center justify-between ${
            message.type === 'success'
              ? 'bg-green-50 border-green-200 text-green-700'
              : 'bg-red-50 border-red-200 text-red-700'
          }`}
        >
          <span>{message.text}</span>
          <button onClick={() => setMessage(null)} className="ml-3 opacity-60 hover:opacity-100">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Pipeline visual */}
      <div className="relative">
        {stages.length === 0 && !isAdding ? (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-8 text-center">
            <MessageSquare className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 text-sm mb-4">Nenhum stage configurado ainda.</p>
            <button
              onClick={() => {
                setIsAdding(true);
                setExpandedId(null);
                setEditData(null);
              }}
              className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition text-sm font-medium"
            >
              <Plus className="w-4 h-4" />
              Criar primeiro stage
            </button>
          </div>
        ) : (
          <div className="space-y-0">
            {stages.map((stage, idx) => {
              const isExpanded = expandedId === stage.id;
              const isBeingDeleted = deleting === stage.id;
              const isBeingSaved = saving === stage.id;

              return (
                <div key={stage.id} className="relative">
                  {/* Connector line */}
                  {idx > 0 && (
                    <div className="flex justify-center -mt-px">
                      <div className="w-0.5 h-6 bg-gray-300" />
                    </div>
                  )}

                  {/* Stage card */}
                  <div
                    className={`bg-white rounded-xl shadow-sm border transition ${
                      isExpanded ? 'border-blue-300 ring-1 ring-blue-100' : 'border-gray-100 hover:border-gray-200'
                    } ${!stage.is_active ? 'opacity-60' : ''}`}
                  >
                    {/* Collapsed view */}
                    <div
                      className="flex items-center gap-4 p-4 cursor-pointer"
                      onClick={() => handleExpand(stage)}
                    >
                      {/* Position badge */}
                      <div
                        className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold ${
                          stage.is_active
                            ? 'bg-blue-100 text-blue-700'
                            : 'bg-gray-100 text-gray-400'
                        }`}
                      >
                        {stage.position}
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-gray-900 truncate">{stage.name || '(sem nome)'}</span>
                          {stage.template_name && (
                            <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full truncate max-w-[180px]">
                              {stage.template_name}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                          <span className="inline-flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {formatDelay(stage.delay_hours, stage.delay_minutes)}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <MessageSquare className="w-3 h-3" />
                            {truncate(stage.ai_prompt, 60)}
                          </span>
                        </div>
                      </div>

                      {/* Controls */}
                      <div className="flex items-center gap-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => handleReorder(stage.id, 'up')}
                          disabled={idx === 0 || reordering}
                          className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
                          title="Mover para cima"
                        >
                          <ChevronUp className="w-4 h-4 text-gray-500" />
                        </button>
                        <button
                          onClick={() => handleReorder(stage.id, 'down')}
                          disabled={idx === stages.length - 1 || reordering}
                          className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
                          title="Mover para baixo"
                        >
                          <ChevronDown className="w-4 h-4 text-gray-500" />
                        </button>
                        <button
                          onClick={() => handleToggleActive(stage)}
                          className="p-1"
                          title={stage.is_active ? 'Desativar' : 'Ativar'}
                        >
                          {stage.is_active ? (
                            <ToggleRight className="w-7 h-7 text-blue-600" />
                          ) : (
                            <ToggleLeft className="w-7 h-7 text-gray-400" />
                          )}
                        </button>
                        <button
                          onClick={() => handleDelete(stage.id)}
                          disabled={isBeingDeleted}
                          className="p-1.5 rounded hover:bg-red-50 text-red-500 hover:text-red-700 disabled:opacity-50"
                          title="Remover stage"
                        >
                          {isBeingDeleted ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Trash2 className="w-4 h-4" />
                          )}
                        </button>
                      </div>
                    </div>

                    {/* Expanded edit form */}
                    {isExpanded && editData && (
                      <div className="border-t border-gray-100 p-5 bg-gray-50/50 rounded-b-xl">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                          <label className="block text-sm text-gray-700">
                            <span className="font-medium">Nome</span>
                            <input
                              value={editData.name}
                              onChange={(e) => setEditData({ ...editData, name: e.target.value })}
                              placeholder="Ex: Follow-up 24h"
                              className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white"
                            />
                          </label>
                          <label className="block text-sm text-gray-700">
                            <span className="font-medium">Template name</span>
                            <input
                              value={editData.template_name}
                              onChange={(e) => setEditData({ ...editData, template_name: e.target.value })}
                              placeholder="Ex: followup_24h"
                              className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white"
                            />
                          </label>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                          <label className="block text-sm text-gray-700">
                            <span className="font-medium">Delay (horas)</span>
                            <input
                              type="number"
                              min={0}
                              max={720}
                              value={editData.delay_hours}
                              onChange={(e) => setEditData({ ...editData, delay_hours: Math.max(0, parseInt(e.target.value) || 0) })}
                              className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white"
                            />
                          </label>
                          <label className="block text-sm text-gray-700">
                            <span className="font-medium">Delay (minutos)</span>
                            <input
                              type="number"
                              min={0}
                              max={59}
                              value={editData.delay_minutes}
                              onChange={(e) => setEditData({ ...editData, delay_minutes: Math.min(59, Math.max(0, parseInt(e.target.value) || 0)) })}
                              className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white"
                            />
                          </label>
                          <label className="block text-sm text-gray-700">
                            <span className="font-medium">Language code</span>
                            <input
                              value={editData.language_code}
                              onChange={(e) => setEditData({ ...editData, language_code: e.target.value })}
                              placeholder="pt_BR"
                              className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white"
                            />
                          </label>
                        </div>

                        <label className="block text-sm text-gray-700 mb-4">
                          <span className="font-medium">Prompt de IA</span>
                          <p className="text-xs text-gray-500 mt-0.5 mb-1">
                            Instrucoes para a IA gerar a mensagem de follow-up neste estagio.
                          </p>
                          <textarea
                            value={editData.ai_prompt}
                            onChange={(e) => setEditData({ ...editData, ai_prompt: e.target.value })}
                            rows={6}
                            placeholder="Descreva como a IA deve se comportar neste estagio de follow-up..."
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white text-gray-900"
                          />
                        </label>

                        <label className="block text-sm text-gray-700 mb-4">
                          <span className="font-medium">Media IDs</span>
                          <p className="text-xs text-gray-500 mt-0.5 mb-1">
                            IDs de midia separados por virgula (opcional).
                          </p>
                          <input
                            value={(editData.media_ids || []).join(', ')}
                            onChange={(e) =>
                              setEditData({
                                ...editData,
                                media_ids: e.target.value
                                  .split(',')
                                  .map((s) => s.trim())
                                  .filter(Boolean),
                              })
                            }
                            placeholder="media_id_1, media_id_2"
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white"
                          />
                        </label>

                        <div className="flex items-center justify-end gap-3">
                          <button
                            onClick={() => {
                              setExpandedId(null);
                              setEditData(null);
                            }}
                            className="inline-flex items-center gap-1.5 px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50"
                          >
                            <X className="w-4 h-4" />
                            Cancelar
                          </button>
                          <button
                            onClick={handleSaveEdit}
                            disabled={isBeingSaved}
                            className="inline-flex items-center gap-1.5 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition disabled:opacity-50"
                          >
                            {isBeingSaved ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Save className="w-4 h-4" />
                            )}
                            Salvar
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Connector arrow after card */}
                  {idx < stages.length - 1 && !isExpanded && (
                    <div className="flex justify-center">
                      <div className="w-0.5 h-6 bg-gray-300" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Add new stage form */}
        {isAdding && (
          <div className="mt-4">
            {stages.length > 0 && (
              <div className="flex justify-center mb-1">
                <div className="w-0.5 h-6 bg-gray-300" />
              </div>
            )}
            <div className="bg-white rounded-xl shadow-sm border border-blue-200 ring-1 ring-blue-100 p-5">
              <h3 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <Plus className="w-4 h-4 text-blue-600" />
                Novo stage
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <label className="block text-sm text-gray-700">
                  <span className="font-medium">Nome</span>
                  <input
                    value={newStage.name}
                    onChange={(e) => setNewStage({ ...newStage, name: e.target.value })}
                    placeholder="Ex: Follow-up 48h"
                    className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white"
                  />
                </label>
                <label className="block text-sm text-gray-700">
                  <span className="font-medium">Template name</span>
                  <input
                    value={newStage.template_name}
                    onChange={(e) => setNewStage({ ...newStage, template_name: e.target.value })}
                    placeholder="Ex: followup_48h"
                    className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white"
                  />
                </label>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                <label className="block text-sm text-gray-700">
                  <span className="font-medium">Delay (horas)</span>
                  <input
                    type="number"
                    min={0}
                    max={720}
                    value={newStage.delay_hours}
                    onChange={(e) => setNewStage({ ...newStage, delay_hours: Math.max(0, parseInt(e.target.value) || 0) })}
                    className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white"
                  />
                </label>
                <label className="block text-sm text-gray-700">
                  <span className="font-medium">Delay (minutos)</span>
                  <input
                    type="number"
                    min={0}
                    max={59}
                    value={newStage.delay_minutes}
                    onChange={(e) => setNewStage({ ...newStage, delay_minutes: Math.min(59, Math.max(0, parseInt(e.target.value) || 0)) })}
                    className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white"
                  />
                </label>
                <label className="block text-sm text-gray-700">
                  <span className="font-medium">Language code</span>
                  <input
                    value={newStage.language_code}
                    onChange={(e) => setNewStage({ ...newStage, language_code: e.target.value })}
                    placeholder="pt_BR"
                    className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white"
                  />
                </label>
              </div>

              <label className="block text-sm text-gray-700 mb-4">
                <span className="font-medium">Prompt de IA</span>
                <p className="text-xs text-gray-500 mt-0.5 mb-1">
                  Instrucoes para a IA gerar a mensagem de follow-up neste estagio.
                </p>
                <textarea
                  value={newStage.ai_prompt}
                  onChange={(e) => setNewStage({ ...newStage, ai_prompt: e.target.value })}
                  rows={6}
                  placeholder="Descreva como a IA deve se comportar neste estagio de follow-up..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white text-gray-900"
                />
              </label>

              <label className="block text-sm text-gray-700 mb-4">
                <span className="font-medium">Media IDs</span>
                <p className="text-xs text-gray-500 mt-0.5 mb-1">
                  IDs de midia separados por virgula (opcional).
                </p>
                <input
                  value={newStage.media_ids.join(', ')}
                  onChange={(e) =>
                    setNewStage({
                      ...newStage,
                      media_ids: e.target.value
                        .split(',')
                        .map((s) => s.trim())
                        .filter(Boolean),
                    })
                  }
                  placeholder="media_id_1, media_id_2"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white"
                />
              </label>

              <div className="flex items-center justify-end gap-3">
                <button
                  onClick={() => {
                    setIsAdding(false);
                    setNewStage({ ...DEFAULT_NEW_STAGE });
                  }}
                  className="inline-flex items-center gap-1.5 px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50"
                >
                  <X className="w-4 h-4" />
                  Cancelar
                </button>
                <button
                  onClick={handleAddStage}
                  disabled={saving === 'new'}
                  className="inline-flex items-center gap-1.5 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition disabled:opacity-50"
                >
                  {saving === 'new' ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Save className="w-4 h-4" />
                  )}
                  Criar stage
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Add button (when not adding) */}
        {!isAdding && stages.length > 0 && (
          <div className="mt-4">
            <div className="flex justify-center mb-1">
              <div className="w-0.5 h-4 bg-gray-200" />
            </div>
            <div className="flex justify-center">
              <button
                onClick={() => {
                  setIsAdding(true);
                  setExpandedId(null);
                  setEditData(null);
                  setNewStage({
                    ...DEFAULT_NEW_STAGE,
                    position: stages.reduce((acc, s) => Math.max(acc, s.position), 0) + 1,
                  });
                }}
                className="inline-flex items-center gap-2 px-4 py-2 border-2 border-dashed border-gray-300 rounded-lg text-sm text-gray-500 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50 transition"
              >
                <Plus className="w-4 h-4" />
                Adicionar stage
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
