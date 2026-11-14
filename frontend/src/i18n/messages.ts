/**
 * Tipos de los mensajes de la aplicación.
 *
 * `es.json` es la fuente de verdad de las claves: si una clave existe ahí,
 * tiene que existir en `en.json` (ver `parity.ts`) y se puede usar en
 * `useTranslate()`.
 */

import es from './es.json';

export type Messages = typeof es;

/**
 * Clave de mensaje válida.
 *
 * El type safety no depende de la tipificación interna de react-intl (que
 * cambia entre versiones mayores): sale del tipo de `es.json`. Un typo como
 * `t('home.cTA')` es un error de TypeScript, y como `npm run build` corre
 * `tsc` antes de Vite, eso es un build roto y no un string undefined en
 * producción.
 */
export type MessageKey = keyof Messages & string;
