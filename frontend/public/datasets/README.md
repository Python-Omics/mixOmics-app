# Datasets de ejemplo

> **Estado:** directorio vacío por diseño. Los CSVs se generan ejecutando
> `scripts/extract_mixomics_datasets.py` (requiere R + `mixOmics`).

## ¿Por qué no están commiteados?

Los CSVs se generan localmente con un script que usa `rpy2` para extraer
los datasets del paquete R `mixOmics` (Bioconductor). El flujo es:

1. Instalar R + `mixOmics` (ver `../../scripts/extract_mixomics_datasets.py` docstring)
2. Activar el venv del backend que tiene `rpy2`
3. Correr: `cd mixOmics-app && .venv/bin/python scripts/extract_mixomics_datasets.py`
4. Los CSVs aparecen en esta carpeta
5. Commitear los CSVs resultantes al repo (van en el bundle de la app)

## Datasets que se generarán

| Dataset | Filas × Cols (aprox) | Bloques | Uso en la app |
|---|---|---|---|
| **nutrimouse** | 40 × 120 (gene) + 40 × 21 (lipid) | 2 | DIABLO multi-bloque, sPLS-DA |
| **srbct** | 63 × 2308 | 1 | sPLS-DA con variable clase |
| **breast.TCGA** | ~150 × varios | 3+ (gene, protein, miRNA) | DIABLO multi-ómico completo |

Todos provienen del paquete R `mixOmics` (Kim-Anh Lê Cao et al., mezcla de
datos de Genética, Transcriptómica, Proteómica, Metabolómica), con licencia
compatible con GPL-3.0-or-later.

## Convención de nombres de archivos

- `<dataset>_gene.csv` → matriz numérica, filas = muestras, columnas = variables
- `<dataset>_lipid.csv`, `<dataset>_protein.csv`, `<dataset>_miRNA.csv` → otros bloques
- `<dataset>_meta.csv` → metadata categórica: `sample`, `class`/`subtype`/`genotype`/`diet`

Las variables categóricas (clase, genotipo, dieta) van en el `_meta.csv`,
separadas de las matrices numéricas. Esto permite cargar el bloque numérico
con el FileDropzone y luego mapear la clase desde el meta con la columna
`sample` como índice común.