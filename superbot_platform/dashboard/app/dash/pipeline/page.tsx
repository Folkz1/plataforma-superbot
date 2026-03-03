'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw, Search, Clock, MessageCircle, ChevronRight, ChevronLeft, Filter } from 'lucide-react';
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

  const totalFiltered = filtered.length;

  return (
    <div className="flex flex-col h-[calc(100vh-0px)] overflow-hidden">
      {/* Header - fixed */}
      <div className="shrink-0 px-4 lg:px-6 pt-4 pb-3 bg-white border-b border-gray-200">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Pipeline CRM</h1>
            <p className="text-xs text-gray-500">{totalFiltered} contatos no funil</p>
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

      {/* Kanban - fills remaining viewport */}
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
          {STAGES.map((stage) => {
            const items = grouped.get(stage.key) || [];
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
                  <p className="text-[10px] text-gray-500 mt-0.5 ml-4">{stage.hint}</p>
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
                      const currentIdx = STAGE_INDEX[inferStage(conv)];
                      const canLeft = currentIdx > 0;
                      const canRight = currentIdx < STAGES.length - 1;
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
                              onClick={(e) => { e.stopPropagation(); moveCard(conv, 'left'); }}
                              disabled={!canLeft}
                              className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 disabled:opacity-30 disabled:cursor-default transition"
                              title={canLeft ? `Mover para ${STAGES[currentIdx - 1].label}` : ''}
                            >
                              <ChevronLeft className="w-3.5 h-3.5" />
                            </button>
                            <span className="text-[9px] text-gray-400 font-medium">{stage.shortLabel}</span>
                            <button
                              onClick={(e) => { e.stopPropagation(); moveCard(conv, 'right'); }}
                              disabled={!canRight}
                              className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 disabled:opacity-30 disabled:cursor-default transition"
                              title={canRight ? `Mover para ${STAGES[currentIdx + 1].label}` : ''}
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
          })}
        </div>
      )}
    </div>
  );
}
