'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useTranslation } from '@/lib/i18n';
import { getPlatformLogo } from '@/components/PlatformLogos';
import { Download, RefreshCcw, Search, Users } from 'lucide-react';

interface ContactItem {
  project_id: string;
  conversation_id: string;
  contact_name: string;
  channel_type: string;
  status: string;
  last_event_at: string;
  last_text?: string | null;
}

function toCsv(rows: ContactItem[], locale: string): string {
  const sep = ';';
  const header = [
    'contact_name',
    'conversation_id',
    'channel_type',
    'status',
    'last_event_at',
    'last_text',
  ];

  const dateLocale = locale === 'pt' ? 'pt-BR' : locale === 'es' ? 'es-ES' : 'en-US';

  const escapeCell = (value: unknown) => {
    const str = String(value ?? '');
    const needsQuotes = str.includes('"') || str.includes('\n') || str.includes('\r') || str.includes(sep);
    const escaped = str.replace(/\"/g, '""');
    return needsQuotes ? `"${escaped}"` : escaped;
  };

  const lines = [header.join(sep)];
  for (const r of rows) {
    const dt = r.last_event_at ? new Date(r.last_event_at).toLocaleString(dateLocale) : '';
    lines.push([
      escapeCell(r.contact_name),
      escapeCell(r.conversation_id),
      escapeCell(r.channel_type),
      escapeCell(r.status),
      escapeCell(dt),
      escapeCell(r.last_text ?? ''),
    ].join(sep));
  }
  return lines.join('\n');
}

function downloadTextFile(filename: string, content: string, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function ContactsPage() {
  const router = useRouter();
  const { t, locale } = useTranslation();

  const [tenantId, setTenantId] = useState('');
  const [contacts, setContacts] = useState<ContactItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [channelType, setChannelType] = useState('');
  const [status, setStatus] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  // Pagination
  const [pageSize, setPageSize] = useState(200);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  const dateLocale = locale === 'pt' ? 'pt-BR' : locale === 'es' ? 'es-ES' : 'en-US';

  const statusLabels = useMemo(() => ({
    open: t.status_open,
    waiting_customer: t.status_waiting_customer,
    handoff: t.status_handoff,
    closed: t.status_closed,
    resolved: t.status_resolved,
    do_not_contact: t.status_do_not_contact,
  }), [t]);

  const statusStyles: Record<string, string> = {
    open: 'bg-green-100 text-green-700',
    waiting_customer: 'bg-yellow-100 text-yellow-700',
    handoff: 'bg-amber-100 text-amber-700',
    closed: 'bg-gray-100 text-gray-600',
    resolved: 'bg-blue-100 text-blue-700',
    do_not_contact: 'bg-red-100 text-red-700',
  };

  useEffect(() => {
    const userData = localStorage.getItem('user');
    if (!userData) {
      router.push('/login');
      return;
    }

    const user = JSON.parse(userData);
    const tId = user.role === 'admin'
      ? localStorage.getItem('active_tenant_id')
      : user.client_id;

    if (!tId) {
      router.push(user.role === 'admin' ? '/admin' : '/login');
      return;
    }

    setTenantId(tId);
    loadContacts(tId, 0, true);
  }, [router]);

  const buildParams = (tId: string, lim: number, off: number) => {
    const params: any = { project_id: tId, limit: lim, offset: off };
    if (channelType) params.channel_type = channelType;
    if (status) params.status = status;
    if (search.trim()) params.search = search.trim();
    if (fromDate) params.last_event_from = `${fromDate}T00:00:00`;
    if (toDate) params.last_event_to = `${toDate}T23:59:59`;
    return params;
  };

  const loadContacts = async (tId: string, off: number, replace: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get('/api/contacts/', { params: buildParams(tId, pageSize, off) });
      const batch = res.data as ContactItem[];
      setContacts((prev) => (replace ? batch : [...prev, ...batch]));
      setOffset(off);
      setHasMore(batch.length === pageSize);
    } catch (err) {
      console.error('Erro ao carregar contatos:', err);
      setError(t.common_error);
    } finally {
      setLoading(false);
    }
  };

  const handleFilter = () => {
    if (tenantId) loadContacts(tenantId, 0, true);
  };

  const handleLoadMore = () => {
    if (tenantId) loadContacts(tenantId, offset + pageSize, false);
  };

  const handleExport = async () => {
    if (!tenantId) return;
    setExporting(true);
    setError(null);

    try {
      const exportPageSize = 1000;
      const maxRows = 50000;
      const all: ContactItem[] = [];
      let off = 0;
      while (all.length < maxRows) {
        const res = await api.get('/api/contacts/', { params: buildParams(tenantId, exportPageSize, off) });
        const batch = res.data as ContactItem[];
        all.push(...batch);
        if (batch.length < exportPageSize) break;
        off += exportPageSize;
      }

      const csv = toCsv(all, locale);
      const today = new Date().toISOString().slice(0, 10);
      downloadTextFile(`contacts_${today}.csv`, csv, 'text/csv;charset=utf-8');
    } catch (err) {
      console.error('Erro ao exportar CSV:', err);
      setError(t.common_error);
    } finally {
      setExporting(false);
    }
  };

  const getChannelIcon = (channel: string) => {
    const logo = getPlatformLogo(channel, 18);
    return logo || <Users className="w-4 h-4 text-gray-400" />;
  };

  return (
    <div className="p-6 lg:p-8">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{t.contacts_title}</h1>
        <p className="text-sm text-gray-500 mt-1">{t.contacts_subtitle}</p>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[220px] relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t.contacts_search}
              className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <select
            value={channelType}
            onChange={(e) => setChannelType(e.target.value)}
            className="px-4 py-2.5 bg-white border border-gray-200 rounded-lg text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">{t.contacts_all_channels}</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="instagram">Instagram</option>
            <option value="messenger">Messenger</option>
            <option value="phone">Phone</option>
          </select>

          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="px-4 py-2.5 bg-white border border-gray-200 rounded-lg text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">{t.contacts_all_status}</option>
            <option value="open">{t.status_open}</option>
            <option value="waiting_customer">{t.status_waiting_customer}</option>
            <option value="handoff">{t.status_handoff}</option>
            <option value="closed">{t.status_closed}</option>
            <option value="resolved">{t.status_resolved}</option>
            <option value="do_not_contact">{t.status_do_not_contact}</option>
          </select>

          <div className="flex items-center gap-2">
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="px-3 py-2.5 bg-white border border-gray-200 rounded-lg text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              title={t.contacts_from}
            />
            <span className="text-gray-400 text-sm">-</span>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="px-3 py-2.5 bg-white border border-gray-200 rounded-lg text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              title={t.contacts_to}
            />
          </div>

          <select
            value={String(pageSize)}
            onChange={(e) => setPageSize(Number(e.target.value))}
            className="px-3 py-2.5 bg-white border border-gray-200 rounded-lg text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            title={t.contacts_page_size}
          >
            <option value="200">200</option>
            <option value="500">500</option>
            <option value="1000">1000</option>
          </select>

          <button
            onClick={handleFilter}
            disabled={loading}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-800 disabled:opacity-50"
          >
            <RefreshCcw className="w-4 h-4" />
            {t.common_filter}
          </button>

          <button
            onClick={handleExport}
            disabled={exporting || loading}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            <Download className="w-4 h-4" />
            {exporting ? t.contacts_exporting : t.contacts_export}
          </button>
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center h-96">
          <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
        </div>
      ) : error ? (
        <div className="bg-red-50 text-red-600 p-4 rounded-lg">{error}</div>
      ) : contacts.length === 0 ? (
        <div className="text-center py-16">
          <Users className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <h3 className="text-lg font-medium text-gray-900 mb-1">{t.contacts_no_contacts}</h3>
          <p className="text-sm text-gray-500">{t.contacts_no_contacts_desc}</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
            <p className="text-sm text-gray-600">
              <span className="font-medium text-gray-900">{contacts.length}</span> {t.contacts_found}
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-100">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">{t.contacts_col_name}</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">{t.contacts_col_id}</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">{t.contacts_col_channel}</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">{t.contacts_col_status}</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">{t.contacts_col_last_event}</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">{t.contacts_col_last_text}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {contacts.map((c) => (
                  <tr key={`${c.channel_type}:${c.conversation_id}`} className="hover:bg-gray-50">
                    <td className="px-5 py-3 text-sm text-gray-900 font-medium whitespace-nowrap">
                      {c.contact_name}
                    </td>
                    <td className="px-5 py-3 text-sm text-gray-700 whitespace-nowrap">
                      {c.conversation_id}
                    </td>
                    <td className="px-5 py-3 text-sm text-gray-700 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        {getChannelIcon(c.channel_type)}
                        <span className="capitalize">{c.channel_type}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-sm text-gray-700 whitespace-nowrap">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusStyles[c.status] || 'bg-gray-100 text-gray-600'}`}>
                        {statusLabels[c.status as keyof typeof statusLabels] || c.status}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-sm text-gray-700 whitespace-nowrap">
                      {c.last_event_at ? new Date(c.last_event_at).toLocaleString(dateLocale) : '-'}
                    </td>
                    <td className="px-5 py-3 text-sm text-gray-600 max-w-[520px]">
                      <span className="line-clamp-2">{c.last_text || '-'}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {hasMore && (
            <div className="p-4 border-t border-gray-100 flex justify-center">
              <button
                onClick={handleLoadMore}
                disabled={loading}
                className="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-800 disabled:opacity-50"
              >
                {t.contacts_load_more}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

