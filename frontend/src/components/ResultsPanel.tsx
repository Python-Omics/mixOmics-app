import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../lib/api';
import type { Figure, FigureKind, ModelResult } from '../lib/types';
import { useTranslate } from '../i18n';
import type { MessageKey } from '../i18n/messages';
import { BiomarkersTable } from './BiomarkersTable';

type Props = {
  result: ModelResult;
  jobId: string;
};

/**
 * Etiqueta de cada tipo de figura (S27).
 *
 * El backend manda el `kind` como texto; el renderer lo traduce para que la
 * figura se pueda identificar sin saber la nomenclatura interna.
 */
const FIGURE_KIND_KEYS: Record<FigureKind, MessageKey> = {
  pca: 'results.figureKind.pca',
  biomarkers: 'results.figureKind.biomarkers',
  circos: 'results.figureKind.circos',
  heatmap: 'results.figureKind.heatmap',
  network: 'results.figureKind.network',
};

/**
 * Proporción (ancho/alto) a partir de la cual una figura ocupa la fila
 * completa de la grilla.
 *
 * El backend manda el ancho y el alto de cada PNG en el modelo `Figure`:
 * decidir con esos números evita medir la imagen en el DOM (y esperar a
 * que cargue para saber cuánto ocupa).
 *
 * Una figura apaisada (el loading plot multi-panel, el heatmap de loadings
 * y la red de relevancia) se lee mal en media columna; una cuadrada (el
 * círculo de correlaciones) sí.
 */
const PROPORCION_ANCHA = 1.25;

/**
 * ¿La figura ocupa la fila completa?
 *
 * Sin dimensiones conocidas se asume que sí: el operador se quejó de que
 * las figuras se veían chicas, así que el error por defecto es darlas más
 * espacio (la vista ampliada siempre está disponible).
 */
function esAncha(figura: Figure): boolean {
  if (!figura.width || !figura.height) return true;
  return figura.width / figura.height >= PROPORCION_ANCHA;
}

/**
 * Figura abierta en la vista ampliada.
 *
 * La imagen ya está cargada (viene del mismo `blob:` URL que la miniatura):
 * abrirla en grande no vuelve a pedirla al backend.
 */
type FiguraAmpliada = {
  figura: Figure;
  url: string;
  etiqueta: string;
};

/**
 * Vista ampliada de una figura.
 *
 * Es la solución estándar para figuras científicas: el PNG original tiene
 * más píxeles de los que entran en la grilla, así que se abre en grande.
 *
 * Accesibilidad (RNF-U-1):
 *   - role="dialog" + aria-modal + nombre accesible
 *   - Escape cierra, el backdrop cierra, y el foco vuelve al disparador
 *   - el foco entra al diálogo (botón de cerrar) y no sale de él
 */
function FigureLightbox({
  abierta,
  onClose,
}: {
  abierta: FiguraAmpliada | null;
  onClose: () => void;
}) {
  const cerrarRef = useRef<HTMLButtonElement>(null);
  const t = useTranslate();

  useEffect(() => {
    if (!abierta) return;

    const onKey = (evento: KeyboardEvent) => {
      if (evento.key === 'Escape') {
        evento.stopPropagation();
        onClose();
        return;
      }
      // El diálogo tiene un solo control: el foco no sale de él. El
      // trampa vive en el documento (y no en el div) porque al hacer
      // click en la imagen el foco se va al <body>.
      if (evento.key === 'Tab') {
        evento.preventDefault();
        cerrarRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);

    // El foco entra en el diálogo: sin esto, el teclado sigue en el
    // disparador que quedó detrás del overlay.
    cerrarRef.current?.focus();

    return () => document.removeEventListener('keydown', onKey);
  }, [abierta, onClose]);

  if (!abierta) return null;

  /*
   * El overlay se monta en el `body`: dentro del panel de resultados
   * heredaría el `space-y` del contenedor (un margen que lo baja 16 px) y
   * quedaría recortado por el `overflow` de <main>.
   */
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-label={t('results.figureDialog', { kind: abierta.etiqueta })}
    >
      {/*
        Backdrop clickeable. El contenedor NO lleva padding: el padding
        delimitaría el fondo y el click fuera de la imagen dejaría de
        cerrar. El margen va en el panel.
      */}
      <div
        className="absolute inset-0 bg-slate-900/70"
        onClick={onClose}
        aria-hidden="true"
      />

      {/*
        El panel se ajusta al contenido (`w-fit`): si estirara el ancho
        taparía el fondo, y el click fuera de la imagen dejaría de cerrar.
      */}
      <div className="relative m-4 flex w-fit max-w-[92vw] flex-col items-center gap-3">
        <div className="flex w-full items-center justify-between gap-3">
          <p className="text-sm font-medium text-white">
            {abierta.etiqueta}
          </p>
          <button
            ref={cerrarRef}
            type="button"
            onClick={onClose}
            className="btn-secondary"
            aria-label={t('results.figureClose')}
          >
            {t('results.figureClose')}
          </button>
        </div>
        <img
          src={abierta.url}
          alt={t('results.figureAlt', { kind: abierta.etiqueta })}
          className="max-h-[75vh] w-auto max-w-full rounded border border-slate-200 bg-white object-contain"
        />
      </div>
    </div>,
    document.body,
  );
}

/**
 * Figura del análisis.
 *
 * La figura es binaria: viaja por el canal `api:file` como base64 y el
 * renderer arma un `blob:` URL (S27). El renderer nunca accede al puerto del
 * backend.
 *
 * La miniatura es un botón: al activarlo se abre la vista ampliada de la
 * misma imagen.
 */
function FigureImage({
  jobId,
  figure,
  onOpen,
}: {
  jobId: string;
  figure: Figure;
  onOpen: (ampliada: FiguraAmpliada, disparador: HTMLButtonElement) => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [fallo, setFallo] = useState(false);
  const t = useTranslate();
  // Guarda la URL creada para poder revocarla al desmontar.
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    let vivo = true;

    void (async () => {
      const res = await api.getFigure(jobId, figure.name);
      if (!vivo) return;
      if (!res.ok || !res.data) {
        setFallo(true);
        return;
      }
      const binario = atob(res.data.dataBase64);
      const bytes = new Uint8Array(binario.length);
      for (let i = 0; i < binario.length; i += 1) {
        bytes[i] = binario.charCodeAt(i);
      }
      const creada = URL.createObjectURL(
        new Blob([bytes], { type: res.data.mime }),
      );
      urlRef.current = creada;
      setUrl(creada);
    })();

    return () => {
      vivo = false;
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      }
    };
  }, [jobId, figure.name]);

  const clave = FIGURE_KIND_KEYS[figure.kind as FigureKind];
  const etiqueta = clave ? t(clave) : figure.kind;
  const dimensiones =
    figure.width && figure.height
      ? t('results.figureDimensions', {
          width: figure.width,
          height: figure.height,
        })
      : null;

  return (
    <figure className="space-y-2">
      {url ? (
        <button
          type="button"
          onClick={(evento) =>
            onOpen({ figura: figure, url, etiqueta }, evento.currentTarget)
          }
          aria-label={t('results.figureExpand', { kind: etiqueta })}
          className="block w-full rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-pharma-500"
        >
          <img
            src={url}
            alt={t('results.figureAlt', { kind: etiqueta })}
            className="h-auto max-w-full w-full rounded border border-slate-200"
          />
        </button>
      ) : !fallo ? (
        <p className="text-sm text-slate-500">{t('results.figureLoading')}</p>
      ) : (
        <p className="text-sm text-red-700">{t('results.figureError')}</p>
      )}
      <figcaption className="flex items-baseline justify-between gap-3 text-xs text-slate-500">
        <span>{etiqueta}</span>
        {dimensiones && (
          <span className="font-mono text-slate-400">{dimensiones}</span>
        )}
      </figcaption>
    </figure>
  );
}

/**
 * Panel de resultados del análisis.
 *
 * Consume el `ModelResult` real del backend (`backend/app/schemas.py`): no
 * adivina la forma del resultado. Muestra las figuras (por el canal de
 * figuras), la varianza explicada, los biomarcadores, las correlaciones
 * entre bloques y la trazabilidad del análisis (RB-7).
 */
export function ResultsPanel({ result, jobId }: Props) {
  const t = useTranslate();

  /** Figura abierta en la vista ampliada (null = cerrada). */
  const [ampliada, setAmpliada] = useState<FiguraAmpliada | null>(null);
  /** Disparador que abrió la vista: el foco vuelve ahí al cerrar. */
  const disparadorRef = useRef<HTMLButtonElement | null>(null);

  const abrirAmpliada = useCallback(
    (figura: FiguraAmpliada, disparador: HTMLButtonElement) => {
      disparadorRef.current = disparador;
      setAmpliada(figura);
    },
    [],
  );

  const cerrarAmpliada = useCallback(() => {
    setAmpliada(null);
    // El foco vuelve al disparador: el teclado no se pierde en el overlay.
    disparadorRef.current?.focus();
  }, []);

  return (
    <div className="space-y-4">
      {result.figures.length > 0 && (
        <section
          className="card p-6 space-y-3"
          aria-labelledby="results-figures-title"
        >
          <h3
            id="results-figures-title"
            className="text-sm font-semibold text-pharma-700"
          >
            {t('results.figuresTitle')}
          </h3>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {result.figures.map((figura) => (
              <div
                key={`${figura.name}-${figura.kind}`}
                className={esAncha(figura) ? 'lg:col-span-2' : undefined}
              >
                <FigureImage
                  jobId={jobId}
                  figure={figura}
                  onOpen={abrirAmpliada}
                />
              </div>
            ))}
          </div>
        </section>
      )}

      {result.explained_variance_ratio &&
        result.explained_variance_ratio.length > 0 && (
          <section
            className="card p-6 space-y-2"
            aria-labelledby="results-variance-title"
          >
            <h3
              id="results-variance-title"
              className="text-sm font-semibold text-pharma-700"
            >
              {t('results.varianceTitle')}
            </h3>
            <ul className="text-sm text-slate-700 space-y-1">
              {result.explained_variance_ratio.map((valor, indice) => (
                <li key={indice} className="flex gap-3">
                  <span className="text-slate-500">
                    {t('biomarkers.component', { component: indice + 1 })}
                  </span>
                  <span className="font-mono">{valor.toFixed(4)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

      {result.biomarkers.length > 0 && (
        <BiomarkersTable biomarkers={result.biomarkers} />
      )}

      <section
        className="card p-6 space-y-2"
        aria-labelledby="results-provenance-title"
      >
        <h3
          id="results-provenance-title"
          className="text-sm font-semibold text-pharma-700"
        >
          {t('results.provenanceTitle')}
        </h3>
        <dl className="text-sm text-slate-700 space-y-1">
          <div className="flex gap-3">
            <dt className="text-slate-500">{t('results.provenanceSeed')}</dt>
            <dd className="font-mono">{result.provenance.seed}</dd>
          </div>
          <div className="flex gap-3">
            <dt className="text-slate-500">
              {t('results.provenanceVersions')}
            </dt>
            <dd className="font-mono">
              pythomics {result.provenance.pythomics_version}
              {result.provenance.r_version
                ? ` · R ${result.provenance.r_version}`
                : ''}
              {result.provenance.mixomics_version
                ? ` · mixOmics ${result.provenance.mixomics_version}`
                : ''}
            </dd>
          </div>
          {result.provenance.data_files.length > 0 && (
            <div className="flex gap-3">
              <dt className="text-slate-500">
                {t('results.provenanceFiles')}
              </dt>
              <dd className="font-mono">
                {result.provenance.data_files
                  .map((archivo) => archivo.name)
                  .join(', ')}
              </dd>
            </div>
          )}
        </dl>
      </section>

      <FigureLightbox abierta={ampliada} onClose={cerrarAmpliada} />
    </div>
  );
}
