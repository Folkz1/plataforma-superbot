'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import {
  CheckCircle, XCircle, AlertCircle, Settings, Loader2, RefreshCw, Wand2
} from 'lucide-react';
import { getPlatformLogo } from '@/components/PlatformLogos';

interface SourceStatus {
  platform: string;
  channel_identifier: string;
  connected: boolean;
  registered: boolean;
  has_access_token: boolean;
  last_message_at: string | null;
  action: 'create' | 'update' | 'keep';
}

interface UserSessionData {
  role: string;
  client_id?: string;
  client_name?: string;
}

interface ConfigChannel {
  channel_type?: string;
  channel_identifier?: string;
  has_access_token?: boolean;
}

interface DiscoveredSource {
  channel_type?: string;
  channel_identifier?: string;
  last_event_at?: string | null;
  action?: 'create' | 'update' | 'keep';
}

const AUTO_REGISTER_DAYS = 90;

function toSourceKey(platform: string, identifier: string): string {
  return `${platform}:${identifier}`;
}

export default function ConnectionStatusPage() {
  const router = useRouter();
  const [user, setUser] = useState<UserSessionData | null>(null);
  const [tenantId, setTenantId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [connections, setConnections] = useState<SourceStatus[]>([]);
  const [tenantName, setTenantName] = useState<string>('');
  const [syncMessage, setSyncMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [webhookUrl, setWebhookUrl] = useState<string>('');
  const [verifyToken, setVerifyToken] = useState<string>('');

  const loadConnectionStatus = useCallback(async (clientId: string) => {
    setLoading(true);
    setSyncMessage(null);

    try {
      const [metaRes, discoveryRes] = await Promise.all([
        api.get(`/api/config/meta/${clientId}`),
        api.post(`/api/config/channels/${clientId}/auto-register`, {
          dry_run: true,
          days: AUTO_REGISTER_DAYS,
        }),
      ]);

      const channels: ConfigChannel[] = Array.isArray(metaRes.data?.channels) ? metaRes.data.channels : [];
      const discovered: DiscoveredSource[] = Array.isArray(discoveryRes.data?.sources) ? discoveryRes.data.sources : [];

      // Extract webhook info from API response
      const webhookPath = metaRes.data?.webhook_path || metaRes.data?.project?.webhook_path || '';
      const vToken = metaRes.data?.verify_token || metaRes.data?.project?.verify_token || '';
      if (webhookPath) setWebhookUrl(webhookPath);
      if (vToken) setVerifyToken(vToken);

      const registeredByKey = new Map<string, ConfigChannel>();
      for (const channel of channels) {
        const channelType = String(channel.channel_type || '').trim();
        const channelIdentifier = String(channel.channel_identifier || '').trim();
        if (!channelType || !channelIdentifier) continue;
        const key = toSourceKey(channelType, channelIdentifier);
        registeredByKey.set(key, channel);
      }

      const discoveredByKey = new Map<string, DiscoveredSource>();
      for (const source of discovered) {
        const channelType = String(source.channel_type || '').trim();
        const channelIdentifier = String(source.channel_identifier || '').trim();
        if (!channelType || !channelIdentifier) continue;
        const key = toSourceKey(channelType, channelIdentifier);
        discoveredByKey.set(key, source);
      }

      const allKeys = new Set<string>([
        ...registeredByKey.keys(),
        ...discoveredByKey.keys(),
      ]);

      const merged: SourceStatus[] = Array.from(allKeys).map((key) => {
        const registered = registeredByKey.get(key);
        const source = discoveredByKey.get(key);

        const platform = String(registered?.channel_type || source?.channel_type || 'unknown');
        const channel_identifier = String(registered?.channel_identifier || source?.channel_identifier || '-');
        const last_message_at = source?.last_event_at || null;
        const action = (source?.action || 'keep') as 'create' | 'update' | 'keep';

        return {
          platform,
          channel_identifier,
          connected: Boolean(last_message_at),
          registered: Boolean(registered),
          has_access_token: Boolean(registered?.has_access_token),
          last_message_at,
          action,
        };
      });

      merged.sort((a, b) => {
        if (a.connected !== b.connected) return a.connected ? -1 : 1;
        const aTs = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
        const bTs = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
        return bTs - aTs;
      });

      setConnections(merged);
    } catch (error) {
      console.error('Erro ao carregar status:', error);
      setSyncMessage({ type: 'error', text: 'Nao foi possivel carregar as fontes e conexoes.' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const userData = localStorage.getItem('user');
    if (!userData) {
      router.push('/login');
      return;
    }

    const parsedUser = JSON.parse(userData) as UserSessionData;
    setUser(parsedUser);

    const currentTenantId = parsedUser.role === 'admin'
      ? localStorage.getItem('active_tenant_id')
      : parsedUser.client_id;

    const name = parsedUser.role === 'admin'
      ? (localStorage.getItem('active_tenant_name') || '')
      : (parsedUser.client_name || '');
    setTenantName(name);

    if (!currentTenantId) {
      router.push(parsedUser.role === 'admin' ? '/admin' : '/login');
      return;
    }

    setTenantId(currentTenantId);
    loadConnectionStatus(currentTenantId);
  }, [router, loadConnectionStatus]);

  const handleAutoRegister = async () => {
    if (!tenantId) return;

    setSyncing(true);
    setSyncMessage(null);

    try {
      const response = await api.post(`/api/config/channels/${tenantId}/auto-register`, {
        dry_run: false,
        days: AUTO_REGISTER_DAYS,
      });

      const summary = response.data?.summary || {};
      setSyncMessage({
        type: 'success',
        text: `Auto-cadastro concluido: ${summary.created || 0} novas, ${summary.updated || 0} atualizadas, ${summary.unchanged || 0} sem alteracao.`,
      });

      await loadConnectionStatus(tenantId);
    } catch (error: unknown) {
      const err = error as { response?: { data?: { detail?: string } }; message?: string };
      setSyncMessage({
        type: 'error',
        text: err.response?.data?.detail || err.message || 'Falha ao auto-cadastrar fontes.',
      });
    } finally {
      setSyncing(false);
    }
  };

  const getPlatformBgClass = (platform: string) => {
    switch (platform) {
      case 'whatsapp': return 'bg-green-50';
      case 'instagram': return 'bg-pink-50';
      case 'messenger': return 'bg-blue-50';
      case 'phone': return 'bg-purple-50';
      default: return 'bg-gray-100';
    }
  };

  const getPlatformName = (platform: string) => {
    switch (platform) {
      case 'whatsapp': return 'WhatsApp';
      case 'instagram': return 'Instagram';
      case 'messenger': return 'Messenger';
      case 'phone': return 'Telefone';
      default: return platform;
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                Status de Conexao e Fontes
              </h1>
              <p className="text-sm text-gray-600">
                {tenantName || user?.client_name || 'Verificar conexoes e fontes detectadas'}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => tenantId && loadConnectionStatus(tenantId)}
                className="flex items-center gap-2 px-3 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition text-sm"
              >
                <RefreshCw className="w-4 h-4" />
                Atualizar
              </button>

              <button
                onClick={handleAutoRegister}
                disabled={syncing || !tenantId}
                className="flex items-center gap-2 px-3 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition text-sm disabled:opacity-50"
              >
                {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                Auto-cadastrar fontes
              </button>

              <button
                onClick={() => router.push('/dash/config/meta')}
                className="flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm"
              >
                <Settings className="w-4 h-4" />
                Configurar
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {syncMessage && (
          <div className={`mb-6 p-3 rounded-lg border text-sm ${
            syncMessage.type === 'success'
              ? 'bg-green-50 border-green-200 text-green-800'
              : 'bg-red-50 border-red-200 text-red-800'
          }`}>
            {syncMessage.text}
          </div>
        )}

        {/* Source Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 mb-8">
          {connections.map((conn) => (
            <div key={toSourceKey(conn.platform, conn.channel_identifier)} className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center justify-between mb-4">
                <div className={`p-2 rounded-lg ${getPlatformBgClass(conn.platform)}`}>
                  {getPlatformLogo(conn.platform, 36)}
                </div>
                {conn.connected ? (
                  <CheckCircle className="w-6 h-6 text-green-600" />
                ) : conn.registered ? (
                  <AlertCircle className="w-6 h-6 text-amber-500" />
                ) : (
                  <XCircle className="w-6 h-6 text-gray-400" />
                )}
              </div>

              <h3 className="text-lg font-semibold text-gray-900 mb-1">
                {getPlatformName(conn.platform)}
              </h3>
              <p className="text-xs text-gray-500 break-all mb-3">
                {conn.channel_identifier}
              </p>

              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${conn.connected ? 'bg-green-500' : 'bg-gray-400'}`} />
                  <span className="text-sm text-gray-600">
                    {conn.connected ? 'Com atividade recente' : 'Sem atividade recente'}
                  </span>
                </div>

                <div className="flex flex-wrap gap-2">
                  <span className={`text-xs px-2 py-1 rounded-full ${
                    conn.registered
                      ? 'bg-blue-50 text-blue-700 border border-blue-200'
                      : 'bg-amber-50 text-amber-700 border border-amber-200'
                  }`}>
                    {conn.registered ? 'Fonte cadastrada' : 'Fonte detectada (nao cadastrada)'}
                  </span>

                  {!conn.has_access_token && conn.registered && conn.platform !== 'phone' && (
                    <span className="text-xs px-2 py-1 rounded-full bg-red-50 text-red-700 border border-red-200">
                      Sem token de acesso
                    </span>
                  )}

                  {conn.action === 'update' && (
                    <span className="text-xs px-2 py-1 rounded-full bg-purple-50 text-purple-700 border border-purple-200">
                      Tipo atualizado na descoberta
                    </span>
                  )}
                </div>

                {conn.last_message_at && (
                  <p className="text-xs text-gray-500">
                    Ultima mensagem: {new Date(conn.last_message_at).toLocaleString('pt-BR')}
                  </p>
                )}
              </div>
            </div>
          ))}

          {connections.length === 0 && (
            <div className="md:col-span-2 xl:col-span-3 bg-white rounded-lg shadow p-8 text-center">
              <AlertCircle className="w-10 h-10 text-gray-300 mx-auto mb-2" />
              <p className="text-gray-600">Nenhuma fonte encontrada para este tenant.</p>
            </div>
          )}
        </div>

        {/* Webhook Info */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Informacoes do Webhook
          </h2>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium text-gray-700">URL</label>
              <code className="block mt-1 p-3 bg-gray-50 rounded text-sm text-gray-900">
                {webhookUrl || 'Nao configurado — defina webhook_path no projeto'}
              </code>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Verify Token</label>
              <code className="block mt-1 p-3 bg-gray-50 rounded text-sm text-gray-900">
                {verifyToken || 'Nao configurado — defina verify_token no projeto'}
              </code>
            </div>
            <p className="text-xs text-gray-400">
              Esses valores vem da configuracao do projeto. Edite em Config &gt; Meta para atualizar.
            </p>
          </div>
        </div>

        {/* Troubleshooting */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-semibold text-blue-900 mb-2">
                Automacao de cadastro de fontes
              </h3>
              <ul className="text-sm text-blue-800 space-y-1">
                <li>- O botao de auto-cadastro detecta fontes novas por eventos recentes.</li>
                <li>- Fontes sem token continuam visiveis para completar na configuracao Meta.</li>
                <li>- Execute novamente sempre que conectar novas paginas, WABA ou contas IG.</li>
                <li>- A descoberta usa os ultimos {AUTO_REGISTER_DAYS} dias de atividade.</li>
              </ul>
              <button
                onClick={() => router.push('/dash/config/meta')}
                className="mt-3 text-sm text-blue-700 hover:text-blue-800 font-medium"
              >
                Ver guia de configuracao
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
