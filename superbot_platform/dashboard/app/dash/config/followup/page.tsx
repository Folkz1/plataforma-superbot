'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { AlertCircle, CheckCircle, Loader2, Save, ToggleLeft, ToggleRight, Volume2 } from 'lucide-react';

type FollowupTemplate = {
  id: string;
  name: string;
  message: string;
  delay_hours: number;
  channel: 'whatsapp' | 'all';
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
  templates?: FollowupTemplate[];
  auto_followup?: boolean;
  default_delay_hours?: number;
  max_followups?: number;
  channels?: {
    whatsapp?: {
      ai_reengagement?: AiCfg;
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
  audioFirstFollowupOnly: boolean;
  audioSendTextAfterAudio: boolean;
  audioVoiceId: string;
  audioModelId: string;
  audioStability: number;
  audioSimilarityBoost: number;
};

const DEFAULT_AI: AiForm = {
  enabled: true,
  dryRun: false,
  model: 'openai/gpt-4o-mini',
  timezone: 'America/Sao_Paulo',
  inactiveAfterMinutes: 180,
  minGapMinutes: 240,
  maxAttempts: 2,
  historyLimit: 30,
  batchLimit: 50,
  sendFromHour: 8,
  sendUntilHour: 19,
  audioEnabled: true,
  audioFirstFollowupOnly: true,
  audioSendTextAfterAudio: true,
  audioVoiceId: 'r2fkFV8WAqXq2AqBpgJT',
  audioModelId: 'eleven_multilingual_v2',
  audioStability: 0.45,
  audioSimilarityBoost: 0.7,
};

const OUTPUT_SCHEMA = `{
  "should_send": true|false,
  "send_audio": true|false,
  "audio_text": "texto curto para o audio (opcional)",
  "message": "texto curto em pt-BR, pode ter blocos separados por linha em branco",
  "reason": "1 frase curta",
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

function buildPrompt(custom: string): string {
  return [
    'Voce e um motor de reengajamento para WhatsApp (janela oficial de 24h).',
    '',
    'Objetivo: decidir se vale enviar follow-up e em qual formato.',
    '',
    'Responda APENAS JSON valido (sem markdown):',
    OUTPUT_SCHEMA,
    '',
    'Regras fixas:',
    '- Se o usuario pediu para parar, should_send=false.',
    '- Se contexto insuficiente, should_send=false.',
    '- Se count=0 e should_send=true, prefira send_audio=true com audio_text + message.',
    '- Se send_audio=true e audio_text vazio, usar a primeira frase da message.',
    '- Quando should_send=true, manter next_wait_minutes=120.',
    '',
    CUSTOM_START,
    custom.trim() || '(sem instrucoes personalizadas)',
    CUSTOM_END,
  ].join('\n');
}

function extractCustom(prompt: string): string | null {
  const s = prompt.indexOf(CUSTOM_START);
  const e = prompt.indexOf(CUSTOM_END);
  if (s === -1 || e === -1 || e <= s) return null;
  const value = prompt.slice(s + CUSTOM_START.length, e).trim();
  return value === '(sem instrucoes personalizadas)' ? '' : value;
}

export default function FollowupConfigPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tenantId, setTenantId] = useState('');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [enabled, setEnabled] = useState(false);
  const [baseConfig, setBaseConfig] = useState<FollowupConfig>({});
  const [ai, setAi] = useState<AiForm>(DEFAULT_AI);
  const [promptCustom, setPromptCustom] = useState('');
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
      const wa = (cfg.channels?.whatsapp || {}) as { ai_reengagement?: AiCfg; dry_run?: boolean };
      const aiCfg = (wa.ai_reengagement || {}) as AiCfg;

      setEnabled(Boolean(secrets.followup_enabled));
      setBaseConfig(cfg);
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
        audioFirstFollowupOnly: aiCfg.audio_first_followup_only !== false,
        audioSendTextAfterAudio: aiCfg.audio_send_text_after_audio !== false,
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
          setPromptCustom(extracted);
          setLegacyPrompt(false);
        } else {
          setPromptCustom(raw);
          setLegacyPrompt(Boolean(raw) && raw.includes('Responda APENAS JSON valido'));
        }
      }
    } catch {
      setMessage({ type: 'error', text: 'Erro ao carregar configuracao de follow-up' });
    } finally {
      setLoading(false);
    }
  };

  const onSave = async () => {
    if (!tenantId) return;
    setSaving(true);
    setMessage(null);
    try {
      const nextCfg = JSON.parse(JSON.stringify(baseConfig || {})) as FollowupConfig;
      if (!nextCfg.channels) nextCfg.channels = {};
      const nextWa = (nextCfg.channels.whatsapp || {}) as Record<string, unknown>;
      nextWa.enabled = enabled;
      nextWa.dry_run = ai.dryRun;
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
        audio_first_followup_only: ai.audioFirstFollowupOnly,
        audio_send_text_after_audio: ai.audioSendTextAfterAudio,
        audio_voice_id: ai.audioVoiceId.trim() || DEFAULT_AI.audioVoiceId,
        audio_model_id: ai.audioModelId.trim() || DEFAULT_AI.audioModelId,
        audio_stability: clampFloat(ai.audioStability, 0, 1, DEFAULT_AI.audioStability),
        audio_similarity_boost: clampFloat(ai.audioSimilarityBoost, 0, 1, DEFAULT_AI.audioSimilarityBoost),
        prompt_custom: promptCustom.trim(),
        prompt: buildPrompt(promptCustom),
      };
      nextCfg.channels.whatsapp = nextWa as FollowupConfig['channels']['whatsapp'];

      await api.patch(`/api/config/meta/${tenantId}`, {
        followup_enabled: enabled,
        followup_config: nextCfg,
      });

      setBaseConfig(nextCfg);
      setLegacyPrompt(false);
      setMessage({ type: 'success', text: 'Configuracao salva!' });
    } catch {
      setMessage({ type: 'error', text: 'Erro ao salvar configuracao' });
    } finally {
      setSaving(false);
    }
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
        <p className="text-sm text-gray-500 mt-1">Configuracao avancada do AI reengagement.</p>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Follow-up Automatico</h2>
            <p className="text-sm text-gray-500 mt-1">Liga/desliga disparo automatico.</p>
          </div>
          <button onClick={() => setEnabled(!enabled)} className="flex items-center gap-2">
            {enabled ? <ToggleRight className="w-10 h-10 text-blue-600" /> : <ToggleLeft className="w-10 h-10 text-gray-400" />}
            <span className={`text-sm font-medium ${enabled ? 'text-blue-600' : 'text-gray-400'}`}>
              {enabled ? 'Ativado' : 'Desativado'}
            </span>
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Parametros da IA</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <label className="text-sm text-gray-700">Modelo<input value={ai.model} onChange={(e) => setAi({ ...ai, model: e.target.value })} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white" /></label>
          <label className="text-sm text-gray-700">Timezone<input value={ai.timezone} onChange={(e) => setAi({ ...ai, timezone: e.target.value })} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white" /></label>
          <label className="text-sm text-gray-700">Inicio (0-23)<input type="number" min={0} max={23} value={ai.sendFromHour} onChange={(e) => setAi({ ...ai, sendFromHour: clampInt(Number(e.target.value), 0, 23) })} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white" /></label>
          <label className="text-sm text-gray-700">Fim (0-23)<input type="number" min={0} max={23} value={ai.sendUntilHour} onChange={(e) => setAi({ ...ai, sendUntilHour: clampInt(Number(e.target.value), 0, 23) })} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white" /></label>
          <label className="text-sm text-gray-700">Inatividade (min)<input type="number" min={10} value={ai.inactiveAfterMinutes} onChange={(e) => setAi({ ...ai, inactiveAfterMinutes: clampInt(Number(e.target.value), 10, 1440) })} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white" /></label>
          <label className="text-sm text-gray-700">Gap (min)<input type="number" min={10} value={ai.minGapMinutes} onChange={(e) => setAi({ ...ai, minGapMinutes: clampInt(Number(e.target.value), 10, 1440) })} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white" /></label>
          <label className="text-sm text-gray-700">Max tentativas<input type="number" min={1} max={30} value={ai.maxAttempts} onChange={(e) => setAi({ ...ai, maxAttempts: clampInt(Number(e.target.value), 1, 30) })} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white" /></label>
          <label className="text-sm text-gray-700">History limite<input type="number" min={10} max={60} value={ai.historyLimit} onChange={(e) => setAi({ ...ai, historyLimit: clampInt(Number(e.target.value), 10, 60) })} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white" /></label>
          <label className="text-sm text-gray-700">Batch limite<input type="number" min={1} max={200} value={ai.batchLimit} onChange={(e) => setAi({ ...ai, batchLimit: clampInt(Number(e.target.value), 1, 200) })} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white" /></label>
          <label className="text-sm text-gray-700">Dry run
            <button onClick={() => setAi({ ...ai, dryRun: !ai.dryRun })} className="mt-1 flex items-center gap-2">
              {ai.dryRun ? <ToggleRight className="w-10 h-10 text-blue-600" /> : <ToggleLeft className="w-10 h-10 text-gray-400" />}
            </button>
          </label>
          <label className="text-sm text-gray-700">IA habilitada
            <button onClick={() => setAi({ ...ai, enabled: !ai.enabled })} className="mt-1 flex items-center gap-2">
              {ai.enabled ? <ToggleRight className="w-10 h-10 text-blue-600" /> : <ToggleLeft className="w-10 h-10 text-gray-400" />}
            </button>
          </label>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <Volume2 className="w-5 h-5 text-indigo-600" />
          <h2 className="text-lg font-semibold text-gray-900">Audio</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <label className="text-sm text-gray-700">Audio habilitado<button onClick={() => setAi({ ...ai, audioEnabled: !ai.audioEnabled })} className="mt-1 flex items-center">{ai.audioEnabled ? <ToggleRight className="w-10 h-10 text-blue-600" /> : <ToggleLeft className="w-10 h-10 text-gray-400" />}</button></label>
          <label className="text-sm text-gray-700">Apenas 1o follow-up<button onClick={() => setAi({ ...ai, audioFirstFollowupOnly: !ai.audioFirstFollowupOnly })} className="mt-1 flex items-center">{ai.audioFirstFollowupOnly ? <ToggleRight className="w-10 h-10 text-blue-600" /> : <ToggleLeft className="w-10 h-10 text-gray-400" />}</button></label>
          <label className="text-sm text-gray-700">Texto apos audio<button onClick={() => setAi({ ...ai, audioSendTextAfterAudio: !ai.audioSendTextAfterAudio })} className="mt-1 flex items-center">{ai.audioSendTextAfterAudio ? <ToggleRight className="w-10 h-10 text-blue-600" /> : <ToggleLeft className="w-10 h-10 text-gray-400" />}</button></label>
          <label className="text-sm text-gray-700">Voice ID<input value={ai.audioVoiceId} onChange={(e) => setAi({ ...ai, audioVoiceId: e.target.value })} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white" /></label>
          <label className="text-sm text-gray-700">Audio model<input value={ai.audioModelId} onChange={(e) => setAi({ ...ai, audioModelId: e.target.value })} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white" /></label>
          <label className="text-sm text-gray-700">Stability<input type="number" min={0} max={1} step={0.01} value={ai.audioStability} onChange={(e) => setAi({ ...ai, audioStability: clampFloat(Number(e.target.value), 0, 1, 0.45) })} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white" /></label>
          <label className="text-sm text-gray-700">Similarity<input type="number" min={0} max={1} step={0.01} value={ai.audioSimilarityBoost} onChange={(e) => setAi({ ...ai, audioSimilarityBoost: clampFloat(Number(e.target.value), 0, 1, 0.7) })} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white" /></label>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">Prompt (schema fixo)</h2>
        <p className="text-sm text-gray-500 mb-3">Personalize so as instrucoes. O formato JSON de resposta permanece fixo.</p>
        {legacyPrompt && <div className="mb-3 p-3 bg-amber-50 border border-amber-200 rounded text-sm text-amber-800">Prompt legado detectado. Ao salvar, ele sera padronizado.</div>}
        <textarea value={promptCustom} onChange={(e) => setPromptCustom(e.target.value)} rows={7} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white text-gray-900" placeholder="Instrucoes comerciais e estilo de escrita..." />
        <pre className="mt-3 text-xs bg-gray-50 border border-gray-200 rounded-lg p-3 overflow-x-auto text-gray-800">{OUTPUT_SCHEMA}</pre>
        <details className="mt-3 bg-gray-50 border border-gray-200 rounded-lg p-3">
          <summary className="cursor-pointer text-sm font-medium text-gray-700">Ver prompt final</summary>
          <pre className="mt-3 text-xs whitespace-pre-wrap text-gray-800">{promptPreview}</pre>
        </details>
      </div>

      <div className="flex items-center justify-between">
        <div>
          {message && (
            <div className={`flex items-center gap-2 text-sm ${message.type === 'success' ? 'text-green-700' : 'text-red-700'}`}>
              {message.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
              {message.text}
            </div>
          )}
        </div>
        <button onClick={onSave} disabled={saving} className="flex items-center gap-2 bg-blue-600 text-white px-6 py-2.5 rounded-lg hover:bg-blue-700 transition font-medium disabled:opacity-50">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Salvar Configuracao
        </button>
      </div>
    </div>
  );
}
