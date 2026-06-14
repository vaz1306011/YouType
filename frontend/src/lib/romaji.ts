// ひらがな1文字 → 有効なローマ字入力パターン一覧
const TABLE: Record<string, string[]> = {
  あ: ["a"],
  い: ["i"],
  う: ["u", "wu"],
  え: ["e"],
  お: ["o"],
  か: ["ka"],
  き: ["ki"],
  く: ["ku"],
  け: ["ke"],
  こ: ["ko"],
  さ: ["sa"],
  し: ["si", "shi"],
  す: ["su"],
  せ: ["se"],
  そ: ["so"],
  た: ["ta"],
  ち: ["ti", "chi"],
  つ: ["tu", "tsu"],
  て: ["te"],
  と: ["to"],
  な: ["na"],
  に: ["ni"],
  ぬ: ["nu"],
  ね: ["ne"],
  の: ["no"],
  は: ["ha"],
  ひ: ["hi"],
  ふ: ["fu", "hu"],
  へ: ["he"],
  ほ: ["ho"],
  ま: ["ma"],
  み: ["mi"],
  む: ["mu"],
  め: ["me"],
  も: ["mo"],
  や: ["ya"],
  ゆ: ["yu"],
  よ: ["yo"],
  ら: ["ra"],
  り: ["ri"],
  る: ["ru"],
  れ: ["re"],
  ろ: ["ro"],
  わ: ["wa"],
  ゐ: ["wi"],
  ゑ: ["we"],
  を: ["wo"],
  ん: ["nn", "xn"],
  が: ["ga"],
  ぎ: ["gi"],
  ぐ: ["gu"],
  げ: ["ge"],
  ご: ["go"],
  ざ: ["za"],
  じ: ["zi", "ji"],
  ず: ["zu"],
  ぜ: ["ze"],
  ぞ: ["zo"],
  だ: ["da"],
  ぢ: ["di"],
  づ: ["du"],
  で: ["de"],
  ど: ["do"],
  ば: ["ba"],
  び: ["bi"],
  ぶ: ["bu"],
  べ: ["be"],
  ぼ: ["bo"],
  ぱ: ["pa"],
  ぴ: ["pi"],
  ぷ: ["pu"],
  ぺ: ["pe"],
  ぽ: ["po"],
  きゃ: ["kya"],
  きゅ: ["kyu"],
  きょ: ["kyo"],
  しゃ: ["sya", "sha"],
  しゅ: ["syu", "shu"],
  しょ: ["syo", "sho"],
  ちゃ: ["tya", "cha", "cya"],
  ちゅ: ["tyu", "chu", "cyu"],
  ちょ: ["tyo", "cho", "cyo"],
  にゃ: ["nya"],
  にゅ: ["nyu"],
  にょ: ["nyo"],
  ひゃ: ["hya"],
  ひゅ: ["hyu"],
  ひょ: ["hyo"],
  みゃ: ["mya"],
  みゅ: ["myu"],
  みょ: ["myo"],
  りゃ: ["rya"],
  りゅ: ["ryu"],
  りょ: ["ryo"],
  ぎゃ: ["gya"],
  ぎゅ: ["gyu"],
  ぎょ: ["gyo"],
  じゃ: ["zya", "ja", "jya"],
  じゅ: ["zyu", "ju", "jyu"],
  じょ: ["zyo", "jo", "jyo"],
  びゃ: ["bya"],
  びゅ: ["byu"],
  びょ: ["byo"],
  ぴゃ: ["pya"],
  ぴゅ: ["pyu"],
  ぴょ: ["pyo"],
  ふぁ: ["fa"],
  ふぃ: ["fi"],
  ふぇ: ["fe"],
  ふぉ: ["fo"],
  てぃ: ["thi"],
  てゅ: ["thu"],
  でぃ: ["dhi"],
  でゅ: ["dhu"],
  うぁ: ["wha"],
  うぃ: ["wi"],
  うぇ: ["we"],
  うぉ: ["who"],
  ヴぁ: ["va"],
  ヴぃ: ["vi"],
  ヴ: ["vu"],
  ヴぇ: ["ve"],
  ヴぉ: ["vo"],
  ぁ: ["xa", "la"],
  ぃ: ["xi", "li"],
  ぅ: ["xu", "lu"],
  ぇ: ["xe", "le"],
  ぉ: ["xo", "lo"],
  ゃ: ["xya", "lya"],
  ゅ: ["xyu", "lyu"],
  ょ: ["xyo", "lyo"],
  っ: ["xtu", "ltu", "xtsu", "ltsu"],
  ー: ["-"],
};

// ひらがな文字列をトークン列（1〜2文字）に分割
function tokenize(hiragana: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < hiragana.length) {
    // 小文字がある場合は2文字複合
    const two = hiragana.slice(i, i + 2);
    if (i + 1 < hiragana.length && TABLE[two]) {
      tokens.push(two);
      i += 2;
    } else {
      tokens.push(hiragana[i]);
      i++;
    }
  }
  return tokens;
}

// 現在のトークンに対してローマ字入力が「ん」の n 1文字省略形を使えるか
function canUseN(tokens: string[], idx: number): boolean {
  const next = tokens[idx + 1];
  if (!next) return true; // 末尾なら n1文字OK
  const vowels = new Set(["a", "i", "u", "e", "o", "n", "y"]);
  const firstChar = (TABLE[next]?.[0] ?? "")[0];
  return !!firstChar && !vowels.has(firstChar);
}

export interface MatchState {
  tokens: string[]; // 分解されたひらがなトークン列
  tokenIndex: number; // 現在打っているトークンの位置
  candidates: string[]; // 現在のトークンで有効な残り入力パターン
  typed: string; // 現在のトークンに対して入力済みの文字列
  doneChars: number; // 完了済みトークン数（ハイライト用）
}

export function createMatcher(furigana: string): MatchState {
  const tokens = tokenize(furigana);
  return {
    tokens,
    tokenIndex: 0,
    candidates: buildCandidates(tokens, 0),
    typed: "",
    doneChars: 0,
  };
}

function buildCandidates(tokens: string[], idx: number): string[] {
  const token = tokens[idx];
  if (!token) return [];

  // っ の子音重複ショートカット
  if (token === "っ") {
    const next = tokens[idx + 1];
    const nextPatterns = next ? (TABLE[next] ?? []) : [];
    const consonants = new Set(nextPatterns.map((r) => r[0]).filter(Boolean));
    return [...(TABLE[token] ?? []), ...consonants];
  }

  // ん の n 1文字省略形
  if (token === "ん") {
    const base = TABLE["ん"] ?? [];
    return canUseN(tokens, idx) ? [...base, "n"] : base;
  }

  return TABLE[token] ?? [token];
}

export type AdvanceResult = "ok" | "wrong" | "complete";

export function advance(
  state: MatchState,
  key: string,
): [MatchState, AdvanceResult] {
  const newTyped = state.typed + key;

  // っ の子音重複処理: 次のトークンの先頭子音と一致するか
  const token = state.tokens[state.tokenIndex];
  if (token === "っ") {
    const next = state.tokens[state.tokenIndex + 1];
    const nextPatterns = next ? (TABLE[next] ?? []) : [];
    const consonants = new Set(nextPatterns.map((r) => r[0]).filter(Boolean));
    if (consonants.has(key) && state.typed === "") {
      // 子音重複モード: っ を消費するだけ（次のキー入力で次トークンを処理）
      return [advanceToken({ ...state, typed: "" }), "ok"];
    }
  }

  // 現在の候補で newTyped がプレフィックスになっているか確認
  const stillValid = state.candidates.filter((c) => c.startsWith(newTyped));
  if (stillValid.length === 0) return [state, "wrong"];

  const completed = stillValid.find((c) => c === newTyped);
  if (completed) {
    const next = advanceToken({ ...state, typed: newTyped });
    if (next.tokenIndex >= next.tokens.length) {
      return [next, "complete"];
    }
    return [next, "ok"];
  }

  return [{ ...state, typed: newTyped, candidates: stillValid }, "ok"];
}

function advanceToken(state: MatchState): MatchState {
  const nextIndex = state.tokenIndex + 1;
  return {
    ...state,
    tokenIndex: nextIndex,
    candidates: buildCandidates(state.tokens, nextIndex),
    typed: "",
    doneChars: nextIndex,
  };
}

// 完了済みトークン数から表示用の「打ち終わった文字数（ひらがな）」を計算
export function doneHiraganaLength(state: MatchState): number {
  return state.tokens.slice(0, state.doneChars).join("").length;
}

// ふりがなの打ち済み文字数から元テキストの打ち済み文字数を計算
export function doneSurfaceLength(
  tokenMap: { surface: string; reading: string }[],
  doneHiraganaLen: number,
): number {
  let hiraganaCount = 0;
  let surfaceCount = 0;
  for (const t of tokenMap) {
    if (hiraganaCount + t.reading.length <= doneHiraganaLen) {
      hiraganaCount += t.reading.length;
      surfaceCount += t.surface.length;
    } else {
      break;
    }
  }
  return surfaceCount;
}
