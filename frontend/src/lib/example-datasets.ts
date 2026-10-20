import type { ModelType } from './types';

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
  description: string;
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
    description:
      '40 ratones con expresión génica + lipidómica. Clasificados por genotipo (Wild-type / PPARα) y dieta (Cocoa butter / Sunflower oil).',
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
    description:
      '63 tumores pediátricos (Small Round Blue Cell Tumors): 4 clases (Ewing sarcoma, neuroblastoma,etc.) con 2308 genes.',
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
    description:
      '150 muestras de cáncer de mama con 3 ómicas (miRNA, mRNA, proteína). 4 subtipos moleculares. Caso del Avance para DIABLO.',
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