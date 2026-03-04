'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import {
  Bot, Copy, CheckCircle, Code, Loader2, ChevronDown, Palette, Eye
} from 'lucide-react';

interface AgentData {
  agent_id: string;
  name?: string;
  _configured_label?: string;
  _configured_active?: boolean;
  platform_settings?: { widget_settings?: { name?: string } };
}

export default function WidgetPage() {
  const [tenantId, setTenantId] = useState('');
  const [agents, setAgents] = useState<AgentData[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<AgentData | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  // Customization
  const [brandName, setBrandName] = useState('Assistente Virtual');
  const [primaryColor, setPrimaryColor] = useState('#2563eb');
  const [accentColor, setAccentColor] = useState('#7c3aed');
  const [position, setPosition] = useState<'bottom-right' | 'bottom-left'>('bottom-right');
  const [size, setSize] = useState('60');
  const [greeting, setGreeting] = useState('Ola! Como posso ajudar?');

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
      const list: AgentData[] = (res.data?.agents || []).filter((a: AgentData) => a._configured_active !== false);
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
  const agentName = selectedAgent?._configured_label || selectedAgent?.name || selectedAgent?.platform_settings?.widget_settings?.name || '';
  const positionCSS = position === 'bottom-right' ? 'bottom: 20px; right: 20px;' : 'bottom: 20px; left: 20px;';

  // ─── Code Snippets (White-label, sem mencao a ElevenLabs) ─────

  const scriptSnippet = `<!-- ${brandName} - Chat Widget -->
<script>
(function() {
  var AGENT_ID = "${agentId}";
  var BRAND = "${brandName}";
  var COLOR = "${primaryColor}";
  var ACCENT = "${accentColor}";
  var SIZE = "${size}px";
  var GREETING = "${greeting}";
  var POS = "${position}";

  // Criar botao flutuante
  var btn = document.createElement("div");
  btn.id = "sb-chat-btn";
  btn.innerHTML = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
  btn.style.cssText = "position:fixed;" + (POS === "bottom-right" ? "right:20px;" : "left:20px;") + "bottom:20px;width:" + SIZE + ";height:" + SIZE + ";background:" + COLOR + ";border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,0.15);z-index:99998;transition:transform 0.2s;";
  btn.onmouseover = function() { btn.style.transform = "scale(1.1)"; };
  btn.onmouseout = function() { btn.style.transform = "scale(1)"; };

  // Criar container do chat
  var chat = document.createElement("div");
  chat.id = "sb-chat-container";
  chat.style.cssText = "display:none;position:fixed;" + (POS === "bottom-right" ? "right:20px;" : "left:20px;") + "bottom:90px;width:380px;height:520px;border-radius:16px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,0.18);z-index:99999;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;";

  // Header
  var header = document.createElement("div");
  header.style.cssText = "background:" + COLOR + ";color:white;padding:16px 20px;display:flex;align-items:center;gap:10px;";
  header.innerHTML = '<div style="width:36px;height:36px;background:rgba(255,255,255,0.2);border-radius:50%;display:flex;align-items:center;justify-content:center;"><svg width="20" height="20" viewBox="0 0 24 24" fill="white" stroke="none"><circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 0 0-16 0"/></svg></div><div><div style="font-weight:600;font-size:14px;">' + BRAND + '</div><div style="font-size:11px;opacity:0.8;">Online agora</div></div><div style="margin-left:auto;cursor:pointer;padding:4px;" onclick="document.getElementById(\\'sb-chat-container\\').style.display=\\'none\\'"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg></div>';

  // Body (iframe com o agente)
  var body = document.createElement("iframe");
  body.style.cssText = "width:100%;height:calc(100% - 68px);border:none;background:white;";
  body.allow = "microphone";

  chat.appendChild(header);
  chat.appendChild(body);
  document.body.appendChild(chat);
  document.body.appendChild(btn);

  var isOpen = false;
  btn.onclick = function() {
    isOpen = !isOpen;
    chat.style.display = isOpen ? "block" : "none";
    if (isOpen && !body.src) {
      body.src = "https://elevenlabs.io/convai-widget/embed?agent_id=" + AGENT_ID;
    }
  };
})();
</script>`;

  const iframeSnippet = `<!-- ${brandName} - Embed (iframe direto) -->
<iframe
  src="https://elevenlabs.io/convai-widget/embed?agent_id=${agentId}"
  style="width: 100%; height: 500px; border: none; border-radius: 12px;"
  allow="microphone"
  title="${brandName}"
></iframe>`;

  const reactSnippet = `// SuperBot AI Widget - React Component
// npm install @elevenlabs/react

import { useState } from 'react';
import { useConversation } from '@elevenlabs/react';

export function ChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const conversation = useConversation({
    agentId: '${agentId}',
  });

  const startChat = async () => {
    setIsOpen(true);
    if (conversation.status !== 'connected') {
      await conversation.startSession();
    }
  };

  return (
    <>
      {/* Botao flutuante */}
      <button
        onClick={() => isOpen ? setIsOpen(false) : startChat()}
        style={{
          position: 'fixed', ${position === 'bottom-right' ? 'right: 20' : 'left: 20'}, bottom: 20,
          width: ${size}, height: ${size}, borderRadius: '50%',
          background: '${primaryColor}', border: 'none', cursor: 'pointer',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)', zIndex: 99998,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
      </button>

      {/* Chat container */}
      {isOpen && (
        <div style={{
          position: 'fixed', ${position === 'bottom-right' ? 'right: 20' : 'left: 20'}, bottom: 90,
          width: 380, height: 520, borderRadius: 16, overflow: 'hidden',
          boxShadow: '0 8px 32px rgba(0,0,0,0.18)', zIndex: 99999,
          background: 'white',
        }}>
          <div style={{ background: '${primaryColor}', color: 'white', padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontWeight: 600, fontSize: 14 }}>${brandName}</span>
            <button onClick={() => setIsOpen(false)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'white', cursor: 'pointer' }}>X</button>
          </div>
          <div style={{ padding: 16, height: 'calc(100% - 56px)', overflowY: 'auto' }}>
            {/* Mensagens do conversation aqui */}
            <p style={{ color: '#666', fontSize: 14 }}>{conversation.status === 'connected' ? 'Conectado' : '${greeting}'}</p>
          </div>
        </div>
      )}
    </>
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
          Gere o codigo para incorporar o assistente no site do cliente. 100% white-label.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        {/* Left: Code blocks */}
        <div className="space-y-6">
          {/* Agent Selector */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-4">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Agente</label>
            <div className="relative">
              <button onClick={() => setDropdownOpen(!dropdownOpen)}
                className="flex items-center justify-between w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white hover:bg-gray-50 dark:hover:bg-gray-600">
                <span>{agentName || 'Selecione um agente'}</span>
                <ChevronDown className="w-4 h-4" />
              </button>
              {dropdownOpen && (
                <div className="absolute z-10 mt-1 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg">
                  {agents.map(agent => (
                    <button key={agent.agent_id}
                      onClick={() => { setSelectedAgent(agent); setDropdownOpen(false); }}
                      className={`w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-700 ${
                        selectedAgent?.agent_id === agent.agent_id ? 'bg-blue-50 dark:bg-blue-900/20' : ''
                      }`}>
                      <p className="font-medium text-gray-900 dark:text-white">
                        {agent._configured_label || agent.name || agent.platform_settings?.widget_settings?.name || agent.agent_id}
                      </p>
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
            <div className="space-y-5">
              {/* Script - White label widget completo */}
              <CodeBlock
                title="Widget Completo (Recomendado)"
                description="Botao flutuante + chat popup. Cole antes do </body> no site do cliente."
                code={scriptSnippet}
                copied={copied === 'script'}
                onCopy={() => copyToClipboard(scriptSnippet, 'script')}
              />

              {/* Iframe - Embed direto */}
              <CodeBlock
                title="Embed Inline"
                description="Incorpora o chat diretamente na pagina. Ideal para paginas de contato."
                code={iframeSnippet}
                copied={copied === 'iframe'}
                onCopy={() => copyToClipboard(iframeSnippet, 'iframe')}
              />

              {/* React */}
              <CodeBlock
                title="Componente React"
                description="Para aplicacoes React/Next.js. Widget customizavel."
                code={reactSnippet}
                copied={copied === 'react'}
                onCopy={() => copyToClipboard(reactSnippet, 'react')}
              />
            </div>
          )}
        </div>

        {/* Right: Customization panel */}
        <div className="space-y-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-4 sticky top-4">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2 mb-4">
              <Palette className="w-4 h-4 text-blue-600" />
              Personalizacao
            </h3>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Nome do assistente</label>
                <input type="text" value={brandName} onChange={e => setBrandName(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Mensagem de boas-vindas</label>
                <input type="text" value={greeting} onChange={e => setGreeting(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Cor primaria</label>
                  <div className="flex items-center gap-2">
                    <input type="color" value={primaryColor} onChange={e => setPrimaryColor(e.target.value)}
                      className="w-8 h-8 rounded cursor-pointer border-0 p-0" />
                    <input type="text" value={primaryColor} onChange={e => setPrimaryColor(e.target.value)}
                      className="w-full px-2 py-1 text-xs font-mono border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Cor destaque</label>
                  <div className="flex items-center gap-2">
                    <input type="color" value={accentColor} onChange={e => setAccentColor(e.target.value)}
                      className="w-8 h-8 rounded cursor-pointer border-0 p-0" />
                    <input type="text" value={accentColor} onChange={e => setAccentColor(e.target.value)}
                      className="w-full px-2 py-1 text-xs font-mono border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Posicao</label>
                  <select value={position} onChange={e => setPosition(e.target.value as any)}
                    className="w-full px-2 py-1.5 text-xs border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white">
                    <option value="bottom-right">Inferior direito</option>
                    <option value="bottom-left">Inferior esquerdo</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Tamanho (px)</label>
                  <input type="number" value={size} onChange={e => setSize(e.target.value)} min="40" max="80"
                    className="w-full px-2 py-1.5 text-xs border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
                </div>
              </div>
            </div>

            {/* Preview */}
            <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
              <button onClick={() => setShowPreview(!showPreview)}
                className="flex items-center gap-2 w-full px-3 py-2 text-sm text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/30 transition">
                <Eye className="w-4 h-4" />
                {showPreview ? 'Esconder preview' : 'Ver preview do botao'}
              </button>

              {showPreview && (
                <div className="mt-3 relative bg-gray-100 dark:bg-gray-900 rounded-lg h-40 flex items-end justify-end p-4">
                  <div
                    style={{
                      width: `${size}px`,
                      height: `${size}px`,
                      background: primaryColor,
                      borderRadius: '50%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                      cursor: 'pointer',
                    }}
                  >
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                    </svg>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
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
      <pre className="p-4 text-xs font-mono text-gray-800 dark:text-gray-200 bg-gray-50 dark:bg-gray-900 overflow-x-auto whitespace-pre-wrap">
        {code}
      </pre>
    </div>
  );
}
