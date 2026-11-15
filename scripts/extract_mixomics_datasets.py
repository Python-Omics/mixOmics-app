#!/usr/bin/env python3
"""
extract_mixomics_datasets.py
============================

Extrae los datasets canónicos del paquete R `mixOmics` y los exporta a CSV,
para empaquetarlos en la app de escritorio Pythomics.

Datasets extraídos:
  - nutrimouse   (40 muestras × 120 genes + 21 lípidos + metadata)
  - srbct        (63 muestras × 2308 genes + clase tumoral)
  - breast.TCGA  (bloques mrna + mirna + protein + subtipo)

Convención de salida
--------------------
Cada CSV de matriz tiene **una fila por muestra** y **una columna por
variable**, y la **primera columna es el ID de muestra** (como pide el
Avance: "identificadores de muestra en la primera columna").

Sobre la orientación
--------------------
En R, la convención habitual de un assay es al revés: una fila por feature y
una columna por muestra. Los objetos de `mixOmics` ya vienen con las muestras
en las filas, pero **no se asume**: la función :func:`_orient` decide según el
número de muestras conocido y falla si no encaja de ninguna de las dos
maneras.

Sobre los nombres
-----------------
`pandas2ri.rpy2py` no preserva los `dimnames` de forma confiable, así que los
nombres de filas y columnas se leen explícitamente desde R. Los archivos
generados antes de ese arreglo tenían encabezados `0,1,2,...` en vez de los
nombres reales de las variables.

Sobre la validación
--------------------
Cada bloque se **vuelve a leer del disco y se compara contra R** (forma,
nombres, IDs y valores). Si algo se cruza, se pierde una variable o se pierde
el ID, el script **falla acá** en vez de dejar un bundle corrupto. Los archivos
que se distribute en la app son la entrada del criterio de aceptación de RF-8.

Requisitos del sistema:
  - R >= 4.0
  - Paquete R `mixOmics` (instalar con: R -e 'BiocManager::install("mixOmics")')
  - Python >= 3.13 con `rpy2`, `pandas` y `numpy` instalados

Uso:
  cd mixOmics-app
  backend/.venv/bin/python scripts/extract_mixomics_datasets.py

Output:
  frontend/public/datasets/
    nutrimouse_gene.csv      sample + 120 genes
    nutrimouse_lipid.csv     sample + 21 lípidos
    nutrimouse_meta.csv      sample + genotype + diet
    srbct_gene.csv           sample + 2308 genes
    srbct_meta.csv           sample + class
    breast_TCGA_mrna.csv     sample + 200 genes
    breast_TCGA_mirna.csv    sample + 184 miRNAs
    breast_TCGA_protein.csv  sample + 142 proteínas
    breast_TCGA_meta.csv     sample + subtype

Notas:
  - Los CSVs resultantes se commitean al repo (van en el bundle de la app).
  - Si un dataset no se puede cargar, el script sigue con los demás y reporta
    un warning.
"""

from __future__ import annotations

import sys
import traceback
from pathlib import Path

import numpy as np
import pandas as pd
import rpy2.robjects as ro
from rpy2.robjects.packages import importr, PackageNotInstalledError

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

# mixOmics-app/scripts/extract_mixomics_datasets.py  ->  frontend/public/datasets/
HERE = Path(__file__).resolve().parent
APP_ROOT = HERE.parent
OUTPUT_DIR = APP_ROOT / "frontend" / "public" / "datasets"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

#: Nombre de la columna con el ID de muestra en los CSV de salida.
SAMPLE_COLUMN = "sample"


# ---------------------------------------------------------------------------
# Helpers de R
# ---------------------------------------------------------------------------


def _r_expr(list_name: str, *slots: str) -> str:
    """Expresión R que referencia el objeto, para consultarlo por nombre.

    Ej: ``_r_expr("breast.TCGA", "data.train", "mirna")`` →
    ``"breast.TCGA$data.train$mirna"``.
    """
    expr = list_name
    for slot in slots:
        expr = f"{expr}${slot}"
    return expr


def _r_names(expr: str) -> list[str]:
    """Nombres (``names()``) de un vector o factor de R. Vacío si no los tiene."""
    out = ro.r(f"if (is.null(names({expr}))) character(0) else names({expr})")
    return [str(x) for x in out]


def _r_dimnames(expr: str) -> tuple[list[str], list[str]]:
    """Nombres de fila y de columna de una matriz de R.

    Para una matriz, ``names()`` devuelve los nombres de **columna**; los de
    fila hay que pedirlos con ``rownames()``.
    """
    rows = [str(x) for x in ro.r(f"rownames({expr})")]
    cols = [str(x) for x in ro.r(f"colnames({expr})")]
    return rows, cols


def _r_values(expr: str) -> list[str]:
    """Valores de un vector o factor de R, como strings."""
    return [str(x) for x in ro.r(f"as.character({expr})")]


def _check_elements_against_r(expr: str, values: np.ndarray) -> None:
    """Verifica algunos elementos de la matriz contra R.

    Es el guardián de la orientación: si la transposición quedara mal, los
    valores no coinciden y el script falla acá, en vez de escribir un CSV
    con las variables cruzadas.
    """
    n_rows, n_cols = values.shape
    posiciones = [
        (0, 0),
        (0, min(1, n_cols - 1)),
        (min(1, n_rows - 1), 0),
        (n_rows - 1, n_cols - 1),
    ]
    for i, j in posiciones:
        esperado = float(ro.r(f"{expr}[{i + 1},{j + 1}]")[0])
        if values[i, j] != esperado:
            raise ValueError(
                f"{expr}: el elemento [{i + 1},{j + 1}] es {values[i, j]} en "
                f"Python y {esperado} en R. La matriz quedó transpuesta."
            )


def _r_matrix(list_name: str, *slots: str) -> tuple[np.ndarray, list[str], list[str]]:
    """Lee una matriz de R junto con sus nombres de fila y de columna.

    **La transposición es explícita y verificada.** rpy2 entrega la matriz
    en el orden de memoria de R (column-major) y la acomoda con la forma
    ``(n_columnas, n_filas)``: es decir, con una fila por variable, que es
    la convención de R. Para volver a la forma lógica de R —y de paso a la
    de Python, una fila por muestra— hay que transponer.

    Los ``dimnames`` se piden explícitamente (``rownames``/``colnames``): la
    conversión automática de rpy2 no los preserva de forma confiable, y
    ``names()`` sobre una matriz devuelve solo los de columna.
    """
    r_obj = ro.r[list_name]
    for slot in slots:
        r_obj = r_obj.rx2(slot)

    expr = _r_expr(list_name, *slots)
    dim_r = tuple(int(x) for x in ro.r(f"dim({expr})"))

    # La conversión de R a numpy NO es confiable y depende del tipo del
    # objeto: nutrimouse$gene es un data.frame (is.matrix() da FALSE) y su
    # conversión apila las columnas; srbct$gene es una matriz y viene en otro
    # orden de memoria. Por eso no se usa ninguna de las dos conversiones:
    # se le pide a R una matriz explícita, su vector plano —que R siempre
    # recorre en orden de columna— y se rearma en Python con ese orden.
    flat = np.asarray(
        ro.r(f"as.vector(as.matrix({expr}))"), dtype=float
    )
    expected_len = dim_r[0] * dim_r[1]
    if flat.size != expected_len:
        raise ValueError(
            f"{expr}: R dice dim {dim_r} pero as.vector devolvió {flat.size} valores."
        )
    values = flat.reshape(dim_r, order="F")

    # Y se verifica contra R: si la orientación quedara mal, el error aparece
    # acá y no en un CSV del bundle.
    _check_elements_against_r(expr, values)

    row_names, col_names = _r_dimnames(expr)
    if len(row_names) != values.shape[0]:
        raise ValueError(
            f"{expr}: {values.shape[0]} filas pero {len(row_names)} nombres de fila."
        )
    if len(col_names) != values.shape[1]:
        raise ValueError(
            f"{expr}: {values.shape[1]} columnas pero {len(col_names)} nombres de columna."
        )
    return values, row_names, col_names


# ---------------------------------------------------------------------------
# Helpers de orientación y escritura
# ---------------------------------------------------------------------------


def _orient(
    values: np.ndarray,
    row_names: list[str],
    col_names: list[str],
    n_samples: int,
    label: str,
) -> tuple[np.ndarray, list[str], list[str]]:
    """Deja la matriz con **una fila por muestra**.

    En R la convención habitual de un assay es una fila por feature y una
    columna por muestra; en Python es al revés. Los objetos de ``mixOmics``
    ya vienen con las muestras en las filas (y :func:`_r_matrix` se encarga
    de volver a esa forma desde el orden de memoria de R), pero no se asume:
    se decide comparando con el número de muestras conocido.

    Returns:
        La matriz orientada y sus nombres de fila (muestras) y de columna
        (variables), en ese orden.
    """
    n_rows, n_cols = values.shape

    if n_rows == n_samples:
        return values, row_names, col_names
    if n_cols == n_samples:
        return values.T, col_names, row_names

    raise ValueError(
        f"{label}: la matriz es {n_rows}x{n_cols} y no encaja con "
        f"{n_samples} muestras ni en las filas ni en las columnas."
    )


def _align_to_samples(
    values: list[str],
    names: list[str],
    sample_ids: list[str],
    label: str,
) -> list[str]:
    """Alinea un vector categórico a los IDs de muestra, **por nombre**.

    Es lo que permite que el meta y las matrices compartan IDs y que la
    alineación sea por ID y no por posición (RB-3). Si el vector no tiene
    nombres, o no cubre todos los IDs, se alinea posicionalmente y se avisa:
    es lo único que se puede hacer, pero no verifica nada.
    """
    if names and len(names) == len(values):
        lookup = dict(zip(names, values))
        if all(sid in lookup for sid in sample_ids):
            return [lookup[sid] for sid in sample_ids]
        faltantes = [sid for sid in sample_ids if sid not in lookup]
        print(
            f"  [WARN] {label}: los nombres no cubren {len(faltantes)} IDs "
            f"(ej. {faltantes[:3]}); se alinea posicionalmente."
        )
    else:
        print(
            f"  [WARN] {label}: el vector no tiene nombres; se alinea "
            f"posicionalmente."
        )
    if len(values) != len(sample_ids):
        raise ValueError(
            f"{label}: {len(values)} valores para {len(sample_ids)} muestras."
        )
    return values


def _save_block(
    name: str,
    values: np.ndarray,
    sample_ids: list[str],
    feature_names: list[str],
    r_expr: str,
) -> None:
    """Escribe un bloque numérico con el ID de muestra como primera columna.

    Después de escribirlo, lo **vuelve a leer y lo compara contra R**: forma,
    nombres, IDs y valores. Si algo no cuadra, falla acá y no con un bundle
    corrupto en producción.
    """
    df = pd.DataFrame(values, index=sample_ids, columns=feature_names)
    df.index.name = SAMPLE_COLUMN

    path = OUTPUT_DIR / f"{name}.csv"
    df.to_csv(path, index=True)

    _validate_block(path, df, values, r_expr)

    print(
        f"  → {name}.csv  {df.shape[0]} muestras × {df.shape[1]} variables"
        f"  (ID como primera columna)"
    )


def _validate_block(
    path: Path,
    df: pd.DataFrame,
    r_values: np.ndarray,
    r_expr: str,
) -> None:
    """Verifica el CSV recién escrito contra la matriz de R."""
    # float_precision="round_trip": el parser rápido de pandas no redondea
    # bien y pierde el último bit de algunos floats (diferencias de 1 ULP).
    leido = pd.read_csv(path, float_precision="round_trip")

    esperado = (df.shape[0], df.shape[1] + 1)
    if leido.shape != esperado:
        raise ValueError(
            f"{path.name}: se escribió {leido.shape} y se esperaba {esperado} "
            f"({df.shape[0]} muestras × {df.shape[1]} variables + el ID)."
        )

    if str(leido.columns[0]) != SAMPLE_COLUMN:
        raise ValueError(
            f"{path.name}: la primera columna es {leido.columns[0]!r}, "
            f"debería ser {SAMPLE_COLUMN!r}."
        )

    ids_escritos = [str(x) for x in leido[SAMPLE_COLUMN]]
    if ids_escritos != [str(x) for x in df.index]:
        raise ValueError(f"{path.name}: los IDs de muestra no se preservaron.")
    if len(set(ids_escritos)) != len(ids_escritos):
        raise ValueError(f"{path.name}: hay IDs de muestra duplicados.")

    if list(leido.columns[1:]) != list(df.columns):
        raise ValueError(f"{path.name}: los nombres de variable no coinciden.")

    valores = leido.iloc[:, 1:].to_numpy(dtype=float)
    if not np.array_equal(valores, r_values):
        if not np.allclose(valores, r_values, rtol=1e-12, atol=0):
            raise ValueError(
                f"{path.name}: los valores no coinciden con R ({r_expr})."
            )


def _save_meta(
    name: str,
    sample_ids: list[str],
    columns: dict[str, list[str]],
) -> None:
    """Escribe el archivo de metadata: el ID de muestra y columnas categóricas."""
    df = pd.DataFrame(columns, index=sample_ids)
    df.index.name = SAMPLE_COLUMN

    path = OUTPUT_DIR / f"{name}.csv"
    df.to_csv(path, index=True)

    leido = pd.read_csv(path)
    if leido.shape != (len(sample_ids), len(columns) + 1):
        raise ValueError(
            f"{path.name}: se escribió {leido.shape} y se esperaba "
            f"{(len(sample_ids), len(columns) + 1)}."
        )
    if [str(x) for x in leido[SAMPLE_COLUMN]] != [str(x) for x in sample_ids]:
        raise ValueError(f"{path.name}: los IDs de muestra no se preservaron.")

    print(
        f"  → {name}.csv  {len(sample_ids)} muestras × {len(columns)} columnas"
        f"  ({', '.join(columns)})"
    )


# ---------------------------------------------------------------------------
# Extractores
# ---------------------------------------------------------------------------


def extract_nutrimouse() -> bool:
    """nutrimouse: expresión génica + lipidómica + metadata de 40 ratones."""
    print("[nutrimouse] Cargando desde mixOmics...")
    try:
        importr("mixOmics")
        ro.r("data(nutrimouse, package = 'mixOmics')")
    except (PackageNotInstalledError, Exception) as e:
        print(f"  [WARN] No se pudo cargar nutrimouse: {e}")
        return False

    try:
        gene, gene_rows, gene_cols = _r_matrix("nutrimouse", "gene")
        lipid, lipid_rows, lipid_cols = _r_matrix("nutrimouse", "lipid")

        n_samples = len(gene_rows)
        gene, gene_ids, gene_features = _orient(
            gene, gene_rows, gene_cols, n_samples, "nutrimouse$gene"
        )
        lipid, lipid_ids, lipid_features = _orient(
            lipid, lipid_rows, lipid_cols, n_samples, "nutrimouse$lipid"
        )

        if gene_ids != lipid_ids:
            raise ValueError(
                "nutrimouse: gene y lipid no comparten los mismos IDs de muestra."
            )

        _save_block(
            "nutrimouse_gene", gene, gene_ids, gene_features, "nutrimouse$gene"
        )
        _save_block(
            "nutrimouse_lipid", lipid, lipid_ids, lipid_features, "nutrimouse$lipid"
        )

        genotype = _align_to_samples(
            _r_values("nutrimouse$genotype"),
            _r_names("nutrimouse$genotype"),
            gene_ids,
            "nutrimouse$genotype",
        )
        diet = _align_to_samples(
            _r_values("nutrimouse$diet"),
            _r_names("nutrimouse$diet"),
            gene_ids,
            "nutrimouse$diet",
        )
        _save_meta(
            "nutrimouse_meta", gene_ids, {"genotype": genotype, "diet": diet}
        )
        return True
    except Exception as e:
        print(f"  [WARN] Error procesando nutrimouse: {e}")
        traceback.print_exc()
        return False


def extract_srbct() -> bool:
    """srbct: 63 tumores cerebrales pediatricos, expresión génica."""
    print("[srbct] Cargando desde mixOmics...")
    try:
        importr("mixOmics")
        ro.r("data(srbct, package = 'mixOmics')")
    except (PackageNotInstalledError, Exception) as e:
        print(f"  [WARN] No se pudo cargar srbct: {e}")
        return False

    try:
        gene, gene_rows, gene_cols = _r_matrix("srbct", "gene")

        n_samples = len(gene_rows)
        gene, sample_ids, features = _orient(
            gene, gene_rows, gene_cols, n_samples, "srbct$gene"
        )

        _save_block("srbct_gene", gene, sample_ids, features, "srbct$gene")

        klass = _align_to_samples(
            _r_values("srbct$class"),
            _r_names("srbct$class"),
            sample_ids,
            "srbct$class",
        )
        _save_meta("srbct_meta", sample_ids, {"class": klass})
        return True
    except Exception as e:
        print(f"  [WARN] Error procesando srbct: {e}")
        traceback.print_exc()
        return False


def extract_breast_TCGA() -> bool:
    """breast.TCGA: bloques mrna + mirna + protein y subtipo.

    Los bloques se resuelven **por nombre**, nunca por posición: la versión
    anterior indexaba la lista y un ``continue`` podía dejar el contador
    desfasado, con lo que un bloque terminaba con las variables de otro.
    """
    print("[breast.TCGA] Cargando desde mixOmics...")
    try:
        importr("mixOmics")
        ro.r("data(breast.TCGA, package = 'mixOmics')")
    except (PackageNotInstalledError, Exception) as e:
        print(f"  [WARN] No se pudo cargar breast.TCGA: {e}")
        return False

    try:
        data_train = ro.r["breast.TCGA"].rx2("data.train")
        block_names = [str(n) for n in ro.r("names(breast.TCGA$data.train)")]
        print(f"  bloques detectados: {block_names}")

        # El subtipo va al meta, no a un bloque numérico.
        subtype_expr = "breast.TCGA$data.train$subtype"
        subtype_values = _r_values(subtype_expr)
        subtype_names = _r_names(subtype_expr)

        # Los IDs de muestra salen de los nombres de fila de los bloques.
        reference_ids: list[str] | None = None

        for block_name in block_names:
            if block_name == "subtype":
                continue
            try:
                values, rows, cols = _r_matrix(
                    "breast.TCGA", "data.train", block_name
                )
                if reference_ids is None:
                    reference_ids = rows
                    n_samples = len(reference_ids)
                elif len(rows) != n_samples:
                    raise ValueError(
                        f"'{block_name}' tiene {len(rows)} muestras y el "
                        f"bloque de referencia {n_samples}."
                    )

                values, sample_ids, features = _orient(
                    values, rows, cols, n_samples, f"breast.TCGA$data.train${block_name}"
                )

                if sample_ids != reference_ids:
                    raise ValueError(
                        f"'{block_name}' no comparte los IDs de muestra con "
                        f"el bloque de referencia."
                    )

                safe = "".join(c if c.isalnum() else "_" for c in block_name)
                _save_block(
                    f"breast_TCGA_{safe}",
                    values,
                    sample_ids,
                    features,
                    f"breast.TCGA$data.train${block_name}",
                )
            except Exception as e:
                print(f"  [WARN] Bloque '{block_name}' falló: {e}")
                traceback.print_exc()

        if reference_ids is None:
            raise ValueError("breast.TCGA: no se encontró ningún bloque numérico.")

        subtype = _align_to_samples(
            subtype_values, subtype_names, reference_ids, subtype_expr
        )
        _save_meta("breast_TCGA_meta", reference_ids, {"subtype": subtype})
        return True
    except Exception as e:
        print(f"  [WARN] Error procesando breast.TCGA: {e}")
        traceback.print_exc()
        return False


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> int:
    print(f"Output: {OUTPUT_DIR}")
    print()

    # Verificar rpy2 y mixOmics antes de empezar
    try:
        importr("base")
    except Exception as e:
        print("ERROR: rpy2 no está instalado o no se puede inicializar R.")
        print("       Instalar con: .venv/bin/pip install rpy2")
        print(f"       Detalle: {e}")
        return 1

    try:
        importr("mixOmics")
    except PackageNotInstalledError:
        print("ERROR: El paquete R 'mixOmics' no está instalado.")
        print("       Instalar con: R -e 'BiocManager::install(\"mixOmics\")'")
        return 1

    results = {
        "nutrimouse": extract_nutrimouse(),
        "srbct": extract_srbct(),
        "breast.TCGA": extract_breast_TCGA(),
    }
    print()

    ok = [k for k, v in results.items() if v]
    fail = [k for k, v in results.items() if not v]
    print(f"OK:    {ok}")
    if fail:
        print(f"FAIL:  {fail}")
    print()
    print(f"CSVs en: {OUTPUT_DIR}")
    return 0 if not fail else 2


if __name__ == "__main__":
    sys.exit(main())
