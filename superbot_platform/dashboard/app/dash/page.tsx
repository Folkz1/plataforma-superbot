'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useTranslation } from '@/lib/i18n';
import { getPlatformLogo } from '@/components/PlatformLogos';
import {
  CheckCircle,
  Clock,
  Loader2,
  MessageCircle,
  Search,
  Sparkles,
  TrendingUp,
  Users,
} from 'lucide-react';

type LeadStatus =
  | 'open'
  | 'waiting_customer'
  | 'handoff'
  | 'closed'
  | 'resolved'
  | 'do_not_contact'
  | string;

type Priority = 'high' | 'medium' | 'low';
type PeriodFilter = 'today' | '7d' | '30d' | '90d' | 'all';
type PipelineStage = 'new_contact' | 'qualified' | 'proposal' | 'closed';

interface LeadItem {
  project_id: string;
  conversation_id: string;
  contact_name: string;
  channel_type: string;
  status: LeadStatus;
  last_event_at: string;
  last_text?: string | null;
}

interface OverviewResponse {
  resolution_rate?: number;
  active_conversations?: number;
}

interface EnrichedLead extends LeadItem {
  priority: Priority;
  stage: PipelineStage;
  lastEventDate: Date | null;
}

const PERIOD_OPTIONS: Array<{ value: PeriodFilter; label: string }> = [
  { value: 'today', label: 'Hoje' },
  { value: '7d', label: 'Ultimos 7 dias' },
  { value: '30d', label: 'Ultimos 30 dias' },
  { value: '90d', label: 'Ultimos 90 dias' },
  { value: 'all', label: 'Todo periodo' },
];

const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'all', label: 'Todos os status' },
  { value: 'open', label: 'Novo contato' },
  { value: 'waiting_customer', label: 'Qualificado' },
  { value: 'handoff', label: 'Proposta' },
  { value: 'resolved', label: 'Fechado (resolvido)' },
  { value: 'closed', label: 'Fechado' },
  { value: 'do_not_contact', label: 'Nao contactar' },
];

const ORIGIN_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'all', label: 'Todas as origens' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'messenger', label: 'Messenger' },
  { value: 'phone', label: 'Telefone' },
  { value: 'email', label: 'Email' },
  { value: 'web', label: 'Web' },
];

const STATUS_LABELS: Record<string, string> = {
  open: 'Novo contato',
  waiting_customer: 'Qualificado',
  handoff: 'Proposta',
  closed: 'Fechado',
  resolved: 'Fechado (resolvido)',
  do_not_contact: 'Nao contactar',
};

const STATUS_BADGES: Record<string, string> = {
  open: 'bg-sky-100 text-sky-700',
  waiting_customer: 'bg-indigo-100 text-indigo-700',
  handoff: 'bg-amber-100 text-amber-700',
  closed: 'bg-emerald-100 text-emerald-700',
  resolved: 'bg-teal-100 text-teal-700',
  do_not_contact: 'bg-red-100 text-red-700',
};

const PRIORITY_META: Record<Priority, { label: string; className: string }> = {
  high: { label: 'Alta', className: 'bg-red-100 text-red-700' },
  medium: { label: 'Media', className: 'bg-amber-100 text-amber-700' },
  low: { label: 'Baixa', className: 'bg-emerald-100 text-emerald-700' },
};

const PIPELINE_META: Record<PipelineStage, { title: string; helper: string; className: string }> = {
  new_contact: {
    title: 'Novo contato',
    helper: 'Primeiro toque e descoberta',
    className: 'from-sky-500 to-cyan-500',
  },
  qualified: {
    title: 'Qualificado',
    helper: 'Interesse validado',
    className: 'from-indigo-500 to-blue-600',
  },
  proposal: {
    title: 'Proposta',
    helper: 'Negociacao e ajuste',
    className: 'from-amber-500 to-orange-500',
  },
  closed: {
    title: 'Fechado',
    helper: 'Conversao concluida',
    className: 'from-emerald-500 to-green-600',
  },
};

const PIPELINE_ORDER: PipelineStage[] = ['new_contact', 'qualified', 'proposal', 'closed'];
const INACTIVE_STATUS = new Set(['closed', 'resolved', 'do_not_contact']);
const PROPOSAL_KEYWORDS = /(proposta|orcamento|budget|valor|proposal)/i;
const PRIORITY_WEIGHT: Record<Priority, number> = { high: 0, medium: 1, low: 2 };

function parseDate(value: string): Date | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getPeriodStart(period: PeriodFilter): Date | null {
  const now = new Date();
  if (period === 'all') return null;
  if (period === 'today') {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  const dayMap: Record<Exclude<PeriodFilter, 'all' | 'today'>, number> = {
    '7d': 7,
    '30d': 30,
    '90d': 90,
  };

  const start = new Date(now);
  start.setDate(start.getDate() - dayMap[period]);
  return start;
}

function resolveStage(lead: LeadItem): PipelineStage {
  if (lead.status === 'closed' || lead.status === 'resolved') return 'closed';
  if (lead.status === 'handoff' || PROPOSAL_KEYWORDS.test(lead.last_text || '')) return 'proposal';
  if (lead.status === 'waiting_customer') return 'qualified';
  return 'new_contact';
}

function resolvePriority(lead: LeadItem): Priority {
  if (INACTIVE_STATUS.has(lead.status)) return 'low';

  const lastEvent = parseDate(lead.last_event_at);
  if (!lastEvent) return 'medium';

  const hoursSinceLastEvent = (Date.now() - lastEvent.getTime()) / (1000 * 60 * 60);
  const stage = resolveStage(lead);

  if (stage === 'proposal' || hoursSinceLastEvent >= 48) return 'high';
  if (stage === 'qualified' || hoursSinceLastEvent >= 16) return 'medium';
  return 'low';
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="h-6 w-56 rounded bg-slate-200 mb-3" />
        <div className="h-4 w-72 rounded bg-slate-100 mb-6" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="h-28 rounded-xl bg-slate-100" />
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="h-10 rounded-lg bg-slate-100" />
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <div className="xl:col-span-8 space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="h-28 rounded-xl bg-slate-100" />
            ))}
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="h-12 rounded-lg bg-slate-100 mb-3" />
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="h-12 rounded-lg bg-slate-50 mb-2" />
            ))}
          </div>
        </div>
        <div className="xl:col-span-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="h-6 w-40 rounded bg-slate-100 mb-4" />
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="h-16 rounded-lg bg-slate-50 mb-2" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { t } = useTranslation();

  const [tenantId, setTenantId] = useState('');
  const [tenantName, setTenantName] = useState('');

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [leads, setLeads] = useState<LeadItem[]>([]);

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [originFilter, setOriginFilter] = useState('all');
  const [periodFilter, setPeriodFilter] = useState<PeriodFilter>('30d');
  const hasLoadedRef = useRef(false);

  useEffect(() => {
    const userData = localStorage.getItem('user');
    if (!userData) return;

    const user = JSON.parse(userData) as {
      role?: string;
      client_id?: string;
      client_name?: string;
    };

    const resolvedTenantId = user.role === 'admin'
      ? localStorage.getItem('active_tenant_id') || ''
      : (user.client_id || '');

    const resolvedTenantName = user.role === 'admin'
      ? localStorage.getItem('active_tenant_name') || ''
      : (user.client_name || '');

    setTenantId(resolvedTenantId);
    setTenantName(resolvedTenantName);
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setSearch(searchInput.trim());
    }, 250);

    return () => clearTimeout(timeout);
  }, [searchInput]);

  const loadDashboard = useCallback(async (clientId: string, isInitialLoad: boolean) => {
    if (isInitialLoad) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }
    setError(null);

    try {
      const params: Record<string, string | number> = {
        project_id: clientId,
        limit: 500,
        offset: 0,
      };

      if (statusFilter !== 'all') params.status = statusFilter;
      if (originFilter !== 'all') params.channel_type = originFilter;
      if (search) params.search = search;

      const periodStart = getPeriodStart(periodFilter);
      if (periodStart) params.last_event_from = periodStart.toISOString();

      const [contactsResult, overviewResult] = await Promise.allSettled([
        api.get('/api/contacts/', { params }),
        api.get(`/api/analytics/overview/${clientId}`),
      ]);

      if (contactsResult.status === 'rejected') {
        throw contactsResult.reason;
      }

      const contactsPayload = contactsResult.value.data;
      setLeads(Array.isArray(contactsPayload) ? (contactsPayload as LeadItem[]) : []);

      if (overviewResult.status === 'fulfilled') {
        setOverview((overviewResult.value.data || null) as OverviewResponse | null);
      } else {
        setOverview(null);
      }
    } catch (loadError) {
      console.error('Erro ao carregar dashboard CRM:', loadError);
      setError(t.common_error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [originFilter, periodFilter, search, statusFilter, t.common_error]);

  useEffect(() => {
    if (!tenantId) return;
    loadDashboard(tenantId, !hasLoadedRef.current);
    hasLoadedRef.current = true;
  }, [loadDashboard, tenantId]);

  const enrichedLeads = useMemo<EnrichedLead[]>(() => {
    return leads.map((lead) => ({
      ...lead,
      priority: resolvePriority(lead),
      stage: resolveStage(lead),
      lastEventDate: parseDate(lead.last_event_at),
    }));
  }, [leads]);

  const sortedLeads = useMemo(() => {
    return [...enrichedLeads].sort((left, right) => {
      const priorityDelta = PRIORITY_WEIGHT[left.priority] - PRIORITY_WEIGHT[right.priority];
      if (priorityDelta !== 0) return priorityDelta;

      const leftTime = left.lastEventDate?.getTime() || 0;
      const rightTime = right.lastEventDate?.getTime() || 0;
      return rightTime - leftTime;
    });
  }, [enrichedLeads]);

  const pipelineCount = useMemo<Record<PipelineStage, number>>(() => {
    const summary: Record<PipelineStage, number> = {
      new_contact: 0,
      qualified: 0,
      proposal: 0,
      closed: 0,
    };

    for (const lead of enrichedLeads) {
      summary[lead.stage] += 1;
    }

    return summary;
  }, [enrichedLeads]);

  const totalLeads = enrichedLeads.length;
  const periodDays = periodFilter === 'all'
    ? 7
    : periodFilter === 'today'
      ? 1
      : Number(periodFilter.replace('d', ''));

  const newLeadsCount = useMemo(() => {
    const threshold = Date.now() - (periodDays * 24 * 60 * 60 * 1000);
    return enrichedLeads.filter((lead) => (lead.lastEventDate?.getTime() || 0) >= threshold).length;
  }, [enrichedLeads, periodDays]);

  const activeContacts = useMemo(() => {
    return enrichedLeads.filter((lead) => !INACTIVE_STATUS.has(lead.status)).length;
  }, [enrichedLeads]);

  const closedCount = pipelineCount.closed;
  const conversionRate = totalLeads > 0 ? (closedCount / totalLeads) * 100 : 0;

  const computedResponseRate = totalLeads > 0
    ? ((totalLeads - enrichedLeads.filter((lead) => lead.status === 'open').length) / totalLeads) * 100
    : 0;

  const responseRate = typeof overview?.resolution_rate === 'number'
    ? overview.resolution_rate
    : computedResponseRate;

  const followUps = useMemo(() => {
    const nowMs = Date.now();
    return enrichedLeads
      .filter((lead) => !INACTIVE_STATUS.has(lead.status))
      .sort((left, right) => {
        const priorityDelta = PRIORITY_WEIGHT[left.priority] - PRIORITY_WEIGHT[right.priority];
        if (priorityDelta !== 0) return priorityDelta;

        const leftAge = left.lastEventDate ? nowMs - left.lastEventDate.getTime() : 0;
        const rightAge = right.lastEventDate ? nowMs - right.lastEventDate.getTime() : 0;
        return rightAge - leftAge;
      })
      .slice(0, 6);
  }, [enrichedLeads]);

  const dateTimeFormatter = useMemo(
    () => new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }),
    [],
  );

  const getAgeLabel = (date: Date | null) => {
    if (!date) return 'sem data';
    const hours = (Date.now() - date.getTime()) / (1000 * 60 * 60);

    if (hours < 1) return 'agora';
    if (hours < 24) return `ha ${Math.floor(hours)}h`;
    if (hours < 48) return 'ontem';
    return `ha ${Math.floor(hours / 24)}d`;
  };

  const getFollowUpNote = (lead: EnrichedLead) => {
    if (lead.stage === 'proposal') return 'Enviar proposta e validar decisor.';
    if (lead.stage === 'qualified') return 'Conduzir qualificacao e confirmar dor principal.';
    return 'Realizar primeiro retorno e confirmar canal preferido.';
  };

  const kpiCards = [
    {
      label: 'Novos leads',
      value: newLeadsCount.toLocaleString('pt-BR'),
      helper: `No recorte: ${PERIOD_OPTIONS.find((option) => option.value === periodFilter)?.label || ''}`,
      icon: <MessageCircle className="h-5 w-5 text-cyan-300" />,
      className: 'from-cyan-500/20 to-cyan-300/5 border-cyan-400/30',
    },
    {
      label: 'Contatos ativos',
      value: activeContacts.toLocaleString('pt-BR'),
      helper: `${overview?.active_conversations ?? activeContacts} em andamento`,
      icon: <Users className="h-5 w-5 text-emerald-300" />,
      className: 'from-emerald-500/20 to-emerald-300/5 border-emerald-400/30',
    },
    {
      label: 'Taxa de resposta',
      value: `${responseRate.toFixed(1)}%`,
      helper: 'Resolucao e retorno no periodo',
      icon: <Clock className="h-5 w-5 text-amber-300" />,
      className: 'from-amber-500/20 to-amber-300/5 border-amber-400/30',
    },
    {
      label: 'Conversoes',
      value: `${conversionRate.toFixed(1)}%`,
      helper: `${closedCount} de ${totalLeads} leads fechados`,
      icon: <CheckCircle className="h-5 w-5 text-teal-300" />,
      className: 'from-teal-500/20 to-teal-300/5 border-teal-400/30',
    },
  ];

  const clearFilters = () => {
    setStatusFilter('all');
    setOriginFilter('all');
    setPeriodFilter('30d');
    setSearchInput('');
    setSearch('');
  };

  return (
    <div className="p-5 lg:p-8 space-y-6">
      <section className="rounded-2xl border border-slate-800 bg-gradient-to-br from-slate-900 via-slate-900 to-cyan-950 p-6 text-slate-50 shadow-xl">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl lg:text-3xl font-semibold tracking-tight">CRM Dashboard</h1>
            <p className="text-sm text-slate-300 mt-1">
              {tenantName || 'Cliente ativo'} - operacao comercial em tempo real
            </p>
          </div>

          <div className="inline-flex items-center gap-2 rounded-full border border-slate-600 bg-slate-800/60 px-3 py-1.5 text-xs text-slate-200">
            {refreshing ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Atualizando dados
              </>
            ) : (
              <>
                <Sparkles className="h-3.5 w-3.5 text-cyan-300" />
                Atualizado agora
              </>
            )}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {kpiCards.map((card) => (
            <article
              key={card.label}
              className={`rounded-xl border bg-gradient-to-b p-4 backdrop-blur-sm transition-transform duration-200 hover:-translate-y-0.5 ${card.className}`}
            >
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm text-slate-200">{card.label}</p>
                <span className="rounded-lg bg-slate-900/40 p-2">{card.icon}</span>
              </div>
              <p className="text-3xl font-semibold text-white">{card.value}</p>
              <p className="text-xs text-slate-300 mt-1">{card.helper}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <label className="relative block xl:col-span-2">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Buscar por nome, texto ou id"
              className="w-full rounded-lg border border-gray-200 bg-white py-2.5 pl-10 pr-4 text-sm text-gray-900 outline-none ring-0 transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"
            />
          </label>

          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-700 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>

          <select
            value={originFilter}
            onChange={(event) => setOriginFilter(event.target.value)}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-700 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"
          >
            {ORIGIN_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>

          <div className="flex gap-2">
            <select
              value={periodFilter}
              onChange={(event) => setPeriodFilter(event.target.value as PeriodFilter)}
              className="flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-700 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"
            >
              {PERIOD_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>

            <button
              onClick={clearFilters}
              className="rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-gray-700 transition hover:border-gray-300 hover:bg-gray-50"
            >
              Limpar
            </button>
          </div>
        </div>
      </section>

      {loading ? (
        <DashboardSkeleton />
      ) : error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
          {error}
        </div>
      ) : (
        <section className="grid grid-cols-1 gap-6 xl:grid-cols-12">
          <div className="xl:col-span-8 space-y-6">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {PIPELINE_ORDER.map((stage) => (
                <article
                  key={stage}
                  className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className={`h-2.5 w-2.5 rounded-full bg-gradient-to-r ${PIPELINE_META[stage].className}`} />
                    <TrendingUp className="h-4 w-4 text-gray-400" />
                  </div>
                  <p className="text-sm font-medium text-gray-600">{PIPELINE_META[stage].title}</p>
                  <p className="text-3xl font-semibold text-gray-900 mt-1">{pipelineCount[stage]}</p>
                  <p className="text-xs text-gray-500 mt-1">{PIPELINE_META[stage].helper}</p>
                </article>
              ))}
            </div>

            <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
              <header className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                <div>
                  <h2 className="text-base font-semibold text-gray-900">Leads</h2>
                  <p className="text-sm text-gray-500">{sortedLeads.length} resultados no recorte atual</p>
                </div>
              </header>

              {sortedLeads.length === 0 ? (
                <div className="px-6 py-16 text-center">
                  <MessageCircle className="h-10 w-10 text-gray-300 mx-auto mb-3" />
                  <p className="text-base font-medium text-gray-900">Nenhum lead encontrado</p>
                  <p className="text-sm text-gray-500 mt-1">Ajuste os filtros para ampliar o funil.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-100">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Lead</th>
                        <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Origem</th>
                        <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Status</th>
                        <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Prioridade</th>
                        <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Etapa</th>
                        <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Ultimo contato</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {sortedLeads.map((lead) => (
                        <tr key={`${lead.channel_type}:${lead.conversation_id}`} className="hover:bg-slate-50/80 transition">
                          <td className="px-5 py-3">
                            <p className="text-sm font-medium text-gray-900">{lead.contact_name}</p>
                            <p className="text-xs text-gray-500">{lead.conversation_id}</p>
                          </td>
                          <td className="px-5 py-3 text-sm text-gray-700">
                            <div className="flex items-center gap-2">
                              {getPlatformLogo(lead.channel_type, 16) || <Users className="h-4 w-4 text-gray-400" />}
                              <span>
                                {ORIGIN_OPTIONS.find((option) => option.value === lead.channel_type)?.label || lead.channel_type}
                              </span>
                            </div>
                          </td>
                          <td className="px-5 py-3 text-sm text-gray-700">
                            <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_BADGES[lead.status] || 'bg-gray-100 text-gray-600'}`}>
                              {STATUS_LABELS[lead.status] || lead.status}
                            </span>
                          </td>
                          <td className="px-5 py-3 text-sm text-gray-700">
                            <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${PRIORITY_META[lead.priority].className}`}>
                              {PRIORITY_META[lead.priority].label}
                            </span>
                          </td>
                          <td className="px-5 py-3 text-sm text-gray-700">
                            {PIPELINE_META[lead.stage].title}
                          </td>
                          <td className="px-5 py-3 text-sm text-gray-600 whitespace-nowrap">
                            <p>{lead.lastEventDate ? dateTimeFormatter.format(lead.lastEventDate) : '-'}</p>
                            <p className="text-xs text-gray-400">{getAgeLabel(lead.lastEventDate)}</p>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          <aside className="xl:col-span-4">
            <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm xl:sticky xl:top-6">
              <header className="mb-4">
                <h2 className="text-base font-semibold text-gray-900">Tarefas de hoje</h2>
                <p className="text-sm text-gray-500">Follow-ups priorizados para acelerar conversao</p>
              </header>

              {followUps.length === 0 ? (
                <div className="rounded-xl border border-dashed border-gray-200 p-6 text-center">
                  <CheckCircle className="h-8 w-8 text-emerald-500 mx-auto mb-2" />
                  <p className="text-sm font-medium text-gray-800">Sem pendencias para hoje</p>
                  <p className="text-xs text-gray-500 mt-1">Quando surgirem leads ativos, os seguimentos aparecem aqui.</p>
                </div>
              ) : (
                <ul className="space-y-3">
                  {followUps.map((lead) => (
                    <li key={`${lead.channel_type}:${lead.conversation_id}`} className="rounded-xl border border-gray-100 p-3 hover:border-cyan-200 hover:bg-cyan-50/40 transition">
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <div>
                          <p className="text-sm font-medium text-gray-900">{lead.contact_name}</p>
                          <p className="text-xs text-gray-500">{STATUS_LABELS[lead.status] || lead.status}</p>
                        </div>
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${PRIORITY_META[lead.priority].className}`}>
                          {PRIORITY_META[lead.priority].label}
                        </span>
                      </div>
                      <p className="text-xs text-gray-600">{getFollowUpNote(lead)}</p>
                      <p className="text-xs text-gray-400 mt-1">
                        Ultimo contato: {lead.lastEventDate ? dateTimeFormatter.format(lead.lastEventDate) : '-'} ({getAgeLabel(lead.lastEventDate)})
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </aside>
        </section>
      )}
    </div>
  );
}

