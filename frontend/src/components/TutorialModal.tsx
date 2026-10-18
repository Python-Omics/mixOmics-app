import { useEffect, useRef } from 'react';
import { CloseIcon, ExternalLinkIcon } from './icons';

type Props = {
  open: boolean;
  onClose: () => void;
};

/**
 * Modal de tutorial — explica al biólogo qué es Pythomics y cómo usar
 * el flujo de 3 pasos. Aparece arriba a la derecha con el botón "Tutorial".
 *
 * Accesibilidad: role="dialog", aria-modal, cierre con Escape, foco
 * inicial en el botón de cerrar.
 */
export function TutorialModal({ open, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    closeRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tutorial-title"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-slate-900/50"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Card */}
      <div className="relative card w-full max-w-lg p-6 bg-white shadow-xl">
        <div className="flex items-start justify-between mb-4">
          <h2
            id="tutorial-title"
            className="text-lg font-semibold text-pharma-700"
          >
            Tutorial
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="btn-ghost text-slate-500 hover:text-slate-700"
            aria-label="Cerrar tutorial"
          >
            <CloseIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-5 text-sm text-slate-700 max-h-[70vh] overflow-y-auto pr-1">
          {/* ¿Qué es esto? */}
          <section>
            <h3 className="text-sm font-semibold text-pharma-700 mb-1.5">
              ¿Qué es esto?
            </h3>
            <p>
              Pythomics es una aplicación de escritorio para hacer pipelines
              de integración multi-ómica <strong>sin necesidad de escribir
              código</strong>. Es un port a Python de la librería{' '}
              <code className="font-mono text-pharma-700">mixOmics</code> de R
              (Bioconductor), preservando la misma precisión numérica y los
              mismos algoritmos.
            </p>
            <p className="text-xs text-slate-500 mt-1.5">
              El cálculo estadístico corre 100% de forma local. En futuras
              versiones, bajo consentimiento explícito, se podrán
              consultar APIs biológicas públicas (UniProt, MyGene) para
              anotar biomarcadores y servicios de LLM para asistir el
              análisis preliminar. En esos casos solo se envían
              identificadores genéricos (nombres de genes, proteínas,
              metabolitos) y métricas agregadas, pero nunca valores de las
              muestras ni información concreta del estudio.
            </p>
          </section>

          {/* ¿Cómo usar? */}
          <section>
            <h3 className="text-sm font-semibold text-pharma-700 mb-1.5">
              ¿Cómo usar?
            </h3>
            <ol className="space-y-2 pl-5 list-decimal marker:text-pharma-500 marker:font-semibold">
              <li>
                <strong>Carga tus datos.</strong> Sube uno o más archivos{' '}
                <code className="font-mono text-pharma-700">.csv</code> o{' '}
                <code className="font-mono text-pharma-700">.tsv</code> con
                tus matrices (expresión génica, proteómica, metabolómica o
                variables clínicas). Las filas son muestras y las columnas
                son variables.
              </li>
              <li>
                <strong>Configura el modelo.</strong> Elige el tipo de
                análisis (<code className="font-mono text-pharma-700">PCA</code>,{' '}
                <code className="font-mono text-pharma-700">sPLS-DA</code>,{' '}
                <code className="font-mono text-pharma-700">DIABLO</code>, …)
                y los parámetros principales (número de componentes,
                <code className="font-mono text-pharma-700"> keepX</code>).
              </li>
              <li>
                <strong>Visualiza los resultados.</strong> Obten gráficos y
                una tabla de biomarcadores seleccionados. Exporta figuras y
                reportes para tus publicaciones.
              </li>
            </ol>
          </section>

          {/* Más información */}
          <section>
            <h3 className="text-sm font-semibold text-pharma-700 mb-1.5">
              Más información
            </h3>
            <p className="mb-3">
              Para conocer en detalle los modelos estadísticos, sus
              parámetros y supuestos, así como las distintas visualizaciones,  puedes consultar la documentación oficial de
              la librería <code className="font-mono text-pharma-700">mixOmics</code>:
            </p>
            <a
              href="https://mixomics.org/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-pharma-50 text-pharma-700 border border-pharma-200 hover:bg-pharma-100 hover:border-pharma-400 transition-colors text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pharma-500"
            >
              <span>Documentación oficial de mixOmics</span>
              <ExternalLinkIcon className="w-4 h-4" />
            </a>
          </section>
        </div>

        <div className="mt-6 pt-4 border-t border-spa-200 flex justify-end">
          <button type="button" onClick={onClose} className="btn-secondary">
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
