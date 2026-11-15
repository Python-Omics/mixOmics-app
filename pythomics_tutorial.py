"""
Mini-tutorial de uso de pythomics.

IMPORTANTE: para ejecución del modelo DIABLO, por ahora se requiere
tener R + mixOmics instalado (ya que el modelo es solo un wrapper, por debajo se ejecuta en R)

Todos los plots quedan en tutorial_outputs/

EJECUCIÓN (desde raíz de proyecto):

    source backend/.venv/bin/activate
    python pythomics_tutorial.py

INSTALACIÓN DE R + mixOmics (TEMPORAL)

1) Instalar R (binario del sistema):

       Arch:        sudo pacman -S r
       Ubuntu/Deb:  sudo apt install r-base
       macOS:       brew install r          (o CRAN: https://cran.r-project.org)
       Windows:     instalador desde CRAN

   Verificar: ``which R`` debe devolver la ruta al binario y ``R --version``
   la versión instalada.

2) Instalar el paquete ``mixOmics`` dentro de R (una vez por máquina):

       R
       > install.packages("mixOmics")
       > library(mixOmics)        # no debe tirar error

3) Instalar el puente Python ↔ R (``rpy2``, temporal hasta portar DIABLO):

       cd mixOmics-app/backend
       source .venv/bin/activate
       pip install -e "../../omics[r,viz]"

   El extra ``[r]`` agrega ``rpy2``; el extra ``[viz]`` agrega matplotlib,
   seaborn y pycirclize para los plots. Cuando DIABLO sea nativo Python,
   alcanza solo ``[viz]``.

4) Verificación:

       python -c "import pythomics; from pythomics.models import DIABLOWrapper; \
       from rpy2.robjects.packages import isinstalled; \
       print('mixOmics OK:', isinstalled('mixOmics'))"

   Si imprime ``mixOmics OK: True``, el entorno está listo para correr el
   tutorial.

"""

from pathlib import Path

import numpy as np
import pandas as pd

# IMPORTS de pythomics
from pythomics.tools import NipalsPCA
from pythomics.models import DIABLOWrapper
from pythomics.visualizations import (
    plot_pca,
    plot_biomarkers,
    plot_circos,
    plot_cim,
)


# Paths resueltos relativos a este archivo (``mixOmics-app/``).
BASE = Path(__file__).resolve().parent
DATASETS = BASE / "frontend" / "public" / "datasets"
OUTDIR = BASE / "tutorial_outputs"

PALETTE = {
    "primary": "#2CB67D",
    "text":    "#1F3D2C",
}


def load_nutrimouse(
    gene_csv: Path,
    lipid_csv: Path,
    meta_csv: Path,
) -> tuple[dict[str, pd.DataFrame], pd.Series, pd.DataFrame]:
    """
    Carga nutrimouse desde tres CSVs (genes, lípidos, metadatos).

    """
    for path in (gene_csv, lipid_csv, meta_csv):
        if path.suffix.lower() not in {".csv", ".tsv"}:
            raise ValueError(
                f"RB-14: solo se aceptan .csv o .tsv; "
                f"se recibió {path.suffix} ({path.name})."
            )

    # Meta primero, fuente de verdad para los sample IDs.
    meta = pd.read_csv(meta_csv)
    if "sample" not in meta.columns:
        raise ValueError(
            f"Se esperaba la columna 'sample' en {meta_csv.name}; "
            f"columnas encontradas: {list(meta.columns)}."
        )
    if meta["sample"].duplicated().any():
        raise ValueError(f"RB-1: hay sample IDs duplicados en {meta_csv.name}.")

    # Bloques. Asignamos sample_id copiando del meta fila a fila.
    # index_col=0: el ID de muestra es la primera columna del CSV (la
    # convención del Avance). Sin esto, el ID entraría como una variable más.
    gene_df = pd.read_csv(gene_csv, index_col=0)
    lipid_df = pd.read_csv(lipid_csv, index_col=0)

    # debe haber misma cantidad de filas en los tres archivos.
    if not (len(gene_df) == len(lipid_df) == len(meta)):
        raise ValueError(
            f"RB-3: las filas no coinciden "
            f"(gene={len(gene_df)}, lipid={len(lipid_df)}, meta={len(meta)})."
        )

    sample_ids = meta["sample"].to_numpy()
    gene_df.index = sample_ids
    lipid_df.index = sample_ids
    meta = meta.set_index("sample")

    return {"gene": gene_df, "lipid": lipid_df}, meta["genotype"], meta


def require_r_mixomics() -> None:
    """Falla limpio si falta ``rpy2`` o el paquete ``mixOmics`` en R."""
    try:
        from rpy2.robjects.packages import isinstalled
    except ImportError as exc:
        raise RuntimeError(
            "rpy2 no está disponible. Instalar con:\n"
            "    pip install 'pythomics[r]'\n"
            "y verificar que R esté en PATH (`which R`)."
        ) from exc

    if not isinstalled("mixOmics"):
        raise RuntimeError(
            "El paquete R 'mixOmics' no está instalado. Correr en R:\n"
            "    install.packages('mixOmics')\n"
            "y volver a ejecutar este script."
        )


"""ESTO ES LO IMPORTANTE"""
if __name__ == "__main__":
    # NOTE: por ahora se requiere R + mixOmics instalado.
    # (en un futuro la idea es que sea todo nativo de Python, sin rpy2 ni R)
    require_r_mixomics()
    OUTDIR.mkdir(parents=True, exist_ok=True)

    """ CARGA DE DATOS """
    # Lo que haría POST /v1/cargar/
    # backend recibe archivos .csv/.tsv de usuario y los normaliza a (X_dict, Y, meta)
    # para pasárselos a los modelos
    # - X_dict: la data. es un dict de DataFrames, cada key es un bloque ómico
    # - Y: variable de respuesta (target). es un pd.Series con index=sample_id y valores=clase
    # - meta: metadatos, info sobre las muestras. es un DataFrame con index=sample_id y columnas=metadatos
    # === Endpoints cubiertos aquí ===
    #   POST /v1/cargar/    sube .csv/.tsv y los normaliza
    #   GET  /v1/archivos/  lista los archivos disponibles (lee del mismo DATASETS)
    paths = {
        "gene":  DATASETS / "nutrimouse_gene.csv",
        "lipid": DATASETS / "nutrimouse_lipid.csv",
        "meta":  DATASETS / "nutrimouse_meta.csv",
    }
    X_dict, Y, meta = load_nutrimouse(
        gene_csv=paths["gene"],
        lipid_csv=paths["lipid"],
        meta_csv=paths["meta"],
    )

    print(f"Bloques cargados: {list(X_dict.keys())}")
    for bloque, df in X_dict.items():
        print(f"  - {bloque:6s}: {df.shape[0]} muestras × {df.shape[1]} variables")
    print(f"Y = genotype (distribución: {Y.value_counts().to_dict()})\n")

    """ PCA POR BLOQUE """
    # NipalsPCA
    # === Endpoints cubiertos aquí ===
    #   POST /v1/model/  con  model_type="PCA", n_components en el body
    #                     el backend itera bloques y devuelve paths de figuras al frontend
    for bloque, X in X_dict.items():
        # NipalsPCA es determinista para datos completos: no requiere semilla.
        # Si en el futuro se agrega bootstrap, manejo de NaN o Perf (que sí usa
        # random_state), reintroducir ``np.random.seed(...)`` (RB-6).
        pca = NipalsPCA(n_components=2, center=True, scale=True)
        pca.fit_transform(X)
        
        # lo siguiente es solo una métrica de control que tiene pca para saber cuánta varianza explica 
        # cada componente
        var_ratio = pca.explained_variance_ratio_
        print(f"PCA [{bloque}] varianza explicada: {var_ratio.round(4).tolist()}")
        
        # plot_pca devuelve (fig, ax), backend podría guardar el png y devolver la ruta al frontend?
        fig, _ = plot_pca(
            model=pca,
            metadata=meta,
            hue="genotype",
            title=f"PCA — {bloque}",
        )
        fig.savefig(OUTDIR / f"01_pca_{bloque}.png", dpi=150, bbox_inches="tight")
        print(f"  -> figura: {OUTDIR / f'01_pca_{bloque}.png'}\n")

    """ DIABLO MULTI-BLOQUE """
    # tiene 2 parámetros principales: design y keepX.
    # design: matriz de diseño (bloques x bloques) que indica cuánta correlación se espera entre los bloques.
    # keepX: dict, cada key es un bloque y el valor es una lista con la cantidad de variables a seleccionar por componente.
    # === Endpoints cubiertos aquí ===
    #   POST /v1/model/  con  model_type="DIABLO", design, keepX en el body
    #                     fit + transform + get_biomarkers + plots multi-bloque
    bloques = list(X_dict.keys())
    design = np.full((len(bloques), len(bloques)), 0.1) # lleno de 0.1
    np.fill_diagonal(design, 0.0) # diagonal a 0.0

    keepX = {
        "gene":  [20, 20],   # 20 genes por componente
        "lipid": [10, 10],   # 10 lípidos por componente
    }
    
    # MODELO INSANO
    diablo = DIABLOWrapper(
        n_components=2,
        design=design,
        keepX=keepX,
    )

    diablo.fit(X_dict, Y) 

    # transform devuelve variates/scores  por bloque
    # get_biomarkers devuelve las variables seleccionadas por bloque y componente
    variates = diablo.transform(X_dict)
    for bloque, v in variates.items():
        print(f"DIABLO variates [{bloque}]: shape={v.shape}")

    for bloque in bloques:
        bio = diablo.get_biomarkers(block=bloque, comp=1)
        print(f"Biomarcadores [{bloque} / comp=1]: {len(bio)} variables")
        print(bio.head(5).to_string())
    
    # LO SIGUIENTE ES TODO PLOTS
    # NOTE: es obligatorio pasar group_colors y block_colors
    group_colors = {"1": PALETTE["primary"], "2": PALETTE["text"]}
    block_colors = {"gene": PALETTE["primary"], "lipid": PALETTE["text"]}

    fig, _ = plot_biomarkers(model=diablo, comp=1, top_n=20)
    fig.savefig(OUTDIR / "02_diablo_biomarkers.png", dpi=150, bbox_inches="tight")

    fig_cim = plot_cim(
        model=diablo,
        block_colors=block_colors,
        group_colors=group_colors,
    )
    fig_cim.savefig(OUTDIR / "02_diablo_cim.png", dpi=150, bbox_inches="tight")

    fig, _ = plot_circos(
        model=diablo,
        cutoff=0.5,
        block_colors=block_colors,
        group_colors=group_colors,
    )
    fig.savefig(OUTDIR / "02_diablo_circos.png", dpi=150, bbox_inches="tight")

    """
    TAMBIÉN SE PUEDEN HACER PREDICCIONES CON DIABLO Y USARLO COMO MODELO DE CLASIFICACIÓN, DONDE
    PREDICE Y. POR AHORA ESO NO INTERESA JEJ.
    
    LO QUE DEBE HACER EL BACKEND POR AHORA:
        - Cargar datos multi-bloque (X_dict, Y, meta)
        - NipalsPCA por bloque
        - Ejecución de DIABLO multi-bloque 

          Backend podría guardar todos los resultados y csvs en sistema de archivos y devolver
          al frontend las rutas necesarias para buscarlos?
    """
