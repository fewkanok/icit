import { synthesizeSpeechWithAi } from './api';

const ttsCache = new Map();
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
  if (!window.speechSynthesis || !text) return;

  stopSpeaking();
  const synth = window.speechSynthesis;

  const run = () => {
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = 'th-TH';
    utter.rate = 1.0;
    const voice = pickBestThaiVoice(synth.getVoices());
    if (voice) utter.voice = voice;
    synth.speak(utter);
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
}

function playAudioUrl(url) {
  stopSpeaking();
  const audio = new Audio(url);
  activeAudio = audio;
  audio.onended = () => {
    if (activeAudio === audio) activeAudio = null;
  };
  return audio.play();
}

export async function speakQuestion(text, { useGemini = false } = {}) {
  const clean = text?.trim();
  if (!clean) return;

  if (!useGemini) {
    speakThai(clean);
    return;
  }

  const cached = ttsCache.get(clean);
  if (cached) {
    try {
      await playAudioUrl(cached);
      return;
    } catch {
      // fallback ด้านล่าง
    }
  }

  try {
    const data = await synthesizeSpeechWithAi(clean);
    if (data?.audioDataUrl) {
      ttsCache.set(clean, data.audioDataUrl);
      await playAudioUrl(data.audioDataUrl);
      return;
    }
  } catch {
    // ถ้าโควตาหมดหรือปิด API ให้สลับกลับมาใช้เสียงเบราว์เซอร์อัตโนมัติ
  }

  speakThai(clean);
}
