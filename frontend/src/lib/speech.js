import { synthesizeFreeSpeech } from './api';

const edgeCache = new Map();
const edgePending = new Map();
let activeAudio = null;
let activeUtterance = null;
let speakSeq = 0;

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

function stopMediaOnly() {
  window.speechSynthesis?.cancel();
  activeUtterance = null;
  if (activeAudio) {
    activeAudio.pause();
    activeAudio.currentTime = 0;
    activeAudio = null;
  }
}

export function stopSpeaking() {
  speakSeq += 1;
  stopMediaOnly();
}

export function speakThai(text, expectedSeq = null) {
  if (!window.speechSynthesis || !text) return Promise.resolve();

  const mySeq = expectedSeq ?? ++speakSeq;
  stopMediaOnly();
  const synth = window.speechSynthesis;

  return new Promise((resolve) => {
    let done = false;
    let fallbackTimer = null;
    const finish = () => {
      if (done) return;
      done = true;
      if (fallbackTimer) clearTimeout(fallbackTimer);
      if (activeUtterance) activeUtterance = null;
      resolve();
    };

    const run = () => {
      if (mySeq !== speakSeq) {
        finish();
        return;
      }
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = 'th-TH';
      utter.rate = 1.0;
      const voice = pickBestThaiVoice(synth.getVoices());
      if (voice) utter.voice = voice;
      utter.onend = finish;
      utter.onerror = finish;
      activeUtterance = utter;
      synth.speak(utter);
      // กันกรณีเบราว์เซอร์บางตัวไม่ยิง onend
      fallbackTimer = setTimeout(finish, Math.max(5000, text.length * 180));
    };

    // หน่วง 60ms หลัง cancel() เพื่อแก้บั๊ก Chrome บน Windows ที่ตัดเสียงทิ้งเมื่อเรียก speak() ทันที
    const scheduleRun = () => {
      setTimeout(() => {
        if (mySeq !== speakSeq) {
          finish();
          return;
        }
        run();
      }, 60);
    };

    if (synth.getVoices().length > 0) {
      scheduleRun();
    } else {
      let triggered = false;
      const triggerOnce = () => {
        if (triggered) return;
        triggered = true;
        synth.removeEventListener('voiceschanged', triggerOnce);
        scheduleRun();
      };
      synth.addEventListener('voiceschanged', triggerOnce, { once: true });
      setTimeout(triggerOnce, 200);
    }
  });
}

function playAudioUrl(url) {
  stopMediaOnly();
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

async function fetchFreeEdgeTtsUrl(clean) {
  if (edgeCache.has(clean)) return edgeCache.get(clean);
  if (edgePending.has(clean)) return edgePending.get(clean);

  const req = synthesizeFreeSpeech(clean)
    .then((data) => {
      if (data?.audioDataUrl) {
        edgeCache.set(clean, data.audioDataUrl);
        return data.audioDataUrl;
      }
      return null;
    })
    .finally(() => {
      edgePending.delete(clean);
    });

  edgePending.set(clean, req);
  return req;
}

export async function getQuestionAudioUrl(text) {
  const clean = text?.trim();
  if (!clean) return null;
  try {
    return await fetchFreeEdgeTtsUrl(clean);
  } catch {
    return null;
  }
}

export async function preloadQuestionSpeech(text) {
  const clean = text?.trim();
  if (!clean) return null;
  return getQuestionAudioUrl(clean);
}

export async function preloadAllQuestionsSpeech(questions = []) {
  const list = Array.isArray(questions) ? questions : [];
  for (const item of list) {
    const text = typeof item === 'string' ? item : item?.question;
    if (text?.trim()) {
      await preloadQuestionSpeech(text);
    }
  }
}

export async function speakQuestion(text) {
  const clean = text?.trim();
  if (!clean) return;
  const seq = ++speakSeq;

  try {
    const edgeUrl = await fetchFreeEdgeTtsUrl(clean);
    if (seq !== speakSeq) return;
    if (edgeUrl) {
      await playAudioUrl(edgeUrl);
      return;
    }
  } catch {
    // ถ้า Edge-TTS ติดบล็อกหรือเน็ตช้า สลับไปใช้เสียงเบราว์เซอร์อัตโนมัติ
  }

  if (seq !== speakSeq) return;
  await speakThai(clean, seq);
}
