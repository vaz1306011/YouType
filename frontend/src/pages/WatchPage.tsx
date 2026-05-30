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
  const playerRef = useRef<YT.Player | null>(null)
  const playerDivRef = useRef<HTMLDivElement>(null)
  const lyricsRef = useRef<HTMLDivElement>(null)
  const currentIndexRef = useRef(-1)

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
                if (idx >= 0) setMatcher(createMatcher(snippets[idx].furigana))
              }
            }, 200)
          },
        },
      })
    })

    return () => clearInterval(timer)
  }, [state.status, videoId])

  // Auto-scroll active lyric into view
  useEffect(() => {
    if (currentIndex < 0 || !lyricsRef.current) return
    const el = lyricsRef.current.children[currentIndex] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [currentIndex])

  // Keyboard input
  const handleKey = useCallback((e: KeyboardEvent) => {
    if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return
    setMatcher((prev) => {
      if (!prev) return prev
      const [next] = advance(prev, e.key)
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

  return (
    <main className="watch">
      <header className="watch-header">
        <h1>{data.title ?? videoId}</h1>
        {data.artist && <p className="artist">{data.artist}</p>}
      </header>

      <div className="player-wrapper">
        <div ref={playerDivRef} />
      </div>

      <section className="lyrics" ref={lyricsRef}>
        {data.snippets.length === 0 ? (
          <p className="no-lyrics">歌詞が見つかりませんでした</p>
        ) : (
          data.snippets.map((s, i) => {
            const isActive = i === currentIndex
            const doneLen = isActive && matcher ? doneHiraganaLength(matcher) : 0
            const done = s.furigana.slice(0, doneLen)
            const remaining = s.furigana.slice(doneLen)
            return (
              <p key={i} className={`lyric-line${isActive ? ' active' : ''}`}>
                {isActive ? (
                  <>
                    <span className="typed">{done}</span>
                    <span>{remaining}</span>
                  </>
                ) : (
                  s.text
                )}
              </p>
            )
          })
        )}
      </section>
    </main>
  )
}
