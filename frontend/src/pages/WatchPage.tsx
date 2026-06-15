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
import type { Snippet, VideoData, LrclibResult, State } from "../types";
import AutoChoiceModal from "../components/AutoChoiceModal";
import LyricsSearchModal from "../components/LyricsSearchModal";
import "./WatchPage.css";

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
  const [lyricSize, setLyricSize] = useLocalStorage("lyricSize", 19);
  const [furiganaSize, setFuriganaSize] = useLocalStorage("furiganaSize", 28);
  const [volume, setVolume] = useLocalStorage("volume", 50);
  const [showGapHint, setShowGapHint] = useState(false);
  const [nextIndex, setNextIndex] = useState(-1);
  const [gapProgress, setGapProgress] = useState(0);
  const [songProgress, setSongProgress] = useState(0);

  // Lyrics search modal
  const [showLyricsModal, setShowLyricsModal] = useState(false);
  const [searchTrack, setSearchTrack] = useState("");
  const [searchArtist, setSearchArtist] = useState("");
  const [searchResults, setSearchResults] = useState<LrclibResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [applyingId, setApplyingId] = useState<number | null>(null);
  const [showAutoChoice, setShowAutoChoice] = useState(false);
  const [applyingAutoCC, setApplyingAutoCC] = useState(false);
  const [paused, setPaused] = useState(true);
  const [hasStarted, setHasStarted] = useState(false);
  const hasStartedRef = useRef(false);
  const [ended, setEnded] = useState(false);
  const [exitingIndex, setExitingIndex] = useState(-1);
  const [exitingScrollX, setExitingScrollX] = useState(0);

  const playerRef = useRef<YT.Player | null>(null);
  const playerDivRef = useRef<HTMLDivElement>(null);
  const currentIndexRef = useRef(-1);
  const practiceModeRef = useRef(true);
  const pausedRef = useRef(true);
  const practicePausedRef = useRef(false);
  const matcherRef = useRef<MatchState | null>(null);
  const pendingIndexRef = useRef(-1);
  const nextSnippetIndexRef = useRef(-1);
  const snippetsRef = useRef<Snippet[]>([]);
  const typedRef = useRef<HTMLSpanElement>(null);
  const furiganaRef = useRef<HTMLParagraphElement>(null);
  const lyricContainerRef = useRef<HTMLDivElement>(null);
  const [scrollX, setScrollX] = useState(0);
  const prevIndexRef = useRef(-1);
  const [scrollTransition, setScrollTransition] = useState(true);

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

  // Auto-open modal when no snippets found
  useEffect(() => {
    if (state.status === "success" && state.data.snippets.length === 0) {
      if (state.data.has_auto_cc) {
        setShowAutoChoice(true);
      } else {
        setSearchTrack(state.data.title ?? "");
        setSearchArtist("");
        setSearchResults([]);
        setShowLyricsModal(true);
      }
    }
  }, [state.status]);

  const openLyricsModal = useCallback(() => {
    if (state.status === "success") {
      setSearchTrack(state.data.title ?? "");
      setSearchArtist("");
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
        const res = await fetch("/apply_lyrics", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            video_id: videoId,
            synced_lyrics: result.synced_lyrics,
            title: result.title,
            artist: result.artist,
            duration: result.duration,
          }),
        });
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

  const handleApplyAutoCC = useCallback(async () => {
    if (!videoId || applyingAutoCC) return;
    setApplyingAutoCC(true);
    try {
      const res = await fetch(
        `/apply_auto_cc?video_id=${encodeURIComponent(videoId)}`,
      );
      if (!res.ok) return;
      const data = (await res.json()) as VideoData;
      setState({ status: "success", data });
      setCurrentIndex(-1);
      currentIndexRef.current = -1;
      matcherRef.current = null;
      setMatcher(null);
      setShowAutoChoice(false);
    } finally {
      setApplyingAutoCC(false);
    }
  }, [videoId, applyingAutoCC]);

  const handleChooseLrclib = useCallback(() => {
    setShowAutoChoice(false);
    if (state.status === "success") {
      setSearchTrack(state.data.title ?? "");
      setSearchArtist("");
      setSearchResults([]);
    }
    setShowLyricsModal(true);
  }, [state]);

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
    pausedRef.current = paused;
  }, [paused]);
  useEffect(() => {
    hasStartedRef.current = hasStarted;
  }, [hasStarted]);
  useEffect(() => {
    if (state.status === "success") snippetsRef.current = state.data.snippets;
  }, [state]);

  // Horizontal scroll to keep typed position visible
  useEffect(() => {
    if (currentIndex !== prevIndexRef.current) {
      const prev = prevIndexRef.current;
      prevIndexRef.current = currentIndex;
      if (prev >= 0 && currentIndex > prev) {
        setExitingScrollX(scrollX);
        setExitingIndex(prev);
        setTimeout(() => setExitingIndex(-1), 400);
      }
      setScrollTransition(false);
      setScrollX(0);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setScrollTransition(true));
      });
      return;
    }
    if (!furiganaRef.current || !lyricContainerRef.current) {
      setScrollX(0);
      return;
    }
    const totalWidth = furiganaRef.current.scrollWidth;
    const containerWidth = lyricContainerRef.current.clientWidth - 32;
    const maxScroll = Math.max(0, totalWidth - containerWidth);
    if (maxScroll === 0) {
      setScrollX(0);
      return;
    }
    const typedWidth = typedRef.current?.offsetWidth ?? 0;
    const offset = Math.min(
      Math.max(0, typedWidth - containerWidth / 3),
      maxScroll,
    );
    setScrollX(offset);
  }, [matcher, currentIndex]);

  // Settings open/close → pause/resume + volume
  const settingsWrapRef = useRef<HTMLDivElement>(null);

  const openSettings = useCallback(() => {
    setShowSettings(true);
  }, []);

  const closeSettings = useCallback(() => {
    setShowSettings(false);
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
        playerVars: { rel: 0, modestbranding: 1, controls: 0 },
        events: {
          onStateChange(e) {
            if (e.data === window.YT.PlayerState.PLAYING) {
              practicePausedRef.current = false;
              setPaused(false);
              setHasStarted(true);
              setEnded(false);
            } else if (e.data === window.YT.PlayerState.PAUSED) {
              setPaused(!practicePausedRef.current);
            } else if (e.data === window.YT.PlayerState.ENDED) {
              setEnded(true);
              setPaused(true);
            }
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
              const duration = player.getDuration();
              if (duration > 0) setSongProgress(t / duration);
              const currentDone =
                matcherRef.current !== null &&
                matcherRef.current.tokenIndex >=
                  matcherRef.current.tokens.length;
              const earlyOffset = currentDone ? 0.5 : 0;
              const idx = snippets.findLastIndex(
                (s) => s.start <= t + earlyOffset,
              );

              // Progress bar: current lyric start → next lyric start
              if (idx >= 0 && idx + 1 < snippets.length) {
                const curStart = snippets[idx].start;
                const nextStart = snippets[idx + 1].start;
                const progress =
                  nextStart > curStart
                    ? Math.max(
                        0,
                        Math.min(1, (t - curStart) / (nextStart - curStart)),
                      )
                    : 1;
                setGapProgress(progress);
                setNextIndex(idx + 1);
              } else if (idx < 0 && snippets.length > 0) {
                const nextStart = snippets[0].start;
                const progress =
                  nextStart > 0 ? Math.max(0, Math.min(1, t / nextStart)) : 1;
                setGapProgress(progress);
                setNextIndex(0);
              } else {
                setGapProgress(idx >= 0 ? 1 : 0);
                setNextIndex(-1);
              }

              // Skip hint: typing done and next lyric >3s away
              const inGap =
                idx < 0 || t > snippets[idx].start + snippets[idx].duration;
              const typingDone =
                matcherRef.current !== null &&
                matcherRef.current.tokenIndex >=
                  matcherRef.current.tokens.length;
              const nextIdx2 = idx + 1;
              const lastDone = typingDone && idx === snippets.length - 1;
              if (
                (inGap || typingDone) &&
                nextIdx2 < snippets.length &&
                snippets[nextIdx2].start - t > 3
              ) {
                nextSnippetIndexRef.current = nextIdx2;
                setShowGapHint(true);
              } else if (lastDone) {
                setShowGapHint(true);
              } else {
                nextSnippetIndexRef.current = -1;
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
                  practicePausedRef.current = true;
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
                  practicePausedRef.current = true;
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
      e.preventDefault();
      if (!hasStartedRef.current) {
        playerRef.current?.playVideo();
        return;
      }
      if (nextSnippetIndexRef.current >= 0) {
        const target =
          snippetsRef.current[nextSnippetIndexRef.current].start - 3;
        playerRef.current?.seekTo(Math.max(0, target), true);
        return;
      }
      const m = matcherRef.current;
      const snippets = snippetsRef.current;
      if (
        m &&
        m.tokenIndex >= m.tokens.length &&
        currentIndexRef.current === snippets.length - 1
      ) {
        const duration = playerRef.current?.getDuration();
        if (duration) playerRef.current?.seekTo(duration, true);
        return;
      }
    }

    if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;
    if (pausedRef.current) return;
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
  const doneTokenLen =
    current && matcher
      ? matcher.tokens.slice(0, matcher.doneChars).join("").length
      : 0;
  const doneHLen =
    current && matcher ? doneHiraganaLength(matcher, current.furigana) : 0;
  const doneSLen =
    current && matcher ? doneSurfaceLength(current.tokens, doneTokenLen) : 0;

  const previewFurigana = PREVIEW_TEXT.furigana;
  const previewText = PREVIEW_TEXT.text;
  const previewHLen = Math.floor(previewFurigana.length / 2);
  const previewSLen = Math.floor(previewText.length / 2);

  return (
    <main className="watch">
      <header className="watch-header">
        <h1>{data.title ?? videoId}</h1>
        {data.artist && <p className="artist">{data.artist}</p>}
        {data.source && (
          <span className={`source-badge source-${data.source}`}>
            {data.source === "lrclib"
              ? "LRCLIB"
              : data.source === "youtube"
                ? "CC字幕"
                : "自動CC字幕"}
          </span>
        )}
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

        {/* 右：練習モード + 設定ギア */}
        <div className="toolbar-right">
          <button
            className={`toggle-btn${practiceMode ? " on" : ""}`}
            onClick={() => setPracticeMode((v) => !v)}
          >
            練習 {practiceMode ? "ON" : "OFF"}
          </button>
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
                <button className="lyrics-change-btn" onClick={openLyricsModal}>
                  歌詞を変更する
                </button>
                <hr className="settings-divider" />
                <div className="size-control">
                  <span className="size-label">歌詞</span>
                  <button
                    className="size-btn"
                    onClick={() => setLyricSize((v) => Math.max(10, v - 1))}
                  >
                    −
                  </button>
                  <span className="size-value">{lyricSize}</span>
                  <button
                    className="size-btn"
                    onClick={() => setLyricSize((v) => Math.min(28, v + 1))}
                  >
                    +
                  </button>
                </div>
                <div className="size-control">
                  <span className="size-label">ふりがな</span>
                  <button
                    className="size-btn"
                    onClick={() => setFuriganaSize((v) => Math.max(18, v - 1))}
                  >
                    −
                  </button>
                  <span className="size-value">{furiganaSize}</span>
                  <button
                    className="size-btn"
                    onClick={() => setFuriganaSize((v) => Math.min(38, v + 1))}
                  >
                    +
                  </button>
                </div>
                <hr className="settings-divider" />
                <button
                  className="lyrics-change-btn"
                  onClick={() => {
                    setLyricSize(19);
                    setFuriganaSize(28);
                  }}
                >
                  サイズをリセット
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="player-wrapper">
        <div ref={playerDivRef} />
      </div>

      {!showSettings && (
        <>
          <div className="progress-group">
            <div className="gap-progress-wrap">
              <div
                className="gap-progress-bar"
                style={{ width: `${gapProgress * 100}%` }}
              />
            </div>
            {showGapHint && <span className="gap-hint">Space: スキップ</span>}
          </div>
          <div className="song-progress-wrap">
            <div
              className="song-progress-bar"
              style={{ width: `${songProgress * 100}%` }}
            />
          </div>
        </>
      )}

      <div
        className={`current-lyric${paused && hasStarted && !ended && !showSettings ? " paused" : ""}`}
        ref={lyricContainerRef}
      >
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
          <>
            {exitingIndex >= 0 && data.snippets[exitingIndex] && (
              <div className="lyric-pair lyric-exit">
                <div className="lyric-row">
                  <p
                    className="furigana"
                    style={{
                      fontSize: furiganaSize,
                      transform: `translateX(-${exitingScrollX}px)`,
                    }}
                  >
                    <span className="typed">
                      {data.snippets[exitingIndex].furigana}
                    </span>
                  </p>
                  <p className="lyric-text" style={{ fontSize: lyricSize }}>
                    <span className="typed">
                      {data.snippets[exitingIndex].text}
                    </span>
                  </p>
                </div>
              </div>
            )}
            <div
              key={currentIndex}
              className={`lyric-pair${currentIndex > 0 ? " lyric-slide" : ""}`}
            >
              <div className="lyric-row">
                <p
                  ref={furiganaRef}
                  className={`furigana${scrollTransition ? " lyric-scroll" : ""}`}
                  style={{
                    fontSize: furiganaSize,
                    transform: `translateX(-${scrollX}px)`,
                  }}
                >
                  <span className="typed" ref={typedRef}>
                    {current.furigana.slice(0, doneHLen)}
                  </span>
                  <span>{current.furigana.slice(doneHLen)}</span>
                </p>
                <p className="lyric-text" style={{ fontSize: lyricSize }}>
                  <span className="typed">
                    {current.text.slice(0, doneSLen)}
                  </span>
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
          </>
        ) : data.snippets.length > 0 ? (
          <div className="lyric-pair">
            <div className="lyric-row">
              <p
                className="furigana preview-text"
                style={{ fontSize: furiganaSize }}
              >
                {data.snippets[nextIndex >= 0 ? nextIndex : 0].furigana}
              </p>
              <p
                className="lyric-text preview-text"
                style={{ fontSize: lyricSize }}
              >
                {data.snippets[nextIndex >= 0 ? nextIndex : 0].text}
              </p>
            </div>
            {(nextIndex >= 0 ? nextIndex : 0) + 1 < data.snippets.length && (
              <div className="lyric-row next">
                <p
                  className="furigana preview-text"
                  style={{ fontSize: furiganaSize }}
                >
                  {data.snippets[(nextIndex >= 0 ? nextIndex : 0) + 1].furigana}
                </p>
                <p
                  className="lyric-text preview-text"
                  style={{ fontSize: lyricSize }}
                >
                  {data.snippets[(nextIndex >= 0 ? nextIndex : 0) + 1].text}
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="lyric-row">
            <p className="lyric-placeholder">♪</p>
          </div>
        )}
        {paused && !showSettings && (
          <div className="paused-overlay">
            {ended ? (
              <button
                className="start-btn"
                onClick={() => {
                  playerRef.current?.seekTo(0, true);
                  playerRef.current?.playVideo();
                  currentIndexRef.current = -1;
                  pendingIndexRef.current = -1;
                  setCurrentIndex(-1);
                  matcherRef.current = null;
                  setMatcher(null);
                  setGapProgress(0);
                  setSongProgress(0);
                }}
              >
                ▶ もう一度
              </button>
            ) : hasStarted ? (
              "一時停止中"
            ) : (
              <button
                className="start-btn"
                onClick={() => playerRef.current?.playVideo()}
              >
                ▶ スタート (Space)
              </button>
            )}
          </div>
        )}
      </div>

      {showAutoChoice && (
        <AutoChoiceModal
          applyingAutoCC={applyingAutoCC}
          onApplyAutoCC={handleApplyAutoCC}
          onChooseLrclib={handleChooseLrclib}
        />
      )}

      {showLyricsModal && (
        <LyricsSearchModal
          searchTrack={searchTrack}
          searchArtist={searchArtist}
          searchResults={searchResults}
          searching={searching}
          applyingId={applyingId}
          canClose={
            state.status === "success" && state.data.snippets.length > 0
          }
          onSearchTrackChange={setSearchTrack}
          onSearchArtistChange={setSearchArtist}
          onSearch={handleLyricsSearch}
          onApply={handleApplyLyrics}
          onClose={() => setShowLyricsModal(false)}
        />
      )}
    </main>
  );
}
