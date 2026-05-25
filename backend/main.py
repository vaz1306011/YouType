from fastapi import FastAPI

from backend.routers import search, transcript

app = FastAPI()

app.include_router(search.router)
app.include_router(transcript.router)
