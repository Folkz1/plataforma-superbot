'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { Locale, translations, Translations, LOCALE_LABELS } from './translations';
import { clientsAPI } from '@/lib/api';

interface I18nContextType {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Translations;
}

const I18nContext = createContext<I18nContextType>({
  locale: 'pt',
  setLocale: () => {},
  t: translations.pt,
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('pt');
  const pathname = usePathname();

  const resolveTenantId = (): string | null => {
    try {
      const userData = localStorage.getItem('user');
      if (!userData) return localStorage.getItem('active_tenant_id');
      const user = JSON.parse(userData);
      return user.role === 'admin'
        ? localStorage.getItem('active_tenant_id')
        : user.client_id;
    } catch {
      return localStorage.getItem('active_tenant_id');
    }
  };

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const tenantId = resolveTenantId();
      const savedKey = tenantId ? `locale:${tenantId}` : 'locale';
      const saved = localStorage.getItem(savedKey) as Locale | null;
      if (saved && translations[saved]) {
        if (!cancelled) setLocaleState(saved);
        return;
      }

      if (!tenantId) return;

      try {
        const res = await clientsAPI.get(tenantId);
        const serverLocale = res?.data?.settings?.locale as Locale | undefined;
        if (serverLocale && translations[serverLocale]) {
          localStorage.setItem(savedKey, serverLocale);
          localStorage.setItem('locale', serverLocale);
          if (!cancelled) setLocaleState(serverLocale);
        }
      } catch {
        // Ignore; fallback to default locale
      }
    };

    run();
    return () => { cancelled = true; };
  }, [pathname]);

  const setLocale = (newLocale: Locale) => {
    setLocaleState(newLocale);
    const tenantId = resolveTenantId();
    const savedKey = tenantId ? `locale:${tenantId}` : 'locale';
    localStorage.setItem(savedKey, newLocale);
    localStorage.setItem('locale', newLocale);
  };

  return (
    <I18nContext.Provider value={{ locale, setLocale, t: translations[locale] }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useTranslation() {
  return useContext(I18nContext);
}

export { LOCALE_LABELS };
export type { Locale };
