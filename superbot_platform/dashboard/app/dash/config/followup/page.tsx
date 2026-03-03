'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { AlertCircle, CheckCircle, Loader2, Plus, RotateCcw, Save, ToggleLeft, ToggleRight, Trash2, Volume2 } from 'lucide-react';

type FollowupStageCfg = {
  stage?: number;
  after_hours?: number;
  mode?: 'template' | string;
  template_name?: string;
  language_code?: string;
  components?: unknown;
  [k: string]: unknown;
};

type AiCfg = {
  enabled?: boolean;
  dry_run?: boolean;
  model?: string;
  timezone?: string;
  inactive_after_minutes?: number;
  min_gap_minutes?: number;
  max_attempts?: number;
  history_limit?: number;
  batch_limit?: number;
  send_from_hour?: number;
  send_until_hour?: number;
  audio_enabled?: boolean;
  audio_first_followup_only?: boolean;
  audio_send_text_after_audio?: boolean;
  audio_voice_id?: string;
  audio_model_id?: string;
  audio_stability?: number;
  audio_similarity_boost?: number;
  prompt?: string;
  prompt_custom?: string;
  [k: string]: unknown;
};

type FollowupConfig = {
  channels?: {
    whatsapp?: {
      ai_reengagement?: AiCfg;
      stages?: FollowupStageCfg[];
      enabled?: boolean;
      dry_run?: boolean;
      [k: string]: unknown;
    };
    [k: string]: unknown;
  };
  [k: string]: unknown;
};

type AiForm = {
  enabled: boolean;
  dryRun: boolean;
  model: string;
  timezone: string;
  inactiveAfterMinutes: number;
  minGapMinutes: number;
  maxAttempts: number;
  historyLimit: number;
  batchLimit: number;
  sendFromHour: number;
  sendUntilHour: number;
  audioEnabled: boolean;
  audioVoiceId: string;
  audioModelId: string;
  audioStability: number;
  audioSimilarityBoost: number;
};

type StageForm = {
  id: string;
  stage: number;
  afterHours: number;
  templateName: string;
  languageCode: string;
  componentsText: string;
};

type ActiveTab = 'within_24h' | 'after_24h';

const DEFAULT_AI: AiForm = {
  enabled: true,
  dryRun: false,
  model: 'openai/gpt-4o-mini',
  timezone: 'America/Sao_Paulo',
  inactiveAfterMinutes: 180,
  minGapMinutes: 120,
  maxAttempts: 10,
  historyLimit: 30,
  batchLimit: 50,
  sendFromHour: 8,
  sendUntilHour: 19,
  audioEnabled: true,
  audioVoiceId: 'r2fkFV8WAqXq2AqBpgJT',
  audioModelId: 'eleven_multilingual_v2',
  audioStability: 0.45,
  audioSimilarityBoost: 0.7,
};

const DEFAULT_STAGE: Omit<StageForm, 'id'> = {
  stage: 1,
  afterHours: 24,
  templateName: '',
  languageCode: 'pt_BR',
  componentsText: '[]',
};

const DEFAULT_PROMPT_CUSTOM = [
  'Use a analise da conversa para decidir o follow-up DENTRO da janela de 24h do WhatsApp.',
  '',
  'Contexto recebido:',
  '- status da conversa',
  '- ultima mensagem inbound/outbound',
  '- historico recente (history)',
  '- metadata.ai_reengagement.whatsapp.count',
  '',
  'Objetivo:',
  '- Reengajar com mensagem curta, util e personalizada ao contexto real.',
  '',
  'Regras comerciais e de conteudo:',
  '- Nao inventar precos, horarios ou procedimentos.',
  '- Sem emojis.',
  '- Mensagem curta (preferencia <= 40 palavras) e terminar com pergunta.',
  '- Se for 2a+ tentativa, variar argumento e nao repetir o ultimo texto do agente.',
  '- Se for 1a tentativa e should_send=true, prefira enviar audio + texto.',
  '',
  'Tom de voz:',
  '- Profissional, humano, objetivo e acolhedor.',
].join('\n');

const OUTPUT_SCHEMA = `{
  "should_send": true|false,
  "send_audio": true|false,
  "audio_text": "texto curto para o audio (opcional)",
  "message": "texto curto em pt-BR. Pode ter blocos separados por linha em branco",
  "reason": "1 frase curta do motivo",
  "next_wait_minutes": 120
}`;

const CUSTOM_START = '[[CUSTOM_INSTRUCTIONS_START]]';
const CUSTOM_END = '[[CUSTOM_INSTRUCTIONS_END]]';

function clampInt(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, Math.round(v)));
}

function clampFloat(v: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(max, v));
}

function n(v: unknown, fb: number): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : fb;
}

function genId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
}

function parseStagesFromConfig(rawStages: unknown): StageForm[] {
  if (!Array.isArray(rawStages)) return [];

  return rawStages.map((raw, index) => {
    const st = (raw || {}) as FollowupStageCfg;
    const components = st.components;
    let componentsText = '[]';
    if (components !== undefined) {
      try {
        componentsText = JSON.stringify(components, null, 2);
      } catch {
        componentsText = '[]';
      }
    }

    return {
      id: genId(),
      stage: clampInt(n(st.stage, index + 1), 1, 99),
      afterHours: Math.max(0, clampInt(n(st.after_hours, 24), 0, 24 * 30)),
      templateName: String(st.template_name || '').trim(),
      languageCode: String(st.language_code || 'pt_BR').trim() || 'pt_BR',
      componentsText,
    };
  });
}

function buildStagesForSave(stages: StageForm[]): FollowupStageCfg[] {
  return stages.map((item) => {
    const languageCode = item.languageCode.trim() || 'pt_BR';
    return {
      stage: clampInt(item.stage, 1, 99),
      after_hours: Math.max(0, clampInt(item.afterHours, 0, 24 * 30)),
      mode: 'template',
      template_name: item.templateName.trim(),
      language_code: languageCode,
      components: item.componentsText.trim() ? JSON.parse(item.componentsText) : [],
    };
  });
}

function buildPrompt(custom: string): string {
  return [
    'Voce e um motor de reengajamento para WhatsApp na janela oficial de 24h (session).',
    'IMPORTANTE: este prompt e APENAS para follow-up ate 24h, baseado na analise da conversa.',
    '',
    'Voce recebera JSON com:',
    '- project_slug',
    '- conversation_id',
    '- status',
    '- last_event_at, last_in_at',
    '- last_text',
    '- history (role/user-agent, content, created_at, message_type)',
    '- metadata (inclusive ai_reengagement.whatsapp.count)',
    '',
    'Objetivo: decidir se deve enviar follow-up e em qual formato (texto e/ou audio).',
    '',
    'Responda APENAS JSON valido (sem markdown):',
    OUTPUT_SCHEMA,
    '',
    'Regras fixas (nao alteraveis):',
    '- Se o usuario pediu para parar, should_send=false.',
    '- Se contexto insuficiente, should_send=false.',
    '- Se send_audio=true e audio_text vazio, usar a primeira frase da message.',
    '- next_wait_minutes deve ficar em 120 quando should_send=true.',
    '',
    CUSTOM_START,
    custom.trim() || DEFAULT_PROMPT_CUSTOM,
    CUSTOM_END,
  ].join('\n');
}

function extractCustom(prompt: string): string | null {
  const s = prompt.indexOf(CUSTOM_START);
  const e = prompt.indexOf(CUSTOM_END);
  if (s === -1 || e === -1 || e <= s) return null;
  return prompt.slice(s + CUSTOM_START.length, e).trim();
}

export default function FollowupConfigPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tenantId, setTenantId] = useState('');
  const [activeTab, setActiveTab] = useState<ActiveTab>('within_24h');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [enabled, setEnabled] = useState(false);
  const [baseConfig, setBaseConfig] = useState<FollowupConfig>({});
  const [ai, setAi] = useState<AiForm>(DEFAULT_AI);
  const [stages, setStages] = useState<StageForm[]>([]);
  const [promptCustom, setPromptCustom] = useState(DEFAULT_PROMPT_CUSTOM);
  const [legacyPrompt, setLegacyPrompt] = useState(false);

  const promptPreview = useMemo(() => buildPrompt(promptCustom), [promptCustom]);

  useEffect(() => {
    const userData = localStorage.getItem('user');
    if (!userData) {
      router.push('/login');
      return;
    }
    const user = JSON.parse(userData) as { role?: string; client_id?: string };
    const tId = user.role === 'admin' ? localStorage.getItem('active_tenant_id') : user.client_id;
    if (!tId) {
      router.push(user.role === 'admin' ? '/admin' : '/login');
      return;
    }
    setTenantId(tId);
    void loadConfig(tId);
  }, [router]);

  const loadConfig = async (tId: string) => {
    try {
      const res = await api.get(`/api/config/meta/${tId}`);
      const secrets = (res.data?.secrets || {}) as { followup_enabled?: boolean; followup_config?: FollowupConfig };
      const cfg = (secrets.followup_config || {}) as FollowupConfig;
      const wa = (cfg.channels?.whatsapp || {}) as { ai_reengagement?: AiCfg; dry_run?: boolean; stages?: unknown };
      const aiCfg = (wa.ai_reengagement || {}) as AiCfg;
      const loadedStages = parseStagesFromConfig(wa.stages);

      setEnabled(Boolean(secrets.followup_enabled));
      setBaseConfig(cfg);
      setStages(loadedStages);
      setAi({
        enabled: aiCfg.enabled !== false,
        dryRun: Boolean(aiCfg.dry_run ?? wa.dry_run ?? false),
        model: String(aiCfg.model || DEFAULT_AI.model),
        timezone: String(aiCfg.timezone || DEFAULT_AI.timezone),
        inactiveAfterMinutes: Math.max(10, n(aiCfg.inactive_after_minutes, DEFAULT_AI.inactiveAfterMinutes)),
        minGapMinutes: Math.max(10, n(aiCfg.min_gap_minutes, DEFAULT_AI.minGapMinutes)),
        maxAttempts: Math.max(1, n(aiCfg.max_attempts, DEFAULT_AI.maxAttempts)),
        historyLimit: clampInt(n(aiCfg.history_limit, DEFAULT_AI.historyLimit), 10, 60),
        batchLimit: clampInt(n(aiCfg.batch_limit, DEFAULT_AI.batchLimit), 1, 200),
        sendFromHour: clampInt(n(aiCfg.send_from_hour, DEFAULT_AI.sendFromHour), 0, 23),
        sendUntilHour: clampInt(n(aiCfg.send_until_hour, DEFAULT_AI.sendUntilHour), 0, 23),
        audioEnabled: aiCfg.audio_enabled !== false,
        audioVoiceId: String(aiCfg.audio_voice_id || DEFAULT_AI.audioVoiceId),
        audioModelId: String(aiCfg.audio_model_id || DEFAULT_AI.audioModelId),
        audioStability: clampFloat(n(aiCfg.audio_stability, DEFAULT_AI.audioStability), 0, 1, DEFAULT_AI.audioStability),
        audioSimilarityBoost: clampFloat(n(aiCfg.audio_similarity_boost, DEFAULT_AI.audioSimilarityBoost), 0, 1, DEFAULT_AI.audioSimilarityBoost),
      });

      const custom = typeof aiCfg.prompt_custom === 'string' ? aiCfg.prompt_custom.trim() : '';
      const raw = typeof aiCfg.prompt === 'string' ? aiCfg.prompt.trim() : '';

      if (custom) {
        setPromptCustom(custom);
        setLegacyPrompt(false);
      } else {
        const extracted = raw ? extractCustom(raw) : null;
        if (extracted !== null) {
          setPromptCustom(extracted || DEFAULT_PROMPT_CUSTOM);
          setLegacyPrompt(false);
        } else if (raw) {
          setPromptCustom(raw);
          setLegacyPrompt(Boolean(raw) && raw.includes('Responda APENAS JSON valido'));
        } else {
          setPromptCustom(DEFAULT_PROMPT_CUSTOM);
          setLegacyPrompt(false);
        }
      }
    } catch {
      setMessage({ type: 'error', text: 'Erro ao carregar configuracao de follow-up' });
    } finally {
      setLoading(false);
    }
  };

  const onSave = async () => {
    if (!tenantId) {
      setMessage({ type: 'error', text: 'Nenhum cliente selecionado. Volte para /admin e selecione um cliente.' });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      for (const stageItem of stages) {
        const stageLabel = `stage ${stageItem.stage}`;
        if (!stageItem.templateName.trim()) {
          throw new Error(`${stageLabel}: template_name e obrigatorio.`);
        }

        let componentsParsed: unknown;
        try {
          componentsParsed = stageItem.componentsText.trim() ? JSON.parse(stageItem.componentsText) : [];
        } catch {
          throw new Error(`${stageLabel}: components deve ser JSON valido.`);
        }

        if (!Array.isArray(componentsParsed)) {
          throw new Error(`${stageLabel}: components deve ser um array JSON.`);
        }
      }

      const nextCfg = JSON.parse(JSON.stringify(baseConfig || {})) as FollowupConfig;
      if (!nextCfg.channels) nextCfg.channels = {};
      const nextWa = (nextCfg.channels.whatsapp || {}) as Record<string, unknown>;

      nextWa.enabled = enabled;
      nextWa.dry_run = ai.dryRun;
      nextWa.stages = buildStagesForSave(stages);
      nextWa.ai_reengagement = {
        ...(nextWa.ai_reengagement as Record<string, unknown> | undefined),
        enabled: ai.enabled,
        dry_run: ai.dryRun,
        model: ai.model.trim() || DEFAULT_AI.model,
        timezone: ai.timezone.trim() || DEFAULT_AI.timezone,
        inactive_after_minutes: clampInt(ai.inactiveAfterMinutes, 10, 1440),
        min_gap_minutes: clampInt(ai.minGapMinutes, 10, 1440),
        max_attempts: clampInt(ai.maxAttempts, 1, 30),
        history_limit: clampInt(ai.historyLimit, 10, 60),
        batch_limit: clampInt(ai.batchLimit, 1, 200),
        send_from_hour: clampInt(ai.sendFromHour, 0, 23),
        send_until_hour: clampInt(ai.sendUntilHour, 0, 23),
        audio_enabled: ai.audioEnabled,
        audio_first_followup_only: false,
        audio_send_text_after_audio: true,
        audio_voice_id: ai.audioVoiceId.trim() || DEFAULT_AI.audioVoiceId,
        audio_model_id: ai.audioModelId.trim() || DEFAULT_AI.audioModelId,
        audio_stability: clampFloat(ai.audioStability, 0, 1, DEFAULT_AI.audioStability),
        audio_similarity_boost: clampFloat(ai.audioSimilarityBoost, 0, 1, DEFAULT_AI.audioSimilarityBoost),
        prompt_custom: promptCustom.trim() || DEFAULT_PROMPT_CUSTOM,
        prompt: buildPrompt(promptCustom || DEFAULT_PROMPT_CUSTOM),
      };

      nextCfg.channels.whatsapp = nextWa as NonNullable<FollowupConfig['channels']>['whatsapp'];

      await api.patch(`/api/config/meta/${tenantId}`, {
        followup_enabled: enabled,
        followup_config: nextCfg,
      });

      setBaseConfig(nextCfg);
      setLegacyPrompt(false);
      setMessage({ type: 'success', text: 'Configuracao salva!' });
    } catch (error) {
      const err = error as { response?: { data?: { detail?: string } }; message?: string };
      const text = error instanceof Error
        ? error.message
        : (err.response?.data?.detail || 'Erro ao salvar configuracao. Verifique sua conexao.');
      setMessage({ type: 'error', text });
    } finally {
      setSaving(false);
    }
  };

  const addStage = () => {
    const maxStage = stages.reduce((acc, item) => Math.max(acc, item.stage), 0);
    const nextStage = Math.max(1, maxStage + 1);
    setStages([
      ...stages,
      {
        ...DEFAULT_STAGE,
        id: genId(),
        stage: nextStage,
        afterHours: nextStage === 1 ? 24 : nextStage * 24,
      },
    ]);
  };

  const updateStage = (id: string, patch: Partial<StageForm>) => {
    setStages((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };

  const removeStage = (id: string) => {
    setStages((prev) => prev.filter((item) => item.id !== id));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 max-w-5xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Follow-up</h1>
        <p className="text-sm text-gray-500 mt-1">Configuracao profissional do follow-up do WhatsApp.</p>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Follow-up Automatico</h2>
            <p className="text-sm text-gray-500 mt-1">Liga/desliga disparos automaticos do follow-up.</p>
          </div>
          <button onClick={() => setEnabled(!enabled)} className="flex items-center gap-2">
            {enabled ? <ToggleRight className="w-10 h-10 text-blue-600" /> : <ToggleLeft className="w-10 h-10 text-gray-400" />}
            <span className={`text-sm font-medium ${enabled ? 'text-blue-600' : 'text-gray-400'}`}>
              {enabled ? 'Ativado' : 'Desativado'}
            </span>
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-2 mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <button
            onClick={() => setActiveTab('within_24h')}
            className={`rounded-lg px-4 py-3 text-sm font-medium transition ${
              activeTab === 'within_24h' ? 'bg-blue-600 text-white' : 'bg-gray-50 text-gray-700 hover:bg-gray-100'
            }`}
          >
            Ate 24h (IA Reengagement)
          </button>
          <button
            onClick={() => setActiveTab('after_24h')}
            className={`rounded-lg px-4 py-3 text-sm font-medium transition ${
              activeTab === 'after_24h' ? 'bg-blue-600 text-white' : 'bg-gray-50 text-gray-700 hover:bg-gray-100'
            }`}
          >
            Apos 24h (Templates Meta)
          </button>
        </div>
      </div>

      {activeTab === 'within_24h' && (
        <>
          {/* Main controls - simplified */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Reengajamento (janela ate 24h)</h2>
            <p className="text-sm text-gray-500 mb-4">
              Configura follow-ups automaticos de sessao com IA, baseado no historico da conversa.
            </p>

            <div className="space-y-5">
              {/* Toggle: IA habilitada */}
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm font-medium text-gray-900">IA de reengajamento</span>
                  <p className="text-xs text-gray-500">Habilita analise automatica e envio de follow-up.</p>
                </div>
                <button onClick={() => setAi({ ...ai, enabled: !ai.enabled })} className="flex items-center">
                  {ai.enabled ? <ToggleRight className="w-10 h-10 text-blue-600" /> : <ToggleLeft className="w-10 h-10 text-gray-400" />}
                </button>
              </div>

              {/* Inactividade */}
              <label className="block text-sm text-gray-700">
                <span className="font-medium">Tempo de inatividade (minutos)</span>
                <p className="text-xs text-gray-500 mb-1">Tempo sem resposta do cliente antes de disparar follow-up.</p>
                <input type="number" min={10} max={1440} value={ai.inactiveAfterMinutes} onChange={(e) => setAi({ ...ai, inactiveAfterMinutes: clampInt(Number(e.target.value), 10, 1440) })} className="mt-1 w-full max-w-xs px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white" />
              </label>

              {/* Toggle: Audio */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Volume2 className="w-4 h-4 text-indigo-600" />
                  <div>
                    <span className="text-sm font-medium text-gray-900">Enviar audio</span>
                    <p className="text-xs text-gray-500">IA pode enviar mensagem de voz junto ao texto.</p>
                  </div>
                </div>
                <button onClick={() => setAi({ ...ai, audioEnabled: !ai.audioEnabled })} className="flex items-center">
                  {ai.audioEnabled ? <ToggleRight className="w-10 h-10 text-blue-600" /> : <ToggleLeft className="w-10 h-10 text-gray-400" />}
                </button>
              </div>

              {/* Instrucoes personalizadas */}
              <div>
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div>
                    <span className="text-sm font-medium text-gray-900">Instrucoes personalizadas</span>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Regras de tom, conteudo e comportamento para o follow-up.
                    </p>
                  </div>
                  <button onClick={() => setPromptCustom(DEFAULT_PROMPT_CUSTOM)} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 border border-gray-300 rounded-lg text-xs hover:bg-gray-50">
                    <RotateCcw className="w-3.5 h-3.5" />
                    Restaurar
                  </button>
                </div>
                {legacyPrompt && (
                  <div className="mb-3 p-3 bg-amber-50 border border-amber-200 rounded text-sm text-amber-800">
                    Prompt legado detectado. Ao salvar, ele sera padronizado para o formato atual.
                  </div>
                )}
                <textarea value={promptCustom} onChange={(e) => setPromptCustom(e.target.value)} rows={8} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white text-gray-900" placeholder="Instrucoes comerciais e de estilo para reengajamento ate 24h..." />
              </div>
            </div>
          </div>

          {/* Advanced settings */}
          <details className="bg-white rounded-xl shadow-sm border border-gray-100 mb-6">
            <summary className="cursor-pointer px-6 py-4 text-sm font-semibold text-gray-700 hover:bg-gray-50 rounded-xl">
              Configuracoes avancadas
            </summary>
            <div className="px-6 pb-6 pt-2 border-t border-gray-100">
              <p className="text-xs text-gray-500 mb-4">
                Ajustes finos do motor de reengajamento. Altere apenas se souber o que esta fazendo.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <label className="text-sm text-gray-700">
                  Modelo
                  <input value={ai.model} onChange={(e) => setAi({ ...ai, model: e.target.value })} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white" />
                </label>
                <label className="text-sm text-gray-700">
                  Timezone
                  <input value={ai.timezone} onChange={(e) => setAi({ ...ai, timezone: e.target.value })} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white" />
                </label>
                <label className="text-sm text-gray-700">
                  Hora inicio (0-23)
                  <input type="number" min={0} max={23} value={ai.sendFromHour} onChange={(e) => setAi({ ...ai, sendFromHour: clampInt(Number(e.target.value), 0, 23) })} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white" />
                </label>
                <label className="text-sm text-gray-700">
                  Hora fim (0-23)
                  <input type="number" min={0} max={23} value={ai.sendUntilHour} onChange={(e) => setAi({ ...ai, sendUntilHour: clampInt(Number(e.target.value), 0, 23) })} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white" />
                </label>
                <label className="text-sm text-gray-700">
                  Gap minimo (min)
                  <input type="number" min={10} value={ai.minGapMinutes} onChange={(e) => setAi({ ...ai, minGapMinutes: clampInt(Number(e.target.value), 10, 1440) })} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white" />
                </label>
                <label className="text-sm text-gray-700">
                  Max tentativas
                  <input type="number" min={1} max={30} value={ai.maxAttempts} onChange={(e) => setAi({ ...ai, maxAttempts: clampInt(Number(e.target.value), 1, 30) })} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white" />
                </label>
                <label className="text-sm text-gray-700">
                  History limite
                  <input type="number" min={10} max={60} value={ai.historyLimit} onChange={(e) => setAi({ ...ai, historyLimit: clampInt(Number(e.target.value), 10, 60) })} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white" />
                </label>
                <label className="text-sm text-gray-700">
                  Batch limite
                  <input type="number" min={1} max={200} value={ai.batchLimit} onChange={(e) => setAi({ ...ai, batchLimit: clampInt(Number(e.target.value), 1, 200) })} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white" />
                </label>
                <label className="text-sm text-gray-700">
                  Dry run
                  <button onClick={() => setAi({ ...ai, dryRun: !ai.dryRun })} className="mt-1 flex items-center">
                    {ai.dryRun ? <ToggleRight className="w-10 h-10 text-blue-600" /> : <ToggleLeft className="w-10 h-10 text-gray-400" />}
                  </button>
                </label>
              </div>

              {/* Audio advanced */}
              <div className="mt-6 pt-4 border-t border-gray-100">
                <h3 className="text-sm font-medium text-gray-700 mb-3">Audio (ElevenLabs)</h3>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <label className="text-sm text-gray-700">
                    Voice ID
                    <input value={ai.audioVoiceId} onChange={(e) => setAi({ ...ai, audioVoiceId: e.target.value })} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white" />
                  </label>
                  <label className="text-sm text-gray-700">
                    Audio model
                    <input value={ai.audioModelId} onChange={(e) => setAi({ ...ai, audioModelId: e.target.value })} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white" />
                  </label>
                  <label className="text-sm text-gray-700">
                    Stability
                    <input type="number" min={0} max={1} step={0.01} value={ai.audioStability} onChange={(e) => setAi({ ...ai, audioStability: clampFloat(Number(e.target.value), 0, 1, 0.45) })} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white" />
                  </label>
                  <label className="text-sm text-gray-700">
                    Similarity
                    <input type="number" min={0} max={1} step={0.01} value={ai.audioSimilarityBoost} onChange={(e) => setAi({ ...ai, audioSimilarityBoost: clampFloat(Number(e.target.value), 0, 1, 0.7) })} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white" />
                  </label>
                </div>
              </div>

              {/* Prompt preview */}
              <details className="mt-6 bg-gray-50 border border-gray-200 rounded-lg p-3">
                <summary className="cursor-pointer text-sm font-medium text-gray-700">Ver prompt final gerado</summary>
                <pre className="mt-3 text-xs whitespace-pre-wrap text-gray-800">{promptPreview}</pre>
              </details>
            </div>
          </details>
        </>
      )}

      {activeTab === 'after_24h' && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-6">
          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Follow-up apos 24h (Template Meta WhatsApp)</h2>
              <p className="text-sm text-gray-500 mt-1">
                Esta aba configura apenas disparos por template aprovado no Meta WhatsApp (fora da janela de 24h).
              </p>
            </div>
            <button onClick={addStage} className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">
              <Plus className="w-4 h-4" />
              Adicionar stage
            </button>
          </div>

          <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded text-sm text-blue-800">
            Cada stage representa um disparo em horas apos o ultimo evento elegivel. O campo <strong>template_name</strong> deve ser exatamente o nome aprovado no Meta.
          </div>
          <div className="mb-6 p-3 bg-gray-50 border border-gray-200 rounded text-xs text-gray-700">
            <div className="font-medium mb-1">Como preencher components (JSON)</div>
            <div>Sem variaveis: <code>[]</code></div>
            <div>Com 1 variavel no body: <code>{'[{"type":"body","parameters":[{"type":"text","text":"Joao"}]}]'}</code></div>
          </div>

          {stages.length === 0 ? (
            <div className="text-sm text-gray-500 border border-dashed border-gray-300 rounded-lg p-4">
              Nenhum stage configurado. Adicione ao menos um stage de template.
            </div>
          ) : (
            <div className="space-y-4">
              {stages.map((stage) => (
                <div key={stage.id} className="border border-gray-200 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-medium text-gray-900">Stage {stage.stage}</h3>
                    <button onClick={() => removeStage(stage.id)} className="inline-flex items-center gap-1 text-sm text-red-600 hover:text-red-700">
                      <Trash2 className="w-4 h-4" />
                      Remover
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <label className="text-sm text-gray-700">
                      Stage
                      <input
                        type="number"
                        min={1}
                        max={99}
                        value={stage.stage}
                        onChange={(e) => updateStage(stage.id, { stage: clampInt(Number(e.target.value), 1, 99) })}
                        className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white"
                      />
                    </label>
                    <label className="text-sm text-gray-700">
                      After hours
                      <input
                        type="number"
                        min={0}
                        max={720}
                        value={stage.afterHours}
                        onChange={(e) => updateStage(stage.id, { afterHours: Math.max(0, clampInt(Number(e.target.value), 0, 720)) })}
                        className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white"
                      />
                    </label>
                    <label className="text-sm text-gray-700 md:col-span-2">
                      Template name (Meta)
                      <input
                        value={stage.templateName}
                        onChange={(e) => updateStage(stage.id, { templateName: e.target.value })}
                        placeholder="followup_24h"
                        className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white"
                      />
                    </label>
                    <label className="text-sm text-gray-700 md:col-span-2">
                      Language code
                      <input
                        value={stage.languageCode}
                        onChange={(e) => updateStage(stage.id, { languageCode: e.target.value })}
                        placeholder="pt_BR"
                        className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white"
                      />
                    </label>
                    <label className="text-sm text-gray-700 md:col-span-4">
                      Components (JSON array)
                      <textarea
                        value={stage.componentsText}
                        onChange={(e) => updateStage(stage.id, { componentsText: e.target.value })}
                        rows={4}
                        className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white font-mono text-xs"
                        placeholder='[]'
                      />
                    </label>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          {message && (
            <div className={`flex items-center gap-2 text-sm ${message.type === 'success' ? 'text-green-700' : 'text-red-700'}`}>
              {message.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
              {message.text}
            </div>
          )}
        </div>
        <button onClick={onSave} disabled={saving || !tenantId} className="flex items-center gap-2 bg-blue-600 text-white px-6 py-2.5 rounded-lg hover:bg-blue-700 transition font-medium disabled:opacity-50">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Salvar Configuracao
        </button>
      </div>
    </div>
  );
}
