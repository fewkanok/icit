import { supabase } from './supabase';
import { recordGeminiCall, triggerGeminiCooldown } from './geminiRateLimit';

export const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

function handleAuthExpired(res, hadToken) {
  if (res.status === 401 && hadToken && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('session-expired'));
  }
}

async function getAuthHeaders() {
  if (!supabase) return {};
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function postJson(path, body, timeoutMs = 30000) {
  const authHeaders = await getAuthHeaders();
  const isGemini = path.startsWith('/api/gemini/');
  if (isGemini) recordGeminiCall();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new Error('ระบบ AI ใช้เวลาตอบสนองนานเกินไป กรุณาลองใหม่อีกครั้ง');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    handleAuthExpired(res, Boolean(authHeaders.Authorization));
    if (isGemini && (res.status === 429 || res.status === 503)) {
      triggerGeminiCooldown(25);
      throw new Error(
        data.message || 'ระบบ AI ถูกใช้งานถี่เกินไป (จำกัด 5 ครั้ง/นาที) กรุณารอสักครู่แล้วลองใหม่',
      );
    }
    throw new Error(data.message || 'ไม่สามารถเชื่อมต่อระบบ AI ได้');
  }
  if (typeof data?.tokenBalance === 'number' && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('tokens-updated', { detail: data.tokenBalance }));
  }
  return data;
}

async function getJson(path) {
  const authHeaders = await getAuthHeaders();
  const res = await fetch(`${API_BASE}${path}`, { headers: authHeaders });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    handleAuthExpired(res, Boolean(authHeaders.Authorization));
    throw new Error(data.message || 'ไม่สามารถโหลดข้อมูลได้');
  }
  return data;
}

export async function fetchMe(refCode) {
  const query = refCode ? `?ref=${encodeURIComponent(refCode)}` : '';
  const data = await getJson(`/api/auth/me${query}`);
  return data.user;
}

export function fetchWallet() {
  return getJson('/api/tokens/wallet');
}

export function saveRehearsalSession(payload) {
  return postJson('/api/sessions', payload);
}

export function fetchSessions() {
  return getJson('/api/sessions');
}

export function fetchSessionDetail(id) {
  return getJson(`/api/sessions/${encodeURIComponent(id)}`);
}

export function prepareCloudVideoUpload(sessionId, payload) {
  return postJson(`/api/sessions/${encodeURIComponent(sessionId)}/video/prepare`, payload, 30000);
}

export function confirmCloudVideoUpload(sessionId, payload) {
  return postJson(`/api/sessions/${encodeURIComponent(sessionId)}/video/confirm`, payload, 30000);
}

export function fetchCloudVideoUrl(sessionId) {
  return getJson(`/api/sessions/${encodeURIComponent(sessionId)}/video-url`);
}

export async function deleteCloudVideo(sessionId) {
  const headers = await getAuthHeaders();
  const res = await fetch(`${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}/video`, {
    method: 'DELETE',
    headers,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || 'ลบคลิปออกจากคลาวด์ไม่สำเร็จ');
  }
  return res.json();
}

export async function deleteSessions(ids = null) {
  const headers = await getAuthHeaders();
  const res = await fetch(`${API_BASE}/api/sessions`, {
    method: 'DELETE',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(Array.isArray(ids) && ids.length > 0 ? { ids } : {}),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || 'ลบประวัติการซ้อมไม่สำเร็จ');
  }
  return res.json();
}

export async function updateSessionShare(sessionId, isPublic) {
  const headers = await getAuthHeaders();
  const res = await fetch(`${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}/share`, {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ isPublic: Boolean(isPublic) }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || 'อัปเดตสถานะการแชร์ไม่สำเร็จ');
  }
  return res.json();
}

export async function fetchPublicSession(shareId) {
  const res = await fetch(`${API_BASE}/api/public/sessions/${encodeURIComponent(shareId)}`);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || 'ไม่พบลิงก์สรุปผลนี้ หรือเจ้าของปิดการแชร์แล้ว');
  }
  return res.json();
}

export async function uploadSessionVideoToCloud(sessionId, blob) {
  if (!sessionId || !blob) {
    throw new Error('ไม่พบไฟล์วิดีโอสำหรับอัปโหลด');
  }
  const mimeType = blob.type || 'video/mp4';
  const prep = await prepareCloudVideoUpload(sessionId, {
    fileSizeBytes: blob.size,
    mimeType,
  });
  const uploadRes = await fetch(prep.signedUrl, {
    method: 'PUT',
    headers: { 'Content-Type': mimeType },
    body: blob,
  });
  if (!uploadRes.ok) {
    throw new Error('อัปโหลดไฟล์ไปยัง Supabase Storage ไม่สำเร็จ');
  }
  return confirmCloudVideoUpload(sessionId, { path: prep.path });
}

export function checkSlideWithAi(payload) {
  return postJson('/api/gemini/check-slide', payload, 60000);
}

export function generateQaQuestions(payload) {
  return postJson('/api/gemini/qa/generate', payload, 60000);
}

export function generateInterruptQuestion(payload) {
  return postJson('/api/gemini/qa/interrupt', payload, 45000);
}

export function evaluateQaAnswer(payload) {
  return postJson('/api/gemini/qa/evaluate', payload, 60000);
}

export function compareRoundsWithAi(payload) {
  return postJson('/api/gemini/compare-rounds', payload, 60000);
}

export function analyzeSummaryWithAi(payload) {
  return postJson('/api/gemini/analyze-summary', payload, 60000);
}

export function synthesizeFreeSpeech(text) {
  return postJson('/api/tts/free', { text }, 15000);
}

export async function uploadGroupClip(roomCode, payload) {
  return postJson(`/group/${encodeURIComponent(roomCode)}/clips`, payload, 60000);
}

export async function fetchGroupClips(roomCode) {
  const res = await fetch(`${API_BASE}/group/${encodeURIComponent(roomCode)}/clips`);
  const data = await res.json().catch(() => []);
  if (!res.ok) throw new Error(data?.message || 'โหลดคลิปกลุ่มไม่สำเร็จ');
  return (Array.isArray(data) ? data : []).map((c) => ({
    ...c,
    mediaUrl: `${API_BASE}${c.mediaPath}`,
  }));
}

export async function deleteGroupClips(roomCode) {
  const res = await fetch(`${API_BASE}/group/${encodeURIComponent(roomCode)}/clips`, {
    method: 'DELETE',
  });
  return res.json().catch(() => ({ ok: true }));
}

export async function fetchLangmindPreset(code) {
  const cleanCode = encodeURIComponent(String(code || '').trim().toUpperCase());
  try {
    return await getJson(`/api/langmind/preset/${cleanCode}`);
  } catch (err) {
    // Fallback สำหรับทดสอบบน localhost กรณีรันเฉพาะ Frontend (Vite Dev Server)
    if (typeof window !== 'undefined') {
      const localRes = await fetch(`/api/langmind/preset/${cleanCode}`);
      if (localRes.ok) {
        return localRes.json();
      }
    }
    throw err;
  }
}

export async function createLangmindPreset(payload) {
  try {
    return await postJson('/api/langmind/preset', payload);
  } catch (err) {
    if (typeof window !== 'undefined') {
      const localRes = await fetch('/api/langmind/preset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (localRes.ok) {
        return localRes.json();
      }
    }
    throw err;
  }
}
