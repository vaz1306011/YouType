export interface Token {
  surface: string;
  reading: string;
}

export interface Snippet {
  text: string;
  furigana: string;
  tokens: Token[];
  start: number;
  duration: number;
}

export interface VideoData {
  video_id: string;
  title: string | null;
  artist: string | null;
  snippets: Snippet[];
  language: string | null;
  is_generated: boolean | null;
  source: string | null;
  has_auto_cc: boolean;
}

export interface LrclibResult {
  id: number;
  title: string;
  artist: string;
  album: string | null;
  duration: number | null;
  synced: boolean;
  synced_lyrics: string | null;
  preview: string[];
}

export type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; data: VideoData }
  | { status: "error"; message: string };
