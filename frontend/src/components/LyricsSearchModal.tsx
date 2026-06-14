import type { LrclibResult } from "../types";

interface Props {
  searchTrack: string;
  searchArtist: string;
  searchResults: LrclibResult[];
  searching: boolean;
  applyingId: number | null;
  canClose: boolean;
  onSearchTrackChange: (v: string) => void;
  onSearchArtistChange: (v: string) => void;
  onSearch: () => void;
  onApply: (result: LrclibResult) => void;
  onClose: () => void;
}

function formatDuration(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

export default function LyricsSearchModal({
  searchTrack,
  searchArtist,
  searchResults,
  searching,
  applyingId,
  canClose,
  onSearchTrackChange,
  onSearchArtistChange,
  onSearch,
  onApply,
  onClose,
}: Props) {
  return (
    <div
      className="modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget && canClose) onClose();
      }}
    >
      <div className="modal">
        <h2 className="modal-title">歌詞を検索</h2>
        <div className="modal-fields">
          <input
            className="modal-input"
            placeholder="曲名"
            value={searchTrack}
            onChange={(e) => onSearchTrackChange(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onSearch()}
          />
          <input
            className="modal-input"
            placeholder="アーティスト（省略可）"
            value={searchArtist}
            onChange={(e) => onSearchArtistChange(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onSearch()}
          />
          <button
            className="modal-search-btn"
            onClick={onSearch}
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
                  onClick={() => applyingId === null && onApply(r)}
                >
                  <span className="result-title">{r.title}</span>
                  <span className="result-artist">
                    {r.artist}
                    {r.album ? ` — ${r.album}` : ""}
                    {r.duration != null && ` (${formatDuration(r.duration)})`}
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
  );
}
