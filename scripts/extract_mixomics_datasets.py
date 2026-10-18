#!/usr/bin/env python3
"""
extract_mixomics_datasets.py
============================

Extrae los datasets canónicos del paquete R `mixOmics` y los exporta a CSV,
para empaquetarlos en la app de escritorio Pythomics.

Datasets extraídos:
  - nutrimouse   (40 muestras × 120 genes + 21 lípidos + metadata)
  - srbct        (63 muestras × 2308 genes + clase tumoral)
  - breast.TCGA  (bloques gene + protein + miRNA + subtipo)

Requisitos del sistema:
  - R >= 4.0
  - Paquete R `mixOmics` (instalar con: R -e 'BiocManager::install("mixOmics")')
  - Python >= 3.13 con `rpy2`, `pandas` instalados

Uso:
  cd mixOmics-app
  .venv/bin/python scripts/extract_mixomics_datasets.py

Output:
  frontend/public/datasets/
    nutrimouse_gene.csv
    nutrimouse_lipid.csv
    nutrimouse_meta.csv
    srbct_gene.csv
    srbct_meta.csv
    breast_TCGA_gene.csv
    breast_TCGA_protein.csv
    breast_TCGA_miRNA.csv  (si está disponible en la versión de mixOmics)
    breast_TCGA_meta.csv

Notas:
  - Los CSVs resultantes deberían commitearse al repo (van en el bundle
    de la app). Para datasets muy grandes, considerar Git LFS.
  - Si un dataset no se puede cargar, el script sigue con los demás
    y reporta un warning.
"""

from __future__ import annotations

import sys
import traceback
from pathlib import Path

import pandas as pd
import rpy2.robjects as ro
from rpy2.robjects import pandas2ri
from rpy2.robjects.packages import importr, PackageNotInstalledError

# Nota: en rpy2 >= 3.5, `pandas2ri.activate()` está deprecado.
# La conversión explícita con `pandas2ri.rpy2py(r_obj)` sigue funcionando
# sin necesidad de activar nada global.

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

# mixOmics-app/scripts/extract_mixomics_datasets.py  ->  frontend/public/datasets/
HERE = Path(__file__).resolve().parent
APP_ROOT = HERE.parent
OUTPUT_DIR = APP_ROOT / "frontend" / "public" / "datasets"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _r_to_df(list_name: str, *slots: str) -> pd.DataFrame:
    """Lee un objeto de R y lo convierte a DataFrame de pandas.

    Args:
        list_name: nombre del objeto en el globalenv de R
        *slots: cero o más niveles de acceso (vía `$` / `rx2`)
                Ej: _r_to_df("nutrimouse", "gene")
                    _r_to_df("breast.TCGA", "data.train", "mirna")

    Note: en rpy2, `ro.r["x$y"]` no funciona (busca el símbolo literal "x$y"
    en el globalenv). Hay que usar `ro.r["x"].rx2("y")` por cada nivel.
    """
    r_obj = ro.r[list_name]
    for s in slots:
        r_obj = r_obj.rx2(s)
    try:
        return pd.DataFrame(pandas2ri.rpy2py(r_obj))
    except Exception:
        import numpy as np
        return pd.DataFrame(np.asarray(r_obj))


def _r_factor_to_str(list_name: str, *slots: str) -> list[str]:
    """Lee un factor/vector de R como lista de strings de Python.

    Acepta múltiples niveles de acceso:
        _r_factor_to_str("nutrimouse", "genotype")
        _r_factor_to_str("breast.TCGA", "data.train", "subtype")
    """
    r_obj = ro.r[list_name]
    for s in slots:
        r_obj = r_obj.rx2(s)
    return [str(x) for x in r_obj]


def _save(df: pd.DataFrame, name: str) -> Path:
    """Guarda un DataFrame como CSV con encabezado y reporta el shape."""
    path = OUTPUT_DIR / f"{name}.csv"
    df.to_csv(path, index=False)
    print(f"  → {name}.csv  shape={df.shape}")
    return path


# ---------------------------------------------------------------------------
# Extractors
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
        gene = _r_to_df("nutrimouse", "gene")
        lipid = _r_to_df("nutrimouse", "lipid")
        meta = pd.DataFrame(
            {
                "sample": gene.index.astype(str),
                "genotype": _r_factor_to_str("nutrimouse", "genotype"),
                "diet": _r_factor_to_str("nutrimouse", "diet"),
            }
        )
        _save(gene, "nutrimouse_gene")
        _save(lipid, "nutrimouse_lipid")
        _save(meta, "nutrimouse_meta")
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
        gene = _r_to_df("srbct", "gene")
        meta = pd.DataFrame(
            {
                "sample": gene.index.astype(str),
                "class": _r_factor_to_str("srbct", "class"),
            }
        )
        _save(gene, "srbct_gene")
        _save(meta, "srbct_meta")
        return True
    except Exception as e:
        print(f"  [WARN] Error procesando srbct: {e}")
        traceback.print_exc()
        return False


def extract_breast_TCGA() -> bool:
    """breast.TCGA: datos multi-bloque (gene, protein, miRNA) de cáncer de mama.

    En mixOmics, breast.TCGA$data.train es una lista con varios bloques
   ómicos. Extraemos cada bloque por separado para que la app los
    cargue individualmente.
    """
    print("[breast.TCGA] Cargando desde mixOmics...")
    try:
        importr("mixOmics")
        ro.r("data(breast.TCGA, package = 'mixOmics')")
    except (PackageNotInstalledError, Exception) as e:
        print(f"  [WARN] No se pudo cargar breast.TCGA: {e}")
        return False

    try:
        # Nombres de los bloques (puede variar según versión de mixOmics)
        block_names = [str(n) for n in ro.r("names(breast.TCGA$data.train)")]
        print(f"  bloques detectados: {block_names}")

        # Acceder a breast.TCGA$data.train una vez y reusar
        data_train = ro.r["breast.TCGA"].rx2("data.train")

        # En breast.TCGA, la clase está en $subtype (NO en $y.train).
        subtype = [str(x) for x in data_train.rx2("subtype")]
        n_train = len(subtype)
        meta = pd.DataFrame(
            {
                "sample": [f"sample_{i}" for i in range(n_train)],
                "subtype": subtype,
            }
        )
        _save(meta, "breast_TCGA_meta")

        # Cada bloque (excepto 'subtype' que ya guardamos como meta)
        for i, block_name in enumerate(block_names, start=1):
            if block_name == "subtype":
                continue
            try:
                # Indexar la lista por posición para obtener el bloque i-ésimo
                r_block = data_train[i - 1]  # rpy2 es 0-indexed, R es 1-indexed
                df = pd.DataFrame(pandas2ri.rpy2py(r_block))
                # Sanitizar el nombre para que sea seguro como filename
                safe = "".join(c if c.isalnum() else "_" for c in block_name)
                _save(df, f"breast_TCGA_{safe}")
            except Exception as e:
                print(f"  [WARN] Bloque '{block_name}' falló: {e}")
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