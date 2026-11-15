const segmenter =
  typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('th', { granularity: 'word' }) : null;

// ภาษาไทยไม่เว้นวรรคระหว่างคำ จึงใช้ Intl.Segmenter ตัดคำ
export function tokenize(text) {
  if (!text.trim()) return [];
  if (!segmenter) return text.trim().split(/\s+/);
  const out = [];
  for (const s of segmenter.segment(text)) if (s.isWordLike) out.push(s.segment);
  return out;
}

export function countWords(text) {
  return tokenize(text).length;
}

/*
 * กติกาการนับ "คำติดปาก"
 * - เสียงลังเล (เอ่อ / อ่า / อืม): ไม่ใช่เนื้อหาแน่นอน นับทุกครั้ง
 * - คำเชื่อม/คำลงท้าย (นะครับ, แบบว่า, คือ, ก็ ...): พูดได้ตามปกติ
 *   จะนับเป็นคำติดปากก็ต่อเมื่อพูดซ้ำบ่อยเกินเกณฑ์ ทั้งจำนวนครั้ง (min)
 *   และความถี่ต่อ 100 คำ (per100) — คำที่เป็นเนื้อหา เช่น "ระบบ" ไม่อยู่ในรายการ จึงไม่ถูกนับ
 * - พูดคำเดิมซ้ำติดกัน (เช่น "ระบบ ระบบ"): นับเป็นการพูดตะกุกตะกัก
 */
const HESITATION = { min: 1, per100: 0, kind: 'hesitation' };
const POLITE = { min: 4, per100: 6, kind: 'tic' };
const DISCOURSE = { min: 3, per100: 2.5, kind: 'tic' };
const CONNECTOR = { min: 4, per100: 5, kind: 'tic' };

const RULES = [
  ...['เอ่อ', 'เอ้อ', 'อ่า', 'อืม'].map((phrase) => ({ phrase, ...HESITATION })),
  ...['นะครับ', 'นะคะ', 'ครับ', 'ค่ะ'].map((phrase) => ({ phrase, ...POLITE })),
  ...['แบบว่า', 'คือว่า', 'ประมาณว่า', 'อะไรแบบนี้', 'อะไรอย่างงี้', 'ในส่วนของ', 'ตรงนี้', 'ตัวนี้', 'เนี่ย', 'อะ', 'อ่ะ', 'ทีนี้'].map((phrase) => ({
    phrase,
    ...DISCOURSE,
  })),
  ...['ก็คือ', 'แล้วก็', 'อันนี้', 'คือ', 'แบบ', 'ก็', 'นะ', 'ประมาณ', 'ซึ่ง'].map((phrase) => ({ phrase, ...CONNECTOR })),
]
  .map((r) => ({ ...r, tokens: tokenize(r.phrase) }))
  // วลียาวก่อน เพื่อไม่ให้ "นะครับ" ถูกนับซ้ำเป็น "นะ" + "ครับ"
  .sort((a, b) => b.tokens.length - a.tokens.length);

function countPhrase(tokens, used, phrase) {
  let count = 0;
  for (let i = 0; i <= tokens.length - phrase.length; i++) {
    if (phrase.every((p, j) => !used[i + j] && tokens[i + j] === p)) {
      count++;
      for (let j = 0; j < phrase.length; j++) used[i + j] = true;
      i += phrase.length - 1;
    }
  }
  return count;
}

export function countFillers(text) {
  const tokens = tokenize(text);
  const used = new Array(tokens.length).fill(false);
  const found = [];

  for (const r of RULES) {
    const count = countPhrase(tokens, used, r.tokens);
    const per100 = tokens.length ? (count / tokens.length) * 100 : 0;
    if (count >= r.min && per100 >= r.per100) found.push({ label: r.phrase, count, kind: r.kind });
  }

  let repeats = 0;
  for (let i = 1; i < tokens.length; i++) if (tokens[i] === tokens[i - 1]) repeats++;
  if (repeats) found.push({ label: 'พูดคำซ้ำติดกัน', count: repeats, kind: 'repeat' });

  found.sort((a, b) => b.count - a.count);
  return { total: found.reduce((a, f) => a + f.count, 0), found };
}

export function analyze(transcript, durationSec) {
  const words = countWords(transcript);
  const wpm = durationSec > 3 ? Math.round(words / (durationSec / 60)) : 0;
  return { transcript, duration: durationSec, words, wpm, fillers: countFillers(transcript) };
}

// เกณฑ์ความเร็ว (คำ/นาที) — ปรับสำหรับตัวตัดคำภาษาไทย (Intl.Segmenter) ซึ่งซอยคำถี่กว่าภาษาอังกฤษ
export const PACE_MIN = 90;
export const PACE_MAX = 205;
export const LIVE_PACE_SLOW = 95;
export const LIVE_PACE_FAST = 215;
export const PACE_WINDOW_SEC = 15;
export const PACE_WARMUP_SEC = 6;

export function pace(wpm) {
  if (!wpm) return null;
  if (wpm < PACE_MIN) return { tone: 'slow', label: 'ช้าไป' };
  if (wpm > PACE_MAX) return { tone: 'fast', label: 'เร็วไป' };
  return { tone: 'good', label: 'กำลังดี' };
}

// คลาสสีตามระดับความเร็ว (เขียนเต็มเพื่อให้ Tailwind สแกนเจอ)
export const PACE_TEXT = { slow: 'text-slow', good: 'text-ok', fast: 'text-accent' };
export const PACE_PILL = {
  slow: 'bg-slow/10 text-slow',
  good: 'bg-ok/10 text-ok',
  fast: 'bg-accent/10 text-accent',
};

export function formatTime(sec = 0) {
  const s = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
