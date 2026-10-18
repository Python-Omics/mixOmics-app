import type { Biomarker } from '../lib/types';
import { BiomarkersTable } from './BiomarkersTable';

type Props = {
  result: unknown;
};

/**
 * Intenta extraer una lista de biomarcadores de la forma esperada
 * (clave "biomarkers" o "top_variables" con array de objetos).
 * Si no la encuentra, devuelve array vacío.
 */
function extractBiomarkers(result: unknown): Biomarker[] {
  if (!result || typeof result !== 'object') return [];
  const r = result as Record<string, unknown>;

  const list = (r.biomarkers ?? r.top_variables ?? r.variables) as unknown;
  if (!Array.isArray(list)) return [];

  return list
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    .map((item) => ({
      variable_id: String(item.variable_id ?? item.id ?? item.name ?? ''),
      loading: Number(item.loading ?? item.value ?? 0),
      stability: item.stability !== undefined ? Number(item.stability) : undefined,
      component: Number(item.component ?? item.comp ?? 1),
    }))
    .filter((b) => b.variable_id.length > 0);
}

/**
 * Panel principal de resultados.
 *
 * En esta POC el backend devuelve null (los endpoints están como placeholder),
 * así que mostramos una vista del JSON crudo y, si aparecen biomarcadores,
 * una tabla. Cuando se implemente el backend, este componente queda igual.
 */
export function ResultsPanel({ result }: Props) {
  const biomarkers = extractBiomarkers(result);
  const hasResult = result !== null && result !== undefined;

  if (!hasResult) {
    return (
      <div className="card p-6 border-amber-200 bg-amber-50">
        <h3 className="text-sm font-semibold text-amber-900">
          Sin resultados todavía
        </h3>
        <p className="text-sm text-amber-800 mt-1">
          El endpoint <code className="font-mono">/v1/model/</code> del backend
          está pendiente de implementar. Cuando devuelva un objeto con la clave
          <code className="font-mono"> biomarkers</code> (array de variables con
          loading, componente y estabilidad), este panel mostrará la tabla
          correspondiente.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {biomarkers.length > 0 && <BiomarkersTable biomarkers={biomarkers} />}

      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-pharma-200 bg-pharma-50 flex justify-between items-center">
          <h3 className="text-sm font-semibold text-pharma-700">
            Resultado crudo
          </h3>
          <span className="text-xs text-pharma-500 font-mono">JSON</span>
        </div>
        <pre className="p-4 text-xs font-mono overflow-auto max-h-96 bg-pharma-50 text-slate-800">
          {JSON.stringify(result, null, 2)}
        </pre>
      </div>
    </div>
  );
}