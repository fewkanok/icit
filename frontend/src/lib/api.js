const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

async function postJson(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message || 'ไม่สามารถเชื่อมต่อระบบ AI ได้');
  }
  return data;
}

export function checkSlideWithAi(payload) {
  return postJson('/api/gemini/check-slide', payload);
}

export function generateQaQuestions(payload) {
  return postJson('/api/gemini/qa/generate', payload);
}

export function generateInterruptQuestion(payload) {
  return postJson('/api/gemini/qa/interrupt', payload);
}

export function evaluateQaAnswer(payload) {
  return postJson('/api/gemini/qa/evaluate', payload);
}

export function analyzeSummaryWithAi(payload) {
  return postJson('/api/gemini/analyze-summary', payload);
}

export function synthesizeSpeechWithAi(text) {
  return postJson('/api/gemini/tts', { text });
}
