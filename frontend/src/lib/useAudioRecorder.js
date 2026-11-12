import { useCallback, useEffect, useRef, useState } from 'react';

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
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      mediaRecorder.start();
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
        analyser.getByteFrequencyData(dataArray);

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
            // เงียบเกิน 2.5 วินาที -> เริ่มนับเป็น Dead Air
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
    } catch (err) {
      console.error("Audio recorder start error:", err);
    }
  }, [silenceThreshold, deadAirLimitSec]);

  const stop = useCallback(() => {
    return new Promise((resolve) => {
      // หยุดแอนิเมชันตรวจเสียง
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
      setIsDeadAir(false);
      setVolume(0);

      // ปิด AudioContext
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close().catch(() => {});
      }

      // หยุด Stream ไมโครโฟน
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }

      // หยุด MediaRecorder และรวมไฟล์เป็น Blob URL
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== 'inactive') {
        recorder.onstop = () => {
          const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
          const url = URL.createObjectURL(blob);
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
        recorder.stop();
      } else {
        setRecording(false);
        resolve({
          audioUrl: null,
          deadAir: { count: 0, totalSeconds: 0 },
        });
      }
    });
  }, []);

  // คลีนอัพหน่วยความจำเมื่อ Component ถูกปิด
  useEffect(() => {
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close().catch(() => {});
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }
    };
  }, [audioUrl]);

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
