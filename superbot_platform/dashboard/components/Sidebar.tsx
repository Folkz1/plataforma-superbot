'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import {
  BarChart3, MessageCircle, Bot, Phone, BookOpen, Settings,
  LogOut, Menu, ArrowLeftRight, X, Globe
} from 'lucide-react';
import { useTranslation, LOCALE_LABELS, type Locale } from '@/lib/i18n';

export default function Sidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const { t, locale, setLocale } = useTranslation();
  const [user, setUser] = useState<any>(null);
  const [tenantName, setTenantName] = useState('');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [langOpen, setLangOpen] = useState(false);

  const navItems = [
    { label: t.nav_dashboard, href: '/dash', icon: <BarChart3 className="w-5 h-5" /> },
    { label: t.nav_conversations, href: '/dash/conversations', icon: <MessageCircle className="w-5 h-5" /> },
    { label: t.nav_calls, href: '/dash/calls', icon: <Phone className="w-5 h-5" /> },
    { label: t.nav_agents, href: '/dash/agents', icon: <Bot className="w-5 h-5" />, adminOnly: true },
    { label: t.nav_rag, href: '/dash/rag', icon: <BookOpen className="w-5 h-5" />, adminOnly: true },
    { label: t.nav_config, href: '/dash/config', icon: <Settings className="w-5 h-5" />, adminOnly: true },
  ];

  useEffect(() => {
    const userData = localStorage.getItem('user');
    if (userData) setUser(JSON.parse(userData));
    setTenantName(localStorage.getItem('active_tenant_name') || '');
  }, []);

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('active_tenant_id');
    localStorage.removeItem('active_tenant_name');
    router.push('/login');
  };

  const handleSwitchClient = () => {
    router.push('/admin');
  };

  const isActive = (href: string) => {
    if (href === '/dash') return pathname === '/dash';
    return pathname.startsWith(href);
  };

  const sidebarContent = (
    <div className="flex flex-col h-full bg-gray-900 text-white">
      {/* Logo */}
      <div className="p-5 border-b border-gray-800">
        <div className="flex items-center gap-3">
          <img src="/logo-superbot.webp" alt="SuperBot" className="h-8 w-auto opacity-90" />
        </div>
      </div>

      {/* Tenant Badge */}
      {tenantName && (
        <div className="px-4 py-3 border-b border-gray-800">
          <div className="flex items-center gap-2 px-3 py-2 bg-gray-800 rounded-lg">
            <div className="w-2 h-2 bg-green-400 rounded-full"></div>
            <span className="text-sm font-medium text-gray-200 truncate">{tenantName}</span>
          </div>
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {navItems.filter(item => !item.adminOnly || user?.role === 'admin').map((item) => {
          const active = isActive(item.href);
          return (
            <button
              key={item.href}
              onClick={() => { router.push(item.href); setMobileOpen(false); }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                active
                  ? 'bg-blue-600/20 text-blue-400 border-l-2 border-blue-400 pl-[10px]'
                  : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
              }`}
            >
              {item.icon}
              {item.label}
            </button>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="border-t border-gray-800 p-4 space-y-2">
        {user?.role === 'admin' && (
          <button
            onClick={handleSwitchClient}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-gray-400 hover:bg-gray-800 hover:text-gray-200 transition"
          >
            <ArrowLeftRight className="w-4 h-4" />
            {t.nav_switch_client}
          </button>
        )}
        {user?.role === 'admin' && (
          <div className="relative">
            <button
              onClick={() => setLangOpen(!langOpen)}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-gray-400 hover:bg-gray-800 hover:text-gray-200 transition"
            >
              <Globe className="w-4 h-4" />
              {LOCALE_LABELS[locale]}
            </button>
            {langOpen && (
              <div className="absolute bottom-full left-0 w-full mb-1 bg-gray-800 rounded-lg shadow-lg border border-gray-700 overflow-hidden">
                {(Object.keys(LOCALE_LABELS) as Locale[]).map((loc) => (
                  <button
                    key={loc}
                    onClick={() => { setLocale(loc); setLangOpen(false); }}
                    className={`w-full text-left px-4 py-2 text-sm transition ${
                      locale === loc
                        ? 'bg-blue-600/20 text-blue-400'
                        : 'text-gray-300 hover:bg-gray-700'
                    }`}
                  >
                    {LOCALE_LABELS[loc]}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="flex items-center gap-3 px-3 py-2">
          <div className="w-8 h-8 bg-gray-700 rounded-full flex items-center justify-center text-sm font-medium text-gray-300">
            {(user?.name || user?.email || 'U')[0].toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-200 truncate">{user?.name || user?.email}</p>
            <p className="text-xs text-gray-500 capitalize">{user?.role}</p>
          </div>
          <button
            onClick={handleLogout}
            className="p-1.5 hover:bg-gray-800 rounded-lg transition"
            title={t.nav_logout}
          >
            <LogOut className="w-4 h-4 text-gray-500" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:fixed lg:inset-y-0 z-30">
        {sidebarContent}
      </aside>

      {/* Mobile Toggle */}
      <button
        onClick={() => setMobileOpen(true)}
        className="lg:hidden fixed top-4 left-4 z-40 p-2 bg-gray-900 text-white rounded-lg shadow-lg"
      >
        <Menu className="w-5 h-5" />
      </button>

      {/* Mobile Overlay */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="w-64 flex-shrink-0">
            {sidebarContent}
          </div>
          <div
            className="flex-1 bg-black/50"
            onClick={() => setMobileOpen(false)}
          >
            <button className="absolute top-4 right-4 p-2 text-white">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
