import logging
import re
from dataclasses import dataclass, field
from typing import Any, ClassVar, Optional

import fugashi
from lrclib import LrcLibAPI
from youtube_transcript_api import YouTubeTranscriptApi

_tagger = fugashi.Tagger()  # type: ignore[attr-defined]

# ひらがな・カタカナ・漢字・半角カタカナ・英数字以外を除去
_PUNCT = re.compile(r"[^぀-ゟ゠-ヿ一-鿿々〃ゞゝｦ-ﾟa-zA-Z0-9]")


def _strip_punct(text: str) -> str:
    return _PUNCT.sub("", text)


def _to_hiragana(text: str) -> str:
    return "".join(chr(ord(c) - 0x60) if "ァ" <= c <= "ン" else c for c in text)


def _split_mixed(surface: str, reading: str) -> list[dict]:
    """「淡と」→「あわと」のように漢字+ひらがな混在トークンを分割する。
    surface末尾のひらがな連続がreadingの末尾と一致する場合に分割する。"""
    for i in range(1, len(surface)):
        suffix = surface[i:]
        if all("ぁ" <= c <= "ん" for c in suffix) and reading.endswith(suffix):
            return [
                {"surface": surface[:i], "reading": reading[: -len(suffix)]},
                {"surface": suffix, "reading": suffix},
            ]
    return [{"surface": surface, "reading": reading}]


_NANI_PARTICLES = set("もがをにでのか")

_READING_OVERRIDES = {
    ("君", "くん"): "きみ",
}


def _furigana_tokens(text: str) -> list[dict]:
    """形態素ごとに {surface, reading} のリストを返す"""
    words = _tagger(text)
    result = []
    for i, w in enumerate(words):
        surface = w.surface
        reading = _to_hiragana(w.feature.kana or surface)
        # 「何」+ 助詞（も/が/を/に/で/の/か）→「なに」に修正
        if surface == "何" and reading == "なん" and i + 1 < len(words):
            next_surf = words[i + 1].surface
            if next_surf and next_surf[0] in _NANI_PARTICLES:
                reading = "なに"
        # 固定の読み修正（歌詞向け）
        reading = _READING_OVERRIDES.get((surface, reading), reading)
        result.extend(_split_mixed(surface, reading))
    return result


_ALPHA = re.compile(r"[a-zA-Z]")


def _join_readings(tokens: list[dict]) -> str:
    parts: list[str] = []
    for i, t in enumerate(tokens):
        if (
            i > 0
            and _ALPHA.match(t["reading"])
            and _ALPHA.match(tokens[i - 1]["reading"][-1:])
        ):
            parts.append(" ")
        parts.append(t["reading"])
    return "".join(parts)


def _furigana(text: str) -> str:
    return _join_readings(_furigana_tokens(text))


def _preview_lines(synced: str | None, plain: str | None, n: int = 3) -> list[str]:
    text = synced or plain or ""
    lines: list[str] = []
    for line in text.splitlines():
        clean = _LRC_TIME.sub("", line).strip() if synced else line.strip()
        if clean:
            lines.append(clean)
        if len(lines) >= n:
            break
    return lines


def search_lrclib(track: str, artist: str) -> list[dict]:
    api = LrcLibAPI(user_agent="youtype/0.1.0")
    results = api.search_lyrics(track_name=track, artist_name=artist)
    return [
        {
            "id": r.id,
            "title": r.track_name,
            "artist": r.artist_name,
            "album": r.album_name,
            "duration": r.duration,
            "synced": bool(r.synced_lyrics),
            "synced_lyrics": r.synced_lyrics,
            "preview": _preview_lines(r.synced_lyrics, r.plain_lyrics),
        }
        for r in results
    ]


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
    source: Optional[str] = None
    has_auto_cc: bool = False

    @classmethod
    def from_id(
        cls,
        video_id: str,
    ) -> "Video":
        track_name: str = ""
        artist_name: Optional[str] = None
        album_name: Optional[str] = None
        try:
            track_name, artist_name, album_name = _fetch_youtube_music_info(video_id)
        except Exception as e:
            logger.warning(f"[{video_id}] yt_dlpからの情報の取得に失敗しました: {e}")
            return cls(video_id=video_id, title=None, artist=None)

        # 1. LRCLIB
        try:
            return cls._from_lrclib(video_id, track_name, artist_name, album_name)
        except Exception:
            pass

        # 2. YouTube 手動CC字幕
        try:
            return cls._from_youtube_manual(video_id, track_name, artist_name)
        except Exception:
            pass

        # 3. 自動生成CC字幕の有無を確認
        has_auto = cls._has_auto_cc(video_id)
        return cls(
            video_id=video_id,
            title=track_name,
            artist=artist_name,
            has_auto_cc=has_auto,
        )

    @classmethod
    def from_synced_lyrics(
        cls,
        video_id: str,
        synced_lyrics: str,
        title: Optional[str] = None,
        artist: Optional[str] = None,
        duration: Optional[float] = None,
    ) -> "Video":
        snippets = []
        for s in _parse_lrc(synced_lyrics, song_length=duration):
            if not _JAPANESE.search(s["text"]):
                continue
            clean = _strip_punct(s["text"])
            tokens = _furigana_tokens(clean)
            snippets.append(
                {
                    **s,
                    "text": clean,
                    "furigana": _join_readings(tokens),
                    "tokens": tokens,
                }
            )
        return cls(
            video_id=video_id,
            title=title,
            artist=artist,
            snippets=snippets,
            language="ja",
            source="lrclib",
        )

    @classmethod
    def _from_lrclib(
        cls,
        video_id: str,
        track_name: str,
        artist: Optional[str],
        album: Optional[str] = None,
    ) -> "Video":

        logger.debug(
            f"[{video_id}] LRCLIB で歌詞を検索はじめます。\n    track_name ={track_name!r}\n    artist_name={artist!r}\n    album_name={album!r}"
        )
        api = LrcLibAPI(user_agent="youtype/0.1.0")

        # 1) アーティスト名で検索
        results = api.search_lyrics(track_name=track_name, artist_name=artist)
        logger.debug(f"[{video_id}] LRCLIB artist検索: {len(results)} 件")

        # 2) アルバム名で検索
        if not results and album:
            results = api.search_lyrics(track_name=track_name, album_name=album)
            logger.debug(f"[{video_id}] LRCLIB album検索: {len(results)} 件")

        # 3) 曲名のみで検索
        if not results:
            results = api.search_lyrics(track_name=track_name)
            logger.debug(f"[{video_id}] LRCLIB 曲名のみ検索: {len(results)} 件")

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
        snippets = []
        for s in _parse_lrc(match.synced_lyrics, song_length=match.duration):
            if not _JAPANESE.search(s["text"]):
                continue
            clean = _strip_punct(s["text"])
            tokens = _furigana_tokens(clean)
            snippets.append(
                {
                    **s,
                    "text": clean,
                    "furigana": _join_readings(tokens),
                    "tokens": tokens,
                }
            )
        return cls(
            video_id=video_id,
            title=track_name,
            artist=artist,
            snippets=snippets,
            language="ja",
            source="lrclib",
        )

    @classmethod
    def _from_youtube_manual(
        cls, video_id: str, track_name: str, artist: Optional[str]
    ) -> "Video":
        logger.debug(f"[{video_id}] YouTube 手動CC字幕を検索します")
        ytt_api = YouTubeTranscriptApi()
        transcript_list = ytt_api.list(video_id)
        transcript = transcript_list.find_manually_created_transcript(
            cls.DEFAULT_LANGUAGES
        )
        return cls._build_from_transcript(
            video_id, track_name, artist, transcript, source="youtube"
        )

    @classmethod
    def from_auto_cc(
        cls,
        video_id: str,
        track_name: Optional[str] = None,
        artist: Optional[str] = None,
    ) -> "Video":
        logger.debug(f"[{video_id}] YouTube 自動生成CC字幕を取得します")
        if not track_name:
            try:
                track_name, artist, _ = _fetch_youtube_music_info(video_id)
            except Exception:
                track_name = ""
        ytt_api = YouTubeTranscriptApi()
        transcript_list = ytt_api.list(video_id)
        transcript = transcript_list.find_generated_transcript(
            cls.FALLBACK_GENERATED_LANGUAGES
        )
        return cls._build_from_transcript(
            video_id, track_name, artist, transcript, source="youtube_generated"
        )

    @classmethod
    def _build_from_transcript(
        cls,
        video_id: str,
        track_name: str,
        artist: Optional[str],
        transcript: Any,
        source: str,
    ) -> "Video":
        fetched = transcript.fetch()
        raw = fetched.to_raw_data()
        snippets = []
        for s in raw:
            if s["text"].startswith("[") and s["text"].endswith("]"):
                continue
            clean = _strip_punct(s["text"])
            tokens = _furigana_tokens(clean)
            snippets.append(
                {
                    **s,
                    "text": clean,
                    "furigana": _join_readings(tokens),
                    "tokens": tokens,
                }
            )
        return cls(
            video_id=video_id,
            title=track_name,
            artist=artist,
            snippets=snippets,
            language=fetched.language,
            is_generated=fetched.is_generated,
            source=source,
        )

    @classmethod
    def _has_auto_cc(cls, video_id: str) -> bool:
        try:
            ytt_api = YouTubeTranscriptApi()
            transcript_list = ytt_api.list(video_id)
            transcript_list.find_generated_transcript(cls.FALLBACK_GENERATED_LANGUAGES)
            return True
        except Exception:
            return False


_LRC_TIME = re.compile(r"\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]")
_JAPANESE = re.compile(r"[ぁ-ゟ゠-ヿ一-鿿㐀-䶿]")


def _fetch_youtube_music_info(
    video_id: str,
) -> tuple[str, Optional[str], Optional[str]]:
    logger.debug(f"[{video_id}] yt_dlpで曲名とアーティスト名を取得します")
    import yt_dlp

    opts: Any = {"quiet": True, "no_warnings": True}
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(
            f"https://www.youtube.com/watch?v={video_id}", download=False
        )
    track: str = info.get("track") or info.get("title") or ""
    artist: Optional[str] = info.get("artist") or info.get("uploader")
    album: Optional[str] = info.get("album")
    logger.debug(
        f"[{video_id}] 取得した曲名: {track!r}\n  アーティスト名: {artist!r}\n  アルバム名: {album!r}"
    )
    return track, artist, album


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
