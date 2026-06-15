import json
import logging
import os
import time
from dataclasses import asdict
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.models import Video, search_lrclib

router = APIRouter()
logger = logging.getLogger(__name__)

_CACHE_DIR = Path(__file__).parent.parent.parent / "cache"
_CACHE_DIR.mkdir(exist_ok=True)

_CACHE_TTL = int(os.getenv("CACHE_TTL_DAYS", "30")) * 86400
_CACHE_VERSION = 3  # 変更したら古いキャッシュを自動破棄


def _cache_path(video_id: str) -> Path:
    return _CACHE_DIR / f"{video_id}.json"


def _load_cache(video_id: str) -> Video | None:
    path = _cache_path(video_id)
    if not path.exists():
        return None
    if time.time() - path.stat().st_mtime > _CACHE_TTL:
        path.unlink()
        logger.debug(f"[{video_id}] キャッシュの有効期限切れ、削除しました")
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if data.get("_v") != _CACHE_VERSION:
            path.unlink()
            logger.debug(f"[{video_id}] キャッシュのバージョンが古いため削除しました")
            return None
        data.pop("_v")
        return Video(**data)
    except Exception:
        logger.warning(f"[{video_id}] キャッシュの読み込みに失敗しました")
        path.unlink(missing_ok=True)
        return None


def _save_cache(video: Video) -> None:
    if not video.video_id:
        return
    path = _cache_path(video.video_id)
    payload = {"_v": _CACHE_VERSION, **asdict(video)}
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


@router.get("/search_lyrics")
def get_search_lyrics(track: str, artist: str = "") -> list[dict]:
    try:
        return search_lrclib(track, artist)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


class ApplyLyricsRequest(BaseModel):
    video_id: str
    synced_lyrics: str
    title: str = ""
    artist: str = ""
    duration: float | None = None


@router.post("/apply_lyrics")
def post_apply_lyrics(body: ApplyLyricsRequest) -> Video:
    try:
        video = Video.from_synced_lyrics(
            video_id=body.video_id,
            synced_lyrics=body.synced_lyrics,
            title=body.title or None,
            artist=body.artist or None,
            duration=body.duration,
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    _save_cache(video)
    return video


@router.get("/apply_auto_cc")
def get_apply_auto_cc(video_id: str) -> Video:
    try:
        video = Video.from_auto_cc(video_id)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    _save_cache(video)
    return video


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
