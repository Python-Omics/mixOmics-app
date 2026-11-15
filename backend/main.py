"""Punto de entrada del backend.

La app tiene que poder levantarse de dos formas, y las dos tienen que
funcionar igual:

    python main.py               # desarrollo (desde backend/)
    uvicorn app.api:app          # sin pasar por este archivo

Por eso ``DATA_DIR`` **no** se define acá: vive en ``app.paths`` y se resuelve
al importar ``app.api``. Si estuviera en este archivo, la segunda forma
arrancaría sin ``app.state.DATA_DIR`` y los endpoints que la usan fallarían
con 500.

Para levantar la segunda forma desde la raíz del repo:

    uvicorn app.api:app --app-dir backend
"""

import os
import sys
from pathlib import Path

# Permite ejecutar ``python backend/main.py`` desde cualquier directorio.
sys.path.insert(0, str(Path(__file__).resolve().parent))

import uvicorn  # noqa: E402

from app.api import app  # noqa: E402
from app.auth import resolve_token  # noqa: E402

HOST = "127.0.0.1"
PORT = 8501


def main() -> None:
    """Levanta el servidor local.

    Solo escucha en loopback: la app es 100% local y el backend no tiene por
    qué ser alcanzable desde la red (RNF-S-3, RB-9).
    """
    token, generated = resolve_token()
    if generated:
        # El proceso Electron siempre manda el token por entorno. Cuando el
        # backend se levanta a mano, se genera uno y se muestra: sin esto no
        # hay forma de llamar a la API (toda peticion exige el token).
        print("=" * 70)
        print("  Token de API generado para esta sesion:")
        print(f"  {token}")
        print("  Mandalo en la cabecera X-Pythomics-Token.")
        print("=" * 70)
        # Sin flush, stdout queda en el buffer y el token no aparece hasta
        # que el proceso termina: el que lo necesita lo necesita ahora.
        sys.stdout.flush()

    uvicorn.run(app, host=HOST, port=PORT, reload=False)


if __name__ == "__main__":
    main()
