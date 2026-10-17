# Backend mixOmics-app

[Universidad de Concepción](https://img.shields.io/badge/Universidad_de_Concepción-UdeC-yellow)]

Esta parte es un ejecutable, lo principal es entender que hace el backend y los endpoints que se utilizan. 
Se piensa dejar esto para que el front sepa que datos entregar y en que formato.

## Endpoints

| Endpoint | Método |Descripción |
|----------|--------|------------|
|`/v1/health`| GET | Enpoint para comprobar conexión|
|`/v1/archivos/`| GET | Endpoint para listar archivos subidos|
|`/v1/reporte/`| POST | Endpoint para generar reportes|
|`/v1/cargar/`| POST | Endpoint para cargar archivos|
|`/v1/model/`| POST | Endpoint para ejecutar un modelo de mixOmics y recibir los resultados|
|`/v1/model_llm/`| POST | Endpoint para obtener un análisis preliminar de los datos con LLM a través de biomarcadores|
|`/v1/archivos/`| DELETE | Endpoint para borrar archivos|

---

A futuro se podrías añadir más endpoints, pero puedes utilizar el docs de swagger para ver los endpoints existentes y testear.
