import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { advance, createMatcher, doneHiraganaLength, doneSurfaceLength, type MatchState } from '../lib/romaji'

interface Token {
  surface: string
  reading: string
}

interface Snippet {
  text: string
  furigana: string
  tokens: Token[]
  start: number
  duration: number
}

interface VideoData {
  video_id: string
  title: string | null
  artist: string | null
  snippets: Snippet[]
  language: string | null
  is_generated: boolean | null
}

type State =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: VideoData }
  | { status: 'error'; message: string }

const PREVIEW_TEXT = { text: 'サンプル歌詞テキスト', furigana: 'さんぷるかしてきすと' }

function loadYouTubeApi(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve()
  return new Promise((resolve) => {
    const tag = document.createElement('script')
    tag.src = 'https://www.youtube.com/iframe_api'
    document.head.appendChild(tag)
    window.onYouTubeIframeAPIReady = resolve
  })
}

export default function WatchPage() {
  const [searchParams] = useSearchParams()
  const videoId = searchParams.get('v')
  const [state, setState] = useState<State>({ status: 'idle' })
  const [currentIndex, setCurrentIndex] = useState(-1)
  const [matcher, setMatcher] = useState<MatchState | null>(null)
  const [practiceMode, setPracticeMode] = useState(true)
  const [showSettings, setShowSettings] = useState(false)
  const [lyricSize, setLyricSize] = useState(28)
  const [furiganaSize, setFuriganaSize] = useState(15)
  const [volume, setVolume] = useState(100)
  const [showGapHint, setShowGapHint] = useState(false)

  const playerRef = useRef<YT.Player | null>(null)
  const playerDivRef = useRef<HTMLDivElement>(null)
  const currentIndexRef = useRef(-1)
  const practiceModeRef = useRef(true)
  const matcherRef = useRef<MatchState | null>(null)
  const pendingIndexRef = useRef(-1)
  const nextSnippetIndexRef = useRef(-1)
  const snippetsRef = useRef<Snippet[]>([])

  // Fetch transcript
  useEffect(() => {
    if (!videoId) {
      setState({ status: 'error', message: 'URLに動画IDがありません（?v=... が必要です）' })
      return
    }
    setState({ status: 'loading' })
    fetch(`/transcript?video_id=${encodeURIComponent(videoId)}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.detail ?? `エラー: ${res.status}`)
        }
        return res.json() as Promise<VideoData>
      })
      .then((data) => setState({ status: 'success', data }))
      .catch((err: Error) => setState({ status: 'error', message: err.message }))
  }, [videoId])

  // Keep refs in sync
  useEffect(() => { practiceModeRef.current = practiceMode }, [practiceMode])
  useEffect(() => {
    if (state.status === 'success') snippetsRef.current = state.data.snippets
  }, [state])

  // Settings open/close → pause/resume + volume
  const openSettings = useCallback(() => {
    playerRef.current?.pauseVideo()
    setShowSettings(true)
  }, [])

  const closeSettings = useCallback(() => {
    setShowSettings(false)
    playerRef.current?.playVideo()
  }, [])

  // Volume change
  useEffect(() => {
    playerRef.current?.setVolume(volume)
  }, [volume])

  // Initialize YouTube Player
  useEffect(() => {
    if (state.status !== 'success' || !videoId || !playerDivRef.current) return
    const snippets = state.data.snippets
    let timer: ReturnType<typeof setInterval>

    loadYouTubeApi().then(() => {
      playerRef.current = new window.YT.Player(playerDivRef.current!, {
        videoId,
        playerVars: { rel: 0, modestbranding: 1 },
        events: {
          onReady(e) {
            e.target.setVolume(volume)
            timer = setInterval(() => {
              const player = playerRef.current
              if (!player || typeof player.getCurrentTime !== 'function') return
              if (player.getPlayerState() !== window.YT.PlayerState.PLAYING) return
              const t = player.getCurrentTime()
              const idx = snippets.findLastIndex((s) => s.start <= t)

              const inGap = idx < 0 || t > snippets[idx].start + snippets[idx].duration
              if (inGap) {
                const nextIdx = idx + 1
                if (nextIdx < snippets.length && snippets[nextIdx].start - t > 2) {
                  nextSnippetIndexRef.current = nextIdx
                  setShowGapHint(true)
                } else {
                  nextSnippetIndexRef.current = -1
                  setShowGapHint(false)
                }
              } else {
                nextSnippetIndexRef.current = -1
                setShowGapHint(false)
              }

              if (idx !== currentIndexRef.current) {
                const notDone =
                  matcherRef.current !== null &&
                  matcherRef.current.tokenIndex < matcherRef.current.tokens.length

                if (practiceModeRef.current && currentIndexRef.current >= 0 && notDone) {
                  player.pauseVideo()
                  pendingIndexRef.current = idx
                } else {
                  currentIndexRef.current = idx
                  pendingIndexRef.current = -1
                  setCurrentIndex(idx)
                  if (idx >= 0) {
                    const newMatcher = createMatcher(snippets[idx].furigana)
                    matcherRef.current = newMatcher
                    setMatcher(newMatcher)
                  }
                }
              }
            }, 200)
          },
        },
      })
    })

    return () => clearInterval(timer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status, videoId])

  // Keyboard input
  const handleKey = useCallback((e: KeyboardEvent) => {
    if (e.key === ' ' && nextSnippetIndexRef.current >= 0) {
      e.preventDefault()
      const target = snippetsRef.current[nextSnippetIndexRef.current].start - 2
      playerRef.current?.seekTo(Math.max(0, target), true)
      return
    }

    if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return
    const prev = matcherRef.current
    if (!prev) return
    const [next, result] = advance(prev, e.key)
    matcherRef.current = next
    setMatcher(next)

    if (result === 'complete') {
      const pending = pendingIndexRef.current
      if (pending >= 0) {
        const newMatcher = createMatcher(snippetsRef.current[pending].furigana)
        matcherRef.current = newMatcher
        currentIndexRef.current = pending
        pendingIndexRef.current = -1
        setCurrentIndex(pending)
        setMatcher(newMatcher)
        if (practiceModeRef.current) playerRef.current?.playVideo()
      } else if (practiceModeRef.current) {
        playerRef.current?.playVideo()
      }
    }
  }, [])

  useEffect(() => {
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [handleKey])

  if (state.status === 'idle' || state.status === 'loading') {
    return (
      <div className="loading">
        <div className="loading-dots">
          <span /><span /><span />
        </div>
        <p>歌詞を取得中...</p>
      </div>
    )
  }

  if (state.status === 'error') {
    return <div className="status error">{state.message}</div>
  }

  const { data } = state
  const current = currentIndex >= 0 ? data.snippets[currentIndex] : null
  const doneHLen = current && matcher ? doneHiraganaLength(matcher) : 0
  const doneSLen = current && matcher ? doneSurfaceLength(current.tokens, doneHLen) : 0

  const previewFurigana = PREVIEW_TEXT.furigana
  const previewText = PREVIEW_TEXT.text
  const previewHLen = Math.floor(previewFurigana.length / 2)
  const previewSLen = Math.floor(previewText.length / 2)

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
            type="range" min={0} max={100} value={volume}
            className="volume-slider"
            onChange={(e) => setVolume(Number(e.target.value))}
          />
        </div>

        {/* 右：設定ギア */}
        <div className="settings-wrap">
          <button
            className={`settings-btn${showSettings ? ' on' : ''}`}
            onClick={() => showSettings ? closeSettings() : openSettings()}
            aria-label="設定"
          >
            ⚙
          </button>
          {showSettings && (
            <div className="settings-panel">
              <label className="toggle-row">
                練習モード
                <button
                  className={`toggle-btn${practiceMode ? ' on' : ''}`}
                  onClick={() => setPracticeMode((v) => !v)}
                >
                  {practiceMode ? 'ON' : 'OFF'}
                </button>
              </label>
              <hr className="settings-divider" />
              <label>
                歌詞サイズ <span>{lyricSize}px</span>
                <input
                  type="range" min={16} max={56} value={lyricSize}
                  onChange={(e) => setLyricSize(Number(e.target.value))}
                />
              </label>
              <label>
                ふりがなサイズ <span>{furiganaSize}px</span>
                <input
                  type="range" min={10} max={28} value={furiganaSize}
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

      <div className="current-lyric">
        {showSettings ? (
          <>
            <p className="furigana" style={{ fontSize: furiganaSize }}>
              <span className="typed">{previewFurigana.slice(0, previewHLen)}</span>
              <span>{previewFurigana.slice(previewHLen)}</span>
            </p>
            <p className="lyric-text" style={{ fontSize: lyricSize }}>
              <span className="typed">{previewText.slice(0, previewSLen)}</span>
              <span>{previewText.slice(previewSLen)}</span>
            </p>
          </>
        ) : current ? (
          <>
            <p className="furigana" style={{ fontSize: furiganaSize }}>
              <span className="typed">{current.furigana.slice(0, doneHLen)}</span>
              <span>{current.furigana.slice(doneHLen)}</span>
            </p>
            <p className="lyric-text" style={{ fontSize: lyricSize }}>
              <span className="typed">{current.text.slice(0, doneSLen)}</span>
              <span>{current.text.slice(doneSLen)}</span>
            </p>
          </>
        ) : (
          <div className="gap-area">
            <p className="lyric-placeholder">♪</p>
            {showGapHint && (
              <p className="gap-hint">スペースキーで次の歌詞へスキップ</p>
            )}
          </div>
        )}
      </div>
    </main>
  )
}
