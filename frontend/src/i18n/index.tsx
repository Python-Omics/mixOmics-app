/**
 * Internacionalización de la UI.
 *
 * Español por defecto (RNF-U-3: la UI operativa se diseña en español) e
 * inglés como opción. La terminología científica (PCA, sPLS-DA, DIABLO,
 * keepX, mixOmics, nombres de genes y lípidos) NO se traduce.
 *
 * La preferencia se persiste en `localStorage['pythomics.locale']`, con el
 * mismo patrón defensivo que usa el tema (`pythomics.theme`).
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { IntlProvider, useIntl, type PrimitiveType } from 'react-intl';
import es from './es.json';
import type { MessageKey, Messages } from './messages';
import './parity'; // side-effect: la paridad de catálogos es un error de build

export type Lang = 'es' | 'en';

export const LANGS: Lang[] = ['es', 'en'];

/** Nombre del idioma en su propia lengua (como corresponde). */
export const LANG_LABELS: Record<Lang, string> = {
  es: 'Español',
  en: 'English',
};

export const DEFAULT_LANG: Lang = 'es';

const STORAGE_KEY = 'pythomics.locale';

/**
 * `es` entra en el bundle inicial (es el default); `en` se carga con
 * `import()` dinámico solo cuando se necesita.
 */
const LOADERS: Record<Lang, () => Promise<Messages>> = {
  es: () => Promise.resolve(es as Messages),
  en: () => import('./en.json').then((m) => m.default as Messages),
};

function readStoredLang(): Lang | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'es' || value === 'en' ? value : null;
  } catch {
    // localStorage bloqueado (modo privado): se usa el default.
    return null;
  }
}

type I18nContextValue = {
  lang: Lang;
  setLang: (lang: Lang) => void;
};

const I18nContext = createContext<I18nContextValue | null>(null);

/**
 * Idioma activo y forma de cambiarlo.
 * Lanza si se usa fuera del provider (error de desarrollo, no de runtime).
 */
export function useLang(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error('useLang() debe usarse dentro de <I18nProvider>');
  }
  return ctx;
}

/**
 * Traduce una clave. Las claves inválidas son un error de TypeScript.
 *
 *   const t = useTranslate();
 *   t('home.cta')
 *   t('load.filesCount', { count: n })
 */
export function useTranslate() {
  const intl = useIntl();
  return useCallback(
    (key: MessageKey, values?: Record<string, PrimitiveType>) =>
      intl.formatMessage({ id: key }, values),
    [intl],
  );
}

/**
 * Firma de `useTranslate()`, para poder pasar `t` como argumento.
 *
 * Se deriva de la función real, así que no puede quedar desfasada del
 * contrato que efectivamente usa la app.
 */
export type Translate = ReturnType<typeof useTranslate>;

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(
    () => readStoredLang() ?? DEFAULT_LANG,
  );
  const [messages, setMessages] = useState<Messages>(es as Messages);

  // Carga el catálogo del idioma activo.
  useEffect(() => {
    let alive = true;
    void LOADERS[lang]().then((loaded) => {
      if (alive) setMessages(loaded);
    });
    return () => {
      alive = false;
    };
  }, [lang]);

  // Refleja el idioma en el documento: <html lang> es lo que lee el lector
  // de pantalla para decidir la pronunciación.
  useEffect(() => {
    document.documentElement.setAttribute('lang', lang);
    document.documentElement.setAttribute('data-locale', lang);
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // localStorage bloqueado (modo privado): el cambio funciona en la
      // sesión actual pero no se persiste.
    }
  }, []);

  const context = useMemo(() => ({ lang, setLang }), [lang, setLang]);

  return (
    <I18nContext.Provider value={context}>
      <IntlProvider
        locale={lang}
        defaultLocale={DEFAULT_LANG}
        messages={messages}
        onError={(error) => {
          // Una clave faltante debe verse en desarrollo, no tragarse.
          if (error.code === 'MISSING_TRANSLATION') {
            console.error('[i18n] clave faltante:', error.message);
          }
        }}
      >
        {children}
      </IntlProvider>
    </I18nContext.Provider>
  );
}
