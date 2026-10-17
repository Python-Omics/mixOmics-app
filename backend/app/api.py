from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

app = FastAPI(
    title="API de mixOmics",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ------------------------------------------------------------------------------
# Esquemas (para validar los tipos de datos :v)
# ------------------------------------------------------------------------------



# ------------------------------------------------------------------------------
# Endpoints (rutas noma :v)
# ------------------------------------------------------------------------------

@app.get("/v1/health", status_code=status.HTTP_200_OK)
async def health():
    """
    Endpoint para verificar que todo funciona bien
    """
    return {"status": "Todo bien gente, toy sano!"}


@app.get("/v1/archivos/", status_code=status.HTTP_200_OK)
async def get_archivos():
    """
    Endpoint para listar los archivos cargados en la carpeta de datos.
    
    TODO: Crear carpeta y modelar funcionamiento (usar libreria os)
    """
    pass


@app.post("/v1/reporte/", status_code=status.HTTP_200_OK)
async def crear_reporte():
    """
    Endpoint para crear un reporte en pdf.
    
    TODO: CREAR ESQUEMA Y AJUSTAR PARAMETROS 
    """
    pass

@app.post("/v1/cargar/", status_code=status.HTTP_201_CREATED)
async def cargar_data():
    """
    Endpoint para cargar datos locales, manejarlos en una carpeta interna.

    TODO: Ajustar parametros, 
    """
    pass

@app.post("/v1/model/", status_code=status.HTTP_201_CREATED)
async def ejecutar_modelo():
    """
    Endpoint para ejecutar un modelo de mixOmics y recibir resultados.

    TODO: Crear esquema (seleccionar modelo, parametros, reduccion de dimensionalidad, posible prompt) 
    """
    pass

@app.post("/v1/model_llm/", status_code=status.HTTP_201_CREATED)
async def ejecutar_modelo_llm():
    """
    Endpoint para obtener analisis preliminar con un LLM a través de sus biomarcadores.

    TODO: Crear esuqema (prompt, datos extras).
    """
    pass

@app.delete("/v1/archivos/", status_code=status.HTTP_200_OK)
async def delete_archivos(nombre_archivo: str):
    """
    Endpoint para borrar un archivo de la carpeta de datos.
    
    TODO: Usar os.
    """
    pass
