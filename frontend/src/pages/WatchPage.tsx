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
  const matcherRef = useRef<MatchState | null>(null)
  const pendingIndexRef = useRef(-1)  // 打ち終わり待ちの次行インデックス

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
                const notDone =
                  matcherRef.current !== null &&
                  matcherRef.current.tokenIndex < matcherRef.current.tokens.length

                if (practiceModeRef.current && currentIndexRef.current >= 0 && notDone) {
                  // 前の行が未完 → 停止して保留、表示は変えない
                  player.pauseVideo()
                  pendingIndexRef.current = idx
                } else {
                  // 通常遷移
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
  }, [state.status, videoId])

  // Keep refs in sync
  useEffect(() => { practiceModeRef.current = practiceMode }, [practiceMode])

  // Keyboard input
  const snippetsRef = useRef<Snippet[]>([])
  useEffect(() => {
    if (state.status === 'success') snippetsRef.current = state.data.snippets
  }, [state])

  const handleKey = useCallback((e: KeyboardEvent) => {
    if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return
    const prev = matcherRef.current
    if (!prev) return
    const [next, result] = advance(prev, e.key)
    matcherRef.current = next
    setMatcher(next)

    if (result === 'complete') {
      const pending = pendingIndexRef.current
      if (pending >= 0) {
        // 保留していた次の行へ進む
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
              <span className="typed">{current.furigana.slice(0, doneHLen)}</span>
              <span>{current.furigana.slice(doneHLen)}</span>
            </p>
            <p className="lyric-text">
              <span className="typed">{current.text.slice(0, doneSLen)}</span>
              <span>{current.text.slice(doneSLen)}</span>
            </p>
          </>
        ) : (
          <p className="lyric-placeholder">♪</p>
        )}
      </div>
    </main>
  )
}
