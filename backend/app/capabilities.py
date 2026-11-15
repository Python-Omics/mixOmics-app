"""Sonda de capacidades del entorno.

El proceso de la API **no** importa ``pythomics.models``: importarlo ya exige
rpy2 y arrastraría R al proceso de FastAPI (S31, §5.3). La API tiene que
arrancar igual en una máquina sin R, y la degradación a ``503`` tiene que ser
natural, no un ``try/except`` alrededor de un import.

Por eso la detección se hace en un **subproceso**: la API pregunta "¿hay R?"
sin tocar R. El subproceso es el mismo Python que corre el backend
(``sys.executable``), así que ve los mismos extras instalados.

La sonda es cara (importar rpy2 carga R entero), así que el resultado
**exitoso** se cachea durante la sesión: las capacidades del entorno no
cambian mientras la app está abierta.

Un **fallo** no se cachea: si la sonda se rompe por un motivo transitorio (R
aún arrancando, un timeout), el próximo ``/v1/health`` reintenta en vez de
dejar la app creyendo que no hay R para siempre.

En un bundle de PyInstaller, ``sys.executable`` es el ejecutable congelado, no
un intérprete de Python: la sonda no puede correr. En ese caso se reporta
todo como ausente sin ni intentarlo — es un fallo **seguro** (se degrada, no
crashea) y el empaquetado de producción tiene su propia etapa.
"""

import asyncio
import json
import subprocess
import sys
import threading

from .schemas import Capabilities

#: Prefijo de la línea que lleva la respuesta de la sonda. El subproceso
#: puede imprimir otras cosas (R y sus librerías son ruidosas), así que la
#: respuesta se busca por este marcador y no por "la última línea".
_MARKER = "PYXPROBE"

#: Techo de la sonda. Importar rpy2 carga R entero: 20 s alcanzan de sobra en
#: una máquina sana y, si algo está trabado, no se lleva el proceso con él.
_TIMEOUT_S = 20

#: Código que corre en el subproceso. Solo imprime JSON; no importa nada de R
#: en el proceso de la API.
_PROBE_CODE = """
import json

out = {"pythomics": False, "r": False, "mixomics": False}

try:
    import pythomics.tools  # noqa: F401
    out["pythomics"] = True
except Exception:
    out["pythomics"] = False

try:
    import rpy2.robjects  # noqa: F401
    from rpy2.robjects.packages import isinstalled

    out["r"] = True
    out["mixomics"] = bool(isinstalled("mixOmics"))
except Exception:
    out["r"] = False
    out["mixomics"] = False

print("PYXPROBE" + json.dumps(out))
"""

#: Cache de la última sonda **exitosa**. ``None`` = todavía no se sondó.
_cached: Capabilities | None = None

#: Cerrojo de la sonda en el camino asíncrono: garantiza que, ante una
#: ráfaga de peticiones en cache frío, se lance **un solo** subproceso. Sin
#: esto, 40 /v1/health simultáneos lanzaban 40 sondeos de R compitiendo:
#: ~640 MB de RAM agregada y falsos negativos ("no hay R") por timeout.
_probe_lock_async: asyncio.Lock | None = None

#: Cerrojo del camino síncrono. El asíncrono se apoya además en el asíncrono,
#: así que el subproceso nunca se duplica.
_probe_lock_thread = threading.Lock()


def _unavailable() -> Capabilities:
    """Capacidades cuando no se puede determinar nada."""
    return Capabilities(pythomics=False, r=False, mixomics=False)


def _run_probe() -> dict[str, bool] | None:
    """Ejecuta la sonda en un subproceso.

    Devuelve ``None`` si la sonda **falló** (no se pudo ejecutar, no
    respondió, no imprimió la línea esperada). Un fallo no es lo mismo que
    "no hay R": lo primero se reintenta, lo segundo se cachea.
    """
    try:
        completed = subprocess.run(
            [sys.executable, "-c", _PROBE_CODE],
            capture_output=True,
            text=True,
            timeout=_TIMEOUT_S,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return None

    for line in completed.stdout.splitlines():
        if not line.startswith(_MARKER):
            continue
        try:
            payload = json.loads(line[len(_MARKER) :])
        except json.JSONDecodeError:
            break
        return {
            "pythomics": bool(payload.get("pythomics")),
            "r": bool(payload.get("r")),
            "mixomics": bool(payload.get("mixomics")),
        }

    return None


def _probe_sync() -> Capabilities | None:
    """Ejecuta la sonda. Devuelve ``None`` si **falló**.

    ``None`` significa "no se pudo determinar", que es distinto de "no hay
    R": un fallo no se cachea y se reintenta; la ausencia de R sí se cachea.
    """
    # En un bundle congelado no hay intérprete que sondear: no se intenta.
    if getattr(sys, "frozen", False):
        return None

    data = _run_probe()
    if data is None:
        return None

    return Capabilities(
        pythomics=data["pythomics"],
        r=data["r"],
        mixomics=data["mixomics"],
    )


def probe_capabilities() -> Capabilities:
    """Detecta qué puede hacer el backend en esta máquina.

    Camino **síncrono**: para scripts y tests. El servidor usa
    :func:`probe_capabilities_async`, que además serializa las sondas.
    """
    global _cached

    if _cached is not None:
        return _cached

    with _probe_lock_thread:
        if _cached is not None:
            return _cached
        capabilities = _probe_sync()
        if capabilities is None:
            # Fallo transitorio: se reintenta en la próxima llamada.
            return _unavailable()
        _cached = capabilities
        return capabilities


def _get_probe_lock_async() -> asyncio.Lock:
    """Cerrojo de single-flight del camino asíncrono."""
    global _probe_lock_async
    if _probe_lock_async is None:
        _probe_lock_async = asyncio.Lock()
    return _probe_lock_async


async def probe_capabilities_async() -> Capabilities:
    """Sonda con **single-flight**: nunca más de un subproceso a la vez.

    Además de no duplicar sondeos, esto evita que el threadpool de FastAPI
    se agote: los que esperan lo hacen sobre el event loop (el cerrojo es de
    asyncio), no reteniendo un hilo cada uno.
    """
    global _cached

    if _cached is not None:
        return _cached

    async with _get_probe_lock_async():
        if _cached is not None:
            return _cached
        capabilities = await asyncio.to_thread(probe_capabilities)
        if capabilities is None:
            return _unavailable()
        return capabilities
