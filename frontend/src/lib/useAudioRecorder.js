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

  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const animFrameRef = useRef(null);
  const streamRef = useRef(null);

  // ตัวจับเวลาเดดแอร์
  const silenceStartRef = useRef(null);
  const deadAirCountRef = useRef(0);
  const deadAirTotalSecRef = useRef(0);
  const inDeadAirRef = useRef(false);

  const start = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // 1. ตั้งค่า Web Audio API สำหรับอ่านคลื่นเสียง
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const audioCtx = new AudioCtx();
      audioContextRef.current = audioCtx;

      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      // 2. ตั้งค่า MediaRecorder เพื่ออัดเสียงเก็บใน RAM
      const mimeType = getSupportedMimeType();
      const options = mimeType ? { mimeType } : {};
      const mediaRecorder = new MediaRecorder(stream, options);
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

      // 3. วนลูปอ่านความดังเสียง (RMS) และตรวจจับ Dead Air
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
      return stream;
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

  // คลีนอัพ Stream และ AudioContext เมื่อถอด Hook (ไม่สั่ง revoke URL ที่ผู้ใช้ต้องนำไปฟัง)
  useEffect(() => {
    return () => {
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
    start,
    stop,
  };
}
