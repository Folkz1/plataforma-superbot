'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw, Search, Clock, MessageCircle, ChevronRight, ChevronLeft, Filter, Layers, PlusCircle, X, Trash2, Edit3 } from 'lucide-react';
import { api } from '@/lib/api';
import { useTranslation } from '@/lib/i18n';
import { getPlatformLogo } from '@/components/PlatformLogos';

type StageKey = 'search' | 'name' | 'internalize' | 'potentialize' | 'engage' | 'resolve';

interface Conversation {
  project_id: string;
  conversation_id: string;
  contact_name: string | null;
  channel_type: string;
  status: string;
  last_event_at: string;
  last_text: string | null;
  message_count: number;
  // Local override for manual stage assignment
  _manualStage?: StageKey;
}

interface Pipeline {
  id: string;
  name: string;
  slug: string;
  pipeline_type: string;
  is_default: boolean;
  stage_count?: number;
}

interface PipelineStage {
  id: string;
  name: string;
  slug: string;
  position: number;
  color: string;
}

const STAGE_COLORS = [
  { bg: 'bg-blue-50', border: 'border-blue-200', dot: 'bg-blue-500' },
  { bg: 'bg-indigo-50', border: 'border-indigo-200', dot: 'bg-indigo-500' },
  { bg: 'bg-emerald-50', border: 'border-emerald-200', dot: 'bg-emerald-600' },
  { bg: 'bg-amber-50', border: 'border-amber-200', dot: 'bg-amber-600' },
  { bg: 'bg-rose-50', border: 'border-rose-200', dot: 'bg-rose-600' },
  { bg: 'bg-fuchsia-50', border: 'border-fuchsia-200', dot: 'bg-fuchsia-600' },
  { bg: 'bg-cyan-50', border: 'border-cyan-200', dot: 'bg-cyan-500' },
  { bg: 'bg-orange-50', border: 'border-orange-200', dot: 'bg-orange-500' },
  { bg: 'bg-violet-50', border: 'border-violet-200', dot: 'bg-violet-500' },
  { bg: 'bg-teal-50', border: 'border-teal-200', dot: 'bg-teal-500' },
];

function getStageClasses(index: number) {
  return STAGE_COLORS[index % STAGE_COLORS.length];
}

const STAGES: Array<{
  key: StageKey;
  label: string;
  shortLabel: string;
  hint: string;
  color: string;
  bgClass: string;
  borderClass: string;
  dotClass: string;
}> = [
  {
    key: 'search',
    label: 'Prospeccao',
    shortLabel: 'S',
    hint: 'Primeiro contato',
    color: '#3b82f6',
    bgClass: 'bg-blue-50',
    borderClass: 'border-blue-200',
    dotClass: 'bg-blue-500',
  },
  {
    key: 'name',
    label: 'Captacao',
    shortLabel: 'N',
    hint: 'Dados basicos',
    color: '#6366f1',
    bgClass: 'bg-indigo-50',
    borderClass: 'border-indigo-200',
    dotClass: 'bg-indigo-500',
  },
  {
    key: 'internalize',
    label: 'Conexao',
    shortLabel: 'I',
    hint: 'Confianca',
    color: '#059669',
    bgClass: 'bg-emerald-50',
    borderClass: 'border-emerald-200',
    dotClass: 'bg-emerald-600',
  },
  {
    key: 'potentialize',
    label: 'Qualificacao',
    shortLabel: 'P',
    hint: 'Objecoes',
    color: '#d97706',
    bgClass: 'bg-amber-50',
    borderClass: 'border-amber-200',
    dotClass: 'bg-amber-600',
  },
  {
    key: 'engage',
    label: 'Negociacao',
    shortLabel: 'E',
    hint: 'Pagamento',
    color: '#e11d48',
    bgClass: 'bg-rose-50',
    borderClass: 'border-rose-200',
    dotClass: 'bg-rose-600',
  },
  {
    key: 'resolve',
    label: 'Fechado',
    shortLabel: 'R',
    hint: 'Pos-venda',
    color: '#c026d3',
    bgClass: 'bg-fuchsia-50',
    borderClass: 'border-fuchsia-200',
    dotClass: 'bg-fuchsia-600',
  },
];

const STAGE_INDEX = {} as Record<StageKey, number>;
STAGES.forEach((s, i) => { STAGE_INDEX[s.key] = i; });

function inferStage(conv: Conversation): StageKey {
  if (conv._manualStage) return conv._manualStage;

  const status = String(conv.status || '').toLowerCase();
  const last = String(conv.last_text || '').toLowerCase();
  const count = Number(conv.message_count || 0);

  if (status === 'closed' || status === 'resolved' || status === 'do_not_contact') return 'resolve';
  if (status === 'handoff') return 'engage';

  if (last.includes('pix') || last.includes('pagamento') || last.includes('r$') || last.includes('agendar') || last.includes('agendamento')) {
    return 'engage';
  }

  if (count >= 14) return 'engage';
  if (count >= 9) return 'potentialize';
  if (count >= 5) return 'internalize';
  if (count >= 2) return 'name';
  return 'search';
}

function buildFingerprint(convs: Conversation[]): string {
  return convs.map(c => `${c.conversation_id}:${c.status}:${c.message_count}:${c.last_event_at}`).join('|');
}

function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 5) return 'agora';
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function relativeTime(dateStr: string): string {
  return timeAgo(new Date(dateStr));
}

const CHANNEL_OPTIONS = [
  { value: 'all', label: 'Todos canais' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'messenger', label: 'Messenger' },
  { value: 'phone', label: 'Telefone' },
];

export default function PipelinePage() {
  const router = useRouter();
  const { t } = useTranslation();
  const [tenantId, setTenantId] = useState<string>('');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [lastUpdatedLabel, setLastUpdatedLabel] = useState('');

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [channelFilter, setChannelFilter] = useState('all');
  // Manual stage overrides stored per conversation key
  const [stageOverrides, setStageOverrides] = useState<Record<string, StageKey>>({});
  // Moving card state
  const [movingCard, setMovingCard] = useState<string | null>(null);

  // Pipeline management state
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [selectedPipelineId, setSelectedPipelineId] = useState<string>('default');
  const [pipelineStages, setPipelineStages] = useState<PipelineStage[]>([]);
  const [showPipelineDropdown, setShowPipelineDropdown] = useState(false);
  const [showManageModal, setShowManageModal] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingPipeline, setEditingPipeline] = useState<Pipeline | null>(null);
  const [pipelineForm, setPipelineForm] = useState({ name: '', slug: '', pipeline_type: 'sales' });
  const [pipelineFormError, setPipelineFormError] = useState('');
  const [loadingPipelines, setLoadingPipelines] = useState(false);
  const [loadingStages, setLoadingStages] = useState(false);

  // Meus Leads / Pool state
  const [viewMode, setViewMode] = useState<'pipeline' | 'my-leads' | 'pool'>('pipeline');
  const [myLeads, setMyLeads] = useState<any[]>([]);
  const [poolLeads, setPoolLeads] = useState<any[]>([]);
  const [poolLoading, setPoolLoading] = useState(false);
  const [autoAssigning, setAutoAssigning] = useState(false);
  const [teamMembers, setTeamMembers] = useState<any[]>([]);

  const pipelineDropdownRef = useRef<HTMLDivElement>(null);
  const fingerprintRef = useRef('');

  useEffect(() => {
    const userData = localStorage.getItem('user');
    if (!userData) { router.push('/login'); return; }
    const user = JSON.parse(userData);
    if (user.role !== 'admin') { router.push('/dash'); return; }
    const tId = localStorage.getItem('active_tenant_id');
    if (!tId) { router.push('/admin'); return; }
    setTenantId(tId);
  }, [router]);

  // Close pipeline dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (pipelineDropdownRef.current && !pipelineDropdownRef.current.contains(e.target as Node)) {
        setShowPipelineDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Load pipelines list
  const loadPipelines = useCallback(async (tId: string) => {
    try {
      setLoadingPipelines(true);
      const resp = await api.get(`/api/pipeline/pipelines/${tId}`);
      setPipelines(resp.data?.pipelines || []);
    } catch {
      // Silently fail - pipelines feature may not be available
      setPipelines([]);
    } finally {
      setLoadingPipelines(false);
    }
  }, []);

  // Load stages for a custom pipeline
  const loadPipelineStages = useCallback(async (tId: string, pipelineId: string) => {
    try {
      setLoadingStages(true);
      const resp = await api.get(`/api/pipeline/stages/${tId}`, { params: { pipeline_id: pipelineId } });
      setPipelineStages(resp.data?.stages || []);
    } catch {
      setPipelineStages([]);
    } finally {
      setLoadingStages(false);
    }
  }, []);

  // Load pipelines when tenantId changes
  useEffect(() => {
    if (!tenantId) return;
    loadPipelines(tenantId);
  }, [tenantId, loadPipelines]);

  // Load stages when a custom pipeline is selected
  useEffect(() => {
    if (!tenantId || selectedPipelineId === 'default') {
      setPipelineStages([]);
      return;
    }
    loadPipelineStages(tenantId, selectedPipelineId);
  }, [tenantId, selectedPipelineId, loadPipelineStages]);

  const fetchMyLeads = async () => {
    if (!tenantId) return;
    try {
      const resp = await api.get(`/api/pipeline/my-leads/${tenantId}`);
      setMyLeads(resp.data.leads || []);
    } catch { setMyLeads([]); }
  };

  const fetchPool = async () => {
    if (!tenantId) return;
    setPoolLoading(true);
    try {
      const resp = await api.get(`/api/pipeline/pool/${tenantId}`);
      setPoolLeads(resp.data.pool || []);
    } catch { setPoolLeads([]); }
    finally { setPoolLoading(false); }
  };

  const fetchTeam = async () => {
    if (!tenantId) return;
    try {
      const resp = await api.get(`/api/pipeline/team/${tenantId}`);
      setTeamMembers(resp.data.team || []);
    } catch { setTeamMembers([]); }
  };

  const handleAutoAssign = async () => {
    if (!tenantId) return;
    setAutoAssigning(true);
    try {
      const resp = await api.post(`/api/pipeline/auto-assign/${tenantId}`);
      if (resp.data.assigned) {
        await fetchMyLeads();
        await fetchPool();
      }
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Erro ao auto-atribuir lead');
    } finally {
      setAutoAssigning(false);
    }
  };

  const load = useCallback(async (tId: string, isBackground = false) => {
    try {
      if (!isBackground) setLoading(true);
      const resp = await api.get('/api/conversations/', { params: { project_id: tId, limit: 200 } });
      const data: Conversation[] = resp.data || [];
      const fp = buildFingerprint(data);
      if (fp !== fingerprintRef.current) {
        fingerprintRef.current = fp;
        setConversations(data);
        setLastUpdated(new Date());
      }
      setError(null);
    } catch {
      if (!isBackground) setError(t.common_error);
    } finally {
      if (!isBackground) setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (!tenantId) return;
    load(tenantId);
    const interval = setInterval(() => load(tenantId, true), 15000);
    return () => clearInterval(interval);
  }, [tenantId, load]);

  useEffect(() => {
    if (!lastUpdated) return;
    setLastUpdatedLabel(timeAgo(lastUpdated));
    const tick = setInterval(() => setLastUpdatedLabel(timeAgo(lastUpdated)), 5000);
    return () => clearInterval(tick);
  }, [lastUpdated]);

  // Load my-leads / pool data when viewMode or tenant changes
  useEffect(() => {
    if (viewMode === 'my-leads') fetchMyLeads();
    if (viewMode === 'pool') { fetchPool(); fetchTeam(); }
  }, [viewMode, tenantId]);

  const convKey = (c: Conversation) => `${c.channel_type}:${c.conversation_id}`;

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return conversations.filter((conv) => {
      const matchSearch = !q ||
        (conv.contact_name || '').toLowerCase().includes(q) ||
        conv.conversation_id.toLowerCase().includes(q) ||
        (conv.last_text || '').toLowerCase().includes(q);
      const matchStatus = statusFilter === 'all' || conv.status === statusFilter;
      const matchChannel = channelFilter === 'all' || conv.channel_type === channelFilter;
      return matchSearch && matchStatus && matchChannel;
    });
  }, [conversations, search, statusFilter, channelFilter]);

  const grouped = useMemo(() => {
    const map = new Map<StageKey, Conversation[]>();
    for (const stage of STAGES) map.set(stage.key, []);
    for (const conv of filtered) {
      const enriched = { ...conv, _manualStage: stageOverrides[convKey(conv)] };
      const key = inferStage(enriched);
      map.get(key)?.push(enriched);
    }
    // Sort each column by last_event_at desc
    for (const [, items] of map) {
      items.sort((a, b) => new Date(b.last_event_at).getTime() - new Date(a.last_event_at).getTime());
    }
    return map;
  }, [filtered, stageOverrides]);

  const moveCard = (conv: Conversation, direction: 'left' | 'right') => {
    const currentStage = inferStage({ ...conv, _manualStage: stageOverrides[convKey(conv)] });
    const idx = STAGE_INDEX[currentStage];
    const newIdx = direction === 'right' ? idx + 1 : idx - 1;
    if (newIdx < 0 || newIdx >= STAGES.length) return;

    const key = convKey(conv);
    setMovingCard(key);
    setStageOverrides(prev => ({ ...prev, [key]: STAGES[newIdx].key }));
    setTimeout(() => setMovingCard(null), 300);
  };

  // Custom pipeline stages mapped to kanban-compatible format
  const customStages = useMemo(() => {
    if (selectedPipelineId === 'default' || pipelineStages.length === 0) return null;
    return pipelineStages
      .sort((a, b) => a.position - b.position)
      .map((s, i) => {
        const classes = getStageClasses(i);
        return {
          key: s.slug as StageKey,
          label: s.name,
          shortLabel: s.name.charAt(0).toUpperCase(),
          hint: '',
          color: s.color || '#6b7280',
          bgClass: classes.bg,
          borderClass: classes.border,
          dotClass: classes.dot,
          dbId: s.id,
        };
      });
  }, [selectedPipelineId, pipelineStages]);

  // For custom pipelines: group conversations by their stage assignment (from DB)
  // For now, all conversations go to the first stage since we don't have assignment data per pipeline
  const customGrouped = useMemo(() => {
    if (!customStages) return null;
    const map = new Map<string, Conversation[]>();
    for (const stage of customStages) map.set(stage.key, []);
    // Without assignment data, conversations go to first stage
    // In a full implementation, you'd load assignments filtered by pipeline_id
    for (const conv of filtered) {
      const firstKey = customStages[0]?.key;
      if (firstKey) {
        const enriched = { ...conv, _manualStage: stageOverrides[convKey(conv)] || firstKey as StageKey };
        const overrideStage = stageOverrides[convKey(conv)];
        const targetKey = overrideStage && customStages.find(s => s.key === overrideStage) ? overrideStage : firstKey;
        map.get(targetKey)?.push(enriched);
      }
    }
    for (const [, items] of map) {
      items.sort((a, b) => new Date(b.last_event_at).getTime() - new Date(a.last_event_at).getTime());
    }
    return map;
  }, [customStages, filtered, stageOverrides]);

  const selectedPipelineName = useMemo(() => {
    if (selectedPipelineId === 'default') return 'Vendas';
    const found = pipelines.find(p => p.id === selectedPipelineId);
    return found?.name || 'Vendas';
  }, [selectedPipelineId, pipelines]);

  // Pipeline CRUD
  const handleCreatePipeline = async () => {
    if (!pipelineForm.name.trim()) {
      setPipelineFormError('Nome e obrigatorio');
      return;
    }
    const slug = pipelineForm.slug.trim() || pipelineForm.name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    try {
      setPipelineFormError('');
      await api.post(`/api/pipeline/pipelines/${tenantId}`, {
        name: pipelineForm.name.trim(),
        slug,
        pipeline_type: pipelineForm.pipeline_type,
        is_default: false,
      });
      await loadPipelines(tenantId);
      setShowCreateModal(false);
      setPipelineForm({ name: '', slug: '', pipeline_type: 'sales' });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro ao criar pipeline';
      setPipelineFormError(msg);
    }
  };

  const handleUpdatePipeline = async () => {
    if (!editingPipeline) return;
    if (!pipelineForm.name.trim()) {
      setPipelineFormError('Nome e obrigatorio');
      return;
    }
    try {
      setPipelineFormError('');
      await api.patch(`/api/pipeline/pipelines/${tenantId}/${editingPipeline.id}`, {
        name: pipelineForm.name.trim(),
        pipeline_type: pipelineForm.pipeline_type,
      });
      await loadPipelines(tenantId);
      setEditingPipeline(null);
      setPipelineForm({ name: '', slug: '', pipeline_type: 'sales' });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro ao atualizar pipeline';
      setPipelineFormError(msg);
    }
  };

  const handleDeletePipeline = async (pipelineId: string) => {
    if (!confirm('Tem certeza que deseja excluir este pipeline?')) return;
    try {
      await api.delete(`/api/pipeline/pipelines/${tenantId}/${pipelineId}`);
      if (selectedPipelineId === pipelineId) setSelectedPipelineId('default');
      await loadPipelines(tenantId);
    } catch {
      alert('Erro ao excluir pipeline');
    }
  };

  const isDefaultPipeline = selectedPipelineId === 'default';
  const activeStages = customStages || STAGES;
  const activeGrouped = customGrouped || grouped;

  const totalFiltered = filtered.length;

  return (
    <div className="flex flex-col h-[calc(100vh-0px)] overflow-hidden">
      {/* Header - fixed */}
      <div className="shrink-0 px-4 lg:px-6 pt-4 pb-3 bg-white border-b border-gray-200">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <div>
              <h1 className="text-xl font-bold text-gray-900">Pipeline CRM</h1>
              <p className="text-xs text-gray-500">{totalFiltered} contatos no funil</p>
            </div>

            {/* Pipeline selector */}
            <div className="relative" ref={pipelineDropdownRef}>
              <button
                onClick={() => setShowPipelineDropdown(!showPipelineDropdown)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-xs font-medium text-gray-700 hover:bg-gray-50 transition"
              >
                <Layers className="w-3.5 h-3.5 text-gray-500" />
                {selectedPipelineName}
                <ChevronRight className={`w-3 h-3 text-gray-400 transition-transform ${showPipelineDropdown ? 'rotate-90' : ''}`} />
              </button>

              {showPipelineDropdown && (
                <div className="absolute top-full left-0 mt-1 w-56 bg-white border border-gray-200 rounded-lg shadow-lg z-50">
                  <div className="py-1">
                    <button
                      onClick={() => { setSelectedPipelineId('default'); setShowPipelineDropdown(false); }}
                      className={`w-full text-left px-3 py-2 text-xs hover:bg-gray-50 flex items-center gap-2 ${selectedPipelineId === 'default' ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-700'}`}
                    >
                      <div className="w-2 h-2 rounded-full bg-blue-500" />
                      Vendas (padrao)
                    </button>
                    {pipelines.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => { setSelectedPipelineId(p.id); setShowPipelineDropdown(false); }}
                        className={`w-full text-left px-3 py-2 text-xs hover:bg-gray-50 flex items-center gap-2 ${selectedPipelineId === p.id ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-700'}`}
                      >
                        <div className="w-2 h-2 rounded-full bg-indigo-500" />
                        {p.name}
                        {p.stage_count !== undefined && (
                          <span className="ml-auto text-[10px] text-gray-400">{p.stage_count} etapas</span>
                        )}
                      </button>
                    ))}
                  </div>
                  <div className="border-t border-gray-100 p-1.5 flex gap-1">
                    <button
                      onClick={() => { setShowPipelineDropdown(false); setShowCreateModal(true); setPipelineForm({ name: '', slug: '', pipeline_type: 'sales' }); setPipelineFormError(''); }}
                      className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded text-[11px] text-blue-600 hover:bg-blue-50 transition"
                    >
                      <PlusCircle className="w-3 h-3" />
                      Novo Pipeline
                    </button>
                    <button
                      onClick={() => { setShowPipelineDropdown(false); setShowManageModal(true); }}
                      className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded text-[11px] text-gray-600 hover:bg-gray-50 transition"
                    >
                      <Layers className="w-3 h-3" />
                      Gerenciar
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {lastUpdatedLabel && (
              <span className="text-xs text-gray-400">{lastUpdatedLabel}</span>
            )}
            <button
              onClick={() => tenantId && load(tenantId)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white text-xs text-gray-600 hover:bg-gray-50 transition"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Atualizar
            </button>
          </div>
        </div>

        {/* Filters row */}
        <div className="flex gap-2 items-center flex-wrap">
          <div className="flex-1 min-w-[180px] max-w-xs relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <input
              type="text"
              placeholder="Buscar contato..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-xs text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <select
            value={channelFilter}
            onChange={(e) => setChannelFilter(e.target.value)}
            className="px-2.5 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            {CHANNEL_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-2.5 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="all">Todos status</option>
            <option value="open">Aberto</option>
            <option value="waiting_customer">Aguardando</option>
            <option value="handoff">Handoff</option>
            <option value="closed">Fechado</option>
            <option value="do_not_contact">Nao contactar</option>
          </select>
          <div className="flex items-center gap-1 text-xs text-gray-400">
            <Filter className="w-3 h-3" />
            <span>{channelFilter !== 'all' || statusFilter !== 'all' ? 'Filtrado' : ''}</span>
          </div>
        </div>
      </div>

      {/* View Mode Tabs */}
      <div className="flex items-center gap-2 px-4 lg:px-6 pt-3 pb-0 shrink-0">
        <button
          onClick={() => setViewMode('pipeline')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition ${viewMode === 'pipeline' ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
        >
          Pipeline
        </button>
        <button
          onClick={() => setViewMode('my-leads')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition ${viewMode === 'my-leads' ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
        >
          Meus Leads
        </button>
        <button
          onClick={() => setViewMode('pool')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition ${viewMode === 'pool' ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
        >
          Pool ({poolLeads.length})
        </button>
        {viewMode === 'pool' && (
          <button
            onClick={handleAutoAssign}
            disabled={autoAssigning || poolLeads.length === 0}
            className="ml-auto px-4 py-2 bg-green-500 text-white rounded-lg text-sm font-medium hover:bg-green-600 transition disabled:opacity-50"
          >
            {autoAssigning ? 'Atribuindo...' : 'Pegar Próximo Lead'}
          </button>
        )}
      </div>

      {/* Kanban - fills remaining viewport */}
      {viewMode === 'pipeline' && (
        <>
          {loading ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : error ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="bg-red-50 text-red-600 p-4 rounded-lg">{error}</div>
            </div>
          ) : (
            <div className="flex-1 flex gap-3 overflow-x-auto px-4 lg:px-6 py-3 min-h-0">
              {loadingStages && !isDefaultPipeline ? (
                <div className="flex-1 flex items-center justify-center">
                  <div className="w-6 h-6 border-3 border-blue-600 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : (
                activeStages.map((stage, stageIdx) => {
                  const items = activeGrouped?.get(stage.key) || [];
                  return (
                    <div
                      key={stage.key}
                      className="flex flex-col w-[280px] min-w-[280px] shrink-0"
                    >
                      {/* Column header */}
                      <div className={`border rounded-lg px-3 py-2 ${stage.bgClass} ${stage.borderClass} shrink-0`}>
                        <div className="flex items-center gap-2">
                          <div className={`w-2 h-2 rounded-full ${stage.dotClass}`} />
                          <span className="text-xs font-semibold text-gray-800 flex-1">{stage.label}</span>
                          <span className="text-[10px] font-bold text-gray-600 bg-white/80 border border-gray-200 rounded-full px-1.5 py-0.5 min-w-[20px] text-center">
                            {items.length}
                          </span>
                        </div>
                        {stage.hint && <p className="text-[10px] text-gray-500 mt-0.5 ml-4">{stage.hint}</p>}
                      </div>

                      {/* Cards container - scrollable */}
                      <div className="flex-1 mt-2 space-y-1.5 overflow-y-auto min-h-0 pr-1">
                        {items.length === 0 ? (
                          <div className="text-[10px] text-gray-400 px-2 py-8 text-center border border-dashed border-gray-200 rounded-lg bg-gray-50/50">
                            Vazio
                          </div>
                        ) : (
                          items.map((conv) => {
                            const key = convKey(conv);
                            const currentIdx = isDefaultPipeline ? STAGE_INDEX[inferStage(conv)] : stageIdx;
                            const canLeft = currentIdx > 0;
                            const canRight = currentIdx < activeStages.length - 1;
                            const isMoving = movingCard === key;

                            return (
                              <div
                                key={key}
                                className={`bg-white border border-gray-100 rounded-lg p-2.5 hover:border-blue-200 hover:shadow-sm transition-all cursor-pointer group ${isMoving ? 'scale-95 opacity-70' : ''}`}
                              >
                                {/* Click to open conversation */}
                                <div
                                  onClick={() => router.push(
                                    `/dash/conversations/${encodeURIComponent(conv.project_id)}/${encodeURIComponent(conv.conversation_id)}?channel_type=${encodeURIComponent(conv.channel_type)}`
                                  )}
                                >
                                  <div className="flex items-center gap-2 mb-1">
                                    <div className="shrink-0">{getPlatformLogo(conv.channel_type, 14) || <MessageCircle className="w-3.5 h-3.5 text-gray-400" />}</div>
                                    <span className="text-xs font-medium text-gray-900 truncate flex-1">
                                      {conv.contact_name || conv.conversation_id}
                                    </span>
                                    <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                      conv.status === 'open' ? 'bg-green-100 text-green-700' :
                                      conv.status === 'handoff' ? 'bg-amber-100 text-amber-700' :
                                      conv.status === 'closed' ? 'bg-gray-100 text-gray-500' :
                                      'bg-gray-100 text-gray-600'
                                    }`}>
                                      {conv.status === 'open' ? 'Aberto' :
                                       conv.status === 'handoff' ? 'Handoff' :
                                       conv.status === 'closed' ? 'Fechado' :
                                       conv.status === 'waiting_customer' ? 'Aguard.' :
                                       conv.status}
                                    </span>
                                  </div>
                                  {conv.last_text && (
                                    <p className="text-[11px] text-gray-500 line-clamp-1 mb-1 ml-5">
                                      {conv.last_text}
                                    </p>
                                  )}
                                  <div className="flex items-center gap-2 ml-5 text-[10px] text-gray-400">
                                    <Clock className="w-2.5 h-2.5" />
                                    <span>{relativeTime(conv.last_event_at)}</span>
                                    <span>{conv.message_count} msgs</span>
                                  </div>
                                </div>

                                {/* Move buttons - visible on hover */}
                                <div className="flex items-center justify-end gap-1 mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (isDefaultPipeline) {
                                        moveCard(conv, 'left');
                                      } else if (customStages && currentIdx > 0) {
                                        const cKey = convKey(conv);
                                        setMovingCard(cKey);
                                        setStageOverrides(prev => ({ ...prev, [cKey]: customStages[currentIdx - 1].key as StageKey }));
                                        setTimeout(() => setMovingCard(null), 300);
                                      }
                                    }}
                                    disabled={!canLeft}
                                    className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 disabled:opacity-30 disabled:cursor-default transition"
                                    title={canLeft ? `Mover para ${activeStages[currentIdx - 1].label}` : ''}
                                  >
                                    <ChevronLeft className="w-3.5 h-3.5" />
                                  </button>
                                  <span className="text-[9px] text-gray-400 font-medium">{stage.shortLabel}</span>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (isDefaultPipeline) {
                                        moveCard(conv, 'right');
                                      } else if (customStages && currentIdx < customStages.length - 1) {
                                        const cKey = convKey(conv);
                                        setMovingCard(cKey);
                                        setStageOverrides(prev => ({ ...prev, [cKey]: customStages[currentIdx + 1].key as StageKey }));
                                        setTimeout(() => setMovingCard(null), 300);
                                      }
                                    }}
                                    disabled={!canRight}
                                    className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 disabled:opacity-30 disabled:cursor-default transition"
                                    title={canRight ? `Mover para ${activeStages[currentIdx + 1].label}` : ''}
                                  >
                                    <ChevronRight className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </>
      )}

      {/* Meus Leads view */}
      {viewMode === 'my-leads' && (
        <div className="flex-1 overflow-y-auto px-4 lg:px-6 py-3">
          <div className="space-y-3">
            {myLeads.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <p className="text-lg font-medium">Nenhum lead atribuído</p>
                <p className="text-sm">Vá ao Pool para pegar leads do pool compartilhado</p>
              </div>
            ) : (
              myLeads.map((lead) => (
                <div key={lead.assignment_id}
                     className="bg-white rounded-lg border p-4 hover:shadow-md transition cursor-pointer"
                     onClick={() => router.push(`/dash/conversations/${encodeURIComponent(lead.project_id || tenantId)}/${encodeURIComponent(lead.conversation_id)}?channel_type=${encodeURIComponent(lead.channel_type || 'whatsapp')}`)}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: lead.stage_color || '#6366f1' }}></div>
                      <div>
                        <p className="font-medium text-gray-900">{lead.contact_name || lead.conversation_id}</p>
                        <p className="text-sm text-gray-500 truncate max-w-md">{lead.last_text || 'Sem mensagem'}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {lead.stage_name && (
                        <span className="px-2 py-1 text-xs font-medium rounded-full" style={{ backgroundColor: (lead.stage_color || '#6366f1') + '20', color: lead.stage_color || '#6366f1' }}>
                          {lead.stage_name}
                        </span>
                      )}
                      <span className={`px-2 py-1 text-xs rounded-full ${lead.conv_status === 'open' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                        {lead.conv_status || lead.status || 'open'}
                      </span>
                      {lead.last_event_at && (
                        <span className="text-xs text-gray-400">{new Date(lead.last_event_at).toLocaleDateString('pt-BR')}</span>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Pool view */}
      {viewMode === 'pool' && (
        <div className="flex-1 overflow-y-auto px-4 lg:px-6 py-3">
          <div className="space-y-3">
            {/* Team capacity overview */}
            {teamMembers.length > 0 && (
              <div className="bg-white rounded-lg border p-4 mb-4">
                <h3 className="text-sm font-medium text-gray-500 mb-3">EQUIPE — CAPACIDADE</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {teamMembers.map((m: any) => (
                    <div key={m.id} className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${m.is_available ? 'bg-green-500' : 'bg-gray-400'}`}></div>
                      <span className="text-sm font-medium">{m.user_name}</span>
                      <span className="text-xs text-gray-400">{m.active_conversations}/{m.max_concurrent_conversations}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {poolLoading ? (
              <div className="text-center py-12 text-gray-500">Carregando pool...</div>
            ) : poolLeads.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <p className="text-lg font-medium">Pool vazio</p>
                <p className="text-sm">Todos os leads estão atribuídos</p>
              </div>
            ) : (
              poolLeads.map((lead: any) => (
                <div key={lead.conversation_id} className="bg-white rounded-lg border p-4 hover:shadow-md transition">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-gray-900">{lead.contact_name || lead.conversation_id}</p>
                      <p className="text-sm text-gray-500 truncate max-w-md">{lead.last_text || 'Sem mensagem'}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-400">{lead.channel_type}</span>
                      {lead.last_event_at && (
                        <span className="text-xs text-gray-400">{new Date(lead.last_event_at).toLocaleDateString('pt-BR')}</span>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Create Pipeline Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold text-gray-900">Novo Pipeline</h2>
              <button onClick={() => setShowCreateModal(false)} className="p-1 rounded hover:bg-gray-100">
                <X className="w-4 h-4 text-gray-500" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Nome</label>
                <input
                  type="text"
                  value={pipelineForm.name}
                  onChange={(e) => setPipelineForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="Ex: Suporte, Onboarding..."
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Slug (opcional)</label>
                <input
                  type="text"
                  value={pipelineForm.slug}
                  onChange={(e) => setPipelineForm(f => ({ ...f, slug: e.target.value }))}
                  placeholder="auto-gerado a partir do nome"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Tipo</label>
                <select
                  value={pipelineForm.pipeline_type}
                  onChange={(e) => setPipelineForm(f => ({ ...f, pipeline_type: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="sales">Vendas</option>
                  <option value="support">Suporte</option>
                  <option value="onboarding">Onboarding</option>
                  <option value="custom">Personalizado</option>
                </select>
              </div>
              {pipelineFormError && (
                <p className="text-xs text-red-600">{pipelineFormError}</p>
              )}
              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => setShowCreateModal(false)}
                  className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-700 hover:bg-gray-50 transition"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleCreatePipeline}
                  className="flex-1 px-3 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition"
                >
                  Criar Pipeline
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Manage Pipelines Modal */}
      {showManageModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold text-gray-900">Gerenciar Pipelines</h2>
              <button onClick={() => { setShowManageModal(false); setEditingPipeline(null); }} className="p-1 rounded hover:bg-gray-100">
                <X className="w-4 h-4 text-gray-500" />
              </button>
            </div>

            {/* Default pipeline */}
            <div className="border border-gray-200 rounded-lg p-3 mb-2 bg-gray-50">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-blue-500" />
                <span className="text-sm font-medium text-gray-800 flex-1">Vendas (padrao)</span>
                <span className="text-[10px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded">6 etapas</span>
              </div>
              <p className="text-[11px] text-gray-500 ml-4 mt-0.5">Pipeline padrao com inferencia automatica de estagio</p>
            </div>

            {/* Custom pipelines */}
            {loadingPipelines ? (
              <div className="flex items-center justify-center py-6">
                <div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : pipelines.length === 0 ? (
              <div className="text-center py-6 text-xs text-gray-400">
                Nenhum pipeline personalizado criado
              </div>
            ) : (
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {pipelines.map((p) => (
                  <div key={p.id} className="border border-gray-200 rounded-lg p-3">
                    {editingPipeline?.id === p.id ? (
                      <div className="space-y-2">
                        <input
                          type="text"
                          value={pipelineForm.name}
                          onChange={(e) => setPipelineForm(f => ({ ...f, name: e.target.value }))}
                          className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                        <select
                          value={pipelineForm.pipeline_type}
                          onChange={(e) => setPipelineForm(f => ({ ...f, pipeline_type: e.target.value }))}
                          className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                        >
                          <option value="sales">Vendas</option>
                          <option value="support">Suporte</option>
                          <option value="onboarding">Onboarding</option>
                          <option value="custom">Personalizado</option>
                        </select>
                        {pipelineFormError && <p className="text-xs text-red-600">{pipelineFormError}</p>}
                        <div className="flex gap-1">
                          <button
                            onClick={() => { setEditingPipeline(null); setPipelineFormError(''); }}
                            className="px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 rounded transition"
                          >
                            Cancelar
                          </button>
                          <button
                            onClick={handleUpdatePipeline}
                            className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 transition"
                          >
                            Salvar
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-indigo-500" />
                        <span className="text-sm font-medium text-gray-800 flex-1">{p.name}</span>
                        <span className="text-[10px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded">{p.pipeline_type}</span>
                        {p.stage_count !== undefined && (
                          <span className="text-[10px] text-gray-400">{p.stage_count} etapas</span>
                        )}
                        <button
                          onClick={() => {
                            setEditingPipeline(p);
                            setPipelineForm({ name: p.name, slug: p.slug, pipeline_type: p.pipeline_type });
                            setPipelineFormError('');
                          }}
                          className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition"
                          title="Editar"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDeletePipeline(p.id)}
                          className="p-1 rounded hover:bg-red-50 text-gray-400 hover:text-red-600 transition"
                          title="Excluir"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-2 mt-4 pt-3 border-t border-gray-100">
              <button
                onClick={() => { setShowManageModal(false); setEditingPipeline(null); }}
                className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-700 hover:bg-gray-50 transition"
              >
                Fechar
              </button>
              <button
                onClick={() => { setShowManageModal(false); setShowCreateModal(true); setPipelineForm({ name: '', slug: '', pipeline_type: 'sales' }); setPipelineFormError(''); }}
                className="flex-1 inline-flex items-center justify-center gap-1 px-3 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition"
              >
                <PlusCircle className="w-3.5 h-3.5" />
                Novo Pipeline
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
