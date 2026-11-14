import type { ModelType } from './types';
import type { MessageKey } from '../i18n/messages';

/**
 * Metadata de los datasets de ejemplo pre-empaquetados en la app.
 *
 * Los CSVs viven en `frontend/public/datasets/` y son servidos como
 * assets estáticos por Vite (ruta `/datasets/<filename>`).
 *
 * Los CSVs originales vienen del paquete R `mixOmics` y se regeneran
 * con `scripts/extract_mixomics_datasets.py` (requiere R + mixOmics).
 * Ver `frontend/public/datasets/README.md` para más detalle.
 */

export type ExampleDataset = {
  id: string;
  name: string;
  /**
   * Clave de mensaje para la descripción (ver catálogo i18n).
   *
   * El `name` NO se traduce (son nombres de dataset); la descripción sí.
   */
  descriptionKey: MessageKey;
  /** Archivo principal (matriz numérica). El botón "Cargar" trae este. */
  primaryFile: string;
  /** Otros bloques del mismo dataset (no se cargan automáticamente). */
  additionalFiles?: string[];
  /** Metadata categórica (clase / genotipo / dieta). */
  metaFile?: string;
  /** Modelo que mejor se ajusta al dataset (preseleccionado al cargar). */
  suggestedModel: ModelType;
  /** Dimensiones aproximadas (para mostrar en la card). */
  nSamples: number;
  /** Variables del archivo principal. */
  nFeatures: number;
  /** Columnas categóricas en el metaFile (si existe). */
  metaColumns?: string[];
};

export const EXAMPLE_DATASETS: ExampleDataset[] = [
  {
    id: 'nutrimouse',
    name: 'nutrimouse',
    descriptionKey: 'exampleDataset.nutrimouse.description',
    primaryFile: 'nutrimouse_gene.csv',
    additionalFiles: ['nutrimouse_lipid.csv'],
    metaFile: 'nutrimouse_meta.csv',
    suggestedModel: 'DIABLO',
    nSamples: 40,
    nFeatures: 120,
    metaColumns: ['genotype', 'diet'],
  },
  {
    id: 'srbct',
    name: 'srbct',
    descriptionKey: 'exampleDataset.srbct.description',
    primaryFile: 'srbct_gene.csv',
    metaFile: 'srbct_meta.csv',
    suggestedModel: 'sPLS-DA',
    nSamples: 63,
    nFeatures: 2308,
    metaColumns: ['class'],
  },
  {
    id: 'breast_TCGA',
    name: 'breast.TCGA',
    descriptionKey: 'exampleDataset.breast_TCGA.description',
    primaryFile: 'breast_TCGA_mrna.csv',
    additionalFiles: ['breast_TCGA_mirna.csv', 'breast_TCGA_protein.csv'],
    metaFile: 'breast_TCGA_meta.csv',
    suggestedModel: 'DIABLO',
    nSamples: 150,
    nFeatures: 200,
    metaColumns: ['subtype'],
  },
];

/** Mapeo rápido por id (útil para tests y lookups). */
export const EXAMPLE_DATASETS_BY_ID: Record<string, ExampleDataset> =
  Object.fromEntries(EXAMPLE_DATASETS.map((d) => [d.id, d]));