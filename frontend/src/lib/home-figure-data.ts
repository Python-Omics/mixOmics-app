/**
 * Datos de la banda multi-omics de la pantalla de Inicio.
 *
 * GENERADO — no editar a mano. Se regenera con:
 *
 *     backend/.venv/bin/python scripts/generate_home_figure.py
 *
 * Los numeros vienen de los datos reales del dataset `nutrimouse`:
 * el PCA lo calcula `pythomics.tools.NipalsPCA(n_components=2,
 * center=True, scale=False)` sobre `nutrimouse_gene.csv` (40 muestras
 * x 120 genes) y las clases salen de la columna `genotype` de
 * `nutrimouse_meta.csv` (`wt` = circulo, `ppar` = rombo). El heat map
 * es el z-score por variable sobre las mismas 40 muestras, saturado en
 * +-2.0 y coloreado con la rampa divergente `slate-700 -> --p-100 ->
 * --p-400` (ver `design/system.md`).
 *
 * El circos del medio usa el bloque de lipidos (`nutrimouse_lipid.csv`,
 * 40 muestras x 21 lipidos): las cuerdas son la correlacion de Pearson
 * real gen/lipido que pasa el umbral de |r|, y las pistas de clase son
 * el perfil (media en z) de `wt` y de `ppar` variable por variable.
 *
 * El renderer no calcula nada: dibuja estos numeros tal cual.
 */

/** Una linea (grilla o eje del PCA). */
export type BandLine = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

/** Un punto del PCA: `wt` es un circulo, `ppar` un rombo. */
export type BandMark =
  | { kind: 'wt'; x: number; y: number }
  | { kind: 'ppar'; x: number; y: number; d: string };

/** Una celda del heat map. */
export type BandCell = {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Mezcla con custom properties: sigue al tema `data-theme`. */
  mix: string;
  /** Hex del tema por defecto: fallback si no hay `color-mix()`. */
  fill: string;
};

/** Un sector del anillo del circos (un bloque del diagrama). */
export type BandArc = {
  /** `gene` = bloque de genes, `lipid` = bloque de lipidos. */
  block: 'gene' | 'lipid';
  d: string;
};

/** Una cuerda del circos: un par gen/lipido con correlacion real. */
export type BandChord = {
  /** Nombre del gen (bloque superior del anillo). */
  gene: string;
  /** Nombre del lipid (bloque inferior del anillo). */
  lipid: string;
  /** Correlacion de Pearson real (40 muestras). */
  r: number;
  d: string;
  /** Grosor: crece con |r|. */
  width: number;
};

/** Una pista de clase del circos (el perfil de `wt` o de `ppar`). */
export type BandTrack = {
  kind: 'wt' | 'ppar';
  d: string;
};

/** Una etiqueta del circos: el nombre real de la variable. */
export type BandLabel = {
  name: string;
  x: number;
  y: number;
  /** Rotacion tangencial (`rotate(ang x y)`). */
  transform: string;
};

/** Procedencia de los datos (trazabilidad de la figura). */
export const HOME_FIGURE_SOURCE = {
  dataset: 'frontend/public/datasets/nutrimouse_gene.csv',
  datasetSha256: '06b4bc97a6b2a0fee1e2f7c822a1729e8d2a4b36269fe4f82dade54884b55c3c',
  lipidDataset: 'frontend/public/datasets/nutrimouse_lipid.csv',
  lipidDatasetSha256: 'fc2929f1300db39aa595394ae326d40d32dade65e31d1c077b895b51d5185e1d',
  metaSha256: 'fc235c8ee254b912611b6d8ce2f32534d3fcff41bde8320dbe78672db3a466af',
  pythomicsVersion: '0.0.0.0.0.0.1',
  explainedVarianceRatio: [
    0.349742,
    0.196094,
  ],
} as const;

export const SCATTER_VIEWBOX = '0 0 420 290';

/** Lineas de grilla (3 verticales + 2 horizontales). */
export const SCATTER_GRID: BandLine[] = [
  { x1: 132, y1: 16, x2: 132, y2: 250 },
  { x1: 220, y1: 16, x2: 220, y2: 250 },
  { x1: 308, y1: 16, x2: 308, y2: 250 },
  { x1: 44, y1: 94, x2: 396, y2: 94 },
  { x1: 44, y1: 172, x2: 396, y2: 172 },
];

/** Ejes (vertical y horizontal). */
export const SCATTER_AXES: BandLine[] = [
  { x1: 44, y1: 16, x2: 44, y2: 250 },
  { x1: 44, y1: 250, x2: 396, y2: 250 },
];

/** Los 40 puntos del PCA (20 `wt` + 20 `ppar`). */
export const SCATTER_MARKS: BandMark[] = [
  { kind: 'wt', x: 129, y: 30 },
  { kind: 'wt', x: 115.8, y: 100.9 },
  { kind: 'wt', x: 197.4, y: 21.1 },
  { kind: 'wt', x: 133.2, y: 33 },
  { kind: 'wt', x: 160.3, y: 122.4 },
  { kind: 'wt', x: 99.7, y: 158.8 },
  { kind: 'wt', x: 93.7, y: 121.1 },
  { kind: 'wt', x: 146.7, y: 16 },
  { kind: 'wt', x: 44, y: 79.3 },
  { kind: 'wt', x: 85, y: 168.6 },
  { kind: 'wt', x: 73.3, y: 34.4 },
  { kind: 'wt', x: 210.3, y: 50.9 },
  { kind: 'wt', x: 150.9, y: 118.1 },
  { kind: 'wt', x: 258.7, y: 20.8 },
  { kind: 'wt', x: 113.6, y: 130.5 },
  { kind: 'wt', x: 149.3, y: 31 },
  { kind: 'wt', x: 179.8, y: 58.2 },
  { kind: 'wt', x: 52.7, y: 109.3 },
  { kind: 'wt', x: 107.7, y: 148.3 },
  { kind: 'wt', x: 171.4, y: 80.7 },
  { kind: 'ppar', x: 255.3, y: 130.8, d: 'M255.3 127.6L258.5 130.8L255.3 134L252.2 130.8Z' },
  { kind: 'ppar', x: 290.4, y: 110.9, d: 'M290.4 107.7L293.6 110.9L290.4 114.1L287.2 110.9Z' },
  { kind: 'ppar', x: 396, y: 96.8, d: 'M396 93.6L399.2 96.8L396 99.9L392.8 96.8Z' },
  { kind: 'ppar', x: 246.2, y: 107, d: 'M246.2 103.8L249.3 107L246.2 110.2L243 107Z' },
  { kind: 'ppar', x: 331.5, y: 73, d: 'M331.5 69.8L334.7 73L331.5 76.1L328.4 73Z' },
  { kind: 'ppar', x: 99.9, y: 250, d: 'M99.9 246.8L103.1 250L99.9 253.2L96.7 250Z' },
  { kind: 'ppar', x: 257.6, y: 157.2, d: 'M257.6 154L260.7 157.2L257.6 160.4L254.4 157.2Z' },
  { kind: 'ppar', x: 226.4, y: 163.9, d: 'M226.4 160.7L229.6 163.9L226.4 167.1L223.2 163.9Z' },
  { kind: 'ppar', x: 287, y: 80.6, d: 'M287 77.5L290.1 80.6L287 83.8L283.8 80.6Z' },
  { kind: 'ppar', x: 250.1, y: 149.9, d: 'M250.1 146.8L253.2 149.9L250.1 153.1L246.9 149.9Z' },
  { kind: 'ppar', x: 271.6, y: 117.5, d: 'M271.6 114.4L274.8 117.5L271.6 120.7L268.4 117.5Z' },
  { kind: 'ppar', x: 131.4, y: 226.3, d: 'M131.4 223.2L134.6 226.3L131.4 229.5L128.2 226.3Z' },
  { kind: 'ppar', x: 225.8, y: 148.8, d: 'M225.8 145.6L229 148.8L225.8 152L222.6 148.8Z' },
  { kind: 'ppar', x: 271.7, y: 138.5, d: 'M271.7 135.4L274.9 138.5L271.7 141.7L268.5 138.5Z' },
  { kind: 'ppar', x: 253.1, y: 138.2, d: 'M253.1 135L256.3 138.2L253.1 141.3L249.9 138.2Z' },
  { kind: 'ppar', x: 157.9, y: 249, d: 'M157.9 245.8L161 249L157.9 252.2L154.7 249Z' },
  { kind: 'ppar', x: 210, y: 190.8, d: 'M210 187.7L213.1 190.8L210 194L206.8 190.8Z' },
  { kind: 'ppar', x: 271.1, y: 130, d: 'M271.1 126.9L274.3 130L271.1 133.2L268 130Z' },
  { kind: 'ppar', x: 261.8, y: 210.5, d: 'M261.8 207.3L265 210.5L261.8 213.7L258.7 210.5Z' },
  { kind: 'ppar', x: 240.4, y: 163.9, d: 'M240.4 160.7L243.6 163.9L240.4 167L237.3 163.9Z' },
];

export const CIRCOS_VIEWBOX = '0 0 340 290';

/** Los sectores del anillo: genes arriba, lipidos abajo. */
export const CIRCOS_ARCS: BandArc[] = [
  { block: 'gene', d: 'M48 142.4A122 122 0 0 1 54.5 105.7' },
  { block: 'gene', d: 'M56.3 100.9A122 122 0 0 1 74.9 68.6' },
  { block: 'gene', d: 'M78.2 64.6A122 122 0 0 1 106.8 40.6' },
  { block: 'gene', d: 'M111.2 38.1A122 122 0 0 1 146.3 25.3' },
  { block: 'gene', d: 'M151.3 24.4A122 122 0 0 1 188.7 24.4' },
  { block: 'gene', d: 'M193.7 25.3A122 122 0 0 1 228.8 38.1' },
  { block: 'gene', d: 'M233.2 40.6A122 122 0 0 1 261.8 64.6' },
  { block: 'gene', d: 'M265.1 68.6A122 122 0 0 1 283.7 100.9' },
  { block: 'gene', d: 'M285.5 105.7A122 122 0 0 1 292 142.4' },
  { block: 'lipid', d: 'M292 147.6A122 122 0 0 1 270.2 214.6' },
  { block: 'lipid', d: 'M267.2 218.8A122 122 0 0 1 210.1 260.2' },
  { block: 'lipid', d: 'M205.3 261.8A122 122 0 0 1 134.7 261.8' },
  { block: 'lipid', d: 'M129.9 260.2A122 122 0 0 1 72.8 218.8' },
  { block: 'lipid', d: 'M69.8 214.6A122 122 0 0 1 48 147.6' },
];

/** Las cuerdas: los pares gen/lipido que pasan el umbral de |r|. */
export const CIRCOS_CHORDS: BandChord[] = [
  { gene: 'HPNCL', lipid: 'C20.2n.6', r: -0.7846, d: 'M170 30Q170 145 102.4 238', width: 4 },
  { gene: 'HPNCL', lipid: 'C18.2n.6', r: -0.7676, d: 'M170 30Q170 145 170 260', width: 3.5 },
  { gene: 'ACBP', lipid: 'C16.0', r: 0.7606, d: 'M56.7 125Q170 145 279.4 180.5', width: 3.3 },
  { gene: 'THIOL', lipid: 'C16.0', r: 0.7465, d: 'M283.3 125Q170 145 279.4 180.5', width: 2.9 },
  { gene: 'AOX', lipid: 'C16.0', r: 0.7393, d: 'M70.4 87.5Q170 145 279.4 180.5', width: 2.7 },
  { gene: 'Lpin2', lipid: 'C18.2n.6', r: -0.7269, d: 'M243.9 56.9Q170 145 170 260', width: 2.4 },
  { gene: 'CYP3A11', lipid: 'C22.6n.3', r: 0.7210, d: 'M96.1 56.9Q170 145 60.6 180.5', width: 2.2 },
  { gene: 'Lpin2', lipid: 'C20.2n.6', r: -0.7189, d: 'M243.9 56.9Q170 145 102.4 238', width: 2.1 },
  { gene: 'FAS', lipid: 'C16.0', r: 0.7141, d: 'M130.7 36.9Q170 145 279.4 180.5', width: 2 },
  { gene: 'L.FABP', lipid: 'C16.0', r: 0.7090, d: 'M209.3 36.9Q170 145 279.4 180.5', width: 1.9 },
  { gene: 'PECI', lipid: 'C20.1n.9', r: -0.7075, d: 'M269.6 87.5Q170 145 237.6 238', width: 1.8 },
];

/** Las pistas de clase: el perfil de `wt` y el de `ppar`. */
export const CIRCOS_TRACKS: BandTrack[] = [
  { kind: 'wt', d: 'M60.5 125.7 C61.7 110.9 67.9 100.7 74.2 89.7 C80.6 78.7 88.9 68 98.6 59.9 C108.2 51.7 120.2 45.1 132.1 40.9 C144 36.6 157.3 34.6 170 34.4 C182.7 34.3 196.5 35.6 208.2 40.1 C219.9 44.6 230.6 53 240.3 61.3 C249.9 69.5 259.5 78.7 266.2 89.4 C272.9 100.1 278.8 110.5 280.5 125.5 C282.2 140.5 285 162.8 276.4 179.6 C267.8 196.3 246.7 215.2 229 226.2 C211.3 237.2 189.8 245.5 170 245.7 C150.2 245.9 127.4 238.5 110.2 227.2 C93.1 216 75.7 195.3 67.4 178.3 C59.1 161.4 59.4 140.5 60.5 125.7Z' },
  { kind: 'ppar', d: 'M72.7 127.8 C74.5 114.3 78.3 105.1 83.9 95.3 C89.5 85.5 97.8 76.5 106.5 69.3 C115.2 62 125.5 55.7 136.1 51.8 C146.7 47.8 158.7 45.4 170 45.6 C181.3 45.7 192.9 48.8 203.6 52.6 C214.4 56.3 226.1 60.7 234.7 67.9 C243.4 75 250.4 85.5 255.6 95.6 C260.9 105.6 265 114.7 266.3 128 C267.6 141.3 268.6 157.7 263.3 175.3 C258 192.9 250 220.5 234.4 233.7 C218.9 246.9 191.4 254.5 170 254.3 C148.6 254.1 122.5 245.6 106.3 232.7 C90.1 219.7 78.5 194 72.9 176.5 C67.3 159.1 70.8 141.4 72.7 127.8Z' },
];

/** Las etiquetas: el nombre real de cada variable del anillo. */
export const CIRCOS_LABELS: BandLabel[] = [
  { name: 'ACBP', x: 43, y: 122.6, transform: 'rotate(-80 43 122.6)' },
  { name: 'AOX', x: 58.3, y: 80.5, transform: 'rotate(-60 58.3 80.5)' },
  { name: 'CYP3A11', x: 87.1, y: 46.2, transform: 'rotate(-40 87.1 46.2)' },
  { name: 'FAS', x: 125.9, y: 23.8, transform: 'rotate(-20 125.9 23.8)' },
  { name: 'HPNCL', x: 170, y: 16, transform: 'rotate(0 170 16)' },
  { name: 'L.FABP', x: 214.1, y: 23.8, transform: 'rotate(20 214.1 23.8)' },
  { name: 'Lpin2', x: 252.9, y: 46.2, transform: 'rotate(40 252.9 46.2)' },
  { name: 'PECI', x: 281.7, y: 80.5, transform: 'rotate(60 281.7 80.5)' },
  { name: 'THIOL', x: 297, y: 122.6, transform: 'rotate(80 297 122.6)' },
  { name: 'C16.0', x: 292.7, y: 184.9, transform: 'rotate(288 292.7 184.9)' },
  { name: 'C20.1n.9', x: 245.8, y: 249.4, transform: 'rotate(324 245.8 249.4)' },
  { name: 'C18.2n.6', x: 170, y: 274, transform: 'rotate(360 170 274)' },
  { name: 'C20.2n.6', x: 94.2, y: 249.4, transform: 'rotate(396 94.2 249.4)' },
  { name: 'C22.6n.3', x: 47.3, y: 184.9, transform: 'rotate(432 47.3 184.9)' },
];

export const HEAT_VIEWBOX = '0 0 468 290';

/** La tira de heat map: 20 muestras x 14 genes. */
export const HEAT_CELLS: BandCell[] = [
  { x: 12, y: 12, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 26.2%,var(--p-100))', fill: '#b0e6cc' },
  { x: 34.2, y: 12, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 11.4%,var(--p-100))', fill: '#cbf0dc' },
  { x: 56.4, y: 12, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 18.4%,var(--p-100))', fill: '#536370' },
  { x: 78.6, y: 12, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 3.9%,var(--p-100))', fill: '#d8f4e4' },
  { x: 100.8, y: 12, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 26.2%,var(--p-100))', fill: '#b0e6cc' },
  { x: 123, y: 12, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 18.8%,var(--p-100))', fill: '#bdebd4' },
  { x: 145.2, y: 12, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 55.6%,var(--p-100))', fill: '#93a6a7' },
  { x: 167.4, y: 12, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 25.9%,var(--p-100))', fill: '#5f707b' },
  { x: 189.6, y: 12, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 70.9%,var(--p-100))', fill: '#60c99c' },
  { x: 211.8, y: 12, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 33.3%,var(--p-100))', fill: '#6c7e86' },
  { x: 234, y: 12, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 41.1%,var(--p-100))', fill: '#95dcbc' },
  { x: 256.2, y: 12, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 48.2%,var(--p-100))', fill: '#86999c' },
  { x: 278.4, y: 12, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 48.2%,var(--p-100))', fill: '#86999c' },
  { x: 300.6, y: 12, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 11.0%,var(--p-100))', fill: '#465565' },
  { x: 322.8, y: 12, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 26.2%,var(--p-100))', fill: '#b0e6cc' },
  { x: 345, y: 12, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 92.9%,var(--p-100))', fill: '#d3eadd' },
  { x: 367.2, y: 12, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 3.5%,var(--p-100))', fill: '#39475a' },
  { x: 389.4, y: 12, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 70.9%,var(--p-100))', fill: '#60c99c' },
  { x: 411.6, y: 12, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 78.3%,var(--p-100))', fill: '#53c494' },
  { x: 433.8, y: 12, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 11.4%,var(--p-100))', fill: '#cbf0dc' },
  { x: 12, y: 31, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 4.9%,var(--p-100))', fill: '#d6f4e3' },
  { x: 34.2, y: 31, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 23.2%,var(--p-100))', fill: '#5b6b77' },
  { x: 56.4, y: 31, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 79.6%,var(--p-100))', fill: '#bcd2ca' },
  { x: 78.6, y: 31, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 32.6%,var(--p-100))', fill: '#6b7c85' },
  { x: 100.8, y: 31, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 51.4%,var(--p-100))', fill: '#8b9fa1' },
  { x: 123, y: 31, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 32.6%,var(--p-100))', fill: '#6b7c85' },
  { x: 145.2, y: 31, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 33.1%,var(--p-100))', fill: '#a4e1c5' },
  { x: 167.4, y: 31, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 32.6%,var(--p-100))', fill: '#6b7c85' },
  { x: 189.6, y: 31, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 4.5%,var(--p-100))', fill: '#3b495c' },
  { x: 211.8, y: 31, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 33.1%,var(--p-100))', fill: '#a4e1c5' },
  { x: 234, y: 31, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 51.9%,var(--p-100))', fill: '#82d5b0' },
  { x: 256.2, y: 31, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 4.5%,var(--p-100))', fill: '#3b495c' },
  { x: 278.4, y: 31, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 23.7%,var(--p-100))', fill: '#b5e8cf' },
  { x: 300.6, y: 31, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 51.4%,var(--p-100))', fill: '#8b9fa1' },
  { x: 322.8, y: 31, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 4.5%,var(--p-100))', fill: '#3b495c' },
  { x: 345, y: 31, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 33.1%,var(--p-100))', fill: '#a4e1c5' },
  { x: 367.2, y: 31, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 32.6%,var(--p-100))', fill: '#6b7c85' },
  { x: 389.4, y: 31, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 70.7%,var(--p-100))', fill: '#61c99c' },
  { x: 411.6, y: 31, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 33.1%,var(--p-100))', fill: '#a4e1c5' },
  { x: 433.8, y: 31, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 89.0%,var(--p-100))', fill: '#cce3d8' },
  { x: 12, y: 50, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 21.2%,var(--p-100))', fill: '#576874' },
  { x: 34.2, y: 50, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 41.4%,var(--p-100))', fill: '#7a8c92' },
  { x: 56.4, y: 50, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 96.3%,var(--p-100))', fill: '#d9f0e3' },
  { x: 78.6, y: 50, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 33.7%,var(--p-100))', fill: '#a3e1c4' },
  { x: 100.8, y: 50, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 65.5%,var(--p-100))', fill: '#6acca2' },
  { x: 123, y: 50, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 9.6%,var(--p-100))', fill: '#445263' },
  { x: 145.2, y: 50, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 67.4%,var(--p-100))', fill: '#a7bcb8' },
  { x: 167.4, y: 50, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 41.4%,var(--p-100))', fill: '#7a8c92' },
  { x: 189.6, y: 50, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 7.7%,var(--p-100))', fill: '#d1f2e0' },
  { x: 211.8, y: 50, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 6.7%,var(--p-100))', fill: '#3f4d5f' },
  { x: 234, y: 50, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 62.6%,var(--p-100))', fill: '#6fcea5' },
  { x: 256.2, y: 50, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 30.8%,var(--p-100))', fill: '#a8e3c7' },
  { x: 278.4, y: 50, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 64.5%,var(--p-100))', fill: '#a2b6b4' },
  { x: 300.6, y: 50, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 94.4%,var(--p-100))', fill: '#36ba83' },
  { x: 322.8, y: 50, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 32.7%,var(--p-100))', fill: '#6b7d85' },
  { x: 345, y: 50, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 24.1%,var(--p-100))', fill: '#5c6d78' },
  { x: 367.2, y: 50, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 91.5%,var(--p-100))', fill: '#3bbc86' },
  { x: 389.4, y: 50, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 16.4%,var(--p-100))', fill: '#c2ecd6' },
  { x: 411.6, y: 50, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 59.7%,var(--p-100))', fill: '#74d0a8' },
  { x: 433.8, y: 50, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 19.3%,var(--p-100))', fill: '#bcead3' },
  { x: 12, y: 69, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 47.1%,var(--p-100))', fill: '#8bd8b6' },
  { x: 34.2, y: 69, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 57.2%,var(--p-100))', fill: '#79d2ab' },
  { x: 56.4, y: 69, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 13.2%,var(--p-100))', fill: '#4a5968' },
  { x: 78.6, y: 69, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 11.9%,var(--p-100))', fill: '#caefdb' },
  { x: 100.8, y: 69, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 27.0%,var(--p-100))', fill: '#afe5cb' },
  { x: 123, y: 69, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 57.2%,var(--p-100))', fill: '#79d2ab' },
  { x: 145.2, y: 69, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 3.1%,var(--p-100))', fill: '#38475a' },
  { x: 167.4, y: 69, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 32.1%,var(--p-100))', fill: '#a6e2c6' },
  { x: 189.6, y: 69, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 22.0%,var(--p-100))', fill: '#b8e9d0' },
  { x: 211.8, y: 69, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 37.1%,var(--p-100))', fill: '#9ddfc0' },
  { x: 234, y: 69, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 92.4%,var(--p-100))', fill: '#3abb85' },
  { x: 256.2, y: 69, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 11.9%,var(--p-100))', fill: '#caefdb' },
  { x: 278.4, y: 69, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 1.9%,var(--p-100))', fill: '#dcf6e6' },
  { x: 300.6, y: 69, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 8.2%,var(--p-100))', fill: '#415061' },
  { x: 322.8, y: 69, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 52.2%,var(--p-100))', fill: '#82d5b0' },
  { x: 345, y: 69, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 6.9%,var(--p-100))', fill: '#d3f3e1' },
  { x: 367.2, y: 69, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 57.2%,var(--p-100))', fill: '#79d2ab' },
  { x: 389.4, y: 69, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 47.1%,var(--p-100))', fill: '#8bd8b6' },
  { x: 411.6, y: 69, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 97.4%,var(--p-100))', fill: '#31b880' },
  { x: 433.8, y: 69, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 52.2%,var(--p-100))', fill: '#82d5b0' },
  { x: 12, y: 88, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 23.4%,var(--p-100))', fill: '#5b6c77' },
  { x: 34.2, y: 88, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 21.1%,var(--p-100))', fill: '#b9e9d1' },
  { x: 56.4, y: 88, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 30.8%,var(--p-100))', fill: '#687982' },
  { x: 78.6, y: 88, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 1.1%,var(--p-100))', fill: '#354357' },
  { x: 100.8, y: 88, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 36.0%,var(--p-100))', fill: '#9fe0c2' },
  { x: 123, y: 88, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 95.3%,var(--p-100))', fill: '#34b982' },
  { x: 145.2, y: 88, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 28.5%,var(--p-100))', fill: '#ace4c9' },
  { x: 167.4, y: 88, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 23.4%,var(--p-100))', fill: '#5b6c77' },
  { x: 189.6, y: 88, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 80.5%,var(--p-100))', fill: '#4fc392' },
  { x: 211.8, y: 88, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 36.0%,var(--p-100))', fill: '#9fe0c2' },
  { x: 234, y: 88, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 28.5%,var(--p-100))', fill: '#ace4c9' },
  { x: 256.2, y: 88, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 15.9%,var(--p-100))', fill: '#4e5e6c' },
  { x: 278.4, y: 88, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 13.7%,var(--p-100))', fill: '#c6eed9' },
  { x: 300.6, y: 88, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 100.0%,var(--p-100))', fill: '#dff7e8' },
  { x: 322.8, y: 88, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 13.7%,var(--p-100))', fill: '#c6eed9' },
  { x: 345, y: 88, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 53.0%,var(--p-100))', fill: '#8ea1a3' },
  { x: 367.2, y: 88, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 38.2%,var(--p-100))', fill: '#75878d' },
  { x: 389.4, y: 88, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 43.4%,var(--p-100))', fill: '#91dbba' },
  { x: 411.6, y: 88, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 13.7%,var(--p-100))', fill: '#c6eed9' },
  { x: 433.8, y: 88, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 67.9%,var(--p-100))', fill: '#a8bcb9' },
  { x: 12, y: 107, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 48.8%,var(--p-100))', fill: '#879a9d' },
  { x: 34.2, y: 107, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 15.3%,var(--p-100))', fill: '#4d5d6c' },
  { x: 56.4, y: 107, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 29.7%,var(--p-100))', fill: '#667781' },
  { x: 78.6, y: 107, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 29.7%,var(--p-100))', fill: '#667781' },
  { x: 100.8, y: 107, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 66.0%,var(--p-100))', fill: '#69cca1' },
  { x: 123, y: 107, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 100.0%,var(--p-100))', fill: '#2cb67d' },
  { x: 145.2, y: 107, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 13.4%,var(--p-100))', fill: '#c7eeda' },
  { x: 167.4, y: 107, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 15.3%,var(--p-100))', fill: '#4d5d6c' },
  { x: 189.6, y: 107, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 24.9%,var(--p-100))', fill: '#5e6e7a' },
  { x: 211.8, y: 107, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 99.5%,var(--p-100))', fill: '#2db67e' },
  { x: 234, y: 107, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 48.8%,var(--p-100))', fill: '#879a9d' },
  { x: 256.2, y: 107, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 34.5%,var(--p-100))', fill: '#6e8088' },
  { x: 278.4, y: 107, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 32.5%,var(--p-100))', fill: '#a5e2c5' },
  { x: 300.6, y: 107, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 67.9%,var(--p-100))', fill: '#a8bdb9' },
  { x: 322.8, y: 107, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 1.0%,var(--p-100))', fill: '#354356' },
  { x: 345, y: 107, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 77.5%,var(--p-100))', fill: '#b8cec7' },
  { x: 367.2, y: 107, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 46.9%,var(--p-100))', fill: '#8bd9b6' },
  { x: 389.4, y: 107, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 23.0%,var(--p-100))', fill: '#b6e8cf' },
  { x: 411.6, y: 107, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 70.8%,var(--p-100))', fill: '#60c99c' },
  { x: 433.8, y: 107, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 5.7%,var(--p-100))', fill: '#3d4b5d' },
  { x: 12, y: 126, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 12.3%,var(--p-100))', fill: '#485767' },
  { x: 34.2, y: 126, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 50.7%,var(--p-100))', fill: '#8a9da0' },
  { x: 56.4, y: 126, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 95.6%,var(--p-100))', fill: '#d7efe1' },
  { x: 78.6, y: 126, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 12.3%,var(--p-100))', fill: '#485767' },
  { x: 100.8, y: 126, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 57.1%,var(--p-100))', fill: '#95a9a9' },
  { x: 123, y: 126, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 12.3%,var(--p-100))', fill: '#485767' },
  { x: 145.2, y: 126, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 18.7%,var(--p-100))', fill: '#536371' },
  { x: 167.4, y: 126, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 89.1%,var(--p-100))', fill: '#cce3d8' },
  { x: 189.6, y: 126, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 19.7%,var(--p-100))', fill: '#bcead3' },
  { x: 211.8, y: 126, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 5.9%,var(--p-100))', fill: '#3d4c5e' },
  { x: 234, y: 126, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 64.5%,var(--p-100))', fill: '#6ccda3' },
  { x: 256.2, y: 126, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 25.1%,var(--p-100))', fill: '#5e6f7a' },
  { x: 278.4, y: 126, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 31.5%,var(--p-100))', fill: '#697a83' },
  { x: 300.6, y: 126, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 69.9%,var(--p-100))', fill: '#abc0bc' },
  { x: 322.8, y: 126, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 5.9%,var(--p-100))', fill: '#3d4c5e' },
  { x: 345, y: 126, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 0.5%,var(--p-100))', fill: '#def7e7' },
  { x: 367.2, y: 126, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 95.6%,var(--p-100))', fill: '#d7efe1' },
  { x: 389.4, y: 126, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 5.9%,var(--p-100))', fill: '#3d4c5e' },
  { x: 411.6, y: 126, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 25.1%,var(--p-100))', fill: '#5e6f7a' },
  { x: 433.8, y: 126, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 50.7%,var(--p-100))', fill: '#8a9da0' },
  { x: 12, y: 145, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 1.6%,var(--p-100))', fill: '#364457' },
  { x: 34.2, y: 145, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 7.8%,var(--p-100))', fill: '#d1f2e0' },
  { x: 56.4, y: 145, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 95.9%,var(--p-100))', fill: '#d8f0e2' },
  { x: 78.6, y: 145, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 39.3%,var(--p-100))', fill: '#77898f' },
  { x: 100.8, y: 145, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 26.6%,var(--p-100))', fill: '#afe6cc' },
  { x: 123, y: 145, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 7.8%,var(--p-100))', fill: '#d1f2e0' },
  { x: 145.2, y: 145, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 36.0%,var(--p-100))', fill: '#9ee0c1' },
  { x: 167.4, y: 145, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 39.3%,var(--p-100))', fill: '#77898f' },
  { x: 189.6, y: 145, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 1.6%,var(--p-100))', fill: '#364457' },
  { x: 211.8, y: 145, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 11.1%,var(--p-100))', fill: '#465565' },
  { x: 234, y: 145, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 11.1%,var(--p-100))', fill: '#465565' },
  { x: 256.2, y: 145, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 58.2%,var(--p-100))', fill: '#97abab' },
  { x: 278.4, y: 145, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 17.2%,var(--p-100))', fill: '#c0ecd6' },
  { x: 300.6, y: 145, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 39.3%,var(--p-100))', fill: '#77898f' },
  { x: 322.8, y: 145, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 36.0%,var(--p-100))', fill: '#9ee0c1' },
  { x: 345, y: 145, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 7.8%,var(--p-100))', fill: '#d1f2e0' },
  { x: 367.2, y: 145, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 77.0%,var(--p-100))', fill: '#b8cdc6' },
  { x: 389.4, y: 145, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 36.0%,var(--p-100))', fill: '#9ee0c1' },
  { x: 411.6, y: 145, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 7.8%,var(--p-100))', fill: '#d1f2e0' },
  { x: 433.8, y: 145, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 86.5%,var(--p-100))', fill: '#c8ded4' },
  { x: 12, y: 164, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 81.3%,var(--p-100))', fill: '#bfd5cd' },
  { x: 34.2, y: 164, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 53.9%,var(--p-100))', fill: '#7ed4ae' },
  { x: 56.4, y: 164, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 74.2%,var(--p-100))', fill: '#b3c8c2' },
  { x: 78.6, y: 164, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 4.1%,var(--p-100))', fill: '#d8f4e4' },
  { x: 100.8, y: 164, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 3.0%,var(--p-100))', fill: '#384759' },
  { x: 123, y: 164, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 4.1%,var(--p-100))', fill: '#d8f4e4' },
  { x: 145.2, y: 164, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 18.3%,var(--p-100))', fill: '#beebd4' },
  { x: 167.4, y: 164, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 60.0%,var(--p-100))', fill: '#9aaead' },
  { x: 189.6, y: 164, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 18.3%,var(--p-100))', fill: '#beebd4' },
  { x: 211.8, y: 164, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 53.9%,var(--p-100))', fill: '#7ed4ae' },
  { x: 234, y: 164, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 17.3%,var(--p-100))', fill: '#51606e' },
  { x: 256.2, y: 164, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 45.7%,var(--p-100))', fill: '#829498' },
  { x: 278.4, y: 164, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 11.2%,var(--p-100))', fill: '#cbf0dc' },
  { x: 300.6, y: 164, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 81.3%,var(--p-100))', fill: '#bfd5cd' },
  { x: 322.8, y: 164, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 39.7%,var(--p-100))', fill: '#98ddbe' },
  { x: 345, y: 164, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 52.9%,var(--p-100))', fill: '#8ea1a3' },
  { x: 367.2, y: 164, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 60.0%,var(--p-100))', fill: '#9aaead' },
  { x: 389.4, y: 164, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 61.0%,var(--p-100))', fill: '#72cfa7' },
  { x: 411.6, y: 164, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 3.0%,var(--p-100))', fill: '#384759' },
  { x: 433.8, y: 164, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 3.0%,var(--p-100))', fill: '#384759' },
  { x: 12, y: 183, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 62.7%,var(--p-100))', fill: '#6fcea5' },
  { x: 34.2, y: 183, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 91.6%,var(--p-100))', fill: '#3bbb86' },
  { x: 56.4, y: 183, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 28.9%,var(--p-100))', fill: '#abe4c9' },
  { x: 78.6, y: 183, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 48.2%,var(--p-100))', fill: '#89d8b4' },
  { x: 100.8, y: 183, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 24.1%,var(--p-100))', fill: '#b4e7ce' },
  { x: 123, y: 183, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 28.9%,var(--p-100))', fill: '#abe4c9' },
  { x: 145.2, y: 183, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 67.5%,var(--p-100))', fill: '#66cba0' },
  { x: 167.4, y: 183, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 28.9%,var(--p-100))', fill: '#abe4c9' },
  { x: 189.6, y: 183, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 72.3%,var(--p-100))', fill: '#5ec89b' },
  { x: 211.8, y: 183, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 57.9%,var(--p-100))', fill: '#77d1aa' },
  { x: 234, y: 183, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 19.3%,var(--p-100))', fill: '#bcead3' },
  { x: 256.2, y: 183, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 9.6%,var(--p-100))', fill: '#cef1de' },
  { x: 278.4, y: 183, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 14.5%,var(--p-100))', fill: '#c5eed9' },
  { x: 300.6, y: 183, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 33.8%,var(--p-100))', fill: '#6d7e87' },
  { x: 322.8, y: 183, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 62.7%,var(--p-100))', fill: '#6fcea5' },
  { x: 345, y: 183, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 33.8%,var(--p-100))', fill: '#a3e1c4' },
  { x: 367.2, y: 183, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 28.9%,var(--p-100))', fill: '#abe4c9' },
  { x: 389.4, y: 183, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 62.7%,var(--p-100))', fill: '#6fcea5' },
  { x: 411.6, y: 183, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 48.2%,var(--p-100))', fill: '#89d8b4' },
  { x: 433.8, y: 183, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 24.1%,var(--p-100))', fill: '#b4e7ce' },
  { x: 12, y: 202, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 27.7%,var(--p-100))', fill: '#ade5ca' },
  { x: 34.2, y: 202, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 34.9%,var(--p-100))', fill: '#a0e0c3' },
  { x: 56.4, y: 202, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 23.3%,var(--p-100))', fill: '#5b6b77' },
  { x: 78.6, y: 202, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 16.0%,var(--p-100))', fill: '#4f5e6d' },
  { x: 100.8, y: 202, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 27.7%,var(--p-100))', fill: '#ade5ca' },
  { x: 123, y: 202, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 56.8%,var(--p-100))', fill: '#79d2ab' },
  { x: 145.2, y: 202, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 23.3%,var(--p-100))', fill: '#5b6b77' },
  { x: 167.4, y: 202, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 23.3%,var(--p-100))', fill: '#5b6b77' },
  { x: 189.6, y: 202, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 71.3%,var(--p-100))', fill: '#5fc99c' },
  { x: 211.8, y: 202, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 5.8%,var(--p-100))', fill: '#d5f3e2' },
  { x: 234, y: 202, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 78.6%,var(--p-100))', fill: '#52c494' },
  { x: 256.2, y: 202, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 67.0%,var(--p-100))', fill: '#a6bbb7' },
  { x: 278.4, y: 202, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 13.1%,var(--p-100))', fill: '#c8eeda' },
  { x: 300.6, y: 202, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 45.1%,var(--p-100))', fill: '#819397' },
  { x: 322.8, y: 202, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 49.5%,var(--p-100))', fill: '#86d7b3' },
  { x: 345, y: 202, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 13.1%,var(--p-100))', fill: '#c8eeda' },
  { x: 367.2, y: 202, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 1.5%,var(--p-100))', fill: '#364457' },
  { x: 389.4, y: 202, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 49.5%,var(--p-100))', fill: '#86d7b3' },
  { x: 411.6, y: 202, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 20.4%,var(--p-100))', fill: '#bbead2' },
  { x: 433.8, y: 202, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 5.8%,var(--p-100))', fill: '#d5f3e2' },
  { x: 12, y: 221, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 39.8%,var(--p-100))', fill: '#98ddbd' },
  { x: 34.2, y: 221, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 57.4%,var(--p-100))', fill: '#78d2ab' },
  { x: 56.4, y: 221, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 39.8%,var(--p-100))', fill: '#98ddbd' },
  { x: 78.6, y: 221, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 35.4%,var(--p-100))', fill: '#a0e0c2' },
  { x: 100.8, y: 221, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 26.2%,var(--p-100))', fill: '#60717b' },
  { x: 123, y: 221, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 9.0%,var(--p-100))', fill: '#cff1de' },
  { x: 145.2, y: 221, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 70.6%,var(--p-100))', fill: '#61c99c' },
  { x: 167.4, y: 221, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 13.4%,var(--p-100))', fill: '#c7eeda' },
  { x: 189.6, y: 221, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 83.8%,var(--p-100))', fill: '#49c18e' },
  { x: 211.8, y: 221, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 9.0%,var(--p-100))', fill: '#cff1de' },
  { x: 234, y: 221, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 92.6%,var(--p-100))', fill: '#39bb85' },
  { x: 256.2, y: 221, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 43.8%,var(--p-100))', fill: '#7e9195' },
  { x: 278.4, y: 221, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 9.0%,var(--p-100))', fill: '#cff1de' },
  { x: 300.6, y: 221, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 8.6%,var(--p-100))', fill: '#425162' },
  { x: 322.8, y: 221, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 53.0%,var(--p-100))', fill: '#80d5af' },
  { x: 345, y: 221, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 44.2%,var(--p-100))', fill: '#90dab9' },
  { x: 367.2, y: 221, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 13.4%,var(--p-100))', fill: '#c7eeda' },
  { x: 389.4, y: 221, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 83.8%,var(--p-100))', fill: '#49c18e' },
  { x: 411.6, y: 221, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 35.4%,var(--p-100))', fill: '#a0e0c2' },
  { x: 433.8, y: 221, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 9.0%,var(--p-100))', fill: '#cff1de' },
  { x: 12, y: 240, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 41.4%,var(--p-100))', fill: '#95dcbc' },
  { x: 34.2, y: 240, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 24.6%,var(--p-100))', fill: '#5d6e79' },
  { x: 56.4, y: 240, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 24.6%,var(--p-100))', fill: '#5d6e79' },
  { x: 78.6, y: 240, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 24.6%,var(--p-100))', fill: '#5d6e79' },
  { x: 100.8, y: 240, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 18.0%,var(--p-100))', fill: '#52626f' },
  { x: 123, y: 240, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 4.8%,var(--p-100))', fill: '#3b4a5c' },
  { x: 145.2, y: 240, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 21.6%,var(--p-100))', fill: '#b8e9d1' },
  { x: 167.4, y: 240, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 48.0%,var(--p-100))', fill: '#89d8b5' },
  { x: 189.6, y: 240, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 87.6%,var(--p-100))', fill: '#42be8a' },
  { x: 211.8, y: 240, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 54.6%,var(--p-100))', fill: '#7dd3ae' },
  { x: 234, y: 240, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 15.0%,var(--p-100))', fill: '#c4edd8' },
  { x: 256.2, y: 240, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 51.0%,var(--p-100))', fill: '#8b9ea0' },
  { x: 278.4, y: 240, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 18.0%,var(--p-100))', fill: '#52626f' },
  { x: 300.6, y: 240, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 51.0%,var(--p-100))', fill: '#8b9ea0' },
  { x: 322.8, y: 240, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 18.0%,var(--p-100))', fill: '#52626f' },
  { x: 345, y: 240, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 21.6%,var(--p-100))', fill: '#b8e9d1' },
  { x: 367.2, y: 240, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 15.0%,var(--p-100))', fill: '#c4edd8' },
  { x: 389.4, y: 240, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 87.6%,var(--p-100))', fill: '#42be8a' },
  { x: 411.6, y: 240, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 41.4%,var(--p-100))', fill: '#95dcbc' },
  { x: 433.8, y: 240, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 28.2%,var(--p-100))', fill: '#ace5ca' },
  { x: 12, y: 259, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 14.4%,var(--p-100))', fill: '#c5eed9' },
  { x: 34.2, y: 259, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 19.0%,var(--p-100))', fill: '#bdebd4' },
  { x: 56.4, y: 259, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 14.4%,var(--p-100))', fill: '#c5eed9' },
  { x: 78.6, y: 259, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 69.8%,var(--p-100))', fill: '#62ca9d' },
  { x: 100.8, y: 259, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 22.5%,var(--p-100))', fill: '#5a6a76' },
  { x: 123, y: 259, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 37.5%,var(--p-100))', fill: '#9cdfc0' },
  { x: 145.2, y: 259, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 28.3%,var(--p-100))', fill: '#ace5ca' },
  { x: 167.4, y: 259, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 9.8%,var(--p-100))', fill: '#cdf1de' },
  { x: 189.6, y: 259, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 83.7%,var(--p-100))', fill: '#49c18e' },
  { x: 211.8, y: 259, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 74.4%,var(--p-100))', fill: '#5ac798' },
  { x: 234, y: 259, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 100.0%,var(--p-100))', fill: '#2cb67d' },
  { x: 256.2, y: 259, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 17.9%,var(--p-100))', fill: '#52626f' },
  { x: 278.4, y: 259, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 8.7%,var(--p-100))', fill: '#425162' },
  { x: 300.6, y: 259, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--slate-700) 22.5%,var(--p-100))', fill: '#5a6a76' },
  { x: 322.8, y: 259, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 37.5%,var(--p-100))', fill: '#9cdfc0' },
  { x: 345, y: 259, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 5.2%,var(--p-100))', fill: '#d6f4e2' },
  { x: 367.2, y: 259, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 0.6%,var(--p-100))', fill: '#def7e7' },
  { x: 389.4, y: 259, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 69.8%,var(--p-100))', fill: '#62ca9d' },
  { x: 411.6, y: 259, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 28.3%,var(--p-100))', fill: '#ace5ca' },
  { x: 433.8, y: 259, w: 20.2, h: 17, mix: 'color-mix(in srgb,var(--p-400) 19.0%,var(--p-100))', fill: '#bdebd4' },
];
