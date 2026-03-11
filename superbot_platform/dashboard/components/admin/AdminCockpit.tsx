'use client';

import { useMemo } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  AudioLines,
  Bot,
  Building2,
  Clock3,
  HardDrive,
  MessageSquare,
  RadioTower,
  Search,
  ShieldAlert,
} from 'lucide-react';

export interface AdminOverviewSummary {
  total_clients: number;
  active_clients: number;
  inactive_clients: number;
  linked_projects: number;
  companies_with_alerts: number;
  active_conversations: number;
  open_conversations: number;
  handoff_conversations: number;
  today_conversations: number;
  today_messages: number;
  inbound_today: number;
  outbound_today: number;
  audio_today: number;
  media_today: number;
  resolution_rate: number;
}

export interface AdminOverviewCompany {
  client_id: string;
  name: string;
  slug: string;
  status: string;
  timezone: string;
  project_id: string | null;
  project_slug?: string | null;
  health: 'healthy' | 'attention' | 'critical' | 'inactive' | string;
  alerts: string[];
  metrics: {
    total_conversations: number;
    active_conversations: number;
    open_conversations: number;
    handoff_conversations: number;
    period_conversations: number;
    today_conversations: number;
    total_messages: number;
    period_messages: number;
    today_messages: number;
    inbound_today: number;
    outbound_today: number;
    audio_today: number;
    media_today: number;
    resolution_rate: number;
    avg_response_time: string;
    last_event_at: string | null;
  };
  operations: {
    connected_channels: number;
    channel_types: string[];
    active_agents: number;
    has_meta_token: boolean;
    has_storage: boolean;
  };
}

export interface AdminOverviewResponse {
  generated_at: string;
  period_days: number;
  summary: AdminOverviewSummary;
  alerts: Array<{
    client_id: string;
    name: string;
    health: string;
    alerts: string[];
  }>;
  companies: AdminOverviewCompany[];
}

type HealthFilter = 'all' | 'healthy' | 'attention' | 'critical' | 'inactive';

interface AdminCockpitProps {
  overview: AdminOverviewResponse | null;
  loading: boolean;
  error: string | null;
  periodDays: number;
  onPeriodDaysChange: (days: number) => void;
  companySearch: string;
  onCompanySearchChange: (value: string) => void;
  healthFilter: HealthFilter;
  onHealthFilterChange: (value: HealthFilter) => void;
  onOpenDashboard: (company: AdminOverviewCompany) => void;
}

const PERIOD_OPTIONS = [
  { value: 1, label: 'Hoje' },
  { value: 7, label: '7 dias' },
  { value: 30, label: '30 dias' },
];

const HEALTH_META: Record<string, { label: string; className: string }> = {
  healthy: { label: 'Saudavel', className: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  attention: { label: 'Atencao', className: 'bg-amber-100 text-amber-700 border-amber-200' },
  critical: { label: 'Critico', className: 'bg-rose-100 text-rose-700 border-rose-200' },
  inactive: { label: 'Inativo', className: 'bg-slate-100 text-slate-600 border-slate-200' },
};

function formatRelativeTime(value: string | null): string {
  if (!value) return 'Sem atividade';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Sem atividade';

  const diffMinutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
  if (diffMinutes < 1) return 'agora';
  if (diffMinutes < 60) return `ha ${diffMinutes} min`;

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `ha ${diffHours} h`;

  return `ha ${Math.round(diffHours / 24)} d`;
}

function formatChannelTypes(channelTypes: string[]): string {
  if (!channelTypes.length) return 'Nenhum canal';
  return channelTypes.join(', ');
}

export function AdminCockpit({
  overview,
  loading,
  error,
  periodDays,
  onPeriodDaysChange,
  companySearch,
  onCompanySearchChange,
  healthFilter,
  onHealthFilterChange,
  onOpenDashboard,
}: AdminCockpitProps) {
  const companies = overview?.companies || [];

  const filteredCompanies = useMemo(() => {
    const normalizedSearch = companySearch.trim().toLowerCase();

    return companies.filter((company) => {
      const matchesHealth = healthFilter === 'all' || company.health === healthFilter;
      const matchesSearch = !normalizedSearch
        || company.name.toLowerCase().includes(normalizedSearch)
        || company.slug.toLowerCase().includes(normalizedSearch)
        || (company.project_slug || '').toLowerCase().includes(normalizedSearch);

      return matchesHealth && matchesSearch;
    });
  }, [companies, companySearch, healthFilter]);

  const topByVolume = useMemo(
    () => [...companies].sort((left, right) => right.metrics.today_messages - left.metrics.today_messages).slice(0, 5),
    [companies],
  );

  const storageReadyCount = useMemo(
    () => companies.filter((company) => company.operations.has_storage).length,
    [companies],
  );

  const tokenReadyCount = useMemo(
    () => companies.filter((company) => company.operations.has_meta_token).length,
    [companies],
  );

  const summary = overview?.summary;

  return (
    <section className="mb-8 space-y-6">
      <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="bg-[radial-gradient(circle_at_top_left,_rgba(12,74,110,0.18),_transparent_32%),linear-gradient(135deg,#0f172a_0%,#111827_55%,#1e293b_100%)] px-6 py-7 text-white">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <p className="text-[11px] uppercase tracking-[0.32em] text-cyan-200">Cockpit Global</p>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight">Operacao consolidada de todas as empresas</h2>
              <p className="mt-2 max-w-3xl text-sm text-slate-300">
                Visao executiva para decidir rapido: volume, fila, canais, audio, saude e pontos de atencao em um so lugar.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {PERIOD_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  onClick={() => onPeriodDaysChange(option.value)}
                  className={`rounded-full px-3 py-1.5 text-sm transition ${
                    periodDays === option.value
                      ? 'bg-white text-slate-900'
                      : 'bg-white/10 text-slate-200 hover:bg-white/15'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="border-t border-slate-200 bg-slate-50/80 px-6 py-4">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px]">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={companySearch}
                onChange={(event) => onCompanySearchChange(event.target.value)}
                placeholder="Buscar empresa, slug ou projeto"
                className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-4 text-sm text-slate-900 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"
              />
            </label>

            <select
              value={healthFilter}
              onChange={(event) => onHealthFilterChange(event.target.value as HealthFilter)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"
            >
              <option value="all">Todas as saudes</option>
              <option value="critical">Critico</option>
              <option value="attention">Atencao</option>
              <option value="healthy">Saudavel</option>
              <option value="inactive">Inativo</option>
            </select>
          </div>
        </div>
      </div>

      {error && !overview && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        {loading && !overview
          ? Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="h-32 animate-pulse rounded-2xl border border-slate-200 bg-slate-100" />
            ))
          : [
              {
                label: 'Empresas ativas',
                value: `${summary?.active_clients || 0}/${summary?.total_clients || 0}`,
                helper: `${summary?.linked_projects || 0} com projeto vinculado`,
                icon: <Building2 className="h-5 w-5 text-cyan-500" />,
                tone: 'bg-cyan-50 border-cyan-100',
              },
              {
                label: 'Conversas abertas',
                value: String(summary?.active_conversations || 0),
                helper: `${summary?.handoff_conversations || 0} com humano`,
                icon: <Bot className="h-5 w-5 text-emerald-500" />,
                tone: 'bg-emerald-50 border-emerald-100',
              },
              {
                label: 'Mensagens hoje',
                value: String(summary?.today_messages || 0),
                helper: `${summary?.inbound_today || 0} entrada / ${summary?.outbound_today || 0} saida`,
                icon: <MessageSquare className="h-5 w-5 text-blue-500" />,
                tone: 'bg-blue-50 border-blue-100',
              },
              {
                label: 'Audios hoje',
                value: String(summary?.audio_today || 0),
                helper: `${summary?.media_today || 0} mensagens com midia`,
                icon: <AudioLines className="h-5 w-5 text-violet-500" />,
                tone: 'bg-violet-50 border-violet-100',
              },
              {
                label: 'Saude de canais',
                value: `${tokenReadyCount}/${companies.length}`,
                helper: `${storageReadyCount}/${companies.length} com storage pronto`,
                icon: <RadioTower className="h-5 w-5 text-amber-500" />,
                tone: 'bg-amber-50 border-amber-100',
              },
              {
                label: 'Empresas em atencao',
                value: String(summary?.companies_with_alerts || 0),
                helper: `Resolucao media ${summary?.resolution_rate.toFixed(1) || '0.0'}%`,
                icon: <ShieldAlert className="h-5 w-5 text-rose-500" />,
                tone: 'bg-rose-50 border-rose-100',
              },
            ].map((card) => (
              <article key={card.label} className={`rounded-2xl border p-4 shadow-sm ${card.tone}`}>
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-slate-700">{card.label}</p>
                  {card.icon}
                </div>
                <p className="mt-4 text-3xl font-semibold tracking-tight text-slate-900">{card.value}</p>
                <p className="mt-1 text-xs text-slate-500">{card.helper}</p>
              </article>
            ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <div>
              <h3 className="text-base font-semibold text-slate-900">Empresas que exigem atencao</h3>
              <p className="text-sm text-slate-500">Faltas de configuracao ou operacao com risco.</p>
            </div>
            <AlertTriangle className="h-5 w-5 text-amber-500" />
          </div>

          <div className="p-5">
            {!overview?.alerts.length ? (
              <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-6 text-sm text-emerald-700">
                Nenhuma empresa com alerta prioritario no momento.
              </div>
            ) : (
              <div className="space-y-3">
                {overview.alerts.map((alert) => (
                  <article key={alert.client_id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{alert.name}</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {alert.alerts.map((item) => (
                            <span key={item} className="rounded-full border border-amber-200 bg-amber-100 px-2.5 py-1 text-[11px] font-medium text-amber-800">
                              {item}
                            </span>
                          ))}
                        </div>
                      </div>
                      <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${HEALTH_META[alert.health]?.className || HEALTH_META.attention.className}`}>
                        {HEALTH_META[alert.health]?.label || alert.health}
                      </span>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <div>
              <h3 className="text-base font-semibold text-slate-900">Top volume do dia</h3>
              <p className="text-sm text-slate-500">Quem mais esta movimentando atendimento agora.</p>
            </div>
            <Clock3 className="h-5 w-5 text-slate-400" />
          </div>

          <div className="space-y-3 p-5">
            {topByVolume.length === 0 ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                Nenhuma atividade suficiente para montar ranking ainda.
              </div>
            ) : (
              topByVolume.map((company, index) => (
                <button
                  key={company.client_id}
                  onClick={() => onOpenDashboard(company)}
                  className="flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-left transition hover:border-slate-300 hover:bg-white"
                >
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">#{index + 1}</p>
                    <p className="mt-1 text-sm font-semibold text-slate-900">{company.name}</p>
                    <p className="text-xs text-slate-500">
                      {company.metrics.today_messages} mensagens hoje | {company.metrics.active_conversations} abertas
                    </p>
                  </div>
                  <ArrowUpRight className="h-4 w-4 text-slate-400" />
                </button>
              ))
            )}
          </div>
        </section>
      </div>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h3 className="text-base font-semibold text-slate-900">Operacao por empresa</h3>
            <p className="text-sm text-slate-500">{filteredCompanies.length} empresas no recorte atual.</p>
          </div>
          <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-500">
            <HardDrive className="h-3.5 w-3.5" />
            Dados consolidados do admin
          </div>
        </div>

        {loading && !overview ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="h-14 animate-pulse rounded-xl bg-slate-100" />
            ))}
          </div>
        ) : filteredCompanies.length === 0 ? (
          <div className="px-5 py-12 text-center text-sm text-slate-500">
            Nenhuma empresa encontrada com os filtros atuais.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Empresa</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Saude</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Hoje</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Fila</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Canais</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Resposta</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Alertas</th>
                  <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Acao</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredCompanies.map((company) => {
                  const healthMeta = HEALTH_META[company.health] || HEALTH_META.attention;
                  return (
                    <tr key={company.client_id} className="transition hover:bg-slate-50/80">
                      <td className="px-5 py-4">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">{company.name}</p>
                          <p className="text-xs text-slate-500">
                            {company.project_slug || company.slug}
                            {company.metrics.last_event_at ? ` | ${formatRelativeTime(company.metrics.last_event_at)}` : ''}
                          </p>
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${healthMeta.className}`}>
                          {healthMeta.label}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-sm text-slate-700">
                        <p className="font-medium">{company.metrics.today_messages} mensagens</p>
                        <p className="text-xs text-slate-500">{company.metrics.today_conversations} conversas com atividade</p>
                      </td>
                      <td className="px-5 py-4 text-sm text-slate-700">
                        <p className="font-medium">{company.metrics.active_conversations} abertas</p>
                        <p className="text-xs text-slate-500">{company.metrics.handoff_conversations} com humano</p>
                      </td>
                      <td className="px-5 py-4 text-sm text-slate-700">
                        <p className="font-medium">{company.operations.connected_channels} conectados</p>
                        <p className="text-xs text-slate-500">{formatChannelTypes(company.operations.channel_types)}</p>
                      </td>
                      <td className="px-5 py-4 text-sm text-slate-700">
                        <p className="font-medium">{company.metrics.avg_response_time}</p>
                        <p className="text-xs text-slate-500">{company.metrics.resolution_rate.toFixed(1)}% resolucao</p>
                      </td>
                      <td className="px-5 py-4">
                        {company.alerts.length ? (
                          <div className="flex flex-wrap gap-1.5">
                            {company.alerts.slice(0, 2).map((alert) => (
                              <span key={alert} className="rounded-full bg-amber-100 px-2 py-1 text-[11px] font-medium text-amber-800">
                                {alert}
                              </span>
                            ))}
                            {company.alerts.length > 2 && (
                              <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-600">
                                +{company.alerts.length - 2}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-emerald-600">Sem alertas</span>
                        )}
                      </td>
                      <td className="px-5 py-4 text-right">
                        <button
                          onClick={() => onOpenDashboard(company)}
                          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                        >
                          Abrir
                          <ArrowUpRight className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </section>
  );
}
