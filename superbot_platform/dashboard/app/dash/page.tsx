'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useTranslation } from '@/lib/i18n';
import {
  MessageCircle, TrendingUp, Clock, CheckCircle, Loader2
} from 'lucide-react';
import { TimelineChart } from '@/components/charts/TimelineChart';
import { ChannelPieChart } from '@/components/charts/ChannelPieChart';
import { StatusBarChart } from '@/components/charts/StatusBarChart';
import { HourlyBarChart } from '@/components/charts/HourlyBarChart';

export default function DashboardPage() {
  const { t } = useTranslation();
  const [tenantName, setTenantName] = useState('');
  const [loading, setLoading] = useState(true);

  const [overview, setOverview] = useState<any>(null);
  const [timeline, setTimeline] = useState<any[]>([]);
  const [channels, setChannels] = useState<any[]>([]);
  const [statuses, setStatuses] = useState<any[]>([]);
  const [hourly, setHourly] = useState<any[]>([]);

  useEffect(() => {
    const userData = localStorage.getItem('user');
    if (!userData) return;
    const user = JSON.parse(userData);
    const tenantId = user.role === 'admin'
      ? localStorage.getItem('active_tenant_id')
      : user.client_id;
    setTenantName(
      user.role === 'admin'
        ? (localStorage.getItem('active_tenant_name') || '')
        : (user.client_name || '')
    );
    if (tenantId) loadAnalytics(tenantId);
  }, []);

  const loadAnalytics = async (clientId: string) => {
    try {
      const [overviewRes, timelineRes, channelsRes, statusesRes, hourlyRes] = await Promise.all([
        api.get(`/api/analytics/overview/${clientId}`),
        api.get(`/api/analytics/timeline/${clientId}?days=30`),
        api.get(`/api/analytics/channels/${clientId}`),
        api.get(`/api/analytics/status/${clientId}`),
        api.get(`/api/analytics/hourly/${clientId}?days=7`)
      ]);
      setOverview(overviewRes.data);
      setTimeline(timelineRes.data.timeline);
      setChannels(channelsRes.data.channels);
      setStatuses(statusesRes.data.statuses);
      setHourly(hourlyRes.data.hourly);
    } catch (error) {
      console.error('Erro ao carregar analytics:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (!overview) {
    return (
      <div className="flex items-center justify-center h-96">
        <p className="text-gray-600">{t.common_error}</p>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">{t.dash_title}</h1>
        <p className="text-sm text-gray-500 mt-1">{tenantName} - Visao geral</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-medium text-gray-500">{t.dash_total_conversations}</p>
            <div className="p-2 bg-blue-50 rounded-lg"><MessageCircle className="w-4 h-4 text-blue-600" /></div>
          </div>
          <p className="text-3xl font-bold text-gray-900">{overview.total_conversations}</p>
          <p className="text-xs text-gray-400 mt-1">{overview.period_conversations} nos ultimos {overview.period_days} dias</p>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-medium text-gray-500">Taxa de Resolucao</p>
            <div className="p-2 bg-green-50 rounded-lg"><CheckCircle className="w-4 h-4 text-green-600" /></div>
          </div>
          <p className="text-3xl font-bold text-gray-900">{overview.resolution_rate}%</p>
          <p className="text-xs text-green-600 mt-1">Excelente performance</p>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-medium text-gray-500">Tempo Medio</p>
            <div className="p-2 bg-amber-50 rounded-lg"><Clock className="w-4 h-4 text-amber-600" /></div>
          </div>
          <p className="text-3xl font-bold text-gray-900">{overview.avg_response_time}</p>
          <p className="text-xs text-gray-400 mt-1">Por conversa resolvida</p>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-medium text-gray-500">{t.dash_active_conversations}</p>
            <div className="p-2 bg-purple-50 rounded-lg"><TrendingUp className="w-4 h-4 text-purple-600" /></div>
          </div>
          <p className="text-3xl font-bold text-gray-900">{overview.active_conversations}</p>
          <p className="text-xs text-gray-400 mt-1">Em andamento agora</p>
        </div>
      </div>

      {/* Timeline */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-8">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Tendencia (Ultimos 30 dias)</h2>
        <TimelineChart data={timeline} />
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Distribuicao por Canal</h2>
          {channels.length > 0 ? <ChannelPieChart data={channels} /> : <p className="text-gray-400 text-center py-12">Sem dados</p>}
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Status das Conversas</h2>
          {statuses.length > 0 ? <StatusBarChart data={statuses} /> : <p className="text-gray-400 text-center py-12">Sem dados</p>}
        </div>
      </div>

      {/* Hourly */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Horarios de Pico (Ultimos 7 dias)</h2>
        <HourlyBarChart data={hourly} />
      </div>
    </div>
  );
}
