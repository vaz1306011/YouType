from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from backend.logging_config import setup_logging
from backend.routers import search, transcript

setup_logging()

app = FastAPI()

app.include_router(search.router)
app.include_router(transcript.router)

_static_dir = Path(__file__).parent.parent / "static"
if _static_dir.is_dir():
    _index = _static_dir / "index.html"

    app.mount(
        "/assets", StaticFiles(directory=str(_static_dir / "assets")), name="assets"
    )

    @app.get("/{full_path:path}")
    async def spa_fallback(full_path: str):
        file = _static_dir / full_path
        if file.is_file():
            return FileResponse(file)
        return FileResponse(_index)
