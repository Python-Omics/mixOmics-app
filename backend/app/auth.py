"""Autenticación entre el proceso Electron y el backend local.

Escuchar en ``127.0.0.1`` **no** vuelve privado al backend. Cualquier página
web que el usuario tenga abierta puede hacer un ``POST`` a
``http://127.0.0.1:8501/v1/archivos/``; sin CORS el navegador no le impide
**enviar** la petición (solo le impide **leer** la respuesta). Con eso, una
página ajena podría subir o pisar los archivos del usuario: por eso cerrar el
CORS no alcanza y hace falta una segunda barrera.

La barrera es un **token compartido**:

- El proceso Electron genera un token aleatorio y lo pasa al backend por la
  variable de entorno ``PYTHOMICS_API_TOKEN``. Ese canal es el spawn del
  subproceso, no la red: el token nunca viaja por HTTP.
- El backend exige la cabecera ``X-Pythomics-Token`` en **toda** petición.
- Una página web no puede inventar ese token, ni enviar esa cabecera sin un
  preflight que el backend no responde con headers CORS → el navegador bloquea
  el envío antes de que salga.

Sin token válido, la respuesta es ``401``.
"""

import os
import secrets

#: Variable de entorno por la que el proceso Electron pasa el token.
TOKEN_ENV = "PYTHOMICS_API_TOKEN"

#: Cabecera que debe traer el token en cada petición.
TOKEN_HEADER = "X-Pythomics-Token"

def resolve_token() -> tuple[str, bool]:
    """Devuelve ``(token, generado)``.

    Si el entorno no trae token, se genera uno aleatorio y se deja en el
    entorno, para que el proceso que lo generó pueda mostrarlo (ver
    ``backend/main.py``). Comparar con :func:`secrets.compare_digest` evita
    filtrar información por tiempo.
    """
    token = os.environ.get(TOKEN_ENV, "").strip()
    if token:
        return token, False
    token = secrets.token_urlsafe(32)
    os.environ[TOKEN_ENV] = token
    return token, True


def check_token(candidate: str | None) -> bool:
    """True si el token recibido es el válido.

    La comparación es en **bytes**: ``secrets.compare_digest`` sobre ``str``
    lanza ``TypeError`` si alguna de las dos cadenas tiene caracteres fuera
    de ASCII, y un token con acento es un 500 con traceback en el log, no un
    401.
    """
    if not candidate:
        return False
    expected = resolve_token()[0]
    return secrets.compare_digest(
        candidate.encode("utf-8"),
        expected.encode("utf-8"),
    )
