import { clearAllLocalVideos, deleteLocalSessionVideo } from './videoStore';

export const DEMO_AUTH_TOKEN = 'demo-mode-token';
export const DEMO_INITIAL_TOKENS = 50;

const KEY_ACTIVE = 'zomgon_demo_active';
const KEY_TOKENS = 'zomgon_demo_tokens';
const KEY_TXS = 'zomgon_demo_transactions';
const KEY_SESSIONS = 'zomgon_demo_sessions';

const GEMINI_COST_MAP = {
  '/api/gemini/check-slide': {
    cost: 1,
    type: 'AI_SLIDE_CHECK',
    description: 'ตรวจความตรงสไลด์ด้วย AI',
  },
  '/api/gemini/qa/generate': {
    cost: 1,
    type: 'AI_QA',
    description: 'สร้างชุดคำถาม Q&A',
  },
  '/api/gemini/qa/interrupt': {
    cost: 1,
    type: 'AI_QA',
    description: 'สร้างคำถามแทรกระหว่างซ้อม',
  },
  '/api/gemini/qa/evaluate': {
    cost: 1,
    type: 'AI_QA',
    description: 'ประเมินคำตอบ Q&A',
  },
  '/api/gemini/analyze-summary': {
    cost: 2,
    type: 'AI_SUMMARY',
    description: 'วิเคราะห์สรุปผลการซ้อมทั้งหมด',
  },
  '/api/gemini/compare-rounds': {
    cost: 1,
    type: 'AI_COMPARE',
    description: 'วิเคราะห์เปรียบเทียบพัฒนาการระหว่างรอบ',
  },
  '/api/gemini/tts': {
    cost: 1,
    type: 'AI_TTS',
    description: 'สร้างเสียงอ่านคำถาม Gemini TTS',
  },
};

function hasWindow() {
  return typeof window !== 'undefined';
}

export function isDemoButtonVisible() {
  if (String(import.meta.env.VITE_ENABLE_DEMO_MODE || '').trim().toLowerCase() === 'true') {
    return true;
  }
  if (!hasWindow()) return false;
  const param = new URLSearchParams(window.location.search).get('demo');
  return param === 'true' || param === '1';
}

export function isDemoActive() {
  if (!hasWindow()) return false;
  try {
    return window.localStorage.getItem(KEY_ACTIVE) === '1';
  } catch {
    return false;
  }
}

export function getDemoTokenBalance() {
  if (!hasWindow()) return DEMO_INITIAL_TOKENS;
  try {
    const raw = window.localStorage.getItem(KEY_TOKENS);
    if (raw === null) return DEMO_INITIAL_TOKENS;
    const n = Number(raw);
    return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : DEMO_INITIAL_TOKENS;
  } catch {
    return DEMO_INITIAL_TOKENS;
  }
}

function readJsonArray(key) {
  if (!hasWindow()) return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeJson(key, value) {
  if (!hasWindow()) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore storage quota errors
  }
}

export function getDemoUser() {
  if (!isDemoActive()) return null;
  return {
    id: 'demo-presenter',
    email: 'demo@zomgon.local',
    name: 'Demo Presenter',
    avatarUrl: null,
    tokenBalance: getDemoTokenBalance(),
    referralCode: 'DEMO2026',
    isDemo: true,
  };
}

export function enterDemoMode() {
  if (!hasWindow()) return null;
  try {
    window.localStorage.setItem(KEY_ACTIVE, '1');
    if (window.localStorage.getItem(KEY_TOKENS) === null) {
      window.localStorage.setItem(KEY_TOKENS, String(DEMO_INITIAL_TOKENS));
      writeJson(KEY_TXS, [
        {
          id: `demo_init_${Date.now()}`,
          amount: DEMO_INITIAL_TOKENS,
          type: 'DEMO_BONUS',
          description: 'เครดิตตั้งต้นโหมด Demo (สำหรับนำเสนอ)',
          createdAt: new Date().toISOString(),
        },
      ]);
    }
  } catch {
    // ignore
  }
  return getDemoUser();
}

export async function exitAndClearDemoMode() {
  if (hasWindow()) {
    try {
      window.localStorage.removeItem(KEY_ACTIVE);
      window.localStorage.removeItem(KEY_TOKENS);
      window.localStorage.removeItem(KEY_TXS);
      window.localStorage.removeItem(KEY_SESSIONS);
      window.sessionStorage.removeItem('icit_solo_rounds');
    } catch {
      // ignore
    }
  }
  await clearAllLocalVideos().catch(() => {});
}

export function getGeminiDemoCostMeta(path) {
  return (
    GEMINI_COST_MAP[path] || {
      cost: 1,
      type: 'AI_USAGE',
      description: 'ใช้งาน AI (โหมด Demo)',
    }
  );
}

export function spendDemoTokens(cost, type, description) {
  const current = getDemoTokenBalance();
  const safeCost = Math.max(0, Number(cost) || 0);
  if (current < safeCost) {
    throw new Error('Token ในโหมด Demo ไม่เพียงพอ (คุณสามารถออกจากโหมด Demo แล้วเข้าใหม่เพื่อรีเซ็ต 50 Tokens)');
  }
  const nextBalance = current - safeCost;
  if (hasWindow()) {
    try {
      window.localStorage.setItem(KEY_TOKENS, String(nextBalance));
      if (safeCost > 0) {
        const txs = readJsonArray(KEY_TXS);
        txs.unshift({
          id: `demo_tx_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          amount: -safeCost,
          type: type || 'AI_USAGE',
          description: description || 'ใช้งาน AI',
          createdAt: new Date().toISOString(),
        });
        writeJson(KEY_TXS, txs.slice(0, 50));
      }
      window.dispatchEvent(new CustomEvent('tokens-updated', { detail: nextBalance }));
    } catch {
      // ignore
    }
  }
  return nextBalance;
}

export function getDemoWallet() {
  return {
    tokenBalance: getDemoTokenBalance(),
    referralCode: 'DEMO2026',
    referralCount: 0,
    maxReferrals: 10,
    transactions: readJsonArray(KEY_TXS),
    isDemo: true,
  };
}

export function saveDemoSession(payload) {
  const sessions = readJsonArray(KEY_SESSIONS);
  const nowIso = new Date().toISOString();
  const existingIdx = payload?.sessionId
    ? sessions.findIndex((s) => s.id === payload.sessionId)
    : -1;

  if (existingIdx >= 0) {
    const prev = sessions[existingIdx];
    const updated = {
      ...prev,
      deckName: payload.deckName ?? prev.deckName,
      audience: payload.audience ?? prev.audience,
      rehearsalMode: payload.rehearsalMode ?? prev.rehearsalMode,
      isGroup: Boolean(payload.isGroup ?? prev.isGroup),
      roomCode: payload.roomCode ?? prev.roomCode ?? null,
      seriesId: payload.seriesId ?? prev.seriesId ?? null,
      roundNumber: payload.roundNumber ?? prev.roundNumber ?? 1,
      slideCount: payload.slideCount ?? prev.slideCount ?? 0,
      totalDurationSec: payload.totalDurationSec ?? prev.totalDurationSec ?? 0,
      avgWpm: payload.avgWpm ?? prev.avgWpm ?? 0,
      avgEyeContactPct:
        payload.avgEyeContactPct !== undefined ? payload.avgEyeContactPct : prev.avgEyeContactPct,
      overallScore:
        payload.overallScore !== undefined ? payload.overallScore : prev.overallScore,
      slidesJson: payload.slidesJson ?? prev.slidesJson ?? [],
      qaJson: payload.qaJson ?? prev.qaJson ?? [],
      summaryJson: payload.summaryJson !== undefined ? payload.summaryJson : prev.summaryJson,
      participants: payload.participants ?? prev.participants ?? [],
      updatedAt: nowIso,
    };
    sessions[existingIdx] = updated;
    writeJson(KEY_SESSIONS, sessions);
    return { session: updated, referralBonusAwarded: false };
  }

  const newSession = {
    id: `demo_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    userId: 'demo-presenter',
    deckName: payload.deckName || 'ชุดสไลด์โหมด Demo',
    audience: payload.audience || 'general',
    rehearsalMode: payload.rehearsalMode || 'per_slide',
    isGroup: Boolean(payload.isGroup),
    roomCode: payload.roomCode || null,
    seriesId: payload.seriesId || null,
    roundNumber: payload.roundNumber || 1,
    shareId: null,
    isPublic: false,
    slideCount: payload.slideCount || 0,
    totalDurationSec: payload.totalDurationSec || 0,
    avgWpm: payload.avgWpm || 0,
    avgEyeContactPct: payload.avgEyeContactPct ?? null,
    overallScore: payload.overallScore ?? null,
    videoPath: null,
    videoUploadedAt: null,
    slidesJson: payload.slidesJson || [],
    qaJson: payload.qaJson || [],
    summaryJson: payload.summaryJson || null,
    participants: payload.participants || [],
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  sessions.unshift(newSession);
  writeJson(KEY_SESSIONS, sessions.slice(0, 30));
  return { session: newSession, referralBonusAwarded: false };
}

export function listDemoSessions() {
  return readJsonArray(KEY_SESSIONS).sort(
    (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime(),
  );
}

export function getDemoSessionDetail(id) {
  const found = readJsonArray(KEY_SESSIONS).find((s) => s.id === id);
  if (!found) {
    throw new Error('ไม่พบประวัติการซ้อมนี้ในโหมด Demo');
  }
  return found;
}

export async function deleteDemoSessions(ids = null) {
  const sessions = readJsonArray(KEY_SESSIONS);
  if (Array.isArray(ids) && ids.length > 0) {
    const idSet = new Set(ids);
    const remaining = sessions.filter((s) => !idSet.has(s.id));
    writeJson(KEY_SESSIONS, remaining);
    await Promise.all(ids.map((id) => deleteLocalSessionVideo(id).catch(() => {})));
    return { deletedCount: sessions.length - remaining.length };
  }
  writeJson(KEY_SESSIONS, []);
  await clearAllLocalVideos().catch(() => {});
  return { deletedCount: sessions.length };
}
