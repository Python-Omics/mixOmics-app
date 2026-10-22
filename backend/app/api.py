import sys
import os
import shutil
from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, status, Request
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
# Funciones (para comprobar cosas)
# ------------------------------------------------------------------------------



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
    return {"status": "Todo bien gente, toy sano! la vida es bella"}

@app.get("/v1/archivos/", status_code=status.HTTP_200_OK)
async def get_archivos(request: Request): # <- Agregas request: Request
    data_dir = request.app.state.DATA_DIR   # <- Lees la ruta del estado global
    
    try:
        elementos = os.listdir(data_dir)
        archivos = [f for f in elementos if os.path.isfile(os.path.join(data_dir, f))]    
        return {"archivos": archivos, "total": len(archivos), "ruta": data_dir}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error al leer la carpeta: {str(e)}")


@app.post("/v1/reporte/", status_code=status.HTTP_200_OK)
async def crear_reporte():
    """
    Endpoint para crear un reporte en pdf.
    
    TODO: CREAR ESQUEMA Y AJUSTAR PARAMETROS 
    """
    pass

@app.post("/v1/archivos/", status_code=status.HTTP_201_CREATED)
async def cargar_data(file: UploadFile = File(...)):
    """
    Endpoint para cargar datos locales, manejarlos en una carpeta interna.

    TODO: Ajustar parametros, 
    """
    nombre_seguro = os.path.basename(file.filename)
    ruta_archivo = os.path.join(DATA_DIR, nombre_seguro)
    
    try:
        # Usamos shutil para copiar el flujo de datos (buffer) directamente al disco
        # Esto es eficiente en memoria, ideal para datasets pesados.
        with open(ruta_archivo, "wb") as buffer_destino:
            shutil.copyfileobj(file.file, buffer_destino)
            
        return {
            "mensaje": f"Archivo '{nombre_seguro}' subido correctamente.",
            "nombre_archivo": nombre_seguro
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error al guardar el archivo: {str(e)}")
    finally:
        # Siempre debemos cerrar el archivo en memoria liberando recursos
        file.file.close()
    

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
    nombre_seguro = os.path.basename(nombre_archivo)
    ruta_archivo = os.path.join(DATA_DIR, nombre_seguro)
    
    if not os.path.exists(ruta_archivo):
        raise HTTPException(status_code=404, detail=f"El archivo '{nombre_seguro}' no existe.")
    
    try:
        os.remove(ruta_archivo)
        return {"mensaje": f"Archivo '{nombre_seguro}' eliminado correctamente."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error al eliminar el archivo: {str(e)}")
