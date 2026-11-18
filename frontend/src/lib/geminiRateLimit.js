const STORAGE_KEY = 'icit_gemini_timestamps';
const COOLDOWN_UNTIL_KEY = 'icit_gemini_cooldown_until';
export const GEMINI_RPM_LIMIT = 5;
const WINDOW_MS = 60_000;

const listeners = new Set();

function readTimestamps() {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    const cutoff = Date.now() - WINDOW_MS;
    return Array.isArray(arr) ? arr.filter((t) => typeof t === 'number' && t > cutoff) : [];
  } catch {
    return [];
  }
}

function writeTimestamps(arr) {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
  } catch {
    // ignore
  }
}

function readCooldownUntil() {
  if (typeof window === 'undefined') return 0;
  try {
    return Number(window.sessionStorage.getItem(COOLDOWN_UNTIL_KEY) || 0);
  } catch {
    return 0;
  }
}

function notify() {
  const state = getGeminiCooldownState();
  listeners.forEach((fn) => fn(state));
}

export function getGeminiCooldownState() {
  const now = Date.now();
  const timestamps = readTimestamps();
  const remainingQuota = Math.max(0, GEMINI_RPM_LIMIT - timestamps.length);
  let waitMs = 0;

  if (timestamps.length >= GEMINI_RPM_LIMIT) {
    waitMs = Math.max(waitMs, timestamps[0] + WINDOW_MS - now);
  }
  const forcedUntil = readCooldownUntil();
  if (forcedUntil > now) {
    waitMs = Math.max(waitMs, forcedUntil - now);
  }

  return {
    usedInWindow: timestamps.length,
    remainingQuota,
    waitSeconds: Math.max(0, Math.ceil(waitMs / 1000)),
    isCoolingDown: waitMs > 0,
  };
}

export function recordGeminiCall() {
  const next = [...readTimestamps(), Date.now()].slice(-GEMINI_RPM_LIMIT);
  writeTimestamps(next);
  notify();
}

export function triggerGeminiCooldown(seconds = 20) {
  if (typeof window !== 'undefined') {
    try {
      window.sessionStorage.setItem(COOLDOWN_UNTIL_KEY, String(Date.now() + seconds * 1000));
    } catch {
      // ignore
    }
  }
  notify();
}

export function subscribeGeminiCooldown(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
