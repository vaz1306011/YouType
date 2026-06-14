declare global {
  interface Window {
    onYouTubeIframeAPIReady?: () => void;
  }
}

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  advance,
  createMatcher,
  doneHiraganaLength,
  doneSurfaceLength,
  type MatchState,
} from "../lib/romaji";
import { useLocalStorage } from "../lib/useLocalStorage";

interface Token {
  surface: string;
  reading: string;
}

interface Snippet {
  text: string;
  furigana: string;
  tokens: Token[];
  start: number;
  duration: number;
}

interface VideoData {
  video_id: string;
  title: string | null;
  artist: string | null;
  snippets: Snippet[];
  language: string | null;
  is_generated: boolean | null;
}

interface LrclibResult {
  id: number;
  title: string;
  artist: string;
  album: string | null;
  duration: number | null;
  synced: boolean;
}

type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; data: VideoData }
  | { status: "error"; message: string };

const PREVIEW_TEXT = {
  text: "サンプル歌詞テキスト",
  furigana: "さんぷるかしてきすと",
};

function loadYouTubeApi(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve();
  return new Promise((resolve) => {
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);
    window.onYouTubeIframeAPIReady = resolve;
  });
}

export default function WatchPage() {
  const [searchParams] = useSearchParams();
  const videoId = searchParams.get("v");
  const [state, setState] = useState<State>({ status: "idle" });
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [matcher, setMatcher] = useState<MatchState | null>(null);
  const [practiceMode, setPracticeMode] = useLocalStorage("practiceMode", true);
  const [showSettings, setShowSettings] = useState(false);
  const [lyricSize, setLyricSize] = useLocalStorage("lyricSize", 28);
  const [furiganaSize, setFuriganaSize] = useLocalStorage("furiganaSize", 15);
  const [volume, setVolume] = useLocalStorage("volume", 100);
  const [showGapHint, setShowGapHint] = useState(false);
  const [nextIndex, setNextIndex] = useState(-1);
  const [gapProgress, setGapProgress] = useState(0);

  // Lyrics search modal
  const [showLyricsModal, setShowLyricsModal] = useState(false);
  const [searchTrack, setSearchTrack] = useState("");
  const [searchArtist, setSearchArtist] = useState("");
  const [searchResults, setSearchResults] = useState<LrclibResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [applyingId, setApplyingId] = useState<number | null>(null);

  const playerRef = useRef<YT.Player | null>(null);
  const playerDivRef = useRef<HTMLDivElement>(null);
  const currentIndexRef = useRef(-1);
  const practiceModeRef = useRef(true);
  const matcherRef = useRef<MatchState | null>(null);
  const pendingIndexRef = useRef(-1);
  const nextSnippetIndexRef = useRef(-1);
  const snippetsRef = useRef<Snippet[]>([]);

  // Fetch transcript
  useEffect(() => {
    if (!videoId) {
      setState({
        status: "error",
        message: "URLに動画IDがありません（?v=... が必要です）",
      });
      return;
    }
    setState({ status: "loading" });
    fetch(`/transcript?video_id=${encodeURIComponent(videoId)}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.detail ?? `エラー: ${res.status}`);
        }
        return res.json() as Promise<VideoData>;
      })
      .then((data) => setState({ status: "success", data }))
      .catch((err: Error) =>
        setState({ status: "error", message: err.message }),
      );
  }, [videoId]);

  // Auto-open lyrics modal when no snippets found
  useEffect(() => {
    if (state.status === "success" && state.data.snippets.length === 0) {
      setSearchTrack(state.data.title ?? "");
      setSearchArtist(state.data.artist ?? "");
      setSearchResults([]);
      setShowLyricsModal(true);
    }
  }, [state.status]);

  const openLyricsModal = useCallback(() => {
    if (state.status === "success") {
      setSearchTrack(state.data.title ?? "");
      setSearchArtist(state.data.artist ?? "");
      setSearchResults([]);
    }
    playerRef.current?.pauseVideo();
    setShowSettings(false);
    setShowLyricsModal(true);
  }, [state]);

  const handleLyricsSearch = useCallback(async () => {
    if (!searchTrack.trim()) return;
    setSearching(true);
    setSearchResults([]);
    try {
      const res = await fetch(
        `/search_lyrics?track=${encodeURIComponent(searchTrack)}&artist=${encodeURIComponent(searchArtist)}`,
      );
      if (res.ok) setSearchResults(await res.json());
    } finally {
      setSearching(false);
    }
  }, [searchTrack, searchArtist]);

  const handleApplyLyrics = useCallback(
    async (result: LrclibResult) => {
      if (!videoId || applyingId !== null) return;
      setApplyingId(result.id);
      try {
        const params = new URLSearchParams({
          video_id: videoId,
          lrclib_id: String(result.id),
          title: result.title,
          artist: result.artist,
        });
        const res = await fetch(`/apply_lyrics?${params}`);
        if (!res.ok) return;
        const data = (await res.json()) as VideoData;
        setState({ status: "success", data });
        setCurrentIndex(-1);
        currentIndexRef.current = -1;
        matcherRef.current = null;
        setMatcher(null);
        setShowLyricsModal(false);
      } finally {
        setApplyingId(null);
      }
    },
    [videoId, applyingId],
  );

  // Update page title
  useEffect(() => {
    if (state.status === "success" && state.data.title) {
      document.title = `${state.data.title} - Youtype`;
    }
    return () => {
      document.title = "Youtype";
    };
  }, [state]);

  // Keep refs in sync
  useEffect(() => {
    practiceModeRef.current = practiceMode;
  }, [practiceMode]);
  useEffect(() => {
    if (state.status === "success") snippetsRef.current = state.data.snippets;
  }, [state]);

  // Settings open/close → pause/resume + volume
  const settingsWrapRef = useRef<HTMLDivElement>(null);

  const openSettings = useCallback(() => {
    playerRef.current?.pauseVideo();
    setShowSettings(true);
  }, []);

  const closeSettings = useCallback(() => {
    setShowSettings(false);
    playerRef.current?.playVideo();
  }, []);

  useEffect(() => {
    if (!showSettings) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        settingsWrapRef.current &&
        !settingsWrapRef.current.contains(e.target as Node)
      ) {
        closeSettings();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showSettings, closeSettings]);

  // Volume change
  useEffect(() => {
    playerRef.current?.setVolume(volume);
  }, [volume]);

  // Initialize YouTube Player
  useEffect(() => {
    if (state.status !== "success" || !videoId || !playerDivRef.current) return;
    let timer: ReturnType<typeof setInterval>;

    loadYouTubeApi().then(() => {
      playerRef.current = new window.YT.Player(playerDivRef.current!, {
        videoId,
        playerVars: { rel: 0, modestbranding: 1 },
        events: {
          onStateChange(e) {
            if (e.data === window.YT.PlayerState.BUFFERING) {
              const snips = snippetsRef.current;
              const t = e.target.getCurrentTime();
              const idx = snips.findLastIndex((s: Snippet) => s.start <= t);
              if (
                idx !== currentIndexRef.current &&
                idx > currentIndexRef.current
              ) {
                currentIndexRef.current = idx;
                pendingIndexRef.current = -1;
                setCurrentIndex(idx);
                if (idx >= 0) {
                  const newMatcher = createMatcher(snips[idx].furigana);
                  matcherRef.current = newMatcher;
                  setMatcher(newMatcher);
                }
              }
            }
          },
          onReady(e) {
            e.target.setVolume(volume);
            timer = setInterval(() => {
              const player = playerRef.current;
              if (!player || typeof player.getCurrentTime !== "function")
                return;
              const snippets = snippetsRef.current;
              if (!snippets.length) return;
              const ps = player.getPlayerState();
              if (
                ps === window.YT.PlayerState.UNSTARTED ||
                ps === window.YT.PlayerState.ENDED
              )
                return;
              const t = player.getCurrentTime();
              const idx = snippets.findLastIndex((s) => s.start <= t);

              const inGap =
                idx < 0 || t > snippets[idx].start + snippets[idx].duration;
              if (inGap) {
                const nextIdx = idx + 1;
                if (nextIdx < snippets.length) {
                  const nextStart = snippets[nextIdx].start;
                  const gapStart =
                    idx >= 0 ? snippets[idx].start + snippets[idx].duration : 0;
                  const progress =
                    gapStart < nextStart
                      ? Math.max(
                          0,
                          Math.min(1, (t - gapStart) / (nextStart - gapStart)),
                        )
                      : 1;
                  setNextIndex(nextIdx);
                  setGapProgress(progress);
                  if (nextStart - t > 2) {
                    nextSnippetIndexRef.current = nextIdx;
                    setShowGapHint(true);
                  } else {
                    nextSnippetIndexRef.current = -1;
                    setShowGapHint(false);
                  }
                } else {
                  nextSnippetIndexRef.current = -1;
                  setNextIndex(-1);
                  setGapProgress(0);
                  setShowGapHint(false);
                }
              } else {
                nextSnippetIndexRef.current = -1;
                setNextIndex(-1);
                setGapProgress(0);
                setShowGapHint(false);
              }

              // 練習モード: 次の行の0.25秒前に未完なら事前停止
              if (
                practiceModeRef.current &&
                idx >= 0 &&
                idx === currentIndexRef.current &&
                pendingIndexRef.current < 0
              ) {
                const nextIdx = idx + 1;
                const notDone =
                  matcherRef.current !== null &&
                  matcherRef.current.tokenIndex <
                    matcherRef.current.tokens.length;
                if (
                  notDone &&
                  nextIdx < snippets.length &&
                  snippets[nextIdx].start - t <= 0.25
                ) {
                  player.pauseVideo();
                  pendingIndexRef.current = nextIdx;
                }
              }

              // 後退は無視（打ち終わり直後の動画位置ずれによる誤検知を防ぐ）
              if (
                idx !== currentIndexRef.current &&
                idx > currentIndexRef.current
              ) {
                const notDone =
                  matcherRef.current !== null &&
                  matcherRef.current.tokenIndex <
                    matcherRef.current.tokens.length;

                if (
                  practiceModeRef.current &&
                  currentIndexRef.current >= 0 &&
                  notDone
                ) {
                  player.pauseVideo();
                  pendingIndexRef.current = idx;
                } else {
                  currentIndexRef.current = idx;
                  pendingIndexRef.current = -1;
                  setCurrentIndex(idx);
                  if (idx >= 0) {
                    const newMatcher = createMatcher(snippets[idx].furigana);
                    matcherRef.current = newMatcher;
                    setMatcher(newMatcher);
                  }
                }
              }
            }, 200);
          },
        },
      });
    });

    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status, videoId]);

  // Keyboard input
  const handleKey = useCallback((e: KeyboardEvent) => {
    if (e.key === " ") {
      // Gap 中：跳到下一句
      if (nextSnippetIndexRef.current >= 0) {
        e.preventDefault();
        const target =
          snippetsRef.current[nextSnippetIndexRef.current].start - 2;
        playerRef.current?.seekTo(Math.max(0, target), true);
        return;
      }
      // 當前歌詞打完：跳到下一句
      const done =
        matcherRef.current &&
        matcherRef.current.tokenIndex >= matcherRef.current.tokens.length;
      const nextIdx = currentIndexRef.current + 1;
      if (done && nextIdx < snippetsRef.current.length) {
        e.preventDefault();
        const target = snippetsRef.current[nextIdx].start;
        playerRef.current?.seekTo(Math.max(0, target - 0.2), true);
        currentIndexRef.current = nextIdx;
        pendingIndexRef.current = -1;
        setCurrentIndex(nextIdx);
        const newMatcher = createMatcher(snippetsRef.current[nextIdx].furigana);
        matcherRef.current = newMatcher;
        setMatcher(newMatcher);
        return;
      }
    }

    if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;
    const prev = matcherRef.current;
    if (!prev) return;
    const [next, result] = advance(prev, e.key);
    matcherRef.current = next;
    setMatcher(next);

    if (result === "complete") {
      const pending = pendingIndexRef.current;
      if (pending >= 0) {
        const newMatcher = createMatcher(snippetsRef.current[pending].furigana);
        matcherRef.current = newMatcher;
        currentIndexRef.current = pending;
        pendingIndexRef.current = -1;
        setCurrentIndex(pending);
        setMatcher(newMatcher);
        if (practiceModeRef.current) playerRef.current?.playVideo();
      } else if (practiceModeRef.current) {
        playerRef.current?.playVideo();
      }
    }
  }, []);

  useEffect(() => {
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [handleKey]);

  // iframe がフォーカスを奪ったら即座に取り返す（YouTube ショートカットを無効化）
  useEffect(() => {
    const onBlur = () => requestAnimationFrame(() => window.focus());
    window.addEventListener("blur", onBlur);
    return () => window.removeEventListener("blur", onBlur);
  }, []);

  if (state.status === "idle" || state.status === "loading") {
    return (
      <div className="loading">
        <div className="loading-dots">
          <span />
          <span />
          <span />
        </div>
        <p>歌詞を取得中...</p>
      </div>
    );
  }

  if (state.status === "error") {
    return <div className="status error">{state.message}</div>;
  }

  const { data } = state;
  const current = currentIndex >= 0 ? data.snippets[currentIndex] : null;
  const doneHLen = current && matcher ? doneHiraganaLength(matcher) : 0;
  const doneSLen =
    current && matcher ? doneSurfaceLength(current.tokens, doneHLen) : 0;

  const previewFurigana = PREVIEW_TEXT.furigana;
  const previewText = PREVIEW_TEXT.text;
  const previewHLen = Math.floor(previewFurigana.length / 2);
  const previewSLen = Math.floor(previewText.length / 2);

  return (
    <main className="watch">
      <header className="watch-header">
        <h1>{data.title ?? videoId}</h1>
        {data.artist && <p className="artist">{data.artist}</p>}
      </header>

      <div className="toolbar">
        {/* 左：音量スライダー */}
        <div className="volume-wrap">
          <span className="volume-icon">🔊</span>
          <input
            type="range"
            min={0}
            max={100}
            value={volume}
            className="volume-slider"
            onChange={(e) => setVolume(Number(e.target.value))}
          />
        </div>

        {/* 右：設定ギア */}
        <div className="settings-wrap" ref={settingsWrapRef}>
          <button
            className={`settings-btn${showSettings ? " on" : ""}`}
            onClick={() => (showSettings ? closeSettings() : openSettings())}
            aria-label="設定"
          >
            ⚙
          </button>
          {showSettings && (
            <div className="settings-panel">
              <label className="toggle-row">
                練習モード
                <button
                  className={`toggle-btn${practiceMode ? " on" : ""}`}
                  onClick={() => setPracticeMode((v) => !v)}
                >
                  {practiceMode ? "ON" : "OFF"}
                </button>
              </label>
              <hr className="settings-divider" />
              <button className="lyrics-change-btn" onClick={openLyricsModal}>
                歌詞を変更する
              </button>
              <hr className="settings-divider" />
              <label>
                歌詞サイズ <span>{lyricSize}px</span>
                <input
                  type="range"
                  min={16}
                  max={56}
                  value={lyricSize}
                  onChange={(e) => setLyricSize(Number(e.target.value))}
                />
              </label>
              <label>
                ふりがなサイズ <span>{furiganaSize}px</span>
                <input
                  type="range"
                  min={10}
                  max={28}
                  value={furiganaSize}
                  onChange={(e) => setFuriganaSize(Number(e.target.value))}
                />
              </label>
            </div>
          )}
        </div>
      </div>

      <div className="player-wrapper">
        <div ref={playerDivRef} />
      </div>

      {nextIndex >= 0 && !current && !showSettings && (
        <>
          <div className="gap-progress-wrap">
            <div
              className="gap-progress-bar"
              style={{ width: `${gapProgress * 100}%` }}
            />
          </div>
          {showGapHint && (
            <p className="gap-hint">スペースキーで次の歌詞へスキップ</p>
          )}
        </>
      )}

      <div className="current-lyric">
        {showSettings ? (
          <div className="lyric-row">
            <p className="furigana" style={{ fontSize: furiganaSize }}>
              <span className="typed">
                {previewFurigana.slice(0, previewHLen)}
              </span>
              <span>{previewFurigana.slice(previewHLen)}</span>
            </p>
            <p className="lyric-text" style={{ fontSize: lyricSize }}>
              <span className="typed">{previewText.slice(0, previewSLen)}</span>
              <span>{previewText.slice(previewSLen)}</span>
            </p>
          </div>
        ) : current ? (
          <div key={currentIndex} className="lyric-pair lyric-slide">
            <div className="lyric-row">
              <p className="furigana" style={{ fontSize: furiganaSize }}>
                <span className="typed">
                  {current.furigana.slice(0, doneHLen)}
                </span>
                <span>{current.furigana.slice(doneHLen)}</span>
              </p>
              <p className="lyric-text" style={{ fontSize: lyricSize }}>
                <span className="typed">{current.text.slice(0, doneSLen)}</span>
                <span>{current.text.slice(doneSLen)}</span>
              </p>
            </div>
            {currentIndex + 1 < data.snippets.length && (
              <div className="lyric-row next">
                <p
                  className="furigana preview-text"
                  style={{ fontSize: furiganaSize }}
                >
                  {data.snippets[currentIndex + 1].furigana}
                </p>
                <p
                  className="lyric-text preview-text"
                  style={{ fontSize: lyricSize }}
                >
                  {data.snippets[currentIndex + 1].text}
                </p>
              </div>
            )}
          </div>
        ) : nextIndex >= 0 ? (
          <div className="lyric-row">
            <p
              className="furigana preview-text"
              style={{ fontSize: furiganaSize }}
            >
              {data.snippets[nextIndex].furigana}
            </p>
            <p
              className="lyric-text preview-text"
              style={{ fontSize: lyricSize }}
            >
              {data.snippets[nextIndex].text}
            </p>
          </div>
        ) : (
          <div className="lyric-row">
            <p className="lyric-placeholder">♪</p>
          </div>
        )}
      </div>

      {showLyricsModal && (
        <div
          className="modal-overlay"
          onClick={(e) => {
            if (
              e.target === e.currentTarget &&
              state.status === "success" &&
              state.data.snippets.length > 0
            )
              setShowLyricsModal(false);
          }}
        >
          <div className="modal">
            <h2 className="modal-title">歌詞を検索</h2>
            <div className="modal-fields">
              <input
                className="modal-input"
                placeholder="曲名"
                value={searchTrack}
                onChange={(e) => setSearchTrack(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleLyricsSearch()}
              />
              <input
                className="modal-input"
                placeholder="アーティスト（省略可）"
                value={searchArtist}
                onChange={(e) => setSearchArtist(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleLyricsSearch()}
              />
              <button
                className="modal-search-btn"
                onClick={handleLyricsSearch}
                disabled={searching}
              >
                {searching ? "検索中..." : "検索"}
              </button>
            </div>
            {searchResults.length > 0 && (
              <ul className="modal-results">
                {searchResults
                  .filter((r) => r.synced)
                  .map((r) => (
                    <li
                      key={r.id}
                      className="modal-result"
                      onClick={() =>
                        applyingId === null && handleApplyLyrics(r)
                      }
                    >
                      <span className="result-title">{r.title}</span>
                      <span className="result-artist">
                        {r.artist}
                        {r.album ? ` — ${r.album}` : ""}
                      </span>
                      {applyingId === r.id && (
                        <span className="result-applying">適用中...</span>
                      )}
                    </li>
                  ))}
              </ul>
            )}
            {searchResults.length === 0 && !searching && searchTrack && (
              <p className="modal-empty">結果がありません</p>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
