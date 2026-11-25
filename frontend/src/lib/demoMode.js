import { clearAllLocalVideos, deleteLocalSessionVideo } from './videoStore';

export const DEMO_AUTH_TOKEN = 'demo-mode-token';
export const DEMO_INITIAL_TOKENS = 50;
export const DEMO_PERMANENT_SESSION_ID = 'demo_permanent_sample';

const KEY_ACTIVE = 'zomgon_demo_active';
const KEY_TOKENS = 'zomgon_demo_tokens';
const KEY_TXS = 'zomgon_demo_transactions';
const KEY_SESSIONS = 'zomgon_demo_sessions';

function buildPermanentDemoSession() {
  return {
    id: DEMO_PERMANENT_SESSION_ID,
    userId: 'demo-presenter',
    deckName: 'นำเสนอโครงงาน ZomGon (ตัวอย่าง)',
    audience: 'teacher',
    rehearsalMode: 'per_slide',
    isGroup: false,
    roomCode: null,
    seriesId: 'demo_series_sample',
    roundNumber: 1,
    shareId: null,
    isPublic: false,
    slideCount: 4,
    totalDurationSec: 245,
    avgWpm: 138,
    avgEyeContactPct: 84,
    overallScore: 88,
    videoPath: null,
    videoUploadedAt: null,
    createdAt: '2026-11-24T10:30:00.000Z',
    updatedAt: '2026-11-24T10:30:00.000Z',
    participants: [],
    slidesJson: [
      {
        index: 0,
        title: 'ที่มาและความสำคัญของปัญหา',
        duration: 58,
        wpm: 134,
        fillersCount: 1,
        deadAirCount: 0,
        eyeContactPct: 88,
        transcript:
          'สวัสดีคณะกรรมการทุกท่านครับ วันนี้ขออนุญาตนำเสนอโครงงาน ZomGon ระบบ AI โค้ชช่วยซ้อมพรีเซนต์อัจฉริยะ ซึ่งเกิดจากปัญหาที่นักศึกษาส่วนใหญ่มักกังวลเวลาขึ้นพูดจริง ซ้อมคนเดียวไม่รู้ความเร็วการพูด ไม่รู้ว่าก้มอ่านโพยหรือเกิดเดดแอร์ช่วงไหน และไม่สามารถจำลองคำถามจากกรรมการได้ครับ',
      },
      {
        index: 1,
        title: 'แนวคิดและสถาปัตยกรรมระบบ ZomGon',
        duration: 66,
        wpm: 145,
        fillersCount: 2,
        deadAirCount: 0,
        eyeContactPct: 81,
        transcript:
          'เราจึงออกแบบเว็บแอปพลิเคชันที่รวมการวิเคราะห์เสียงและภาพแบบเรียลไทม์บนเบราว์เซอร์ โดยใช้ Web Speech API ถอดเสียงวัดความเร็วคำต่อนาที ตรวจจับคำติดปากและช่วงเงียบ ใช้ MediaPipe ตรวจจับการสบตากล้อง และเชื่อมต่อ Gemini AI เพื่อสร้างคำถามแทรกและคำถาม Q&A เฉพาะสไลด์ที่ผู้พูดเลือกซ้อมครับ',
      },
      {
        index: 2,
        title: 'ฟีเจอร์เด่น: ซ้อมเดี่ยว ซ้อมกลุ่ม และประวัติย้อนหลัง',
        duration: 64,
        wpm: 140,
        fillersCount: 1,
        deadAirCount: 1,
        eyeContactPct: 82,
        transcript:
          'ผู้ใช้งานสามารถเลือกซ้อมเฉพาะบางสไลด์ ซ้อมเดี่ยวพร้อมรีโมตมือถือ หรือซ้อมเป็นกลุ่มออนไลน์ร่วมกับเพื่อนได้ หลังซ้อมเสร็จระบบจะสร้างกราฟวิเคราะห์รายสไลด์ ตรวจคำตอบ Q&A และบันทึกประวัติย้อนหลังให้กลับมาทบทวนพัฒนาการในรอบถัดไปได้ทันทีครับ',
      },
      {
        index: 3,
        title: 'ผลการทดสอบและแนวทางพัฒนาต่อยอด',
        duration: 57,
        wpm: 132,
        fillersCount: 0,
        deadAirCount: 0,
        eyeContactPct: 86,
        transcript:
          'จากผลการทดลองใช้งานจริง พบว่าผู้ซ้อมสามารถคุมจังหวะการพูดให้อยู่ในช่วงเหมาะสมได้เร็วขึ้น ลดคำติดปาก และมีความมั่นใจในการตอบคำถามกรรมการมากขึ้น ในอนาคตสามารถต่อยอดรองรับหลายภาษาและเกณฑ์ประเมินเฉพาะแต่ละคณะได้ครับ ขอบคุณครับ',
      },
    ],
    qaJson: [
      {
        question:
          'ระบบ ZomGon แตกต่างจากการซ้อมอัดวิดีโอดูเองด้วยมือถือหรือโปรแกรมทั่วไปอย่างไร?',
        slideIndex: 1,
        answerTranscript:
          'จุดต่างหลักคือ ZomGon วิเคราะห์เชิงตัวเลขให้ทันทีระหว่างพูดครับ ทั้งความเร็วคำต่อนาที คำติดปาก เดดแอร์ และเปอร์เซ็นต์การสบตา รวมถึงมีกรรมการ AI ตั้งคำถามสดจากเนื้อหาสไลด์ที่ซ้อมจริง ทำให้ได้ฝึกตอบคำถามเฉพาะหน้าเหมือนห้องสอบจริงครับ',
        duration: 28,
        directness: 'ตอบตรงประเด็น',
        feedback:
          'อธิบายความแตกต่างได้ชัดเจน ครบทั้งมุมการวัดผลแบบเรียลไทม์และการจำลองกรรมการถาม-ตอบ',
        betterAnswer:
          'การอัดวิดีโอดูเองต้องมานั่งจับผิดเองทีหลัง แต่ ZomGon วัดจังหวะพูด คำติดปาก และการสบตาให้แบบเรียลไทม์ พร้อมจำลองกรรมการ AI ยิงคำถามสดจากสไลด์ที่ซ้อมครับ',
        timelineNote: '',
      },
      {
        question:
          'การประมวลผลกล้องและไมโครโฟนบนเบราว์เซอร์มีความกังวลเรื่องความเป็นส่วนตัวของข้อมูลผู้ใช้อย่างไร?',
        slideIndex: 2,
        answerTranscript:
          'การตรวจจับสายตาด้วย MediaPipe และคลื่นเสียงทั้งหมดประมวลผลบนเครื่องของผู้ใช้โดยตรงครับ ไม่ได้ส่งภาพจากกล้องขึ้นเซิร์ฟเวอร์ และในโหมด Demo ข้อมูลประวัติและคลิปจะเก็บเฉพาะในเบราว์เซอร์เครื่องนั้นและกดล้างทิ้งได้ทันทีครับ',
        duration: 24,
        directness: 'ตอบตรงประเด็น',
        feedback:
          'ตอบประเด็นความเป็นส่วนตัวได้น่าเชื่อถือ ระบุชัดเจนว่าภาพกล้องประมวลผลฝั่ง Client-side',
        betterAnswer:
          'การวิเคราะห์สายตาและเสียงทำบนเบราว์เซอร์ฝั่งผู้ใช้ 100% ภาพกล้องไม่ถูกส่งขึ้นเซิร์ฟเวอร์ และผู้ใช้ควบคุมการลบประวัติหรือคลิปได้เองตลอดเวลาครับ',
        timelineNote: '',
      },
    ],
    summaryJson: {
      listenerSummary:
        'การนำเสนอภาพรวมชัดเจน มีลำดับเล่าเรื่องตั้งแต่ปัญหา แนวทางแก้ไข ฟีเจอร์หลัก จนถึงผลลัพธ์ จังหวะการพูดสม่ำเสมอที่ 138 คำ/นาที และรักษาการสบตากล้องได้ดีมาก (84%) ทำให้ผู้ฟังติดตามเข้าใจง่าย',
      topStrengths: [
        'ความเร็วในการพูดเฉลี่ย 138 คำ/นาที อยู่ในเกณฑ์ฟังสบายและชัดเจนตลอด 4 สไลด์',
        'การสบตากล้องเฉลี่ยสูงถึง 84% ช่วยสร้างความมั่นใจและความน่าเชื่อถือต่อกรรมการ',
        'ตอบคำถาม Q&A ได้ตรงประเด็นทั้ง 2 ข้อ กระชับ และอธิบายจุดเด่นของระบบได้ชัด',
      ],
      topImprovements: [
        'สไลด์หน้าที่ 2 พูดเร็วขึ้นเล็กน้อย (145 คำ/นาที) ควรเว้นจังหวะหายใจช่วงอธิบายสถาปัตยกรรมระบบ',
        'สไลด์หน้าที่ 3 มีช่วงเงียบค้าง 1 ครั้ง ลองซ้อมคำเชื่อมระหว่างฟีเจอร์ให้ลื่นไหลขึ้น',
      ],
      slides: [
        {
          index: 0,
          missed: [],
          polishedScript:
            'สวัสดีคณะกรรมการทุกท่านครับ โครงงาน ZomGon คือระบบ AI โค้ชซ้อมพรีเซนต์ที่ช่วยแก้ปัญหานักศึกษาซ้อมพูดคนเดียวแล้วไม่รู้จังหวะพูด สายตา และไม่เคยฝึกตอบคำถามกรรมการก่อนขึ้นเวทีจริงครับ',
        },
        {
          index: 1,
          missed: ['ระบุเวลาตอบสนองเฉลี่ยของระบบวิเคราะห์เรียลไทม์'],
          polishedScript:
            'ระบบของเราทำงานบนเบราว์เซอร์โดยใช้ Web Speech API วัดความเร็วพูดและคำติดปาก ใช้ MediaPipe ตรวจจับการสบตากล้อง และใช้ Gemini AI สร้างคำถาม Q&A เฉพาะสไลด์ที่เลือกซ้อมครับ',
        },
        {
          index: 2,
          missed: [],
          polishedScript:
            'ZomGon รองรับทั้งซ้อมเดี่ยว ซ้อมกลุ่มออนไลน์ และรีโมตมือถือ หลังจบแต่ละรอบระบบจะสรุปกราฟรายสไลด์ ตรวจคำตอบ Q&A และเก็บประวัติย้อนหลังให้เทียบพัฒนาการได้ทันทีครับ',
        },
        {
          index: 3,
          missed: [],
          polishedScript:
            'จากการทดสอบจริง ผู้ซ้อมควบคุมความเร็วการพูดและสบตากล้องได้ดีขึ้นอย่างชัดเจน พร้อมต่อยอดสู่การใช้งานในรายวิชาสัมมนาและโครงงานจบของทุกคณะครับ ขอบคุณครับ',
        },
      ],
    },
  };
}

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
  const userSessions = readJsonArray(KEY_SESSIONS).filter(
    (s) => s?.id !== DEMO_PERMANENT_SESSION_ID,
  );
  const sortedUser = userSessions.sort(
    (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime(),
  );
  return [...sortedUser, buildPermanentDemoSession()];
}

export function getDemoSessionDetail(id) {
  if (id === DEMO_PERMANENT_SESSION_ID) {
    return buildPermanentDemoSession();
  }
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
