'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import {
  Phone, Clock, CheckCircle, XCircle, TrendingUp,
  Play, X, User, Mail, FileText, Loader2, ChevronDown
} from 'lucide-react';

interface CallSummary {
  id: string;
  agent_id: string;
  agent_name: string;
  conversation_id: string;
  customer_name: string;
  customer_phone: string;
  customer_email: string;
  call_duration_secs: number;
  start_time: string;
  call_successful: boolean;
  termination_reason: string;
  transcript_summary: string;
  audio_url: string;
}

interface CallDetail extends CallSummary {
  transcript: Array<{ role: string; message: string; time_in_call_secs?: number }>;
  data_collection: Record<string, any>;
  created_at: string;
}

interface Stats {
  total: number;
  successful: number;
  success_rate: number;
  avg_duration_secs: number;
  today: number;
}

function formatDuration(secs: number): string {
  if (!secs) return '0s';
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export default function CallsPage() {
  const router = useRouter();
  const [calls, setCalls] = useState<CallSummary[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [tenantId, setTenantId] = useState('');

  // Filters
  const [days, setDays] = useState(30);
  const [statusFilter, setStatusFilter] = useState('');

  // Detail modal
  const [selectedCall, setSelectedCall] = useState<CallDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  useEffect(() => {
    const userData = localStorage.getItem('user');
    if (!userData) { router.push('/login'); return; }
    const parsedUser = JSON.parse(userData);
    const tId = parsedUser.role === 'admin'
      ? localStorage.getItem('active_tenant_id')
      : parsedUser.client_id;
    if (!tId) { router.push(parsedUser.role === 'admin' ? '/admin' : '/login'); return; }
    setTenantId(tId);
    loadCalls(tId, days, statusFilter);
  }, [router]);

  const loadCalls = async (tId: string, d: number, status: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ days: String(d) });
      if (status) params.append('status', status);
      const res = await api.get(`/api/elevenlabs/calls/${tId}?${params}`);
      setStats(res.data.stats);
      setCalls(res.data.calls);
    } catch (error) {
      console.error('Erro ao carregar ligacoes:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleFilter = () => {
    if (tenantId) loadCalls(tenantId, days, statusFilter);
  };

  const openDetail = async (callId: string) => {
    setLoadingDetail(true);
    try {
      const res = await api.get(`/api/elevenlabs/calls/${tenantId}/${callId}`);
      setSelectedCall(res.data);
    } catch (error) {
      console.error('Erro ao carregar detalhe:', error);
    } finally {
      setLoadingDetail(false);
    }
  };

  return (
    <div className="p-6 lg:p-8">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Historico de Ligacoes</h1>
        <p className="text-sm text-gray-500 mt-1">Ligacoes realizadas pelos agentes de voz ElevenLabs</p>
      </div>

      {/* KPI Cards */}
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center">
                <Phone className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{stats.total}</p>
                <p className="text-xs text-gray-500">Total ({days}d)</p>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-amber-50 rounded-lg flex items-center justify-center">
                <Clock className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{formatDuration(stats.avg_duration_secs)}</p>
                <p className="text-xs text-gray-500">Duracao media</p>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-green-50 rounded-lg flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{stats.success_rate}%</p>
                <p className="text-xs text-gray-500">Taxa de sucesso</p>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-purple-50 rounded-lg flex items-center justify-center">
                <Phone className="w-5 h-5 text-purple-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{stats.today}</p>
                <p className="text-xs text-gray-500">Hoje</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-600">Periodo:</label>
            <select
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-900 bg-white"
            >
              <option value={7}>7 dias</option>
              <option value={14}>14 dias</option>
              <option value={30}>30 dias</option>
              <option value={60}>60 dias</option>
              <option value={90}>90 dias</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-600">Status:</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-900 bg-white"
            >
              <option value="">Todos</option>
              <option value="successful">Sucesso</option>
              <option value="failed">Falha</option>
            </select>
          </div>
          <button
            onClick={handleFilter}
            className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition"
          >
            Filtrar
          </button>
        </div>
      </div>

      {/* Calls Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <div className="overflow-x-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
            </div>
          ) : calls.length === 0 ? (
            <div className="text-center py-12">
              <Phone className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500">Nenhuma ligacao encontrada</p>
              <p className="text-sm text-gray-400 mt-1">As ligacoes aparecerao aqui quando o webhook estiver configurado</p>
            </div>
          ) : (
            <table className="w-full">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 uppercase">Data/Hora</th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 uppercase">Cliente</th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 uppercase">Telefone</th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 uppercase">Agente</th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 uppercase">Duracao</th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-5 py-3 text-right text-xs font-medium text-gray-500 uppercase">Acao</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {calls.map((call) => (
                  <tr key={call.id} className="hover:bg-gray-50 transition cursor-pointer" onClick={() => openDetail(call.id)}>
                    <td className="px-5 py-3 text-sm text-gray-900">
                      {call.start_time ? new Date(call.start_time).toLocaleString('pt-BR', {
                        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
                      }) : '-'}
                    </td>
                    <td className="px-5 py-3">
                      <div className="text-sm font-medium text-gray-900">{call.customer_name || '-'}</div>
                      {call.customer_email && (
                        <div className="text-xs text-gray-500">{call.customer_email}</div>
                      )}
                    </td>
                    <td className="px-5 py-3 text-sm text-gray-600 font-mono">{call.customer_phone || '-'}</td>
                    <td className="px-5 py-3 text-sm text-gray-600">{call.agent_name || '-'}</td>
                    <td className="px-5 py-3 text-sm text-gray-900 font-medium">{formatDuration(call.call_duration_secs)}</td>
                    <td className="px-5 py-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full ${
                        call.call_successful
                          ? 'bg-green-50 text-green-700 border border-green-200'
                          : 'bg-red-50 text-red-700 border border-red-200'
                      }`}>
                        {call.call_successful
                          ? <><CheckCircle className="w-3 h-3" /> Sucesso</>
                          : <><XCircle className="w-3 h-3" /> Falha</>}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <button className="text-blue-600 hover:text-blue-800 text-sm font-medium">
                        Ver
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Detail Modal */}
      {(selectedCall || loadingDetail) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl mx-4 max-h-[90vh] flex flex-col">
            {loadingDetail ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
              </div>
            ) : selectedCall && (
              <>
                {/* Header */}
                <div className="px-6 py-4 border-b flex justify-between items-center flex-shrink-0">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">Detalhe da Ligacao</h3>
                    <p className="text-xs text-gray-500">
                      {selectedCall.start_time ? new Date(selectedCall.start_time).toLocaleString('pt-BR') : ''}
                    </p>
                  </div>
                  <button onClick={() => setSelectedCall(null)} className="p-1 hover:bg-gray-100 rounded-lg">
                    <X className="w-5 h-5 text-gray-500" />
                  </button>
                </div>

                {/* Body */}
                <div className="px-6 py-4 overflow-y-auto flex-1 space-y-6">
                  {/* Info Grid */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="flex items-center gap-2">
                      <User className="w-4 h-4 text-gray-400" />
                      <div>
                        <p className="text-xs text-gray-500">Nome</p>
                        <p className="text-sm font-medium text-gray-900">{selectedCall.customer_name || '-'}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Phone className="w-4 h-4 text-gray-400" />
                      <div>
                        <p className="text-xs text-gray-500">Telefone</p>
                        <p className="text-sm font-medium text-gray-900">{selectedCall.customer_phone || '-'}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Mail className="w-4 h-4 text-gray-400" />
                      <div>
                        <p className="text-xs text-gray-500">Email</p>
                        <p className="text-sm font-medium text-gray-900">{selectedCall.customer_email || '-'}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Clock className="w-4 h-4 text-gray-400" />
                      <div>
                        <p className="text-xs text-gray-500">Duracao</p>
                        <p className="text-sm font-medium text-gray-900">{formatDuration(selectedCall.call_duration_secs)}</p>
                      </div>
                    </div>
                  </div>

                  {/* Status */}
                  <div className="flex items-center gap-3">
                    <span className={`inline-flex items-center gap-1 px-3 py-1 text-sm font-medium rounded-full ${
                      selectedCall.call_successful
                        ? 'bg-green-50 text-green-700 border border-green-200'
                        : 'bg-red-50 text-red-700 border border-red-200'
                    }`}>
                      {selectedCall.call_successful ? 'Sucesso' : 'Falha'}
                    </span>
                    {selectedCall.termination_reason && (
                      <span className="text-sm text-gray-500">
                        Motivo: {selectedCall.termination_reason}
                      </span>
                    )}
                  </div>

                  {/* Summary */}
                  {selectedCall.transcript_summary && (
                    <div>
                      <h4 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
                        <FileText className="w-4 h-4" /> Resumo
                      </h4>
                      <p className="text-sm text-gray-600 bg-gray-50 rounded-lg p-3">
                        {selectedCall.transcript_summary}
                      </p>
                    </div>
                  )}

                  {/* Data Collection */}
                  {selectedCall.data_collection && Object.keys(selectedCall.data_collection).length > 0 && (() => {
                    // Extract only meaningful values from ElevenLabs data_collection
                    const entries = Object.entries(selectedCall.data_collection)
                      .map(([key, val]) => {
                        // ElevenLabs format: { value: "...", json_schema: {...}, description: "..." }
                        // or nested: { data_collection_id: "phone", value: "123", ... }
                        let displayVal: string | null = null;
                        if (val && typeof val === 'object') {
                          displayVal = val.value != null ? String(val.value) : null;
                        } else {
                          displayVal = val != null ? String(val) : null;
                        }
                        // Use data_collection_id as label if available, otherwise key
                        const label = (val && typeof val === 'object' && val.data_collection_id) || key;
                        return { label, value: displayVal };
                      })
                      .filter(e => e.value && e.value !== 'null' && e.value !== '');

                    if (entries.length === 0) return null;

                    return (
                      <div>
                        <h4 className="text-sm font-semibold text-gray-700 mb-2">Dados Coletados</h4>
                        <div className="bg-gray-50 rounded-lg p-3 space-y-1">
                          {entries.map((e) => (
                            <div key={e.label} className="flex items-center gap-2 text-sm">
                              <span className="text-gray-500 font-medium">{e.label}:</span>
                              <span className="text-gray-900">{e.value}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()}

                  {/* Audio */}
                  {selectedCall.audio_url && (
                    <div>
                      <h4 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
                        <Play className="w-4 h-4" /> Audio
                      </h4>
                      <audio controls className="w-full" src={selectedCall.audio_url}>
                        Seu navegador nao suporta audio.
                      </audio>
                      <p className="text-xs text-gray-400 mt-1">Link expira em 30 dias</p>
                    </div>
                  )}

                  {/* Transcript */}
                  {selectedCall.transcript && selectedCall.transcript.length > 0 && (
                    <div>
                      <h4 className="text-sm font-semibold text-gray-700 mb-2">Transcricao</h4>
                      <div className="bg-gray-50 rounded-lg p-4 space-y-3 max-h-80 overflow-y-auto">
                        {selectedCall.transcript.map((entry, i) => (
                          <div key={i} className={`flex ${entry.role === 'agent' ? 'justify-start' : 'justify-end'}`}>
                            <div className={`max-w-[80%] px-3 py-2 rounded-xl text-sm ${
                              entry.role === 'agent'
                                ? 'bg-white border border-gray-200 text-gray-800'
                                : 'bg-blue-600 text-white'
                            }`}>
                              <p className="text-xs opacity-60 mb-0.5 font-medium">
                                {entry.role === 'agent' ? 'Agente' : 'Cliente'}
                                {entry.time_in_call_secs !== undefined && ` - ${formatDuration(entry.time_in_call_secs)}`}
                              </p>
                              <p>{entry.message}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
