import { synthesizeSpeechWithAi } from './api';

const ttsCache = new Map();
const ttsPending = new Map();
let activeAudio = null;

// เลือกเสียงภาษาไทยที่ธรรมชาติที่สุดที่มีในเบราว์เซอร์ (รองรับ Edge Natural/Online voices ก่อนเสียงระบบทั่วไป)
function pickBestThaiVoice(voices) {
  const thVoices = voices.filter((v) => v.lang?.toLowerCase().startsWith('th'));
  if (thVoices.length === 0) return null;

  const preferred = ['natural', 'online', 'neural', 'premwadee', 'niwat', 'google'];
  for (const kw of preferred) {
    const match = thVoices.find((v) => v.name?.toLowerCase().includes(kw));
    if (match) return match;
  }
  return thVoices[0];
}

export function stopSpeaking() {
  window.speechSynthesis?.cancel();
  if (activeAudio) {
    activeAudio.pause();
    activeAudio.currentTime = 0;
    activeAudio = null;
  }
}

export function speakThai(text) {
  if (!window.speechSynthesis || !text) return Promise.resolve();

  stopSpeaking();
  const synth = window.speechSynthesis;

  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };

    const run = () => {
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = 'th-TH';
      utter.rate = 1.0;
      const voice = pickBestThaiVoice(synth.getVoices());
      if (voice) utter.voice = voice;
      utter.onend = finish;
      utter.onerror = finish;
      synth.speak(utter);
      // กันกรณีเบราว์เซอร์บางตัวไม่ยิง onend
      setTimeout(finish, Math.max(4000, text.length * 160));
    };

    if (synth.getVoices().length > 0) {
      run();
    } else {
      const onReady = () => {
        synth.removeEventListener('voiceschanged', onReady);
        run();
      };
      synth.addEventListener('voiceschanged', onReady, { once: true });
      setTimeout(() => {
        synth.removeEventListener('voiceschanged', onReady);
        if (!synth.speaking) run();
      }, 150);
    }
  });
}

function playAudioUrl(url) {
  stopSpeaking();
  return new Promise((resolve, reject) => {
    const audio = new Audio(url);
    activeAudio = audio;
    const finish = () => {
      if (activeAudio === audio) activeAudio = null;
      resolve();
    };
    audio.onended = finish;
    audio.onerror = () => {
      if (activeAudio === audio) activeAudio = null;
      reject(new Error('Audio playback failed'));
    };
    audio.play().catch((err) => {
      if (activeAudio === audio) activeAudio = null;
      reject(err);
    });
  });
}

async function fetchGeminiTtsUrl(clean) {
  if (ttsCache.has(clean)) return ttsCache.get(clean);
  if (ttsPending.has(clean)) return ttsPending.get(clean);

  const req = synthesizeSpeechWithAi(clean)
    .then((data) => {
      if (data?.audioDataUrl) {
        ttsCache.set(clean, data.audioDataUrl);
        return data.audioDataUrl;
      }
      return null;
    })
    .finally(() => {
      ttsPending.delete(clean);
    });

  ttsPending.set(clean, req);
  return req;
}

export async function preloadQuestionSpeech(text) {
  const clean = text?.trim();
  if (!clean || ttsCache.has(clean)) return;
  try {
    await fetchGeminiTtsUrl(clean);
  } catch {
    // ไม่เป็นไร ค่อย fallback ตอนเล่นจริง
  }
}

export async function speakQuestion(text, { useGemini = false, onAudioUrl = null } = {}) {
  const clean = text?.trim();
  if (!clean) return;

  if (!useGemini) {
    await speakThai(clean);
    return;
  }

  try {
    const url = await fetchGeminiTtsUrl(clean);
    if (url) {
      if (typeof onAudioUrl === 'function') {
        const handled = await onAudioUrl(url);
        if (handled) return;
      }
      await playAudioUrl(url);
      return;
    }
  } catch {
    // ถ้าโควตาหมดหรือปิด API ให้สลับกลับมาใช้เสียงเบราว์เซอร์อัตโนมัติ
  }

  await speakThai(clean);
}
