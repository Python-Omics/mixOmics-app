import uvicorn
from app.api import app
import sys

def main():
    host = "127.0.0.1"
    port = "8501"

    # Iniciar el server
    uvicorn.run(app, host=host, port=port, reload=False)

if __name__ == "__main__":
    main()


