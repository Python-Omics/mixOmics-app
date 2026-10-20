import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_THEME_ID, THEME_BY_ID, type ThemeId } from './themes';

const STORAGE_KEY = 'pythomics.theme';

/**
 * Lee el tema persistido en localStorage.
 * Se llama desde el script anti-FOUC en index.html (como string,
 * duplicado a propósito para no depender del bundle en ese momento).
 */
export function getStoredTheme(): ThemeId {
  if (typeof window === 'undefined') return DEFAULT_THEME_ID;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    // Solo aceptamos ids conocidos (protege contra valores corruptos)
    if (stored && stored in THEME_BY_ID) return stored as ThemeId;
  } catch {
    /* localStorage puede fallar en modo privado */
  }
  return DEFAULT_THEME_ID;
}

export function applyTheme(id: ThemeId): void {
  document.documentElement.setAttribute('data-theme', id);
}

/**
 * Hook para leer/cambiar el tema.
 *
 * El atributo `data-theme` del <html> es la única fuente de verdad: las
 * CSS custom properties en globals.css hacen el resto. Cambiar de tema
 * no dispara re-render de React (no hay estado de React involucrado),
 * pero mantenemos el estado local para que el selector refleje la
 * selección.
 */
export function useTheme() {
  const [theme, setThemeState] = useState<ThemeId>(() => getStoredTheme());

  // Sincroniza el atributo al montar (por si el anti-FOUC no corrió)
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const setTheme = useCallback((id: ThemeId) => {
    applyTheme(id);
    setThemeState(id);
    try {
      window.localStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* si localStorage falla, el tema aplica igual en esta sesión */
    }
  }, []);

  return { theme, setTheme };
}