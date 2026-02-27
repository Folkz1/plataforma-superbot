'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw, Search, Clock, MessageCircle } from 'lucide-react';
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
}

const STAGES: Array<{
  key: StageKey;
  label: string;
  hint: string;
  headerClass: string;
  dotClass: string;
}> = [
  {
    key: 'search',
    label: 'S  Search',
    hint: 'Prospeccao e interesse',
    headerClass: 'border-blue-200 bg-blue-50',
    dotClass: 'bg-blue-500',
  },
  {
    key: 'name',
    label: 'N  Name',
    hint: 'Captacao e dados basicos',
    headerClass: 'border-indigo-200 bg-indigo-50',
    dotClass: 'bg-indigo-500',
  },
  {
    key: 'internalize',
    label: 'I  Internalize',
    hint: 'Conexao e confianca',
    headerClass: 'border-emerald-200 bg-emerald-50',
    dotClass: 'bg-emerald-600',
  },
  {
    key: 'potentialize',
    label: 'P  Potentialize',
    hint: 'Qualificacao e objecoes',
    headerClass: 'border-amber-200 bg-amber-50',
    dotClass: 'bg-amber-600',
  },
  {
    key: 'engage',
    label: 'E  Engage',
    hint: 'Agendamento e pagamento',
    headerClass: 'border-rose-200 bg-rose-50',
    dotClass: 'bg-rose-600',
  },
  {
    key: 'resolve',
    label: 'R  Resolve',
    hint: 'Resolvido, entrega e pos-venda',
    headerClass: 'border-fuchsia-200 bg-fuchsia-50',
    dotClass: 'bg-fuchsia-600',
  },
];

function inferStage(conv: Conversation): StageKey {
  const status = String(conv.status || '').toLowerCase();
  const last = String(conv.last_text || '').toLowerCase();
  const count = Number(conv.message_count || 0);

  if (status === 'closed' || status === 'resolved') return 'resolve';
  if (status === 'do_not_contact') return 'resolve';
  if (status === 'handoff') return 'engage';

  if (last.includes('pix') || last.includes('pagamento') || last.includes('r$') || last.includes('agendar') || last.includes('agendamento')) {
    return 'engage';
  }

  if (last.includes('qual o seu nome') || last.includes('seu nome') || last.includes('me diga seu nome')) {
    return 'name';
  }

  if (count >= 14) return 'engage';
  if (count >= 9) return 'potentialize';
  if (count >= 5) return 'internalize';
  if (count >= 2) return 'name';
  return 'search';
}

export default function PipelinePage() {
  const router = useRouter();
  const { t, locale } = useTranslation();
  const [tenantId, setTenantId] = useState<string>('');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const dateLocale = locale === 'pt' ? 'pt-BR' : locale === 'es' ? 'es-ES' : 'en-US';

  useEffect(() => {
    const userData = localStorage.getItem('user');
    if (!userData) {
      router.push('/login');
      return;
    }
    const user = JSON.parse(userData);
    if (user.role !== 'admin') {
      router.push('/dash');
      return;
    }

    const tId = localStorage.getItem('active_tenant_id');
    if (!tId) {
      router.push('/admin');
      return;
    }
    setTenantId(tId);
  }, [router]);

  const load = async (tId: string) => {
    try {
      setLoading(true);
      const resp = await api.get('/api/conversations/', { params: { project_id: tId, limit: 200 } });
      setConversations(resp.data || []);
      setError(null);
    } catch {
      setError(t.common_error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!tenantId) return;
    load(tenantId);
    const interval = setInterval(() => load(tenantId), 10000);
    return () => clearInterval(interval);
  }, [tenantId]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return conversations.filter((conv) => {
      const matchSearch =
        !q ||
        (conv.contact_name || '').toLowerCase().includes(q) ||
        conv.conversation_id.toLowerCase().includes(q) ||
        (conv.last_text || '').toLowerCase().includes(q);
      const matchStatus = statusFilter === 'all' || conv.status === statusFilter;
      return matchSearch && matchStatus;
    });
  }, [conversations, search, statusFilter]);

  const grouped = useMemo(() => {
    const map = new Map<StageKey, Conversation[]>();
    for (const stage of STAGES) map.set(stage.key, []);
    for (const conv of filtered) {
      const key = inferStage(conv);
      map.get(key)?.push(conv);
    }
    return map;
  }, [filtered]);

  const getChannelIcon = (channel: string) => {
    const logo = getPlatformLogo(channel, 18);
    return logo || <MessageCircle className="w-5 h-5 text-gray-400" />;
  };

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      open: 'bg-green-100 text-green-700',
      waiting_customer: 'bg-yellow-100 text-yellow-700',
      handoff: 'bg-amber-100 text-amber-700',
      closed: 'bg-gray-100 text-gray-600',
      resolved: 'bg-blue-100 text-blue-700',
      do_not_contact: 'bg-red-100 text-red-700',
    };
    const labels: Record<string, string> = {
      open: t.status_open,
      waiting_customer: t.status_waiting_customer,
      handoff: t.status_handoff,
      closed: t.status_closed,
      resolved: t.status_resolved,
      do_not_contact: t.status_do_not_contact,
    };
    return (
      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${styles[status] || 'bg-gray-100 text-gray-600'}`}>
        {labels[status] || status}
      </span>
    );
  };

  return (
    <div className="p-6 lg:p-8">
      <div className="mb-6 flex items-start gap-4 justify-between flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t.pipeline_title}</h1>
          <p className="text-sm text-gray-500 mt-1">{t.pipeline_subtitle}</p>
        </div>
        <button
          onClick={() => tenantId && load(tenantId)}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm text-gray-700 hover:bg-gray-50 transition"
          title={t.common_filter}
        >
          <RefreshCw className="w-4 h-4" />
          Atualizar
        </button>
      </div>

      <div className="flex gap-3 mb-6 flex-wrap">
        <div className="flex-1 min-w-[240px] relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder={t.pipeline_search}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-4 py-2.5 bg-white border border-gray-200 rounded-lg text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="all">{t.conv_all}</option>
          <option value="open">{t.status_open}</option>
          <option value="waiting_customer">{t.status_waiting_customer}</option>
          <option value="handoff">{t.status_handoff}</option>
          <option value="closed">{t.status_closed}</option>
          <option value="do_not_contact">{t.status_do_not_contact}</option>
        </select>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-72">
          <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
        </div>
      ) : error ? (
        <div className="bg-red-50 text-red-600 p-4 rounded-lg">{error}</div>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {STAGES.map((stage) => {
            const items = grouped.get(stage.key) || [];
            return (
              <div key={stage.key} className="w-[340px] shrink-0">
                <div className={`border rounded-xl px-4 py-3 ${stage.headerClass}`}>
                  <div className="flex items-center gap-2">
                    <div className={`w-2.5 h-2.5 rounded-full ${stage.dotClass}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900">{stage.label}</p>
                      <p className="text-xs text-gray-600 truncate">{stage.hint}</p>
                    </div>
                    <span className="text-xs font-semibold text-gray-700 bg-white/70 border border-white/80 rounded-full px-2 py-0.5">
                      {items.length}
                    </span>
                  </div>
                </div>

                <div className="mt-3 space-y-2">
                  {items.length === 0 ? (
                    <div className="text-xs text-gray-400 px-2 py-6 text-center border border-dashed border-gray-200 rounded-xl bg-gray-50">
                      Sem conversas
                    </div>
                  ) : (
                    items.map((conv) => (
                      <button
                        key={`${conv.project_id}-${conv.channel_type}-${conv.conversation_id}`}
                        onClick={() => router.push(`/dash/conversations/${conv.project_id}/${conv.conversation_id}`)}
                        className="w-full text-left bg-white border border-gray-100 rounded-xl p-4 hover:border-blue-200 hover:shadow-sm transition-all"
                      >
                        <div className="flex items-start gap-3">
                          <div className="mt-0.5">{getChannelIcon(conv.channel_type)}</div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-medium text-gray-900 truncate">
                                {conv.contact_name || conv.conversation_id}
                              </span>
                              {getStatusBadge(conv.status)}
                            </div>
                            <p className="text-gray-500 text-sm line-clamp-2">
                              {conv.last_text || t.conv_no_messages}
                            </p>
                            <div className="flex items-center gap-3 mt-2 text-xs text-gray-400">
                              <span className="flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                {new Date(conv.last_event_at).toLocaleString(dateLocale, {
                                  day: '2-digit',
                                  month: '2-digit',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </span>
                              <span>{conv.message_count} {t.conv_msgs}</span>
                            </div>
                          </div>
                        </div>
                      </button>
                    ))
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
