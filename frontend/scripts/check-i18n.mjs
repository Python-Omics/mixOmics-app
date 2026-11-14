#!/usr/bin/env node
/**
 * Guardián de i18n.
 *
 * Reglas que verifica:
 *
 *   1. NINGÚN texto visible al usuario puede estar hardcodeado en el
 *      renderer. Todo pasa por `t('clave')` y vive en los catálogos.
 *   2. Todo catálogo tiene que tener las mismas claves.
 *   3. Ninguna clave puede quedar sin uso (una traducción muerta no se
 *      mantiene).
 *
 * Corre como parte de `npm run build`, así que un string hardcodeado rompe
 * el build y no llega a producción.
 *
 * Usa el parser de TypeScript (no regex) para detectar texto JSX y atributos:
 * las genéricas como `useState<Step>('load')` no se confundan con JSX.
 *
 * Uso:  node scripts/check-i18n.mjs
 * Salida: 0 si todo ok, 1 si hay hallazgos.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const FRONTEND = dirname(dirname(fileURLToPath(import.meta.url)));
const SRC = join(FRONTEND, 'src');

/**
 * Términos técnicos y nomenclatura científica que NO se traducen
 * (RNF-U-3: la nomenclatura científica va en inglés).
 */
const NOT_TRANSLATABLE = new Set([
  'PCA', 'PLS-DA', 'sPLS-DA', 'DIABLO', 'keepX', 'NIPALS', 'MINT', 'rCCA',
  'mixOmics', 'pythomics', 'Pythomics', 'JSON', 'HTTP', 'HTTPS', 'CSV', 'TSV',
  '.csv', '.tsv', 'UTF-8', 'API', 'LLM', 'BYOK', 'UI',
  'Electron', 'React', 'Vite', 'TypeScript', 'Tailwind', 'FastAPI', 'Bioconductor',
]);

/**
 * Claves que legítimamente no aparecen en el renderer: las usa el script
 * pre-paint (`public/app-init.js`) o el HTML estático.
 */
const CATALOG_ONLY_KEYS = new Set(['app.title', 'app.splashTagline']);

/** Atributos HTML cuyo valor es texto visible al usuario. */
const USER_FACING_ATTRS = new Set(['aria-label', 'placeholder', 'title', 'alt']);

/** Propiedades de objeto cuyo valor es texto visible al usuario. */
const USER_FACING_PROPS = new Set([
  'label', 'description', 'placeholder', 'title', 'hint', 'message',
]);

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (/\.tsx?$/.test(entry) && !entry.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * ¿El texto es traducible?
 *
 * Heurística: el texto visible al usuario tiene palabras en minúscula. Los
 * términos técnicos que no se traducen son mayúsculas o están en la lista.
 */
function isTranslatable(text) {
  const trimmed = text.trim();
  if (!trimmed) return false;
  // Sin letras: puntuación, números, entidades HTML.
  if (!/[a-záéíóúñü]/i.test(trimmed)) return false;
  // Sin una palabra en minúscula de 3+ letras → es un término técnico.
  if (!/[a-záéíóúñü]{3,}/.test(trimmed)) return false;
  // Exactamente un término de la lista.
  if (NOT_TRANSLATABLE.has(trimmed)) return false;
  // Varios términos de la lista separados por espacios o comas.
  const words = trimmed.split(/[\s,;]+/).filter(Boolean);
  if (
    words.length > 0 &&
    words.every((w) => NOT_TRANSLATABLE.has(w.replace(/[.,;:!?()]/g, '')))
  ) {
    return false;
  }
  return true;
}

const findings = [];
const files = walk(SRC);
const allStringLiterals = new Set();

for (const file of files) {
  const rel = relative(FRONTEND, file);
  const text = readFileSync(file, 'utf8');
  const source = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const lineOf = (pos) => source.getLineAndCharacterOfPosition(pos).line + 1;

  const visit = (node) => {
    // --- Texto JSX real ---
    if (ts.isJsxText(node)) {
      const value = node.text.trim();
      if (isTranslatable(value)) {
        findings.push({
          file: rel,
          line: lineOf(node.getStart(source)),
          kind: 'texto JSX',
          text: value,
        });
      }
    }

    // --- Atributos con texto visible ---
    if (ts.isJsxAttribute(node) && node.initializer) {
      const name = ts.isIdentifier(node.name) ? node.name.text : '';
      if (USER_FACING_ATTRS.has(name)) {
        const init = node.initializer;
        if (ts.isStringLiteral(init) && isTranslatable(init.text)) {
          findings.push({
            file: rel,
            line: lineOf(node.getStart(source)),
            kind: `atributo ${name}`,
            text: init.text.trim(),
          });
        }
      }
    }

    // --- Propiedades de objeto con texto visible ---
    if (ts.isPropertyAssignment(node) && node.initializer) {
      const name = node.name.getText(source).replace(/^['"]|['"]$/g, '');
      if (USER_FACING_PROPS.has(name) && ts.isStringLiteral(node.initializer)) {
        const value = node.initializer.text.trim();
        if (isTranslatable(value)) {
          findings.push({
            file: rel,
            line: lineOf(node.getStart(source)),
            kind: `propiedad ${name}`,
            text: value,
          });
        }
      }
    }

    // --- Recolectar literales para el chequeo de claves sin uso ---
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      allStringLiterals.add(node.text);
    }

    ts.forEachChild(node, visit);
  };

  visit(source);
}

// --- Paridad entre catálogos ---
const es = JSON.parse(readFileSync(join(SRC, 'i18n', 'es.json'), 'utf8'));
const en = JSON.parse(readFileSync(join(SRC, 'i18n', 'en.json'), 'utf8'));
const esKeys = Object.keys(es);
const enKeys = Object.keys(en);

for (const key of esKeys) {
  if (!enKeys.includes(key)) {
    findings.push({
      file: 'src/i18n/en.json',
      line: 0,
      kind: 'paridad',
      text: `falta la clave '${key}' en en.json`,
    });
  }
}
for (const key of enKeys) {
  if (!esKeys.includes(key)) {
    findings.push({
      file: 'src/i18n/es.json',
      line: 0,
      kind: 'paridad',
      text: `la clave '${key}' no existe en es.json`,
    });
  }
}

// --- Claves sin uso ---
for (const key of esKeys) {
  if (CATALOG_ONLY_KEYS.has(key)) continue;
  if (!allStringLiterals.has(key)) {
    findings.push({
      file: 'src/i18n/es.json',
      line: 0,
      kind: 'clave sin uso',
      text: `la clave '${key}' no se usa en el renderer`,
    });
  }
}

// --- Reporte ---
console.log(
  `[check:i18n] ${files.length} archivos escaneados en ${relative(FRONTEND, SRC)}`,
);

if (findings.length === 0) {
  console.log(
    `[check:i18n] OK — ${esKeys.length} claves en cada catálogo, ningún texto hardcodeado.`,
  );
  process.exit(0);
}

console.error(`\n[check:i18n] ${findings.length} problema(s):\n`);
for (const f of findings) {
  console.error(`  ${f.file}:${f.line}  [${f.kind}]  ${f.text}`);
}
console.error(
  '\n[check:i18n] Todo texto visible al usuario va en src/i18n/es.json y src/i18n/en.json,',
);
console.error("[check:i18n] y se accede con t('clave') desde useTranslate().\n");
process.exit(1);
