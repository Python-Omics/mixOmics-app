import { useEffect, useRef, type ReactNode } from 'react';
import { useIntl } from 'react-intl';
import { useTranslate } from '../i18n';
import type { MessageKey } from '../i18n/messages';
import { CloseIcon, ExternalLinkIcon } from './icons';

type Props = {
  open: boolean;
  onClose: () => void;
  onOpenExampleDatasets?: () => void;
};

/**
 * Función de fragmento de react-intl: recibe las partes del mensaje que
 * caen dentro de una etiqueta (`<code>`, `<emphasis>`) y devuelve el nodo.
 */
type Chunks = (chunks: string[]) => ReactNode;

/**
 * Modal de tutorial — explica al biólogo qué es Pythomics y cómo usar
 * el flujo de 3 pasos. Aparece arriba a la derecha con el botón "Tutorial".
 *
 * Accesibilidad: role="dialog", aria-modal, cierre con Escape, foco
 * inicial en el botón de cerrar.
 */
export function TutorialModal({ open, onClose, onOpenExampleDatasets }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const t = useTranslate();
  const intl = useIntl();

  /**
   * Traduce un mensaje con marcado en línea.
   *
   * `useTranslate()` solo admite valores primitivos, así que los párrafos
   * con marcado usan `intl.formatMessage` con funciones de fragmento. El
   * tipo de la clave se sigue validando contra el catálogo.
   */
  const rich = (id: MessageKey, values: Record<string, Chunks>) =>
    intl.formatMessage({ id }, values);

  /** Términos técnicos en monoespaciada (mixOmics, .csv, PCA…). */
  const code: Chunks = (chunks) => (
    <code className="font-mono text-pharma-700">{chunks}</code>
  );

  /** Énfasis del texto (la parte en negrita del mensaje). */
  const emphasis: Chunks = (chunks) => <strong>{chunks}</strong>;

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
            {t('tutorial.title')}
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="btn-ghost text-slate-500 hover:text-slate-700"
            aria-label={t('tutorial.closeLabel')}
          >
            <CloseIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-5 text-sm text-slate-700 max-h-[70vh] overflow-y-auto pr-1">
          {/* ¿Qué es esto? */}
          <section>
            <h3 className="text-sm font-semibold text-pharma-700 mb-1.5">
              {t('tutorial.whatIsThis')}
            </h3>
            <p>{rich('tutorial.whatIsThisBody', { code, emphasis })}</p>
            <p className="text-xs text-slate-500 mt-1.5">
              {t('tutorial.localNote')}
            </p>
          </section>

          {/* ¿Cómo usar? */}
          <section>
            <h3 className="text-sm font-semibold text-pharma-700 mb-1.5">
              {t('tutorial.howTo')}
            </h3>
            <ol className="space-y-2 pl-5 list-decimal marker:text-pharma-500 marker:font-semibold">
              <li>{rich('tutorial.step1', { code, emphasis })}</li>
              <li>{rich('tutorial.step2', { code, emphasis })}</li>
              <li>{rich('tutorial.step3', { code, emphasis })}</li>
            </ol>
          </section>

          {/* ¿Por dónde empezar? */}
          {onOpenExampleDatasets && (
            <section>
              <h3 className="text-sm font-semibold text-pharma-700 mb-1.5">
                {t('tutorial.whereToStart')}
              </h3>
              <p className="mb-3">
                {rich('tutorial.whereToStartBody', { code })}
              </p>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenExampleDatasets();
                }}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-pharma-50 text-pharma-700 border border-pharma-200 hover:bg-pharma-100 hover:border-pharma-400 transition-colors text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pharma-500"
                aria-label={t('tutorial.tryDatasetsLabel')}
              >
                <span>{t('tutorial.tryDatasets')}</span>
                <span aria-hidden="true">→</span>
              </button>
            </section>
          )}

          {/* Más información */}
          <section>
            <h3 className="text-sm font-semibold text-pharma-700 mb-1.5">
              {t('tutorial.moreInfo')}
            </h3>
            <p className="mb-3">{rich('tutorial.moreInfoBody', { code })}</p>
            <a
              href="https://mixomics.org/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-pharma-50 text-pharma-700 border border-pharma-200 hover:bg-pharma-100 hover:border-pharma-400 transition-colors text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pharma-500"
            >
              <span>{t('tutorial.docsLink')}</span>
              <ExternalLinkIcon className="w-4 h-4" />
            </a>
          </section>
        </div>

        <div className="mt-6 pt-4 border-t border-spa-200 flex justify-end">
          <button type="button" onClick={onClose} className="btn-secondary">
            {t('tutorial.close')}
          </button>
        </div>
      </div>
    </div>
  );
}
