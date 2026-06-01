import json
import logging
from dataclasses import asdict
from pathlib import Path

from fastapi import APIRouter, HTTPException

from backend.models import Video

router = APIRouter()
logger = logging.getLogger(__name__)

_CACHE_DIR = Path(__file__).parent.parent.parent / "cache"
_CACHE_DIR.mkdir(exist_ok=True)


def _cache_path(video_id: str) -> Path:
    return _CACHE_DIR / f"{video_id}.json"


def _load_cache(video_id: str) -> Video | None:
    path = _cache_path(video_id)
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return Video(**data)
    except Exception:
        logger.warning(f"[{video_id}] キャッシュの読み込みに失敗しました")
        return None


def _save_cache(video: Video) -> None:
    if not video.video_id:
        return
    path = _cache_path(video.video_id)
    path.write_text(json.dumps(asdict(video), ensure_ascii=False, indent=2), encoding="utf-8")


@router.get("/transcript")
def get_transcript(video_id: str) -> Video:
    cached = _load_cache(video_id)
    if cached:
        logger.debug(f"[{video_id}] キャッシュから返します")
        return cached

    try:
        video = Video.from_id(video_id)
    except Exception:
        raise HTTPException(status_code=404, detail="字幕・歌詞が見つかりませんでした")

    _save_cache(video)
    return video
