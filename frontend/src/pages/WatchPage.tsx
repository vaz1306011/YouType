import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { advance, createMatcher, doneHiraganaLength, type MatchState } from '../lib/romaji'

interface Snippet {
  text: string
  furigana: string
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
  const playerRef = useRef<YT.Player | null>(null)
  const playerDivRef = useRef<HTMLDivElement>(null)
  const currentIndexRef = useRef(-1)
  const practiceModeRef = useRef(true)

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
          onReady() {
            timer = setInterval(() => {
              const player = playerRef.current
              if (!player || typeof player.getCurrentTime !== 'function') return
              if (player.getPlayerState() !== window.YT.PlayerState.PLAYING) return
              const t = player.getCurrentTime()
              const idx = snippets.findLastIndex((s) => s.start <= t)
              if (idx !== currentIndexRef.current) {
                currentIndexRef.current = idx
                setCurrentIndex(idx)
                if (idx >= 0) {
                  setMatcher(createMatcher(snippets[idx].furigana))
                  if (practiceModeRef.current) player.pauseVideo()
                }
              }
            }, 200)
          },
        },
      })
    })

    return () => clearInterval(timer)
  }, [state.status, videoId])

  // Keep ref in sync so the interval closure sees latest value
  useEffect(() => { practiceModeRef.current = practiceMode }, [practiceMode])

  // Keyboard input
  const handleKey = useCallback((e: KeyboardEvent) => {
    if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return
    setMatcher((prev) => {
      if (!prev) return prev
      const [next, result] = advance(prev, e.key)
      if (result === 'complete' && practiceModeRef.current) {
        playerRef.current?.playVideo()
      }
      return next
    })
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
  const doneLen = current && matcher ? doneHiraganaLength(matcher) : 0

  return (
    <main className="watch">
      <header className="watch-header">
        <h1>{data.title ?? videoId}</h1>
        {data.artist && <p className="artist">{data.artist}</p>}
      </header>

      <div className="practice-toggle">
        <button
          className={`toggle-btn${practiceMode ? ' on' : ''}`}
          onClick={() => setPracticeMode((v) => !v)}
        >
          練習モード {practiceMode ? 'ON' : 'OFF'}
        </button>
      </div>

      <div className="player-wrapper">
        <div ref={playerDivRef} />
      </div>

      <div className="current-lyric">
        {current ? (
          <>
            <p className="furigana">
              <span className="typed">{current.furigana.slice(0, doneLen)}</span>
              <span>{current.furigana.slice(doneLen)}</span>
            </p>
            <p className="lyric-text">{current.text}</p>
          </>
        ) : (
          <p className="lyric-placeholder">♪</p>
        )}
      </div>
    </main>
  )
}
