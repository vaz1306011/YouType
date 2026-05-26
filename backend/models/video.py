import logging
import re
from dataclasses import dataclass, field
from typing import Any, ClassVar, Optional

from lrclib import LrcLibAPI
from youtube_transcript_api import (
    NoTranscriptFound,
    TranscriptsDisabled,
    YouTubeTranscriptApi,
)

logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)


@dataclass
class Video:
    DEFAULT_LANGUAGES: ClassVar[list[str]] = ["ja", "en"]
    FALLBACK_GENERATED_LANGUAGES: ClassVar[list[str]] = ["ja"]

    video_id: Optional[str]
    title: Optional[str] = None
    artist: Optional[str] = None
    snippets: list[dict] = field(default_factory=list)
    language: Optional[str] = None
    is_generated: Optional[bool] = None

    @classmethod
    def from_id(
        cls,
        video_id: str,
    ) -> "Video":
        try:
            track_name, artist_name = _fetch_youtube_music_info(video_id)
        except Exception as e:
            logger.warning(f"[{video_id}] yt_dlpからの情報の取得に失敗しました: {e}")

        try:
            return cls._from_lrclib(video_id, track_name, artist_name)
        except Exception:
            return cls._from_youtube(video_id, track_name, artist_name)

    @classmethod
    def _from_lrclib(
        cls, video_id: str, track_name: str, artist: Optional[str]
    ) -> "Video":

        logger.debug(
            f"[{video_id}] LRCLIB で歌詞を検索はじめます。\n    track_name ={track_name!r}\n    artist_name={artist!r}"
        )
        api = LrcLibAPI(user_agent="youtype/0.1.0")
        results = api.search_lyrics(
            track_name=track_name,
            artist_name=artist,
        )
        logger.debug(f"[{video_id}] LRCLIB の検索結果: {len(results)} 件")
        if not results:
            logger.warning(
                f"[{video_id}] LRCLIB での検索結果が空でした。\n    track_name ={track_name!r}\n    artist_name={artist!r}"
            )
            raise ValueError(
                f"LRCLIB で {artist} - {track_name} が見つかりませんでした"
            )

        # 先頭の結果が最も一致しやすいため、synced_lyrics がある曲を優先する
        match = next(
            (r for r in results if r.synced_lyrics),
            None,
        )
        if match is None:
            raise ValueError(f"LRCLIB に {track_name} の同期歌詞がありません")

        assert match.synced_lyrics is not None
        snippets = [
            s
            for s in _parse_lrc(match.synced_lyrics, song_length=match.duration)
            if _JAPANESE.search(s["text"])
        ]
        return cls(
            video_id=video_id,
            title=track_name,
            artist=artist,
            snippets=snippets,
            language="ja",
        )

    @classmethod
    def _from_youtube(
        cls, video_id: str, track_name: str, artist: Optional[str]
    ) -> "Video":
        logger.debug(f"[{video_id}] YouTube Transcript API で字幕を検索します")
        ytt_api = YouTubeTranscriptApi()
        try:
            transcript_list = ytt_api.list(video_id)

            try:
                transcript = transcript_list.find_manually_created_transcript(
                    cls.DEFAULT_LANGUAGES
                )
            except NoTranscriptFound:
                transcript = transcript_list.find_generated_transcript(
                    cls.FALLBACK_GENERATED_LANGUAGES
                )

            fetched = transcript.fetch()
            return cls(
                video_id=video_id,
                title=track_name,
                artist=artist,
                snippets=fetched.to_raw_data(),
                language=fetched.language,
                is_generated=fetched.is_generated,
            )

        except TranscriptsDisabled:
            logger.warning(f"[{video_id}] この動画は字幕が無効です。")
            return cls(video_id=video_id, title=track_name, artist=artist)
        except NoTranscriptFound:
            logger.warning(
                f"[{video_id}] 使用可能な字幕が見つかりませんでした（ja/en 手動・ja 自動生成）。"
            )
            return cls(video_id=video_id, title=track_name, artist=artist)


_LRC_TIME = re.compile(r"\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]")
_JAPANESE = re.compile(r"[ぁ-ゟ゠-ヿ一-鿿㐀-䶿]")


def _fetch_youtube_music_info(video_id: str) -> tuple[str, Optional[str]]:
    logger.debug(f"[{video_id}] yt_dlpで曲名とアーティスト名を取得します")
    import yt_dlp

    opts: Any = {"quiet": True, "no_warnings": True}
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(
            f"https://www.youtube.com/watch?v={video_id}", download=False
        )
    track: str = info.get("track") or info.get("title") or ""
    artist: Optional[str] = info.get("artist") or info.get("uploader")
    logger.debug(f"[{video_id}] 取得した曲名: {track!r}\n  アーティスト名: {artist!r}")
    return track, artist


def _parse_lrc(synced: str, song_length: Optional[float] = None) -> list[dict]:
    rows: list[tuple[float, str]] = []
    for line in synced.splitlines():
        stamps = list(_LRC_TIME.finditer(line))
        if not stamps:
            continue  # [ar:] [ti:] [length:] などのメタデータ行をスキップ
        text = line[stamps[-1].end() :].strip()
        for m in stamps:  # 同じ歌詞行に複数のタイムスタンプが付く場合がある
            mm, ss = int(m.group(1)), int(m.group(2))
            frac = m.group(3) or "0"
            start = mm * 60 + ss + int(frac) / (10 ** len(frac))
            rows.append((start, text))

    rows.sort(key=lambda r: r[0])

    snippets: list[dict] = []
    for i, (start, text) in enumerate(rows):
        if not text:
            continue  # 空行は出力しないが、前の行の終了境界（間奏）として利用する
        end = next(
            (rows[j][0] for j in range(i + 1, len(rows)) if rows[j][0] != start), None
        )
        if end is None:
            end = song_length if song_length else start  # 最後の行は曲の長さで補完する
        snippets.append(
            {
                "text": text,
                "start": start,
                "duration": round(end - start, 3),
            }
        )
    return snippets
