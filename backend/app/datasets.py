"""Registro de recetas de datos del backend de Pythomics.

Una receta es la **sesión de datos** del backend: qué archivos componen el
análisis, con qué forma, qué IDs de muestra tienen, cómo se clasifican sus
columnas y qué decisiones se tomaron (alineación, preprocesamiento, variable
de clase). Las matrices nunca se guardan aquí (S29): el worker es el único
que las materializa, y la API solo registra hechos.

Cada receta vive en un archivo JSON propio, ``<root>/<id>.json``, escrito de
forma **atómica**: se escribe en un ``<id>.json.tmp`` y luego se renombra con
:func:`os.replace`. Un corte a mitad de escritura no deja una receta a medias
ni una receta que se pueda leer como válida.

Los identificadores tienen un formato estricto (``ds_`` más 12 hexadecimales)
y se validan **antes** de construir cualquier ruta: un identificador con otro
formato no se busca en el disco, ni se construye un camino con él.
"""

from __future__ import annotations

import os
import re
from pathlib import Path
from uuid import uuid4

from app.errors import ErrorCode, PythomicsError
from app.schemas import BlockRef, Dataset, TargetSpec

#: Formato válido del identificador de una receta.
DATASET_ID_PATTERN = re.compile(r"^ds_[0-9a-f]{12}$")

#: Prefijo de los identificadores de receta.
ID_PREFIX = "ds_"

#: Cantidad de hexadecimales del identificador.
ID_HEX_LENGTH = 12


def new_dataset_id() -> str:
    """Genera un identificador de receta nuevo."""
    return f"{ID_PREFIX}{uuid4().hex[:ID_HEX_LENGTH]}"


class DatasetStore:
    """Registro de recetas de datos, persistido en un archivo JSON por receta."""

    def __init__(self, root: Path) -> None:
        """Crea el registro sobre un directorio.

        Args:
            root: Directorio donde viven los archivos de las recetas. Se crea
                si no existe.
        """
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)

    def create(
        self,
        blocks: list[BlockRef],
        target: TargetSpec | None,
    ) -> Dataset:
        """Crea una receta nueva y la guarda.

        Args:
            blocks: Bloques que componen la receta, con su forma y sus IDs.
            target: Variable de clase, si la receta ya es supervisada.

        Returns:
            La receta creada, con su identificador asignado.
        """
        receta = Dataset(
            id=new_dataset_id(),
            blocks=list(blocks),
            target=target,
        )
        return self.save(receta)

    def get(self, dataset_id: str) -> Dataset:
        """Devuelve la receta con el identificador dado.

        Raises:
            PythomicsError: Si el identificador no tiene el formato válido o
                si no existe la receta (``E_UNKNOWN_DATASET``).
        """
        ruta = self._ruta_de(dataset_id)

        if not ruta.is_file():
            raise PythomicsError(
                ErrorCode.E_UNKNOWN_DATASET,
                detail={"dataset_id": dataset_id},
            )

        return self._leer(ruta)

    def list(self) -> list[Dataset]:
        """Devuelve todas las recetas guardadas, ordenadas por identificador.

        Los archivos que no son recetas (notas, temporales) se ignoran. Una
        receta que no se puede leer **no** se ignora en silencio: se informa
        el error, porque una receta corrupta son datos perdidos.
        """
        recetas: list[Dataset] = []

        for entrada in sorted(self.root.glob("*.json")):
            if not DATASET_ID_PATTERN.match(entrada.stem):
                continue
            recetas.append(self._leer(entrada))

        return recetas

    def save(self, dataset: Dataset) -> Dataset:
        """Guarda la receta, de forma atómica.

        Raises:
            PythomicsError: Si el identificador no tiene el formato válido
                (``E_UNKNOWN_DATASET``) o si el sistema de archivos falla
                (``E_UNEXPECTED``).
        """
        ruta = self._ruta_de(dataset.id)
        # El temporal lleva un sufijo propio: dos escrituras concurrentes de
        # la misma receta (el servidor atiende requests en un threadpool) no
        # pueden pisarse en el mismo archivo temporal.
        temporal = ruta.with_name(f"{ruta.name}.{uuid4().hex[:8]}.tmp")

        try:
            temporal.write_text(
                dataset.model_dump_json(indent=2),
                encoding="utf-8",
            )
            os.replace(temporal, ruta)
        except OSError as exc:
            # El temporal a medias no sirve de nada y confunde el listado.
            try:
                temporal.unlink(missing_ok=True)
            except OSError:
                pass
            raise PythomicsError(
                ErrorCode.E_UNEXPECTED,
                detail={"file": ruta.name, "reason": str(exc)},
            ) from exc

        return dataset

    def delete(self, dataset_id: str) -> None:
        """Borra la receta con el identificador dado.

        Raises:
            PythomicsError: Si el identificador no tiene el formato válido o
                si no existe la receta (``E_UNKNOWN_DATASET``).
        """
        ruta = self._ruta_de(dataset_id)

        if not ruta.is_file():
            raise PythomicsError(
                ErrorCode.E_UNKNOWN_DATASET,
                detail={"dataset_id": dataset_id},
            )

        try:
            ruta.unlink()
        except OSError as exc:
            raise PythomicsError(
                ErrorCode.E_UNEXPECTED,
                detail={"file": ruta.name, "reason": str(exc)},
            ) from exc

    def _ruta_de(self, dataset_id: str) -> Path:
        """Construye la ruta de una receta, validando el identificador antes.

        La validación va **antes** de construir el camino: con un
        identificador con otro formato no se toca el disco.
        """
        if not dataset_id or not DATASET_ID_PATTERN.match(dataset_id):
            raise PythomicsError(
                ErrorCode.E_UNKNOWN_DATASET,
                detail={"dataset_id": dataset_id},
            )

        return self.root / f"{dataset_id}.json"

    def _leer(self, ruta: Path) -> Dataset:
        """Lee una receta del disco y la valida con el modelo."""
        try:
            contenido = ruta.read_text(encoding="utf-8")
            return Dataset.model_validate_json(contenido)
        except (OSError, ValueError) as exc:
            raise PythomicsError(
                ErrorCode.E_UNEXPECTED,
                detail={"file": ruta.name, "reason": str(exc)},
            ) from exc
