#!/usr/bin/env python3
"""
generate_home_figure.py
=======================

Genera los datos de la **banda multi-omics** de la pantalla de Inicio y los
escribe en ``frontend/src/lib/home-figure-data.ts`` (el módulo que consume
``frontend/src/components/BiologyBand.tsx``).

Los datos **NO son inventados**: son los mismos del artboard
``design/home-biology-figure/02-multiomics-band.html``, que a su vez los
calcula ``design/tools/build_artboards.py``:

* PCA  -> ``pythomics.tools.NipalsPCA`` (center=True, scale=False,
  n_components=2) sobre ``nutrimouse_gene.csv`` (40 muestras x 120 genes).
* Clases -> columna ``genotype`` de ``nutrimouse_meta.csv`` (``wt`` / ``ppar``).
* Heat map -> z-score por variable sobre las mismas 40 muestras, saturado en
  +-2.0, con la rampa divergente ``slate-700 -> --p-100 -> --p-400``.
* Circos -> correlacion de Pearson real entre ``nutrimouse_gene.csv`` y
  ``nutrimouse_lipid.csv`` (40 muestras x 21 lipidos). El anillo lleva una
  variable por sector (los genes arriba, los lipidos abajo) y las cuerdas son
  los pares con ``|r| >= CIRCOS_THRESHOLD`` (0.70). Las pistas de clase son el
  perfil (media en z) de ``wt`` y de ``ppar`` variable por variable.

El renderer **no calcula nada**: este script deja los números (coordenadas,
paths, porcentajes de la rampa) inline en el TypeScript.

Verificación
------------
Antes de escribir, el script **compara el markup que genera con el markup
inline del artboard**, bloque por bloque. Si divergen, falla en vez de dejar
una figura que ya no corresponde con el diseño aprobado.

Uso (desde la raiz del repo)::

    backend/.venv/bin/python scripts/generate_home_figure.py

Salida:
    frontend/src/lib/home-figure-data.ts

Requisitos:
  - Python >= 3.13 con ``numpy``, ``pandas`` y ``pythomics`` (el venv del
    backend: ``backend/.venv``).
"""

from __future__ import annotations

import hashlib
import math
import re
import sys
from pathlib import Path

import numpy as np
import pandas as pd

from pythomics.tools import NipalsPCA

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
HERE = Path(__file__).resolve().parent
APP_ROOT = HERE.parent
DATASETS = APP_ROOT / "frontend" / "public" / "datasets"
GENE_CSV = DATASETS / "nutrimouse_gene.csv"
LIPID_CSV = DATASETS / "nutrimouse_lipid.csv"
META_CSV = DATASETS / "nutrimouse_meta.csv"
OUT_TS = APP_ROOT / "frontend" / "src" / "lib" / "home-figure-data.ts"
ARTBOARD = APP_ROOT / "design" / "home-biology-figure" / "02-multiomics-band.html"

# --- Tokens del tema por defecto (frontend/src/styles/globals.css) ----------
P = {
    "50": "#f9fffb", "100": "#dff7e8", "200": "#9be7b1", "300": "#64cf97",
    "400": "#2cb67d", "500": "#20835a", "600": "#1d7651", "700": "#1f3d2c",
    "800": "#1a3425", "900": "#15291e",
}
SLATE = {
    "100": "#f1f5f9", "200": "#e2e8f0", "300": "#cbd5e1", "400": "#94a3b8",
    "500": "#64748b", "600": "#475569", "700": "#334155", "900": "#0f172a",
}

#: Saturacion de la rampa divergente (los z reales van de -2.60 a +2.55).
Z_CLAMP = 2.0

#: Geometria de los tres paneles (identica a la del artboard).
SCATTER_VIEWBOX = (0, 0, 420, 290)
CIRCOS_VIEWBOX = (0, 0, 340, 290)
HEAT_VIEWBOX = (0, 0, 468, 290)

# Circos de mixOmics (el panel del medio de la banda)
# --------------------------------------------------------------------------- #
# Geometria (viewBox 340 x 290, el mismo que el panel de la doble helice
# que ocupaba antes: ahora es el circos).
CIRCOS_CX, CIRCOS_CY = 170.0, 145.0
CIRCOS_ARC_OUT = 122.0   # borde exterior del anillo de sectores
CIRCOS_ARC_IN = 115.0    # borde interior (ahi se enganchan las cuerdas)
CIRCOS_TRACK_BASE = 105.0  # radio base de las pistas de clase
CIRCOS_TRACK_AMP = 9.0   # amplitud (px) del perfil de clase
CIRCOS_LABEL_R = 129.0    # radio de la linea base de las etiquetas
CIRCOS_Z_CLAMP = 1.5      # saturacion del perfil de clase
CIRCOS_GAP = 1.2          # hueco (grados) entre sectores
#: Umbral de |r| de las cuerdas. Con 0.70 quedan 11 vinculos (el maximo del
#: dataset es 0.785): ni un nudo ni un anillo vacio. Con 0.65 serian 25.
CIRCOS_THRESHOLD = 0.70


def polar(radius: float, degrees: float) -> tuple[float, float]:
    """Punto del anillo. Los grados van en sentido horario desde las 12."""
    rad = math.radians(degrees)
    return (
        CIRCOS_CX + radius * math.sin(rad),
        CIRCOS_CY - radius * math.cos(rad),
    )


def arc_path(radius: float, a0: float, a1: float) -> str:
    """Arco del anillo entre dos angulos (sentido horario)."""
    x0, y0 = polar(radius, a0)
    x1, y1 = polar(radius, a1)
    large = 1 if abs(a1 - a0) > 180.0 else 0
    return f"M{n(x0)} {n(y0)}A{n(radius)} {n(radius)} 0 {large} 1 {n(x1)} {n(y1)}"


def zscore(frame: pd.DataFrame) -> pd.DataFrame:
    """z-score por variable (media 0, desviacion 1) sobre las 40 muestras."""
    return (frame - frame.mean()) / frame.std(ddof=1)


def block_correlation(gene: pd.DataFrame, lipid: pd.DataFrame) -> pd.DataFrame:
    """Pearson entre cada gen y cada lipid (las 40 muestras en comun)."""
    g = gene.drop(columns=["sample"]).to_numpy(float)
    l = lipid.drop(columns=["sample"]).to_numpy(float)
    r = np.corrcoef(g.T, l.T)[: g.shape[1], g.shape[1]:]
    return pd.DataFrame(
        r,
        index=list(gene.drop(columns=["sample"]).columns),
        columns=list(lipid.drop(columns=["sample"]).columns),
    )


def class_profile(z: pd.DataFrame, names: list[str], rows: list[int]) -> list[float]:
    """Media (en z) de cada variable dentro de una clase."""
    out = []
    for name in names:
        col = z.columns.get_loc(name)
        out.append(float(z.iloc[rows, col].mean()))
    return out


# --------------------------------------------------------------------------- #
# Helpers de color
# --------------------------------------------------------------------------- #
def lerp_hex(a: str, b: str, t: float) -> str:
    """Interpola dos hex en sRGB."""
    av = [int(a[i:i + 2], 16) for i in (1, 3, 5)]
    bv = [int(b[i:i + 2], 16) for i in (1, 3, 5)]
    out = [round(av[i] + (bv[i] - av[i]) * t) for i in range(3)]
    return "#%02x%02x%02x" % tuple(out)


def ramp(z: float) -> tuple[str, str]:
    """Rampa divergente de expresion: slate-700 -> --p-100 -> --p-400.

    Tres anclas bien separadas: azul-gris oscuro (reprimida), casi blanco
    (sin cambio) y verde vivo (inducida). El pivote casi blanco deja que el
    patron se lea: las celdas neutras se apagan y las extremas destacan.

    Devuelve el hex del tema por defecto (fallback) y la mezcla con
    custom properties, que es la que sigue al tema ``data-theme``.
    """
    z = max(-Z_CLAMP, min(Z_CLAMP, float(z)))
    if z < 0:
        t = -z / Z_CLAMP
        hexa = lerp_hex(SLATE["700"], P["100"], t)
        # El formato es identico al del artboard: la comparacion es byte a byte.
        mix = f"color-mix(in srgb,var(--slate-700) {t * 100:.1f}%,var(--p-100))"
    else:
        t = z / Z_CLAMP
        hexa = lerp_hex(P["100"], P["400"], t)
        mix = f"color-mix(in srgb,var(--p-400) {t * 100:.1f}%,var(--p-100))"
    return hexa, mix


def n(value: float) -> str:
    """Numero compacto para atributos SVG (un decimal, sin ceros de mas)."""
    return f"{value:.1f}".rstrip("0").rstrip(".")


def ts_num(value: float) -> str:
    """Numero para el TypeScript: mismo redondeo que ``n()``, sin comillas."""
    return n(value)


def diamond(cx: float, cy: float, r: float) -> str:
    """Path de un rombo (la clase ``ppar`` del PCA)."""
    d = r * 0.72
    return (
        f"M{n(cx)} {n(cy - d)}L{n(cx + d)} {n(cy)}L{n(cx)} {n(cy + d)}"
        f"L{n(cx - d)} {n(cy)}Z"
    )


def polyline(points: list[tuple[float, float]]) -> str:
    """Path de una polilinea."""
    head = f"M{n(points[0][0])} {n(points[0][1])}"
    rest = " ".join(f"L{n(x)} {n(y)}" for x, y in points[1:])
    return f"{head} {rest}"


def smooth_closed(points: list[tuple[float, float]]) -> str:
    """Curva cerrada y suave (Catmull-Rom -> Bezier) que interpola los puntos.

    Los valores siguen siendo los del dato (una media por variable y clase):
    lo unico que cambia es la interpolacion, para que la pista se lea como un
    perfil y no como un poligono de 14 lados.
    """
    count = len(points)
    head = f"M{n(points[0][0])} {n(points[0][1])}"
    rest = []
    for i in range(count):
        p0 = points[(i - 1) % count]
        p1 = points[i]
        p2 = points[(i + 1) % count]
        p3 = points[(i + 2) % count]
        c1 = (p1[0] + (p2[0] - p0[0]) / 6.0, p1[1] + (p2[1] - p0[1]) / 6.0)
        c2 = (p2[0] - (p3[0] - p1[0]) / 6.0, p2[1] - (p3[1] - p1[1]) / 6.0)
        rest.append(
            f"C{n(c1[0])} {n(c1[1])} {n(c2[0])} {n(c2[1])} {n(p2[0])} {n(p2[1])}"
        )
    return f"{head} " + " ".join(rest) + "Z"


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


# --------------------------------------------------------------------------- #
# Datos
# --------------------------------------------------------------------------- #
def load_data() -> dict:
    """Carga los bloques de genes y lipidos, el meta, y calcula el PCA."""
    gene = pd.read_csv(GENE_CSV)
    lipid = pd.read_csv(LIPID_CSV)
    meta = pd.read_csv(META_CSV)

    # Los IDs tienen que coincidir sample a sample (alineacion por ID).
    if list(gene["sample"]) != list(meta["sample"]):
        raise SystemExit(
            "Los IDs de nutrimouse_gene.csv y nutrimouse_meta.csv no coinciden"
        )
    if list(gene["sample"]) != list(lipid["sample"]):
        raise SystemExit(
            "Los IDs de nutrimouse_gene.csv y nutrimouse_lipid.csv no coinciden"
        )

    frame = gene.drop(columns=["sample"])
    values = frame.to_numpy(float)
    pca = NipalsPCA(n_components=2, center=True, scale=False).fit(values)

    # z-score por variable sobre las 40 muestras (pooled, comparable entre genes).
    z = (frame - frame.mean()) / frame.std(ddof=1)

    return {
        "scores": pca.variates_,
        "classes": meta["genotype"].tolist(),
        "z": z,
        "vars": list(frame.columns),
        "evr": pca.explained_variance_ratio_,
        "gene": gene,
        "lipid": lipid,
    }


# --------------------------------------------------------------------------- #
# Geometria (misma que design/tools/build_artboards.py::build_02)
# --------------------------------------------------------------------------- #
def build_scatter(scores: np.ndarray, classes: list[str]) -> dict:
    """Panel A: scatter del PCA (ejes, grilla y los 40 puntos)."""
    pc1, pc2 = scores[:, 0], scores[:, 1]
    px0, px1, py0, py1 = 44.0, 396.0, 16.0, 250.0

    grid = []
    for i in range(1, 4):
        gx = px0 + (px1 - px0) * i / 4
        grid.append((gx, py0, gx, py1))
    for i in range(1, 3):
        gy = py0 + (py1 - py0) * i / 3
        grid.append((px0, gy, px1, gy))
    axes = [(px0, py0, px0, py1), (px0, py1, px1, py1)]

    marks = []
    for i in range(len(pc1)):
        x = px0 + (pc1[i] - pc1.min()) / (pc1.max() - pc1.min()) * (px1 - px0)
        y = py1 - (pc2[i] - pc2.min()) / (pc2.max() - pc2.min()) * (py1 - py0)
        if classes[i] == "wt":
            marks.append({"kind": "wt", "x": x, "y": y})
        else:
            marks.append({"kind": "ppar", "x": x, "y": y, "d": diamond(x, y, 4.4)})

    return {"grid": grid, "axes": axes, "marks": marks}


def build_circos(gene: pd.DataFrame, lipid: pd.DataFrame, classes: list[str]) -> dict:
    """Circos de mixOmics: anillo por bloques + cuerdas por correlacion real.

    * El anillo lleva una variable por sector: los genes en el medio
      superior y los lipidos en el inferior.
    * Las cuerdas son los pares gen/lipido con |r| >= ``CIRCOS_THRESHOLD``
      (Pearson sobre las 40 muestras en comun).
    * Las pistas de clase son el perfil (media en z) de ``wt`` y de ``ppar``
      variable por variable, siguiendo el anillo.
    """
    r = block_correlation(gene, lipid)
    keep = r.abs() >= CIRCOS_THRESHOLD
    gene_names = [c for c in r.index if bool(keep.loc[c].any())]
    lipid_names = [c for c in r.columns if bool(keep[c].any())]

    links = []
    for gname in gene_names:
        for lname in lipid_names:
            value = float(r.loc[gname, lname])
            if abs(value) >= CIRCOS_THRESHOLD:
                links.append({"gene": gname, "lipid": lname, "r": value})
    # De mas fuerte a mas debil: la mas fuerte queda encima.
    links.sort(key=lambda item: -abs(item["r"]))

    # El anillo: medio circulo de genes (arriba) y medio de lipidos (abajo).
    ring = []
    n_gene, n_lipid = len(gene_names), len(lipid_names)
    for i, name in enumerate(gene_names):
        a0 = -90.0 + 180.0 * i / n_gene
        a1 = -90.0 + 180.0 * (i + 1) / n_gene
        ring.append({
            "name": name, "block": "gene",
            "a0": a0, "a1": a1, "mid": (a0 + a1) / 2,
        })
    for i, name in enumerate(lipid_names):
        a0 = 90.0 + 180.0 * i / n_lipid
        a1 = 90.0 + 180.0 * (i + 1) / n_lipid
        ring.append({
            "name": name, "block": "lipid",
            "a0": a0, "a1": a1, "mid": (a0 + a1) / 2,
        })

    # Pistas de clase: perfil (media en z) de wt y de ppar, variable por variable.
    z_gene = zscore(gene.drop(columns=["sample"]))
    z_lipid = zscore(lipid.drop(columns=["sample"]))
    wt_rows = [i for i, c in enumerate(classes) if c == "wt"]
    ppar_rows = [i for i, c in enumerate(classes) if c == "ppar"]
    profiles = {
        "wt": (
            class_profile(z_gene, gene_names, wt_rows)
            + class_profile(z_lipid, lipid_names, wt_rows)
        ),
        "ppar": (
            class_profile(z_gene, gene_names, ppar_rows)
            + class_profile(z_lipid, lipid_names, ppar_rows)
        ),
    }

    tracks = {}
    for key, values in profiles.items():
        points = []
        for item, value in zip(ring, values):
            z = max(-CIRCOS_Z_CLAMP, min(CIRCOS_Z_CLAMP, value))
            points.append(
                polar(CIRCOS_TRACK_BASE + CIRCOS_TRACK_AMP * z, item["mid"])
            )
        tracks[key] = smooth_closed(points)

    # Cuerdas: del sector del gen al sector del lipid, con el centro como
    # punto de control (la curva entra hacia el medio del circulo).
    max_abs = max((abs(link["r"]) for link in links), default=CIRCOS_THRESHOLD)
    span = max_abs - CIRCOS_THRESHOLD
    mid_gene = {item["name"]: item["mid"] for item in ring if item["block"] == "gene"}
    mid_lipid = {item["name"]: item["mid"] for item in ring if item["block"] == "lipid"}
    chords = []
    for link in links:
        x0, y0 = polar(CIRCOS_ARC_IN, mid_gene[link["gene"]])
        x1, y1 = polar(CIRCOS_ARC_IN, mid_lipid[link["lipid"]])
        weight = (abs(link["r"]) - CIRCOS_THRESHOLD) / span if span > 0 else 0.0
        chords.append({
            **link,
            "d": f"M{n(x0)} {n(y0)}Q{n(CIRCOS_CX)} {n(CIRCOS_CY)} {n(x1)} {n(y1)}",
            "width": 1.6 + 2.4 * weight,
        })

    return {
        "ring": ring,
        "chords": chords,
        "tracks": tracks,
        "threshold": CIRCOS_THRESHOLD,
    }


def circos_label_data(item: dict) -> dict:
    """Posicion y rotacion de la etiqueta tangencial de una variable."""
    mid = item["mid"]
    angle = mid if -90.0 <= mid <= 90.0 else mid + 180.0
    x, y = polar(CIRCOS_LABEL_R, mid)
    return {
        "name": item["name"],
        "x": x,
        "y": y,
        "transform": f"rotate({n(angle)} {n(x)} {n(y)})",
    }


def circos_label(item: dict) -> str:
    """Etiqueta tangencial de una variable (fuera del anillo)."""
    label = circos_label_data(item)
    name = (
        label["name"].replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    )
    return (
        f'<text class="circ-label" x="{n(label["x"])}" y="{n(label["y"])}" '
        f'transform="{label["transform"]}" '
        f'text-anchor="middle" dominant-baseline="middle">{name}</text>'
    )


def circos_markup(c: dict) -> str:
    """Markup inline del circos (el mismo que consume la app)."""
    out = []
    # Primero las cuerdas (van debajo del anillo), luego el anillo, las
    # pistas de clase y por ultimo las etiquetas.
    for chord in c["chords"]:
        cls = "circ-chord circ-pos" if chord["r"] > 0 else "circ-chord circ-neg"
        out.append(
            f'<path class="{cls}" d="{chord["d"]}" stroke-width="{n(chord["width"])}"/>'
        )
    for item in c["ring"]:
        cls = (
            "circ-arc circ-arc-gene" if item["block"] == "gene"
            else "circ-arc circ-arc-lipid"
        )
        out.append(
            f'<path class="{cls}" d="'
            f'{arc_path(CIRCOS_ARC_OUT, item["a0"] + CIRCOS_GAP, item["a1"] - CIRCOS_GAP)}"/>'
        )
    out.append(f'<path class="circ-track circ-wt" d="{c["tracks"]["wt"]}"/>')
    out.append(f'<path class="circ-track circ-ppar" d="{c["tracks"]["ppar"]}"/>')
    for item in c["ring"]:
        out.append(circos_label(item))
    return "".join(out)


def build_heat(z: pd.DataFrame) -> dict:
    """Panel C: tira de heat map (20 muestras x 14 genes)."""
    left, top = 12.0, 12.0
    cols, rows = 20, 14
    cell_w = (HEAT_VIEWBOX[2] - 2 * left) / cols
    cell_h = (HEAT_VIEWBOX[3] - 2 * top) / rows

    cells = []
    for r in range(rows):
        for c in range(cols):
            hexa, mix = ramp(z.iloc[c, r])
            cells.append({
                "x": left + c * cell_w,
                "y": top + r * cell_h,
                "w": cell_w - 2,
                "h": cell_h - 2,
                "fill": hexa,
                "mix": mix,
            })
    return {"cells": cells}


# --------------------------------------------------------------------------- #
# Markup del artboard (para comparar con el archivo de diseño)
# --------------------------------------------------------------------------- #
def scatter_markup(s: dict) -> str:
    out = "".join(
        f'<line class="grid-line" x1="{n(a)}" y1="{n(b)}" x2="{n(c)}" y2="{n(d)}"/>'
        for a, b, c, d in s["grid"]
    )
    out += "".join(
        f'<line class="axis-line" x1="{n(a)}" y1="{n(b)}" x2="{n(c)}" y2="{n(d)}"/>'
        for a, b, c, d in s["axes"]
    )
    for m in s["marks"]:
        if m["kind"] == "wt":
            out += f'<circle class="pt-wt" cx="{n(m["x"])}" cy="{n(m["y"])}" r="4.2"/>'
        else:
            out += f'<path class="pt-ppar" d="{m["d"]}"/>'
    return out


def heat_markup(h: dict) -> str:
    return "".join(
        f'<rect x="{n(c["x"])}" y="{n(c["y"])}" width="{n(c["w"])}" '
        f'height="{n(c["h"])}" rx="1.6" fill="{c["fill"]}" style="fill:{c["mix"]}"/>'
        for c in h["cells"]
    )


def verify_against_artboard(blocks: dict[str, str]) -> bool:
    """Compara el markup generado con el que ya esta inline en el artboard."""
    if not ARTBOARD.exists():
        print(f"  [WARN] No existe {ARTBOARD}: se omite la comparacion.")
        return True

    html = ARTBOARD.read_text(encoding="utf-8")
    ok = True
    for name, markup in blocks.items():
        match = re.search(
            rf"<!--GEN:{name}-->(.*?)<!--/GEN:{name}-->", html, re.DOTALL
        )
        if match is None:
            print(f"  [FAIL] No se encontro el marcador GEN:{name} en el artboard.")
            ok = False
        elif match.group(1) != markup:
            print(f"  [FAIL] {name}: el markup difiere del artboard.")
            ok = False
        else:
            print(f"  [OK]   {name}: identico al artboard.")
    return ok


# --------------------------------------------------------------------------- #
# Emision del modulo TypeScript
# --------------------------------------------------------------------------- #
def viewbox(vb: tuple[int, int, int, int]) -> str:
    return " ".join(str(x) for x in vb)


def ts_lines(lines: list[str]) -> str:
    return "\n".join(lines)


def render_ts(scatter: dict, circos: dict, heat: dict, meta: dict) -> str:
    lines: list[str] = []
    add = lines.append

    add("/**")
    add(" * Datos de la banda multi-omics de la pantalla de Inicio.")
    add(" *")
    add(" * GENERADO — no editar a mano. Se regenera con:")
    add(" *")
    add(" *     backend/.venv/bin/python scripts/generate_home_figure.py")
    add(" *")
    add(" * Los numeros vienen de los datos reales del dataset `nutrimouse`:")
    add(" * el PCA lo calcula `pythomics.tools.NipalsPCA(n_components=2,")
    add(" * center=True, scale=False)` sobre `nutrimouse_gene.csv` (40 muestras")
    add(" * x 120 genes) y las clases salen de la columna `genotype` de")
    add(" * `nutrimouse_meta.csv` (`wt` = circulo, `ppar` = rombo). El heat map")
    add(" * es el z-score por variable sobre las mismas 40 muestras, saturado en")
    add(" * +-2.0 y coloreado con la rampa divergente `slate-700 -> --p-100 ->")
    add(" * --p-400` (ver `design/system.md`).")
    add(" *")
    add(" * El circos del medio usa el bloque de lipidos (`nutrimouse_lipid.csv`,")
    add(" * 40 muestras x 21 lipidos): las cuerdas son la correlacion de Pearson")
    add(" * real gen/lipido que pasa el umbral de |r|, y las pistas de clase son")
    add(" * el perfil (media en z) de `wt` y de `ppar` variable por variable.")
    add(" *")
    add(" * El renderer no calcula nada: dibuja estos numeros tal cual.")
    add(" */")
    add("")

    add("/** Una linea (grilla o eje del PCA). */")
    add("export type BandLine = {")
    add("  x1: number;")
    add("  y1: number;")
    add("  x2: number;")
    add("  y2: number;")
    add("};")
    add("")

    add("/** Un punto del PCA: `wt` es un circulo, `ppar` un rombo. */")
    add("export type BandMark =")
    add("  | { kind: 'wt'; x: number; y: number }")
    add("  | { kind: 'ppar'; x: number; y: number; d: string };")
    add("")

    add("/** Una celda del heat map. */")
    add("export type BandCell = {")
    add("  x: number;")
    add("  y: number;")
    add("  w: number;")
    add("  h: number;")
    add("  /** Mezcla con custom properties: sigue al tema `data-theme`. */")
    add("  mix: string;")
    add("  /** Hex del tema por defecto: fallback si no hay `color-mix()`. */")
    add("  fill: string;")
    add("};")
    add("")

    add("/** Un sector del anillo del circos (un bloque del diagrama). */")
    add("export type BandArc = {")
    add("  /** `gene` = bloque de genes, `lipid` = bloque de lipidos. */")
    add("  block: 'gene' | 'lipid';")
    add("  d: string;")
    add("};")
    add("")

    add("/** Una cuerda del circos: un par gen/lipido con correlacion real. */")
    add("export type BandChord = {")
    add("  /** Nombre del gen (bloque superior del anillo). */")
    add("  gene: string;")
    add("  /** Nombre del lipid (bloque inferior del anillo). */")
    add("  lipid: string;")
    add("  /** Correlacion de Pearson real (40 muestras). */")
    add("  r: number;")
    add("  d: string;")
    add("  /** Grosor: crece con |r|. */")
    add("  width: number;")
    add("};")
    add("")

    add("/** Una pista de clase del circos (el perfil de `wt` o de `ppar`). */")
    add("export type BandTrack = {")
    add("  kind: 'wt' | 'ppar';")
    add("  d: string;")
    add("};")
    add("")

    add("/** Una etiqueta del circos: el nombre real de la variable. */")
    add("export type BandLabel = {")
    add("  name: string;")
    add("  x: number;")
    add("  y: number;")
    add("  /** Rotacion tangencial (`rotate(ang x y)`). */")
    add("  transform: string;")
    add("};")
    add("")

    add("/** Procedencia de los datos (trazabilidad de la figura). */")
    add("export const HOME_FIGURE_SOURCE = {")
    add(f"  dataset: '{meta['dataset']}',")
    add(f"  datasetSha256: '{meta['datasetSha256']}',")
    add(f"  lipidDataset: '{meta['lipidDataset']}',")
    add(f"  lipidDatasetSha256: '{meta['lipidDatasetSha256']}',")
    add(f"  metaSha256: '{meta['metaSha256']}',")
    add(f"  pythomicsVersion: '{meta['pythomicsVersion']}',")
    add("  explainedVarianceRatio: [")
    for value in meta["evr"]:
        add(f"    {value:.6f},")
    add("  ],")
    add("} as const;")
    add("")

    # --- Panel A: PCA ---
    add(f"export const SCATTER_VIEWBOX = '{viewbox(SCATTER_VIEWBOX)}';")
    add("")
    add("/** Lineas de grilla (3 verticales + 2 horizontales). */")
    add("export const SCATTER_GRID: BandLine[] = [")
    for a, b, c, d in scatter["grid"]:
        add(f"  {{ x1: {ts_num(a)}, y1: {ts_num(b)}, x2: {ts_num(c)}, y2: {ts_num(d)} }},")
    add("];")
    add("")
    add("/** Ejes (vertical y horizontal). */")
    add("export const SCATTER_AXES: BandLine[] = [")
    for a, b, c, d in scatter["axes"]:
        add(f"  {{ x1: {ts_num(a)}, y1: {ts_num(b)}, x2: {ts_num(c)}, y2: {ts_num(d)} }},")
    add("];")
    add("")
    add("/** Los 40 puntos del PCA (20 `wt` + 20 `ppar`). */")
    add("export const SCATTER_MARKS: BandMark[] = [")
    for m in scatter["marks"]:
        if m["kind"] == "wt":
            add(f"  {{ kind: 'wt', x: {ts_num(m['x'])}, y: {ts_num(m['y'])} }},")
        else:
            add(
                f"  {{ kind: 'ppar', x: {ts_num(m['x'])}, y: {ts_num(m['y'])}, "
                f"d: '{m['d']}' }},"
            )
    add("];")
    add("")

    # --- Panel B: circos de mixOmics ---
    add(f"export const CIRCOS_VIEWBOX = '{viewbox(CIRCOS_VIEWBOX)}';")
    add("")
    add("/** Los sectores del anillo: genes arriba, lipidos abajo. */")
    add("export const CIRCOS_ARCS: BandArc[] = [")
    for item in circos["ring"]:
        arc = arc_path(
            CIRCOS_ARC_OUT, item["a0"] + CIRCOS_GAP, item["a1"] - CIRCOS_GAP
        )
        add(f"  {{ block: '{item['block']}', d: '{arc}' }},")
    add("];")
    add("")
    add("/** Las cuerdas: los pares gen/lipido que pasan el umbral de |r|. */")
    add("export const CIRCOS_CHORDS: BandChord[] = [")
    for chord in circos["chords"]:
        add(
            f"  {{ gene: '{chord['gene']}', lipid: '{chord['lipid']}', "
            f"r: {chord['r']:.4f}, d: '{chord['d']}', "
            f"width: {ts_num(chord['width'])} }},"
        )
    add("];")
    add("")
    add("/** Las pistas de clase: el perfil de `wt` y el de `ppar`. */")
    add("export const CIRCOS_TRACKS: BandTrack[] = [")
    for kind in ("wt", "ppar"):
        add(f"  {{ kind: '{kind}', d: '{circos['tracks'][kind]}' }},")
    add("];")
    add("")
    add("/** Las etiquetas: el nombre real de cada variable del anillo. */")
    add("export const CIRCOS_LABELS: BandLabel[] = [")
    for item in circos["ring"]:
        label = circos_label_data(item)
        add(
            f"  {{ name: '{label['name']}', x: {ts_num(label['x'])}, "
            f"y: {ts_num(label['y'])}, transform: '{label['transform']}' }},"
        )
    add("];")
    add("")

    # --- Panel C: heat map ---
    add(f"export const HEAT_VIEWBOX = '{viewbox(HEAT_VIEWBOX)}';")
    add("")
    add("/** La tira de heat map: 20 muestras x 14 genes. */")
    add("export const HEAT_CELLS: BandCell[] = [")
    for c in heat["cells"]:
        add(
            f"  {{ x: {ts_num(c['x'])}, y: {ts_num(c['y'])}, w: {ts_num(c['w'])}, "
            f"h: {ts_num(c['h'])}, mix: '{c['mix']}', fill: '{c['fill']}' }},"
        )
    add("];")
    add("")

    return ts_lines(lines)


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #
def main() -> int:
    if not GENE_CSV.exists() or not META_CSV.exists() or not LIPID_CSV.exists():
        print(f"ERROR: faltan los datasets en {DATASETS}")
        return 1

    data = load_data()
    scatter = build_scatter(data["scores"], data["classes"])
    circos = build_circos(data["gene"], data["lipid"], data["classes"])
    heat = build_heat(data["z"])

    print(
        f"PCA real: varianza explicada "
        f"{data['evr'][0] * 100:.1f}% / {data['evr'][1] * 100:.1f}% "
        f"({len(data['scores'])} muestras, {len(data['vars'])} variables)"
    )
    print(f"Panel PCA: {len(scatter['marks'])} puntos")
    genes = [i for i in circos["ring"] if i["block"] == "gene"]
    lipids = [i for i in circos["ring"] if i["block"] == "lipid"]
    print(
        f"Panel circos: {len(circos['ring'])} variables en el anillo "
        f"({len(genes)} genes + {len(lipids)} lipidos), "
        f"{len(circos['chords'])} cuerdas con |r| >= {CIRCOS_THRESHOLD}"
    )
    print(f"Panel heat map: {len(heat['cells'])} celdas")

    print("Comparando con el artboard...")
    bloques = {
        "a02-scatter": scatter_markup(scatter),
        "a02-circos": circos_markup(circos),
        "a02-heat": heat_markup(heat),
    }
    if not verify_against_artboard(bloques):
        print("ERROR: los datos no coinciden con el artboard; no se escribe nada.")
        return 2

    import pythomics

    meta = {
        "dataset": "frontend/public/datasets/nutrimouse_gene.csv",
        "datasetSha256": sha256(GENE_CSV),
        "lipidDataset": "frontend/public/datasets/nutrimouse_lipid.csv",
        "lipidDatasetSha256": sha256(LIPID_CSV),
        "metaSha256": sha256(META_CSV),
        "pythomicsVersion": getattr(pythomics, "__version__", "desconocida"),
        "evr": [float(v) for v in data["evr"]],
    }

    OUT_TS.parent.mkdir(parents=True, exist_ok=True)
    OUT_TS.write_text(render_ts(scatter, circos, heat, meta), encoding="utf-8")
    print(f"  -> {OUT_TS.relative_to(APP_ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
