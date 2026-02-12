'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { 
  Phone, Instagram, MessageCircle, CheckCircle, 
  XCircle, AlertCircle, Settings, Loader2 
} from 'lucide-react';

interface ConnectionStatus {
  platform: 'whatsapp' | 'messenger' | 'instagram';
  connected: boolean;
  last_message_at: string | null;
  error: string | null;
}

export default function ConnectionStatusPage() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [connections, setConnections] = useState<ConnectionStatus[]>([]);
  const [tenantName, setTenantName] = useState<string>('');

  useEffect(() => {
    const userData = localStorage.getItem('user');
    if (!userData) {
      router.push('/login');
      return;
    }

    const parsedUser = JSON.parse(userData);
    setUser(parsedUser);

    const tenantId = parsedUser.role === 'admin'
      ? localStorage.getItem('active_tenant_id')
      : parsedUser.client_id;

    const name = parsedUser.role === 'admin'
      ? (localStorage.getItem('active_tenant_name') || '')
      : (parsedUser.client_name || '');
    setTenantName(name);

    if (!tenantId) {
      router.push(parsedUser.role === 'admin' ? '/admin' : '/login');
      return;
    }

    loadConnectionStatus(tenantId);
  }, [router]);

  const loadConnectionStatus = async (clientId: string) => {
    try {
      // Check last messages per channel
      const response = await api.get(`/api/conversations?project_id=${encodeURIComponent(clientId)}&limit=10`);
      const conversations = Array.isArray(response.data)
        ? response.data
        : (response.data?.conversations || []);

      // Group by channel
      const channels = ['whatsapp', 'messenger', 'instagram'];
      const status: ConnectionStatus[] = channels.map(channel => {
        const channelConvs = conversations.filter((c: any) => c.channel_type === channel);
        const lastConv = channelConvs[0];

        return {
          platform: channel as any,
          connected: channelConvs.length > 0,
          last_message_at: lastConv?.last_event_at || null,
          error: null
        };
      });

      setConnections(status);
    } catch (error) {
      console.error('Erro ao carregar status:', error);
    } finally {
      setLoading(false);
    }
  };

  const getIcon = (platform: string) => {
    switch (platform) {
      case 'whatsapp': return <Phone className="w-6 h-6" />;
      case 'instagram': return <Instagram className="w-6 h-6" />;
      case 'messenger': return <MessageCircle className="w-6 h-6" />;
    }
  };

  const getPlatformColor = (platform: string) => {
    switch (platform) {
      case 'whatsapp': return 'green';
      case 'instagram': return 'pink';
      case 'messenger': return 'blue';
      default: return 'gray';
    }
  };

  const getPlatformBgClass = (platform: string) => {
    switch (platform) {
      case 'whatsapp': return 'bg-green-100';
      case 'instagram': return 'bg-pink-100';
      case 'messenger': return 'bg-blue-100';
      default: return 'bg-gray-100';
    }
  };

  const getPlatformName = (platform: string) => {
    switch (platform) {
      case 'whatsapp': return 'WhatsApp';
      case 'instagram': return 'Instagram';
      case 'messenger': return 'Messenger';
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
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                Status de Conexão
              </h1>
              <p className="text-sm text-gray-600">
                {tenantName || user?.client_name || 'Verificar conexões Meta'}
              </p>
            </div>
            <button
              onClick={() => router.push('/dash/config/meta')}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
            >
              <Settings className="w-4 h-4" />
              Configurar
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Connection Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          {connections.map((conn) => {
            const isConnected = conn.connected;

            return (
              <div key={conn.platform} className="bg-white rounded-lg shadow p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className={`p-3 rounded-lg ${getPlatformBgClass(conn.platform)}`}>
                    {getIcon(conn.platform)}
                  </div>
                  {isConnected ? (
                    <CheckCircle className="w-6 h-6 text-green-600" />
                  ) : (
                    <XCircle className="w-6 h-6 text-gray-400" />
                  )}
                </div>

                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  {getPlatformName(conn.platform)}
                </h3>

                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${
                      isConnected ? 'bg-green-500' : 'bg-gray-400'
                    }`} />
                    <span className="text-sm text-gray-600">
                      {isConnected ? 'Conectado' : 'Não conectado'}
                    </span>
                  </div>

                  {conn.last_message_at && (
                    <p className="text-xs text-gray-500">
                      Última mensagem: {new Date(conn.last_message_at).toLocaleString('pt-BR')}
                    </p>
                  )}

                  {conn.error && (
                    <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-800">
                      {conn.error}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Webhook Info */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Informações do Webhook
          </h2>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium text-gray-700">URL</label>
              <code className="block mt-1 p-3 bg-gray-50 rounded text-sm text-gray-900">
                https://ai.superbot.digital/webhook/meta
              </code>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Verify Token</label>
              <code className="block mt-1 p-3 bg-gray-50 rounded text-sm text-gray-900">
                pacific-token
              </code>
            </div>
          </div>
        </div>

        {/* Troubleshooting */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-semibold text-blue-900 mb-2">
                Problemas de Conexão?
              </h3>
              <ul className="text-sm text-blue-800 space-y-1">
                <li>• Verifique se o webhook está configurado corretamente</li>
                <li>• Confirme que as assinaturas estão ativas (messages, messaging_postbacks)</li>
                <li>• Para WhatsApp: execute o script de inscrição de WABAs</li>
                <li>• Teste enviando uma mensagem para cada canal</li>
              </ul>
              <button
                onClick={() => router.push('/dash/config/meta')}
                className="mt-3 text-sm text-blue-700 hover:text-blue-800 font-medium"
              >
                Ver guia de configuração →
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
