import {
  CIRCOS_ARCS,
  CIRCOS_CHORDS,
  CIRCOS_LABELS,
  CIRCOS_TRACKS,
  CIRCOS_VIEWBOX,
  HEAT_CELLS,
  HEAT_VIEWBOX,
  SCATTER_AXES,
  SCATTER_GRID,
  SCATTER_MARKS,
  SCATTER_VIEWBOX,
} from '../lib/home-figure-data';

/**
 * Banda multi-omics de la pantalla de Inicio.
 *
 * Tres paneles decorativos con motivo científico, de izquierda a derecha:
 *
 *   1. **PCA de nutrimouse** — los 40 ratones proyectados en PC1/PC2, con las
 *      dos clases de genotipo (`wt` = círculo, `ppar` = rombo).
 *   2. **Circos de mixOmics** — el anillo con los genes arriba y los lípidos
 *      abajo, las cuerdas entre ambos bloques (la correlación de Pearson real
 *      que pasa el umbral de |r|) y las pistas de clase (`wt` y `ppar`).
 *   3. **Tira de heat map** — el z-score por variable sobre las mismas
 *      muestras, con la rampa divergente del tema.
 *
 * Es **puramente decorativa**: el contenedor va con `aria-hidden="true"` y los
 * SVG no tienen `aria-label`, así que un lector de pantalla no anuncia nada
 * (las reglas de las figuras de datos están en `design/system.md`).
 *
 * El único texto dentro de la figura son los **nombres de las variables**
 * (`HPNCL`, `C20.2n.6`, …): son nomenclatura científica, no copy de interfaz,
 * así que van inline y no se traducen (RNF-U-3). No hay claves de i18n que
 * sumar.
 *
 * Los números no se calculan acá: vienen inline de
 * `src/lib/home-figure-data.ts`, que genera `scripts/generate_home_figure.py`
 * a partir del dataset real. El renderer solo dibuja.
 *
 * Los colores salen de las custom properties (`--p-*`), así que la figura
 * sigue al tema activo (`data-theme` en el `<html>`). La geometría y las
 * animaciones viven en `src/styles/globals.css` (`@layer components`).
 */
export function BiologyBand() {
  return (
    <div className="biology-band" aria-hidden="true">
      {/* Panel 1 — PCA: grilla, ejes y los 40 puntos. */}
      <div className="biology-panel">
        <svg
          className="w-full h-auto"
          viewBox={SCATTER_VIEWBOX}
          role="presentation"
          focusable="false"
        >
          {SCATTER_GRID.map((line, i) => (
            <line key={`grid-${i}`} className="biology-grid" {...line} />
          ))}
          {SCATTER_AXES.map((line, i) => (
            <line key={`axis-${i}`} className="biology-axis" {...line} />
          ))}
          {SCATTER_MARKS.map((mark, i) =>
            mark.kind === 'wt' ? (
              <circle
                key={`mark-${i}`}
                className="biology-pt-wt"
                cx={mark.x}
                cy={mark.y}
                r={4.2}
              />
            ) : (
              <path
                key={`mark-${i}`}
                className="biology-pt-ppar"
                d={mark.d}
              />
            ),
          )}
        </svg>
      </div>

      {/* Panel 2 — circos: el anillo, las cuerdas, las pistas de clase y
          los nombres de las variables. */}
      <div className="biology-panel">
        <svg
          className="w-full h-auto"
          viewBox={CIRCOS_VIEWBOX}
          role="presentation"
          focusable="false"
        >
          {CIRCOS_CHORDS.map((chord, i) => (
            <path
              key={`chord-${i}`}
              className={
                chord.r > 0
                  ? 'biology-circ-chord biology-circ-pos'
                  : 'biology-circ-chord biology-circ-neg'
              }
              d={chord.d}
              strokeWidth={chord.width}
            />
          ))}
          {CIRCOS_ARCS.map((arc, i) => (
            <path
              key={`arc-${i}`}
              className={
                arc.block === 'gene'
                  ? 'biology-circ-arc biology-circ-arc-gene'
                  : 'biology-circ-arc biology-circ-arc-lipid'
              }
              d={arc.d}
            />
          ))}
          {CIRCOS_TRACKS.map((track, i) => (
            <path
              key={`track-${i}`}
              className={
                track.kind === 'wt'
                  ? 'biology-circ-track biology-circ-wt'
                  : 'biology-circ-track biology-circ-ppar'
              }
              d={track.d}
            />
          ))}
          {CIRCOS_LABELS.map((label, i) => (
            <text
              key={`label-${i}`}
              className="biology-circ-label"
              x={label.x}
              y={label.y}
              transform={label.transform}
              textAnchor="middle"
              dominantBaseline="middle"
            >
              {label.name}
            </text>
          ))}
        </svg>
      </div>

      {/* Panel 3 — heat map: z-score por variable, rampa divergente. */}
      <div className="biology-panel">
        <svg
          className="w-full h-auto"
          viewBox={HEAT_VIEWBOX}
          role="presentation"
          focusable="false"
        >
          {HEAT_CELLS.map((cell, i) => (
            <rect
              key={`cell-${i}`}
              x={cell.x}
              y={cell.y}
              width={cell.w}
              height={cell.h}
              rx={1.6}
              fill={cell.fill}
              // La mezcla con custom properties sigue al tema; el `fill`
              // de arriba queda como fallback si el browser no la soporta.
              style={{ fill: cell.mix }}
            />
          ))}
        </svg>
      </div>
    </div>
  );
}
