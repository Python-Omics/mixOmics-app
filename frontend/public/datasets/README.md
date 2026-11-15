# Datasets de ejemplo

Datasets canónicos del paquete R `mixOmics`, extraídos con
`scripts/extract_mixomics_datasets.py` y **commiteados al repo** (van en el
bundle de la app, así que el usuario los tiene sin descargar nada).

## Convención

Cada CSV de matriz tiene:

- **una fila por muestra**,
- **una columna por variable**,
- y la **primera columna es el ID de muestra** (`sample`), como pide el
  Avance: *"identificadores de muestra en la primera columna"*.

Los metadatos categóricos (clase, genotipo, dieta) van aparte, en el
`_meta.csv`, con la **misma columna `sample`** para poder alinear por ID y no
por posición (RB-3).

```csv
sample,ACAT1,ACAT2,ACBP,...
X36b4,-0.42,-0.65,-0.84,...
1,-0.44,-0.68,-0.91,...
```

> **Sobre R y Python.** En R la convención habitual de un assay es al revés
> (una fila por feature y una columna por muestra), y la conversión de R a
> numpy depende del tipo del objeto: `nutrimouse$gene` es un `data.frame` y
> `srbct$gene` es una `matrix`, y llegan en órdenes distintos. El script
> **no asume nada**: pide a R una matriz explícita, la rearma con el orden
> conocido y **verifica algunos elementos contra R** antes de escribir. Si
> algo quedara transpuesto, falla ahí y no con un bundle corrupto.

## Datasets

| Dataset | Archivo | Muestras × Variables | Uso en la app |
|---|---|---|---|
| **nutrimouse** | `nutrimouse_gene.csv` | 40 × 120 | DIABLO multi-bloque, sPLS-DA |
| | `nutrimouse_lipid.csv` | 40 × 21 | segundo bloque de DIABLO |
| | `nutrimouse_meta.csv` | 40 × 2 | `genotype`, `diet` |
| **srbct** | `srbct_gene.csv` | 63 × 2308 | sPLS-DA con variable clase |
| | `srbct_meta.csv` | 63 × 1 | `class` |
| **breast.TCGA** | `breast_TCGA_mrna.csv` | 150 × 200 | DIABLO multi-ómico |
| | `breast_TCGA_mirna.csv` | 150 × 184 | segundo bloque |
| | `breast_TCGA_protein.csv` | 150 × 142 | tercer bloque |
| | `breast_TCGA_meta.csv` | 150 × 1 | `subtype` |

Los IDs de muestra son los reales de cada dataset (`EWS.T1…` en srbct,
`A0FJ…` en breast.TCGA), no índices sintéticos: son los que permiten
alinear por ID.

Todos provienen del paquete R `mixOmics` (Kim-Anh Lê Cao et al., mezcla de
datos de Genética, Transcriptómica, Proteómica y Metabolómica), con licencia
compatible con GPL-3.0-or-later.

## Cómo regenerarlos

Requiere R con `mixOmics` y el venv del backend (que tiene `rpy2`):

```bash
cd mixOmics-app
backend/.venv/bin/python scripts/extract_mixomics_datasets.py
```

El script **valida cada bloque contra R antes de terminar** (forma, nombres
de fila y columna, IDs y valores) y **falla** si algo no cuadra, en vez de
dejar un bundle corrupto. Después de generarlos, hay que commitearlos.

## Nota de lectura

Si necesitás comparar los valores **bit a bit** contra R, leé los CSV con
`pd.read_csv(path, float_precision="round_trip")`: el parser rápido de
pandas no redondea bien y pierde el último bit de algunos floats (una
diferencia de 1 ULP, del orden de 1e-16 relativo).
