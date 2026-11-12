import { useCallback, useEffect, useRef, useState } from 'react';

const SR = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;

export function useSpeechRecognition(lang = 'th-TH') {
  const [listening, setListening] = useState(false);
  const [finalText, setFinalText] = useState('');
  const [interim, setInterim] = useState('');
  const [error, setError] = useState(null);
  const recRef = useRef(null);
  const wantRef = useRef(false);

  const start = useCallback(() => {
    if (!SR) return;
    const rec = new SR();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;

    rec.onresult = (e) => {
      let fin = '';
      let inter = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) fin += t;
        else inter += t;
      }
      if (fin) setFinalText((p) => p + fin);
      setInterim(inter);
    };

    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        wantRef.current = false;
        setError('ไม่ได้รับอนุญาตให้ใช้ไมโครโฟน');
      }
    };

    // Chrome จะหยุดเองเมื่อเงียบนาน — ถ้ายังกดอัดอยู่ให้เริ่มใหม่
    rec.onend = () => {
      if (wantRef.current) {
        try {
          rec.start();
        } catch {
          /* ignore */
        }
      } else {
        setListening(false);
      }
    };

    recRef.current = rec;
    wantRef.current = true;
    setFinalText('');
    setInterim('');
    setError(null);
    rec.start();
    setListening(true);
  }, [lang]);

  const stop = useCallback(() => {
    wantRef.current = false;
    recRef.current?.stop();
    setListening(false);
  }, []);

  useEffect(() => () => {
    wantRef.current = false;
    recRef.current?.abort();
  }, []);

  return { supported: !!SR, listening, finalText, interim, error, start, stop };
}
