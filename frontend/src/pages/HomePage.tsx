export default function HomePage() {
  return (
    <main className="home">
      <h1>Youtype</h1>
      <p>
        YouTubeのURLの <code>youtube.com</code> を{" "}
        <code>youtype.srnns.com</code> に書き換えると歌詞が表示されます。
      </p>
      <p className="example">
        例: <code>youtype.srnns.com/watch?v=dQw4w9WgXcW</code>
      </p>
    </main>
  );
}
