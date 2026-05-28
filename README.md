# Youtype 🎵⌨️

日本語の歌を YouTube で聴きながら、歌詞を打ち込んでタイピング練習できる Web アプリ。

## 概要

YouTube の楽曲動画に時刻同期された歌詞（+ ふりがな）を表示し、ローマ字でタイピングするゲームです。  
歌詞の1行を打ち終えるまで再生を一時停止する「練習モード」で、楽しみながら日本語入力を鍛えられます。

## 機能

- 🔍 YouTube 楽曲検索
- 🎬 YouTube IFrame Player による動画再生
- 📝 時刻同期された歌詞表示（ふりがな付き）
- ⌨️ ローマ字タイピング入力（入力ボックス不要、直接キー入力）
- ✅ 正しく打った文字のリアルタイムハイライト
- ⏸️ 練習モード：1行打ち終えるまで再生を自動停止
- 🎵 歌詞ソース：[LRCLIB](https://lrclib.net/)（優先）/ YouTube CC（フォールバック）

## 技術スタック

| レイヤー       | 技術                                      |
| -------------- | ----------------------------------------- |
| バックエンド   | Python 3.13 + FastAPI                     |
| パッケージ管理 | [uv](https://github.com/astral-sh/uv)     |
| フロントエンド | React                                     |
| 動画再生       | YouTube IFrame Player API                 |
| 歌詞取得       | `youtube-transcript-api` / LRCLIB API     |
| ふりがな生成   | `fugashi` + `unidic-lite`（バックエンド） |

## セットアップ

### 必要条件

- Python 3.13
- [uv](https://github.com/astral-sh/uv)
- Node.js（フロントエンド用）

### バックエンド

```bash
# 依存関係のインストール
uv sync

# 開発サーバー起動
uv run fastapi dev backend/main.py
```

API は `http://localhost:8000` で起動します。  
ドキュメントは `http://localhost:8000/docs` で確認できます。

### フロントエンド

```bash
cd frontend
npm install
npm run dev
```

## 歌詞の取得ロジック

1. **LRCLIB**（優先）— アーティスト名・曲名で検索し、タイムスタンプ付き `.lrc` を取得
2. **YouTube CC**（フォールバック）— 手動字幕（日本語 → 英語）→ 自動生成（日本語）の優先順で取得

多くの楽曲動画は CC が存在しないため、将来的に `.lrc` / `.srt` の手動アップロード機能を追加予定。

## タイピング判定について

`し` → `shi` / `si`、`っ` → 子音の重複 / `xtu` / `ltu`、`ん` → 文脈依存の `n` / `nn` など、複数の有効なローマ字表記を分岐状態機械で処理します。

## ライセンス

MIT
