'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Settings, Activity, BarChart3, Users, MessageSquare, Clock } from 'lucide-react';
import { clientsAPI } from '@/lib/api';
import { LOCALE_LABELS, useTranslation, type Locale } from '@/lib/i18n';

export default function ConfigIndexPage() {
  const router = useRouter();
  const { t, locale, setLocale } = useTranslation();

  const [tenantId, setTenantId] = useState<string>('');
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [savingLang, setSavingLang] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    try {
      const userData = localStorage.getItem('user');
      if (!userData) return;
      const user = JSON.parse(userData);
      setIsAdmin(user.role === 'admin');
      const tId = user.role === 'admin' ? localStorage.getItem('active_tenant_id') : user.client_id;
      if (tId) setTenantId(tId);
    } catch {
      // ignore
    }
  }, []);

  const saveDashboardLanguage = async (newLocale: Locale) => {
    if (!tenantId) return;
    setSavingLang(true);
    setMessage(null);
    try {
      const clientRes = await clientsAPI.get(tenantId);
      const currentSettings = clientRes.data?.settings || {};
      await clientsAPI.update(tenantId, {
        settings: {
          ...currentSettings,
          locale: newLocale,
        },
      });

      // Update current session language immediately.
      setLocale(newLocale);
      setMessage({ type: 'success', text: 'Language updated' });
    } catch (err: any) {
      setMessage({ type: 'error', text: err?.response?.data?.detail || t.common_error });
    } finally {
      setSavingLang(false);
    }
  };

  const configSections = [
    {
      title: t.config_meta_title,
      description: t.config_meta_desc,
      icon: Settings,
      href: '/dash/config/meta',
      bgColor: 'bg-blue-100',
      textColor: 'text-blue-600',
    },
    {
      title: t.config_status_title,
      description: t.config_status_desc,
      icon: Activity,
      href: '/dash/config/status',
      bgColor: 'bg-green-100',
      textColor: 'text-green-600',
    },
    {
      title: 'Follow-up',
      description: 'Templates and rules for automated follow-ups',
      icon: Clock,
      href: '/dash/config/followup',
      bgColor: 'bg-amber-100',
      textColor: 'text-amber-600',
    },
  ];

  const quickLinks = [
    {
      title: 'Analytics',
      description: 'Dashboard & analytics',
      icon: BarChart3,
      href: '/dash',
      bgColor: 'bg-purple-100',
      textColor: 'text-purple-600',
    },
    {
      title: t.nav_conversations,
      description: 'View conversations',
      icon: MessageSquare,
      href: '/dash/conversations',
      bgColor: 'bg-blue-100',
      textColor: 'text-blue-600',
    },
    {
      title: 'ElevenLabs Agents',
      description: 'Manage voice agents',
      icon: Users,
      href: '/dash/agents',
      bgColor: 'bg-pink-100',
      textColor: 'text-pink-600',
    },
  ];

  return (
    <div className="p-6 lg:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{t.config_title}</h1>
        <p className="text-sm text-gray-500 mt-1">Manage connections and settings</p>
      </div>

      {message && (
        <div
          className={`mb-6 rounded-lg border p-3 text-sm ${
            message.type === 'success'
              ? 'bg-green-50 border-green-200 text-green-700'
              : 'bg-red-50 border-red-200 text-red-700'
          }`}
        >
          {message.text}
        </div>
      )}

      {isAdmin && (
        <div className="mb-8 bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">{t.common_language}</h2>
              <p className="text-sm text-gray-500 mt-1">Default dashboard language for this client</p>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={locale}
                onChange={(e) => saveDashboardLanguage(e.target.value as Locale)}
                disabled={savingLang || !tenantId}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 bg-white disabled:opacity-60"
              >
                {(Object.keys(LOCALE_LABELS) as Locale[]).map((loc) => (
                  <option key={loc} value={loc}>
                    {LOCALE_LABELS[loc]}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Config Sections */}
      <div className="mb-12">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">{t.config_title}</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {configSections.map((section) => {
            const Icon = section.icon;
            return (
              <button
                key={section.href}
                onClick={() => router.push(section.href)}
                className="bg-white rounded-lg shadow p-6 hover:shadow-lg transition text-left"
              >
                <div className={`w-12 h-12 rounded-lg ${section.bgColor} flex items-center justify-center mb-4`}>
                  <Icon className={`w-6 h-6 ${section.textColor}`} />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">{section.title}</h3>
                <p className="text-sm text-gray-600">{section.description}</p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Quick Links */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Quick Access</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {quickLinks.map((link) => {
            const Icon = link.icon;
            return (
              <button
                key={link.href}
                onClick={() => router.push(link.href)}
                className="bg-white rounded-lg shadow p-6 hover:shadow-lg transition text-left"
              >
                <div className={`w-10 h-10 rounded-lg ${link.bgColor} flex items-center justify-center mb-3`}>
                  <Icon className={`w-5 h-5 ${link.textColor}`} />
                </div>
                <h3 className="font-semibold text-gray-900 mb-1">{link.title}</h3>
                <p className="text-xs text-gray-600">{link.description}</p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Info Box */}
      <div className="mt-12 bg-blue-50 border border-blue-200 rounded-lg p-6">
        <h3 className="font-semibold text-blue-900 mb-2">Documentation</h3>
        <p className="text-sm text-blue-800 mb-3">For more information, see:</p>
        <code className="text-xs text-blue-900 bg-blue-100 px-2 py-1 rounded">
          superbot_configuracoes/GUIA_CONEXAO_NOVOS_CLIENTES.md
        </code>
      </div>
    </div>
  );
}
