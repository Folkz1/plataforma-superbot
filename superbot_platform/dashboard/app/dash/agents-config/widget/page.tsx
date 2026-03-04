'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import {
  Bot, Copy, CheckCircle, Code, Globe, Loader2, ChevronDown
} from 'lucide-react';

interface ElevenLabsAgent {
  agent_id: string;
  name?: string;
  _configured_label?: string;
  _configured_active?: boolean;
  platform_settings?: { widget_settings?: { name?: string } };
}

export default function WidgetPage() {
  const [tenantId, setTenantId] = useState('');
  const [agents, setAgents] = useState<ElevenLabsAgent[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<ElevenLabsAgent | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);

  // Customization
  const [orbColor1, setOrbColor1] = useState('#2563eb');
  const [orbColor2, setOrbColor2] = useState('#7c3aed');
  const [bgColor, setBgColor] = useState('#ffffff');

  useEffect(() => {
    const userData = localStorage.getItem('user');
    if (!userData) return;
    const user = JSON.parse(userData);
    const tId = user.role === 'admin'
      ? localStorage.getItem('active_tenant_id')
      : user.client_id;
    if (tId) setTenantId(tId);
  }, []);

  const loadAgents = useCallback(async (tId: string) => {
    setLoading(true);
    try {
      const res = await api.get(`/api/elevenlabs/agents/${tId}`);
      const list: ElevenLabsAgent[] = (res.data?.agents || []).filter((a: ElevenLabsAgent) => a._configured_active !== false);
      setAgents(list);
      if (list.length > 0) setSelectedAgent(list[0]);
    } catch { setAgents([]); }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (tenantId) loadAgents(tenantId);
  }, [tenantId, loadAgents]);

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(''), 2000);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  const agentId = selectedAgent?.agent_id || '';
  const agentName = selectedAgent?._configured_label || selectedAgent?.name || selectedAgent?.platform_settings?.widget_settings?.name || agentId;

  const webComponentCode = `<!-- ElevenLabs Widget -->
<script src="https://elevenlabs.io/convai-widget/index.js" async></script>
<elevenlabs-convai
  agent-id="${agentId}"
  avatar-orb-color-1="${orbColor1}"
  avatar-orb-color-2="${orbColor2}"
></elevenlabs-convai>`;

  const iframeCode = `<!-- ElevenLabs Widget (iframe) -->
<iframe
  src="https://elevenlabs.io/convai-widget/embed?agent_id=${agentId}&avatar_orb_color_1=${encodeURIComponent(orbColor1)}&avatar_orb_color_2=${encodeURIComponent(orbColor2)}"
  style="width: 100px; height: 100px; border: none; position: fixed; bottom: 20px; right: 20px; z-index: 9999;"
  allow="microphone"
></iframe>`;

  const reactCode = `// npm install @elevenlabs/react
import { useConversation } from '@elevenlabs/react';

function Widget() {
  const conversation = useConversation({
    agentId: '${agentId}',
  });

  return (
    <button onClick={() => conversation.startSession()}>
      Falar com ${agentName}
    </button>
  );
}`;

  return (
    <div className="p-4 lg:p-6 max-w-5xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <Code className="w-6 h-6 text-blue-600" />
          Widget Embed
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Codigo para incorporar o agente em sites externos
        </p>
      </div>

      {/* Agent Selector */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Agente</label>
        <div className="relative">
          <button onClick={() => setDropdownOpen(!dropdownOpen)}
            className="flex items-center justify-between w-full max-w-md px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white hover:bg-gray-50 dark:hover:bg-gray-600">
            <span>{agentName || 'Selecione um agente'}</span>
            <ChevronDown className="w-4 h-4" />
          </button>
          {dropdownOpen && (
            <div className="absolute z-10 mt-1 w-full max-w-md bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg">
              {agents.map(agent => (
                <button key={agent.agent_id}
                  onClick={() => { setSelectedAgent(agent); setDropdownOpen(false); }}
                  className={`w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-700 ${
                    selectedAgent?.agent_id === agent.agent_id ? 'bg-blue-50 dark:bg-blue-900/20' : ''
                  }`}>
                  <p className="font-medium text-gray-900 dark:text-white">
                    {agent._configured_label || agent.name || agent.platform_settings?.widget_settings?.name || agent.agent_id}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 font-mono">{agent.agent_id}</p>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {!selectedAgent ? (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-8 text-center">
          <Bot className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-500">Nenhum agente ativo disponivel</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Color customization */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-4">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Cores do Widget</h3>
            <div className="flex flex-wrap gap-4">
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Cor primaria</label>
                <div className="flex items-center gap-2">
                  <input type="color" value={orbColor1} onChange={e => setOrbColor1(e.target.value)}
                    className="w-8 h-8 rounded cursor-pointer border-0" />
                  <input type="text" value={orbColor1} onChange={e => setOrbColor1(e.target.value)}
                    className="w-24 px-2 py-1 text-xs font-mono border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Cor secundaria</label>
                <div className="flex items-center gap-2">
                  <input type="color" value={orbColor2} onChange={e => setOrbColor2(e.target.value)}
                    className="w-8 h-8 rounded cursor-pointer border-0" />
                  <input type="text" value={orbColor2} onChange={e => setOrbColor2(e.target.value)}
                    className="w-24 px-2 py-1 text-xs font-mono border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
                </div>
              </div>
            </div>
          </div>

          {/* Web Component */}
          <CodeBlock
            title="Web Component (Recomendado)"
            description="Funciona em qualquer site HTML. Basta colar antes do </body>."
            code={webComponentCode}
            copied={copied === 'wc'}
            onCopy={() => copyToClipboard(webComponentCode, 'wc')}
          />

          {/* Iframe */}
          <CodeBlock
            title="Iframe"
            description="Para sites que nao suportam web components (ex: WordPress com restricoes)."
            code={iframeCode}
            copied={copied === 'iframe'}
            onCopy={() => copyToClipboard(iframeCode, 'iframe')}
          />

          {/* React */}
          <CodeBlock
            title="React / Next.js"
            description="Usando o SDK oficial @elevenlabs/react com useConversation."
            code={reactCode}
            copied={copied === 'react'}
            onCopy={() => copyToClipboard(reactCode, 'react')}
          />
        </div>
      )}
    </div>
  );
}

function CodeBlock({ title, description, code, copied, onCopy }: {
  title: string; description: string; code: string; copied: boolean; onCopy: () => void;
}) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700 flex justify-between items-center">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{title}</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">{description}</p>
        </div>
        <button onClick={onCopy}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition ${
            copied
              ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
          }`}>
          {copied ? <><CheckCircle className="w-3.5 h-3.5" /> Copiado!</> : <><Copy className="w-3.5 h-3.5" /> Copiar</>}
        </button>
      </div>
      <pre className="p-4 text-xs font-mono text-gray-800 dark:text-gray-200 bg-gray-50 dark:bg-gray-900 overflow-x-auto">
        {code}
      </pre>
    </div>
  );
}
