import { supabase } from './supabase';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

async function getAuthHeaders() {
  if (!supabase) return {};
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function postJson(path, body, timeoutMs = 30000) {
  const authHeaders = await getAuthHeaders();
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

export function mockTopupTokens(packageId) {
  return postJson('/api/tokens/topup-mock', { packageId });
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
