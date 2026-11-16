import { synthesizeFreeSpeech } from './api';

const edgeCache = new Map();
const edgePending = new Map();
let activeAudio = null;
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

export function stopSpeaking() {
  speakSeq += 1;
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
  await speakThai(clean);
}
