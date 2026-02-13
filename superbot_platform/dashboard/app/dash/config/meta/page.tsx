'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { 
  CheckCircle, Circle, Phone, Instagram, MessageCircle,
  Copy, ExternalLink, AlertCircle, Check
} from 'lucide-react';

type Step = {
  id: number;
  title: string;
  description: string;
  instructions: string[];
  notes?: string[];
  warnings?: string[];
};

const WEBHOOK_URL = 'https://ai.superbot.digital/webhook/meta';
const VERIFY_TOKEN = 'pacific-token';

const whatsappSteps: Step[] = [
  {
    id: 1,
    title: 'Adicionar WhatsApp do Cliente',
    description: 'Solicitar acesso à conta WhatsApp Business do cliente',
    instructions: [
      'Acesse business.facebook.com',
      'Entre no portfolio "Super Bot"',
      'Vá em Contas > Contas do WhatsApp',
      'Clique "+ Adicionar"',
      'Escolha "Solicitar acesso a uma conta do WhatsApp"',
      'Cole o ID da WABA do cliente',
      'Aguarde aprovação do cliente'
    ],
    notes: ['WhatsApp é adicionado separadamente das outras redes']
  },
  {
    id: 2,
    title: 'Atribuir ao System User',
    description: 'Dar acesso ao SuperBot Master',
    instructions: [
      'Vá em Usuários > Usuários do sistema',
      'Clique em "SuperBot Master"',
      'Clique em "Adicionar Ativos"',
      'Adicione a Conta do WhatsApp do cliente',
      'Marque "Controle Total"',
      'Salvar'
    ],
    notes: ['O token existente JÁ funciona para os novos ativos!']
  },
  {
    id: 3,
    title: 'Configurar Webhook',
    description: 'Conectar o webhook ao WhatsApp',
    instructions: [
      'Acesse developers.facebook.com',
      'Abra o App "SuperBot App"',
      'Menu lateral: WhatsApp > Configuração',
      'Vá em "Configuração do Webhook"',
      `URL: ${WEBHOOK_URL}`,
      `Verify Token: ${VERIFY_TOKEN}`,
      'Clique em "Gerenciar"',
      'Selecione o novo número do cliente',
      'Marque: messages',
      'Salvar'
    ]
  },
  {
    id: 4,
    title: 'Inscrever WABA no Webhook',
    description: 'Executar script Python para ativar webhook',
    instructions: [
      'Abra superbot_configuracoes/inscrever_wabas_webhook.py',
      'Adicione o novo cliente na lista WABAS',
      'Execute: python superbot_configuracoes/inscrever_wabas_webhook.py',
      'Verifique se aparece ✅ para o novo cliente'
    ],
    warnings: ['OBRIGATÓRIO para WhatsApp funcionar!'],
    notes: ['Isso só precisa ser feito UMA VEZ por WABA']
  },
  {
    id: 5,
    title: 'Testar Conexão',
    description: 'Enviar mensagem de teste',
    instructions: [
      'Envie uma mensagem para o número do cliente',
      'Verifique se chega no webhook',
      'Confirme que o bot responde'
    ]
  }
];

const messengerSteps: Step[] = [
  {
    id: 1,
    title: 'Adicionar Cliente como Parceiro',
    description: 'Solicitar acesso à Página do Facebook',
    instructions: [
      'Acesse business.facebook.com',
      'Entre no portfolio "Super Bot"',
      'Vá em Configurações > Parceiros',
      'Clique "+ Adicionar"',
      'Escolha "Solicitar acesso aos ativos de um parceiro"',
      'Cole o email do admin do cliente OU ID da BM',
      'Selecione: ✅ Página do Facebook',
      'Clique Avançar > Enviar solicitação',
      'Aguarde aprovação do cliente'
    ]
  },
  {
    id: 2,
    title: 'Atribuir ao System User',
    description: 'Dar acesso ao SuperBot Master',
    instructions: [
      'Vá em Usuários > Usuários do sistema',
      'Clique em "SuperBot Master"',
      'Clique em "Adicionar Ativos"',
      'Adicione a Página do Facebook do cliente',
      'Marque "Controle Total"',
      'Salvar'
    ]
  },
  {
    id: 3,
    title: 'Configurar Webhook',
    description: 'Conectar o webhook ao Messenger',
    instructions: [
      'Acesse developers.facebook.com',
      'Abra o App "SuperBot App"',
      'Menu lateral: Messenger > Configurações da API',
      'Role até "Gere tokens de acesso"',
      'Clique em "Adicionar Página"',
      'Selecione a nova página do cliente',
      'Clique em "Adicionar assinaturas"',
      'Marque: ✅ messages, ✅ messaging_postbacks',
      'Confirmar'
    ]
  },
  {
    id: 4,
    title: 'Testar Conexão',
    description: 'Enviar mensagem de teste',
    instructions: [
      'Envie uma mensagem para a Página do cliente',
      'Verifique se chega no webhook',
      'Confirme que o bot responde'
    ]
  }
];

const instagramSteps: Step[] = [
  {
    id: 1,
    title: 'Adicionar Cliente como Parceiro',
    description: 'Solicitar acesso à conta Instagram',
    instructions: [
      'Acesse business.facebook.com',
      'Entre no portfolio "Super Bot"',
      'Vá em Configurações > Parceiros',
      'Clique "+ Adicionar"',
      'Escolha "Solicitar acesso aos ativos de um parceiro"',
      'Cole o email do admin do cliente OU ID da BM',
      'Selecione: ✅ Conta do Instagram',
      'Clique Avançar > Enviar solicitação',
      'Aguarde aprovação do cliente'
    ],
    notes: ['Instagram deve estar conectado a uma Página do Facebook']
  },
  {
    id: 2,
    title: 'Atribuir ao System User',
    description: 'Dar acesso ao SuperBot Master',
    instructions: [
      'Vá em Usuários > Usuários do sistema',
      'Clique em "SuperBot Master"',
      'Clique em "Adicionar Ativos"',
      'Adicione a Conta do Instagram do cliente',
      'Marque "Controle Total"',
      'Salvar'
    ]
  },
  {
    id: 3,
    title: 'Configurar Webhook',
    description: 'Conectar o webhook ao Instagram',
    instructions: [
      'Acesse developers.facebook.com',
      'Abra o App "SuperBot App"',
      'Menu lateral: Instagram > Configuração da API',
      'Na seção "Gere tokens de acesso"',
      'Clique em "Adicionar conta"',
      'Faça login com o Instagram do cliente',
      'Ative o toggle "Assinatura do webhook" ✅',
      'Salvar'
    ],
    warnings: ['Sem isso, o webhook não recebe nada do Instagram!']
  },
  {
    id: 4,
    title: 'Testar Conexão',
    description: 'Enviar mensagem de teste',
    instructions: [
      'Envie uma DM para a conta do cliente',
      'Verifique se chega no webhook',
      'Confirme que o bot responde'
    ]
  }
];

export default function MetaConfigWizardPage() {
  const router = useRouter();
  const [platform, setPlatform] = useState<'whatsapp' | 'messenger' | 'instagram'>('whatsapp');
  const [currentStep, setCurrentStep] = useState(1);
  const [completedSteps, setCompletedSteps] = useState<number[]>([]);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedToken, setCopiedToken] = useState(false);

  // Tenant context + current config (multitenant tables)
  const [user, setUser] = useState<any>(null);
  const [tenantId, setTenantId] = useState<string>('');
  const [tenantName, setTenantName] = useState<string>('');
  const [projectSlug, setProjectSlug] = useState<string>('');
  const [resolvedProjectId, setResolvedProjectId] = useState<string>('');

  const [configLoading, setConfigLoading] = useState<boolean>(true);
  const [configError, setConfigError] = useState<string>('');

  const [notificationPhone, setNotificationPhone] = useState<string>('');
  const [whatsappPhoneNumberId, setWhatsappPhoneNumberId] = useState<string>('');
  const [whatsappHasToken, setWhatsappHasToken] = useState<boolean>(false);
  const [whatsappAccessToken, setWhatsappAccessToken] = useState<string>('');
  const [channelsConfig, setChannelsConfig] = useState<any[]>([]);
  const [newChannelType, setNewChannelType] = useState<string>('messenger');
  const [newChannelIdentifier, setNewChannelIdentifier] = useState<string>('');
  const [newChannelAccessToken, setNewChannelAccessToken] = useState<string>('');
  const [channelSaving, setChannelSaving] = useState<boolean>(false);
  const [channelMessage, setChannelMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [showAdvanced, setShowAdvanced] = useState<boolean>(false);
  const [followupEnabled, setFollowupEnabled] = useState<boolean>(false);
  const [followupConfigText, setFollowupConfigText] = useState<string>('');
  const [feedbackEnabled, setFeedbackEnabled] = useState<boolean>(true);
  const [feedbackConfigText, setFeedbackConfigText] = useState<string>('');

  const [saving, setSaving] = useState<boolean>(false);
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const steps = platform === 'whatsapp' ? whatsappSteps :
                platform === 'messenger' ? messengerSteps :
                instagramSteps;

  const currentStepData = steps.find(s => s.id === currentStep);

  const loadCurrentConfig = async (id: string) => {
    setConfigLoading(true);
    setConfigError('');
    try {
      const res = await api.get(`/api/config/meta/${id}`);
      const project = res.data?.project || {};
      setProjectSlug(String(project.project_slug || ''));
      setResolvedProjectId(String(res.data?.resolved_project_id || project.id || ''));

      const secrets = res.data?.secrets || {};
      setNotificationPhone(String(secrets.notification_phone || ''));

      setFollowupEnabled(Boolean(secrets.followup_enabled));
      setFeedbackEnabled(secrets.feedback_enabled !== false);

      try { setFollowupConfigText(JSON.stringify(secrets.followup_config || {}, null, 2)); } catch (_) { setFollowupConfigText(''); }
      try { setFeedbackConfigText(JSON.stringify(secrets.feedback_config || {}, null, 2)); } catch (_) { setFeedbackConfigText(''); }

      const channels = Array.isArray(res.data?.channels) ? res.data.channels : [];
      setChannelsConfig(channels);
      const wa = channels.find((c: any) => c.channel_type === 'whatsapp');
      setWhatsappPhoneNumberId(String(wa?.channel_identifier || ''));
      setWhatsappHasToken(Boolean(wa?.has_access_token));
    } catch (e: any) {
      setConfigError(e?.response?.data?.detail || e?.message || 'Erro ao carregar configuração');
    } finally {
      setConfigLoading(false);
    }
  };

  const handleSaveConfig = async () => {
    if (!tenantId) return;
    setSaving(true);
    setSaveMessage(null);

    try {
      let parsedFollowup: any | undefined;
      if (followupConfigText.trim()) {
        try { parsedFollowup = JSON.parse(followupConfigText); } catch (_) { throw new Error('followup_config: JSON inválido'); }
      }

      let parsedFeedback: any | undefined;
      if (feedbackConfigText.trim()) {
        try { parsedFeedback = JSON.parse(feedbackConfigText); } catch (_) { throw new Error('feedback_config: JSON inválido'); }
      }

      const patchPayload: any = {
        notification_phone: notificationPhone,
        followup_enabled: followupEnabled,
        feedback_enabled: feedbackEnabled,
      };
      if (parsedFollowup !== undefined) patchPayload.followup_config = parsedFollowup;
      if (parsedFeedback !== undefined) patchPayload.feedback_config = parsedFeedback;

      await api.patch(`/api/config/meta/${tenantId}`, patchPayload);

      const waId = whatsappPhoneNumberId.trim();
      const waToken = whatsappAccessToken.trim();

      if (waId) {
        const payload: any = {
          channel_type: 'whatsapp',
          channel_identifier: waId,
        };
        if (waToken) payload.access_token = waToken;
        await api.post(`/api/config/channels/${tenantId}`, payload);
      }

      setSaveMessage({ type: 'success', text: 'Configuração atualizada!' });
      setWhatsappAccessToken('');
      await loadCurrentConfig(tenantId);
    } catch (e: any) {
      setSaveMessage({ type: 'error', text: e?.response?.data?.detail || e?.message || 'Erro ao salvar configuração' });
    } finally {
      setSaving(false);
    }
  };

  const handleUpsertChannel = async () => {
    if (!tenantId) return;

    const type = newChannelType.trim().toLowerCase();
    const identifier = newChannelIdentifier.trim();
    const token = newChannelAccessToken.trim();

    if (!type || !identifier) {
      setChannelMessage({ type: 'error', text: 'Preencha channel_type e channel_identifier' });
      return;
    }

    setChannelSaving(true);
    setChannelMessage(null);
    try {
      const payload: any = { channel_type: type, channel_identifier: identifier };
      if (token) payload.access_token = token;
      await api.post(`/api/config/channels/${tenantId}`, payload);
      setChannelMessage({ type: 'success', text: 'Canal salvo!' });
      setNewChannelIdentifier('');
      setNewChannelAccessToken('');
      await loadCurrentConfig(tenantId);
    } catch (e: any) {
      setChannelMessage({ type: 'error', text: e?.response?.data?.detail || e?.message || 'Erro ao salvar canal' });
    } finally {
      setChannelSaving(false);
    }
  };

  const handleDeleteChannel = async (channelIdentifier: string) => {
    if (!tenantId) return;
    const cid = String(channelIdentifier || '').trim();
    if (!cid) return;
    if (!confirm(`Remover canal ${cid}?`)) return;

    setChannelSaving(true);
    setChannelMessage(null);
    try {
      await api.delete(`/api/config/channels/${tenantId}/${encodeURIComponent(cid)}`);
      setChannelMessage({ type: 'success', text: 'Canal removido.' });
      await loadCurrentConfig(tenantId);
    } catch (e: any) {
      setChannelMessage({ type: 'error', text: e?.response?.data?.detail || e?.message || 'Erro ao remover canal' });
    } finally {
      setChannelSaving(false);
    }
  };

  useEffect(() => {
    const userData = localStorage.getItem('user');
    if (!userData) {
      router.push('/login');
      return;
    }

    const parsedUser = JSON.parse(userData);
    setUser(parsedUser);

    const tId = parsedUser.role === 'admin'
      ? localStorage.getItem('active_tenant_id')
      : parsedUser.client_id;

    const name = parsedUser.role === 'admin'
      ? (localStorage.getItem('active_tenant_name') || '')
      : (parsedUser.client_name || '');
    setTenantName(name);

    if (!tId) {
      router.push(parsedUser.role === 'admin' ? '/admin' : '/login');
      return;
    }

    setTenantId(tId);
    loadCurrentConfig(tId);
  }, [router]);

  const handleCopy = async (text: string, type: 'url' | 'token') => {
    await navigator.clipboard.writeText(text);
    if (type === 'url') {
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2000);
    } else {
      setCopiedToken(true);
      setTimeout(() => setCopiedToken(false), 2000);
    }
  };

  const toggleStepComplete = (stepId: number) => {
    if (completedSteps.includes(stepId)) {
      setCompletedSteps(completedSteps.filter(id => id !== stepId));
    } else {
      setCompletedSteps([...completedSteps, stepId]);
    }
  };

  const getIcon = (platformName: string) => {
    switch (platformName) {
      case 'whatsapp': return <Phone className="w-5 h-5" />;
      case 'instagram': return <Instagram className="w-5 h-5" />;
      case 'messenger': return <MessageCircle className="w-5 h-5" />;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                Configuração Meta
              </h1>
              <p className="text-sm text-gray-600">
                Wizard de conexão WhatsApp, Messenger e Instagram
              </p>
            </div>
            <button
              onClick={() => router.back()}
              className="text-sm text-gray-600 hover:text-gray-900"
            >
              Voltar
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Current Multitenant Config */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">
                Configuração Atual
              </h2>
              <p className="text-sm text-gray-600">
                {tenantName ? `${tenantName} · ` : ''}
                {projectSlug ? `Projeto: ${projectSlug}` : 'Projeto'}
              </p>
              {resolvedProjectId && (
                <p className="text-xs text-gray-500 mt-1">
                  project_id: {resolvedProjectId}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => tenantId && loadCurrentConfig(tenantId)}
                className="px-3 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition text-sm"
              >
                Recarregar
              </button>
              <button
                onClick={handleSaveConfig}
                disabled={saving || configLoading}
                className="px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm disabled:opacity-50"
              >
                {saving ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>

          {configLoading ? (
            <div className="mt-4 text-sm text-gray-600">Carregando configuração…</div>
          ) : configError ? (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-800">
              {configError}
            </div>
          ) : (
            <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Número para Notificações (ex.: 55DDDNUMERO)
                </label>
                <input
                  value={notificationPhone}
                  onChange={(e) => setNotificationPhone(e.target.value)}
                  placeholder="559999999999"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white text-gray-900"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Usado para receber resumo/feedback de conversas encerradas.
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  WhatsApp phone_number_id
                </label>
                <input
                  value={whatsappPhoneNumberId}
                  onChange={(e) => setWhatsappPhoneNumberId(e.target.value)}
                  placeholder="974597825733636"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white text-gray-900"
                />
                <div className="mt-1 text-xs text-gray-500">
                  Token atual: {whatsappHasToken ? 'configurado' : 'não configurado'}
                </div>
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  WhatsApp access_token (Meta Cloud API) — opcional (não exibimos o token atual)
                </label>
                <input
                  type="password"
                  value={whatsappAccessToken}
                  onChange={(e) => setWhatsappAccessToken(e.target.value)}
                  placeholder="Cole aqui para atualizar"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white text-gray-900"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Se deixar em branco, mantemos o token atual.
                </p>
              </div>

              {/* Channels list */}
              <div className="md:col-span-2">
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-medium text-gray-700">
                    Canais conectados
                  </label>
                  <span className="text-xs text-gray-500">
                    channel_identifier é único globalmente (reutilizar move o canal de tenant).
                  </span>
                </div>
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="text-left px-3 py-2 text-xs font-medium text-gray-600">Tipo</th>
                        <th className="text-left px-3 py-2 text-xs font-medium text-gray-600">Identificador</th>
                        <th className="text-left px-3 py-2 text-xs font-medium text-gray-600">Token</th>
                        <th className="text-right px-3 py-2 text-xs font-medium text-gray-600">Ações</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {channelsConfig.length ? (
                        channelsConfig.map((c: any) => (
                          <tr key={`${c.channel_type}:${c.channel_identifier}`}>
                            <td className="px-3 py-2 whitespace-nowrap">{String(c.channel_type || '')}</td>
                            <td className="px-3 py-2 break-all">{String(c.channel_identifier || '')}</td>
                            <td className="px-3 py-2 whitespace-nowrap">
                              {c.has_access_token ? 'configurado' : 'não configurado'}
                            </td>
                            <td className="px-3 py-2 text-right whitespace-nowrap">
                              <button
                                onClick={() => handleDeleteChannel(String(c.channel_identifier || ''))}
                                disabled={channelSaving}
                                className="text-xs text-red-600 hover:text-red-700 disabled:opacity-50"
                              >
                                Remover
                              </button>
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td className="px-3 py-3 text-gray-500" colSpan={4}>
                            Nenhum canal cadastrado ainda.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Add/update channel */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Adicionar/atualizar canal — tipo
                </label>
                <select
                  value={newChannelType}
                  onChange={(e) => setNewChannelType(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white text-gray-900"
                >
                  <option value="whatsapp">whatsapp</option>
                  <option value="messenger">messenger</option>
                  <option value="instagram">instagram</option>
                  <option value="phone">phone</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  channel_identifier
                </label>
                <input
                  value={newChannelIdentifier}
                  onChange={(e) => setNewChannelIdentifier(e.target.value)}
                  placeholder="phone_number_id / page_id / ig_id / etc"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white text-gray-900"
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  access_token (opcional) — deixe em branco para manter o atual
                </label>
                <input
                  type="password"
                  value={newChannelAccessToken}
                  onChange={(e) => setNewChannelAccessToken(e.target.value)}
                  placeholder="Cole aqui para atualizar"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white text-gray-900"
                />
                <div className="mt-2 flex items-center gap-3">
                  <button
                    onClick={handleUpsertChannel}
                    disabled={channelSaving}
                    className="px-3 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition text-sm disabled:opacity-50"
                  >
                    {channelSaving ? 'Salvando…' : 'Salvar canal'}
                  </button>
                  {channelMessage && (
                    <div
                      className={`text-sm ${
                        channelMessage.type === 'success' ? 'text-green-700' : 'text-red-700'
                      }`}
                    >
                      {channelMessage.text}
                    </div>
                  )}
                </div>
              </div>

              {/* Advanced followup/feedback config */}
              <div className="md:col-span-2 border-t border-gray-200 pt-4">
                <button
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="text-sm text-blue-600 hover:text-blue-700"
                >
                  {showAdvanced ? 'Ocultar opções avançadas' : 'Mostrar opções avançadas'}
                </button>

                {showAdvanced && (
                  <div className="mt-4 space-y-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm font-medium text-gray-900">Follow-up habilitado</div>
                        <div className="text-xs text-gray-500">
                          Controla disparos (templates / IA reengagement) via n8n.
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        checked={followupEnabled}
                        onChange={(e) => setFollowupEnabled(e.target.checked)}
                        className="h-4 w-4"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        followup_config (JSON)
                      </label>
                      <textarea
                        value={followupConfigText}
                        onChange={(e) => setFollowupConfigText(e.target.value)}
                        rows={10}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono bg-white text-gray-900"
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        Dica: use channels.whatsapp.stages e/ou channels.whatsapp.ai_reengagement conforme o guia.
                      </p>
                    </div>

                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm font-medium text-gray-900">Feedback habilitado</div>
                        <div className="text-xs text-gray-500">
                          Exibe link de avaliação no resumo de conversa encerrada.
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        checked={feedbackEnabled}
                        onChange={(e) => setFeedbackEnabled(e.target.checked)}
                        className="h-4 w-4"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        feedback_config (JSON)
                      </label>
                      <textarea
                        value={feedbackConfigText}
                        onChange={(e) => setFeedbackConfigText(e.target.value)}
                        rows={6}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono bg-white text-gray-900"
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        Ex.: {"{\"base_url\":\"https://ai.superbot.digital\"}"} para montar links do form.
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {saveMessage && (
                <div className={`md:col-span-2 p-3 rounded border text-sm ${
                  saveMessage.type === 'success'
                    ? 'bg-green-50 border-green-200 text-green-800'
                    : 'bg-red-50 border-red-200 text-red-800'
                }`}>
                  {saveMessage.text}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Platform Selector */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Escolha a Plataforma
          </h2>
          <div className="grid grid-cols-3 gap-4">
            <button
              onClick={() => { setPlatform('whatsapp'); setCurrentStep(1); setCompletedSteps([]); }}
              className={`p-4 rounded-lg border-2 transition ${
                platform === 'whatsapp'
                  ? 'border-green-500 bg-green-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <div className="flex flex-col items-center gap-2">
                <Phone className={`w-8 h-8 ${platform === 'whatsapp' ? 'text-green-600' : 'text-gray-600'}`} />
                <span className="font-medium">WhatsApp</span>
              </div>
            </button>

            <button
              onClick={() => { setPlatform('messenger'); setCurrentStep(1); setCompletedSteps([]); }}
              className={`p-4 rounded-lg border-2 transition ${
                platform === 'messenger'
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <div className="flex flex-col items-center gap-2">
                <MessageCircle className={`w-8 h-8 ${platform === 'messenger' ? 'text-blue-600' : 'text-gray-600'}`} />
                <span className="font-medium">Messenger</span>
              </div>
            </button>

            <button
              onClick={() => { setPlatform('instagram'); setCurrentStep(1); setCompletedSteps([]); }}
              className={`p-4 rounded-lg border-2 transition ${
                platform === 'instagram'
                  ? 'border-pink-500 bg-pink-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <div className="flex flex-col items-center gap-2">
                <Instagram className={`w-8 h-8 ${platform === 'instagram' ? 'text-pink-600' : 'text-gray-600'}`} />
                <span className="font-medium">Instagram</span>
              </div>
            </button>
          </div>
        </div>

        {/* Progress */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-900">Progresso</h3>
            <span className="text-sm text-gray-600">
              {completedSteps.length} de {steps.length} concluídos
            </span>
          </div>
          <div className="flex gap-2">
            {steps.map((step) => (
              <div
                key={step.id}
                className={`flex-1 h-2 rounded-full ${
                  completedSteps.includes(step.id)
                    ? 'bg-green-500'
                    : step.id === currentStep
                    ? 'bg-blue-500'
                    : 'bg-gray-200'
                }`}
              />
            ))}
          </div>
        </div>

        {/* Steps List */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h3 className="font-semibold text-gray-900 mb-4">Etapas</h3>
          <div className="space-y-2">
            {steps.map((step) => (
              <button
                key={step.id}
                onClick={() => setCurrentStep(step.id)}
                className={`w-full flex items-center gap-3 p-3 rounded-lg transition ${
                  step.id === currentStep
                    ? 'bg-blue-50 border-2 border-blue-500'
                    : 'hover:bg-gray-50 border-2 border-transparent'
                }`}
              >
                {completedSteps.includes(step.id) ? (
                  <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />
                ) : (
                  <Circle className="w-5 h-5 text-gray-400 flex-shrink-0" />
                )}
                <div className="flex-1 text-left">
                  <p className="font-medium text-gray-900">{step.title}</p>
                  <p className="text-sm text-gray-600">{step.description}</p>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Current Step Details */}
        {currentStepData && (
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-start justify-between mb-6">
              <div>
                <div className="flex items-center gap-3 mb-2">
                  {getIcon(platform)}
                  <h2 className="text-xl font-bold text-gray-900">
                    {currentStepData.title}
                  </h2>
                </div>
                <p className="text-gray-600">{currentStepData.description}</p>
              </div>
              <button
                onClick={() => toggleStepComplete(currentStepData.id)}
                className={`px-4 py-2 rounded-lg font-medium transition ${
                  completedSteps.includes(currentStepData.id)
                    ? 'bg-green-100 text-green-700 hover:bg-green-200'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {completedSteps.includes(currentStepData.id) ? (
                  <span className="flex items-center gap-2">
                    <Check className="w-4 h-4" />
                    Concluído
                  </span>
                ) : (
                  'Marcar como concluído'
                )}
              </button>
            </div>

            {/* Warnings */}
            {currentStepData.warnings && currentStepData.warnings.length > 0 && (
              <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                  <div>
                    {currentStepData.warnings.map((warning, idx) => (
                      <p key={idx} className="text-sm text-red-800">{warning}</p>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Instructions */}
            <div className="mb-6">
              <h3 className="font-semibold text-gray-900 mb-3">Instruções</h3>
              <ol className="space-y-2">
                {currentStepData.instructions.map((instruction, idx) => (
                  <li key={idx} className="flex gap-3">
                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-sm font-medium flex items-center justify-center">
                      {idx + 1}
                    </span>
                    <span className="text-gray-700 flex-1">{instruction}</span>
                  </li>
                ))}
              </ol>
            </div>

            {/* Webhook Info */}
            {currentStepData.id === 3 && platform === 'whatsapp' && (
              <div className="mb-6 space-y-3">
                <div className="p-4 bg-gray-50 rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-medium text-gray-700">Webhook URL</label>
                    <button
                      onClick={() => handleCopy(WEBHOOK_URL, 'url')}
                      className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700"
                    >
                      {copiedUrl ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                      {copiedUrl ? 'Copiado!' : 'Copiar'}
                    </button>
                  </div>
                  <code className="text-sm text-gray-900 break-all">{WEBHOOK_URL}</code>
                </div>

                <div className="p-4 bg-gray-50 rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-medium text-gray-700">Verify Token</label>
                    <button
                      onClick={() => handleCopy(VERIFY_TOKEN, 'token')}
                      className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700"
                    >
                      {copiedToken ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                      {copiedToken ? 'Copiado!' : 'Copiar'}
                    </button>
                  </div>
                  <code className="text-sm text-gray-900">{VERIFY_TOKEN}</code>
                </div>
              </div>
            )}

            {/* Notes */}
            {currentStepData.notes && currentStepData.notes.length > 0 && (
              <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <h4 className="font-medium text-blue-900 mb-2">💡 Notas</h4>
                {currentStepData.notes.map((note, idx) => (
                  <p key={idx} className="text-sm text-blue-800">{note}</p>
                ))}
              </div>
            )}

            {/* Navigation */}
            <div className="flex gap-3 mt-6">
              {currentStep > 1 && (
                <button
                  onClick={() => setCurrentStep(currentStep - 1)}
                  className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition"
                >
                  ← Anterior
                </button>
              )}
              {currentStep < steps.length && (
                <button
                  onClick={() => setCurrentStep(currentStep + 1)}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition ml-auto"
                >
                  Próximo →
                </button>
              )}
              {currentStep === steps.length && (
                <button
                  onClick={() => router.push('/dash')}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition ml-auto"
                >
                  Finalizar ✓
                </button>
              )}
            </div>
          </div>
        )}

        {/* Quick Links */}
        <div className="mt-6 bg-white rounded-lg shadow p-6">
          <h3 className="font-semibold text-gray-900 mb-4">Links Úteis</h3>
          <div className="grid grid-cols-2 gap-3">
            <a
              href="https://business.facebook.com"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 p-3 border border-gray-200 rounded-lg hover:bg-gray-50 transition"
            >
              <ExternalLink className="w-4 h-4 text-gray-600" />
              <span className="text-sm text-gray-700">Business Manager</span>
            </a>
            <a
              href="https://developers.facebook.com"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 p-3 border border-gray-200 rounded-lg hover:bg-gray-50 transition"
            >
              <ExternalLink className="w-4 h-4 text-gray-600" />
              <span className="text-sm text-gray-700">Developers Console</span>
            </a>
          </div>
        </div>
      </main>
    </div>
  );
}
