interface Props {
  applyingAutoCC: boolean;
  onApplyAutoCC: () => void;
  onChooseLrclib: () => void;
}

export default function AutoChoiceModal({
  applyingAutoCC,
  onApplyAutoCC,
  onChooseLrclib,
}: Props) {
  return (
    <div className="modal-overlay">
      <div className="modal auto-choice-modal">
        <h2 className="modal-title">字幕の選択</h2>
        <p className="auto-choice-desc">
          同期歌詞が見つかりませんでした。自動生成CC字幕が利用可能です。
        </p>
        <div className="auto-choice-buttons">
          <button
            className="auto-choice-btn primary"
            onClick={onApplyAutoCC}
            disabled={applyingAutoCC}
          >
            {applyingAutoCC ? "適用中..." : "自動CC字幕を使う"}
          </button>
          <button
            className="auto-choice-btn secondary"
            onClick={onChooseLrclib}
            disabled={applyingAutoCC}
          >
            LRCLIBで手動検索
          </button>
        </div>
      </div>
    </div>
  );
}
