import { useCallback, useEffect, useRef, useState } from 'react';

function getSupportedMimeType() {
  if (typeof window === 'undefined' || typeof MediaRecorder === 'undefined') return '';
  const types = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
    'audio/aac',
  ];
  for (const t of types) {
    if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) {
      return t;
    }
  }
  return '';
}

/**
 * useAudioRecorder:
 * - บันทึกเสียงลง RAM (Blob URL) ให้กดฟังย้อนหลังได้ทันที โดยไม่ต้องขึ้น Cloud
 * - ใช้ Web Audio API (AnalyserNode) วิเคราะห์คลื่นเสียงสด
 * - ตรวจจับ Dead Air (เดดแอร์: ช่วงที่เงียบสนิทเกินเกณฑ์ เช่น 2.5 วินาที)
 */
export function useAudioRecorder({ silenceThreshold = 0.02, deadAirLimitSec = 2.5 } = {}) {
  const [recording, setRecording] = useState(false);
  const [audioUrl, setAudioUrl] = useState(null);
  const [volume, setVolume] = useState(0); // ระดับความดังเสียงสด 0 - 1
  const [isDeadAir, setIsDeadAir] = useState(false); // กำลังเดดแอร์อยู่หรือไม่
  const [deadAirStats, setDeadAirStats] = useState({ count: 0, totalSeconds: 0 });
  const [micGain, setMicGain] = useState(() => {
    try {
      const raw = localStorage.getItem('rehearse_mic_gain');
      if (raw === null || raw === '') return 1;
      const saved = Number(raw);
      return Number.isFinite(saved) && saved > 0 && saved <= 2 ? saved : 1;
    } catch {
      return 1;
    }
  });

  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const micGainNodeRef = useRef(null);
  const micGainValueRef = useRef(1);
  const animFrameRef = useRef(null);
  const streamRef = useRef(null);
  const mixDestRef = useRef(null);
  const ttsSourceRef = useRef(null);
  const deadAirPausedRef = useRef(false);

  // ตัวจับเวลาเดดแอร์
  const silenceStartRef = useRef(null);
  const deadAirCountRef = useRef(0);
  const deadAirTotalSecRef = useRef(0);
  const inDeadAirRef = useRef(false);

  const stopTtsMix = useCallback(() => {
    if (ttsSourceRef.current) {
      try {
        ttsSourceRef.current.stop();
        ttsSourceRef.current.disconnect();
      } catch {
        /* ignore */
      }
      ttsSourceRef.current = null;
    }
  }, []);

  const setDeadAirPaused = useCallback((paused) => {
    deadAirPausedRef.current = Boolean(paused);
    if (paused) {
      silenceStartRef.current = null;
      if (inDeadAirRef.current) {
        inDeadAirRef.current = false;
        setIsDeadAir(false);
      }
    }
  }, []);

  const playTtsIntoMix = useCallback(
    async (audioDataUrl) => {
      const ctx = audioContextRef.current;
      const dest = mixDestRef.current;
      if (!ctx || !dest || !audioDataUrl || ctx.state === 'closed') return false;

      stopTtsMix();
      try {
        if (ctx.state === 'suspended') {
          await ctx.resume();
        }
        const res = await fetch(audioDataUrl);
        const arr = await res.arrayBuffer();
        const audioBuf = await ctx.decodeAudioData(arr);

        await new Promise((resolve) => {
          if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
            resolve();
            return;
          }
          const src = ctx.createBufferSource();
          src.buffer = audioBuf;
          src.connect(ctx.destination);
          src.connect(dest);
          ttsSourceRef.current = src;
          src.onended = () => {
            if (ttsSourceRef.current === src) ttsSourceRef.current = null;
            resolve();
          };
          src.start(0);
        });
        return true;
      } catch (err) {
        console.warn('[useAudioRecorder] playTtsIntoMix failed:', err);
        return false;
      }
    },
    [stopTtsMix],
  );

  const start = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // 1. ตั้งค่า Web Audio API สำหรับอ่านคลื่นเสียงและผสมเสียง TTS (ถ้ามี)
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const audioCtx = new AudioCtx();
      if (audioCtx.state === 'suspended') {
        await audioCtx.resume().catch(() => {});
      }
      audioContextRef.current = audioCtx;

      const source = audioCtx.createMediaStreamSource(stream);
      const gainNode = audioCtx.createGain();
      gainNode.gain.value = micGainValueRef.current;
      micGainNodeRef.current = gainNode;
      source.connect(gainNode);

      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      gainNode.connect(analyser);
      analyserRef.current = analyser;

      const mixDest = audioCtx.createMediaStreamDestination();
      gainNode.connect(mixDest);
      mixDestRef.current = mixDest;

      // 2. ตั้งค่า MediaRecorder เพื่ออัดเสียงผสมเก็บใน RAM
      const recordStream = mixDest.stream;
      const mimeType = getSupportedMimeType();
      const options = mimeType ? { mimeType } : {};
      const mediaRecorder = new MediaRecorder(recordStream, options);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      // ส่ง timeslice 200ms เพื่อให้เก็บ chunks เป็นระยะสม่ำเสมอ
      mediaRecorder.start(200);

      setRecording(true);
      setAudioUrl(null);
      setIsDeadAir(false);
      deadAirCountRef.current = 0;
      deadAirTotalSecRef.current = 0;
      setDeadAirStats({ count: 0, totalSeconds: 0 });
      silenceStartRef.current = null;
      inDeadAirRef.current = false;

      // 3. วนลูปอ่านความดังเสียง (RMS) และตรวจจับ Dead Air (เฉพาะช่วงที่ไม่ได้พัก Dead Air)
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      let lastCheckTime = Date.now();

      const checkAudio = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);

        // คำนวณความดังเฉลี่ย (Volume 0 ถึง 1)
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const avg = sum / dataArray.length / 255;
        setVolume(avg);

        const now = Date.now();
        const deltaSec = (now - lastCheckTime) / 1000;
        lastCheckTime = now;

        if (deadAirPausedRef.current) {
          silenceStartRef.current = null;
          animFrameRef.current = requestAnimationFrame(checkAudio);
          return;
        }

        // ถ้าความดังเสียงต่ำกว่าเกณฑ์ (เงียบ)
        if (avg < silenceThreshold) {
          if (!silenceStartRef.current) {
            silenceStartRef.current = now;
          } else {
            const silentSec = (now - silenceStartRef.current) / 1000;
            // เงียบเกิน deadAirLimitSec -> เริ่มนับเป็น Dead Air
            if (silentSec >= deadAirLimitSec) {
              if (!inDeadAirRef.current) {
                inDeadAirRef.current = true;
                deadAirCountRef.current += 1;
                setIsDeadAir(true);
              }
              deadAirTotalSecRef.current += deltaSec;
              setDeadAirStats({
                count: deadAirCountRef.current,
                totalSeconds: Math.round(deadAirTotalSecRef.current * 10) / 10,
              });
            }
          }
        } else {
          // มีเสียงพูด -> ยกเลิกสถานะเดดแอร์
          silenceStartRef.current = null;
          if (inDeadAirRef.current) {
            inDeadAirRef.current = false;
            setIsDeadAir(false);
          }
        }

        animFrameRef.current = requestAnimationFrame(checkAudio);
      };

      checkAudio();
      return recordStream;
    } catch (err) {
      console.error("[useAudioRecorder] Audio recorder start error:", err);
      return null;
    }
  }, [silenceThreshold, deadAirLimitSec]);

  const stop = useCallback(() => {
    return new Promise((resolve) => {
      // 1. หยุดแอนิเมชันตรวจจับเสียง
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
      setIsDeadAir(false);
      setVolume(0);

      const recorder = mediaRecorderRef.current;

      const cleanupHardware = () => {
        stopTtsMix();
        mixDestRef.current = null;
        // หยุด Stream ไมโครโฟน
        if (streamRef.current) {
          try {
            streamRef.current.getTracks().forEach((track) => track.stop());
          } catch (_) {}
          streamRef.current = null;
        }

        // ปิด AudioContext
        if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
          audioContextRef.current.close().catch(() => {});
          audioContextRef.current = null;
        }
      };

      const finalizeResult = () => {
        cleanupHardware();

        const mime = recorder?.mimeType || getSupportedMimeType() || 'audio/webm';
        let url = null;
        let blob = null;

        if (audioChunksRef.current.length > 0) {
          blob = new Blob(audioChunksRef.current, { type: mime });
          url = URL.createObjectURL(blob);
          console.log('[useAudioRecorder] Audio saved to RAM. Size:', blob.size, 'bytes, URL:', url);
        } else {
          console.warn('[useAudioRecorder] No audio chunks recorded!');
        }

        setAudioUrl(url);
        setRecording(false);
        resolve({
          audioUrl: url,
          audioBlob: blob,
          deadAir: {
            count: deadAirCountRef.current,
            totalSeconds: Math.round(deadAirTotalSecRef.current * 10) / 10,
          },
        });
      };

      if (recorder && recorder.state !== 'inactive') {
        recorder.onstop = () => {
          finalizeResult();
        };
        try {
          recorder.stop();
        } catch (e) {
          console.error('[useAudioRecorder] recorder.stop() exception:', e);
          finalizeResult();
        }
      } else {
        finalizeResult();
      }
    });
  }, []);

  useEffect(() => {
    micGainValueRef.current = micGain;
    if (micGainNodeRef.current) {
      micGainNodeRef.current.gain.value = micGain;
    }
    try {
      localStorage.setItem('rehearse_mic_gain', String(micGain));
    } catch {
      // ignore storage errors
    }
  }, [micGain]);

  // คลีนอัพ Stream และ AudioContext เมื่อถอด Hook (ไม่สั่ง revoke URL ที่ผู้ใช้ต้องนำไปฟัง)
  useEffect(() => {
    return () => {
      micGainNodeRef.current = null;
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close().catch(() => {});
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  return {
    recording,
    audioUrl,
    volume,
    isDeadAir,
    deadAirStats,
    micGain,
    setMicGain,
    start,
    stop,
    playTtsIntoMix,
    stopTtsMix,
    setDeadAirPaused,
  };
}
