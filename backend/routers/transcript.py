from fastapi import APIRouter, Depends, HTTPException, Query

from backend.models import Video

router = APIRouter()


class SongQuery:
    def __init__(
        self,
        id: int | None = Query(default=None),
        name: str | None = Query(default=None),
    ):
        if id is None and name is None:
            raise HTTPException(status_code=422, detail="id 或 name 至少要有一個")
        self.id = id
        self.name = name


@router.get("/transcript")
def get_transcript(video_id: str) -> Video:
    try:
        return Video.from_id(video_id)
    except Exception:
        raise HTTPException(status_code=404, detail="字幕・歌詞が見つかりませんでした")
