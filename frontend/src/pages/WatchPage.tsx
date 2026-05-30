import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

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
  const playerRef = useRef<YT.Player | null>(null)
  const playerDivRef = useRef<HTMLDivElement>(null)
  const lyricsRef = useRef<HTMLDivElement>(null)

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

  // Initialize YouTube Player after data loads
  useEffect(() => {
    if (state.status !== 'success' || !videoId || !playerDivRef.current) return

    let timer: ReturnType<typeof setInterval>
    const snippets = state.data.snippets

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
              setCurrentIndex(idx)
            }, 200)
          },
        },
      })
    })

    return () => clearInterval(timer)
  }, [state.status, videoId])

  // Auto-scroll active lyric line into view
  useEffect(() => {
    if (currentIndex < 0 || !lyricsRef.current) return
    const el = lyricsRef.current.children[currentIndex] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [currentIndex])

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
          data.snippets.map((s, i) => (
            <p key={i} className={`lyric-line${i === currentIndex ? ' active' : ''}`}>
              {s.text}
            </p>
          ))
        )}
      </section>
    </main>
  )
}
