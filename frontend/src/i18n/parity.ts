/**
 * Paridad entre los catálogos.
 *
 * Si `en.json` le falta una clave que `es.json` tiene (o al revés), este
 * archivo no compila. Como el `include` del tsconfig cubre todo `src`, el
 * error aparece en `npm run typecheck` y en `npm run build`, no en runtime.
 *
 * El tipo se exporta para que `noUnusedLocals` no lo marque como variable
 * sin usar: la comprobación real la hace el sistema de tipos.
 */

import es from './es.json';
import en from './en.json';

/** Claves que están en español y faltan en inglés. */
export type MissingInEn = Exclude<keyof typeof es, keyof typeof en>;

/** Claves que están en inglés y sobran en español. */
export type ExtraInEn = Exclude<keyof typeof en, keyof typeof es>;

/**
 * `true` solo si los dos catálogos tienen exactamente las mismas claves.
 * Si no, el tipo es `never` y `true` no le es asignable → error de TS.
 */
export type CatalogsInParity = MissingInEn extends never
  ? ExtraInEn extends never
    ? true
    : never
  : never;

export const CATALOGS_IN_PARITY: CatalogsInParity = true;
