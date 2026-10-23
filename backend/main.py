import uvicorn
from app.api import app
import sys
import os

def obtener_directorio_data():
    if getattr(sys, 'frozen', False):
        # Producción (PyInstaller)
        directorio_base = os.path.dirname(sys.executable)
    else:
        # Desarrollo (Ubicación de main.py)
        directorio_base = os.path.dirname(os.path.abspath(__file__))
    
    ruta_data = os.path.join(directorio_base, 'data')
    os.makedirs(ruta_data, exist_ok=True)
    return ruta_data

# Inyectamos la ruta en el estado de FastAPI ANTES de arrancar
app.state.DATA_DIR = obtener_directorio_data()

def main():
    host = "127.0.0.1"
    port = 8501

    # Iniciar el server
    uvicorn.run(app, host=host, port=port, reload=False)

if __name__ == "__main__":
    main()


