from fastapi import FastAPI

from backend.logging_config import setup_logging
from backend.routers import search, transcript

setup_logging()


app = FastAPI()

app.include_router(search.router)
app.include_router(transcript.router)
