import { useEffect, useMemo, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import SlideViewer from './SlideViewer';
import FloatingCamera from './FloatingCamera';
import { ToggleSwitch } from './ui/StateViews';
import InterruptModal from './InterruptModal';
import { askConfirm } from './ConfirmModal';
import { createSocket } from '../lib/socket';
import { useSpeechRecognition } from '../lib/useSpeechRecognition';
import { useAudioRecorder } from '../lib/useAudioRecorder';
import { useFaceLandmarker } from '../lib/useFaceLandmarker';
import { useVideoRecorder } from '../lib/useVideoRecorder';
import { checkSlideWithAi } from '../lib/api';
import {
  analyze,
  countFillers,
  countWords,
  formatTime,
  LIVE_PACE_FAST,
  LIVE_PACE_SLOW,
  pace,
  PACE_PILL,
  PACE_TEXT,
  PACE_WARMUP_SEC,
  PACE_WINDOW_SEC,
} from '../lib/metrics';

const WINDOW_SEC = PACE_WINDOW_SEC;
const WARMUP_SEC = PACE_WARMUP_SEC;

function MicIcon() {
  return (
    <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="5.5" y="1.75" width="5" height="8" rx="2.5" />
      <path d="M3 7.5a5 5 0 0 0 10 0M8 12.5v2" strokeLinecap="round" />
    </svg>
  );
}

function Stat({ label, value, note, noteClass }) {
  return (
    <div>
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 font-mono text-xl tabular-nums tracking-tight">{value}</p>
      {note && <p className={`mt-0.5 text-xs ${noteClass}`}>{note}</p>}
    </div>
  );
}

function LivePace({ wpm, fillers }) {
  const p = pace(wpm);
  return (
    <div className="flex items-end justify-between gap-4 rounded-lg border border-line px-4 py-3">
      <div>
        <div className="flex items-center gap-2">
          <p className="text-xs text-muted">ความเร็วตอนนี้</p>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium transition-colors ${
              p ? PACE_PILL[p.tone] : 'bg-line/60 text-faint'
            }`}
          >
            {p ? p.label : 'กำลังวัด…'}
          </span>
        </div>
        <p className={`mt-1 font-mono text-3xl tabular-nums tracking-tight transition-colors ${p ? PACE_TEXT[p.tone] : 'text-faint'}`}>
          {wpm || '–'}
          <span className="ml-1.5 font-sans text-xs text-muted">คำ/นาที</span>
        </p>
      </div>

      {fillers > 0 && (
        <div className="text-right">
          <p className="text-xs text-accent">พบคำติดปาก</p>
          <p className="mt-1 font-mono text-3xl tabular-nums tracking-tight text-accent">{fillers}</p>
        </div>
      )}
    </div>
  );
}

// แถบคลื่นเสียงเคลื่อนไหวสด + เตือนเดดแอร์
function LiveWaveform({ volume, isDeadAir }) {
  const bars = [0.4, 0.7, 1.0, 0.6, 0.9, 0.5, 0.8, 1.0, 0.6, 0.7, 0.5, 0.8];
  return (
    <div className="flex h-8 items-center justify-between rounded-lg border border-line bg-paper px-3">
      <div className="flex h-4 items-center gap-1">
        {bars.map((mult, i) => {
          const heightPct = Math.min(100, Math.max(15, volume * mult * 320));
          return (
            <span
              key={i}
              className={`w-1 rounded-full transition-all duration-75 ${
                isDeadAir ? 'bg-slow' : 'bg-ink'
              }`}
              style={{ height: `${heightPct}%` }}
            />
          );
        })}
      </div>
      {isDeadAir ? (
        <span className="flex items-center gap-1.5 text-xs font-medium text-slow animate-pulse">
          <span className="size-1.5 rounded-full bg-slow" />
          เดดแอร์ (เงียบเกิน 2.5 วิ)
        </span>
      ) : (
        <span className="text-[11px] text-faint font-mono">LIVE AUDIO</span>
      )}
    </div>
  );
}

export default function RehearsalStep({
  deck,
  rehearsalMode = 'per_slide',
  audience,
  timeBudget,
  results,
  onResult,
  interruptEnabled,
  onInterruptToggle,
  useGeminiTts = false,
  cameraEnabled = true,
  onCameraToggle,
  interruptResults,
  onInterruptResult,
  onBack,
  onFinish,
  initialIndex = 0,
}) {
  const [index, setIndex] = useState(initialIndex);
  const [elapsed, setElapsed] = useState(0);
  const [liveWpm, setLiveWpm] = useState(0);
  const [aiChecking, setAiChecking] = useState(false);
  const [aiError, setAiError] = useState(null);
  const [activeInterruptSlide, setActiveInterruptSlide] = useState(null);
  const [stageMode, setStageMode] = useState(false);
  const [qrModalOpen, setQrModalOpen] = useState(false);
  const [roomCode, setRoomCode] = useState(null);
  const [roomError, setRoomError] = useState(null);
  const [lanIp, setLanIp] = useState(null);
  const [remoteConnected, setRemoteConnected] = useState(false);
  const [laser, setLaser] = useState(null);
  const [mobileTranscript, setMobileTranscript] = useState({ finalText: '', interim: '', listening: false });
  const [hideLiveCoach, setHideLiveCoach] = useState(rehearsalMode === 'continuous');
  const [showOptionsMenu, setShowOptionsMenu] = useState(false);

  const startedAt = useRef(0);
  const segmentStartAt = useRef(0);
  const segmentOffset = useRef(0);
  const resumeAfterInterrupt = useRef(null);
  const samples = useRef([]);
  const textRef = useRef('');
  const socketRef = useRef(null);
  const vibratedRef = useRef({ warn60: false, overtime: false });
  const actionsRef = useRef({});
  const isContinuous = rehearsalMode === 'continuous';

  // สุ่มหน้าที่จะถามแทรกประมาณ 20% ของจำนวนสไลด์ (เริ่มสุ่มเมื่อมี 3 หน้าขึ้นไป และไม่รวมหน้าสุดท้าย)
  const pickedInterruptSlides = useMemo(() => {
    const totalSlides = deck.slides.length;
    if (totalSlides < 3) return new Set();
    const eligible = Array.from({ length: totalSlides - 1 }, (_, i) => i);
    for (let i = eligible.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [eligible[i], eligible[j]] = [eligible[j], eligible[i]];
    }
    const count = Math.min(eligible.length, Math.max(1, Math.round(totalSlides * 0.2)));
    return new Set(eligible.slice(0, count));
  }, [deck]);

  // 1. ตัวถอดเสียงเป็นข้อความ
  const speech = useSpeechRecognition('th-TH');

  // 2. ตัวอัดเสียงลง RAM + จับคลื่นเสียง + เดดแอร์ (ไม่ขึ้น Cloud)
  const recorder = useAudioRecorder({ silenceThreshold: 0.02, deadAirLimitSec: 2.5 });

  // 3. ตัวตรวจจับสายตา & บุคลิกภาพ ด้วย Google MediaPipe Vision (Client-side 100%)
  const vision = useFaceLandmarker();
  const autoCameraStarted = useRef(false);

  useEffect(() => {
    if (cameraEnabled && !autoCameraStarted.current && !vision.cameraActive && !vision.modelLoading) {
      autoCameraStarted.current = true;
      void vision.startCamera();
    }
  }, [cameraEnabled, vision]);

  // 4. ตัวอัดวิดีโอกล้องลง RAM (เมื่อเปิดกล้อง) สำหรับดูย้อนหลังและดาวน์โหลด
  const videoRecorder = useVideoRecorder();

  const total = deck.slides.length;
  const live = speech.listening || recorder.recording;
  const timelineEventsRef = useRef([]);
  const lastPacePinAtRef = useRef(-10);
  const lastLookingDownRef = useRef(0);
  const lastFillerCountRef = useRef(0);
  const result = results[index];
  const isLast = index === total - 1;
  const doneCount = Object.keys(results).length;
  const activeFinal = mobileTranscript.finalText || speech.finalText;
  const activeInterim = mobileTranscript.interim || speech.interim;
  const fullLiveText = `${activeFinal} ${activeInterim}`.trim();
  const liveText = isContinuous ? fullLiveText.slice(segmentOffset.current).trim() : fullLiveText;
  textRef.current = fullLiveText;

  // เวลารวมทั้งหมดที่พูดไปแล้วเทียบกับเวลาเป้าหมาย
  const otherDuration = Object.entries(results).reduce(
    (sum, [k, r]) => (Number(k) === index ? sum : sum + (r?.duration || 0)),
    0,
  );
  const totalElapsedSec = otherDuration + (live ? elapsed : (result?.duration || 0));
  const presentTargetSec = (timeBudget?.presentMinutes || 0) * 60;
  const isOvertime = presentTargetSec > 0 && totalElapsedSec > presentTargetSec;
  const isNearEnd = presentTargetSec > 0 && !isOvertime && presentTargetSec - totalElapsedSec <= 60;

  actionsRef.current = { start, stop, handleContinuousNext, live, index, total, setIndex, onFinish, isContinuous };

  // บันทึกหมุด Timeline ระหว่างพูด (เงียบค้าง / ก้มอ่าน / ความเร็ว / คำติดปาก)
  useEffect(() => {
    if (!live || !startedAt.current) return;
    if (recorder.isDeadAir) {
      const t = Number(((Date.now() - startedAt.current) / 1000).toFixed(1));
      timelineEventsRef.current.push({ t, type: 'deadair', label: 'เงียบค้าง (> 2.5 วิ)' });
    }
  }, [live, recorder.isDeadAir]);

  useEffect(() => {
    if (!live || !startedAt.current) return;
    if (vision.lookingDownCount > lastLookingDownRef.current) {
      lastLookingDownRef.current = vision.lookingDownCount;
      const t = Number(((Date.now() - startedAt.current) / 1000).toFixed(1));
      timelineEventsRef.current.push({ t, type: 'eye', label: 'ก้มอ่าน / สายตาหลุดกล้อง' });
    }
  }, [live, vision.lookingDownCount]);

  useEffect(() => {
    if (!live || !startedAt.current || liveWpm <= 0) return;
    const t = Number(((Date.now() - startedAt.current) / 1000).toFixed(1));
    if (t - lastPacePinAtRef.current < 4) return;
    if (liveWpm > LIVE_PACE_FAST) {
      lastPacePinAtRef.current = t;
      timelineEventsRef.current.push({ t, type: 'pace_fast', label: `พูดเร็ว (${liveWpm} คำ/นาที)` });
    } else if (liveWpm < LIVE_PACE_SLOW && t >= WARMUP_SEC) {
      lastPacePinAtRef.current = t;
      timelineEventsRef.current.push({ t, type: 'pace_slow', label: `พูดช้า (${liveWpm} คำ/นาที)` });
    }
  }, [live, liveWpm]);

  useEffect(() => {
    if (!live || !startedAt.current || !fullLiveText) return;
    const { fillers } = analyze(fullLiveText, 1);
    if (fillers.total > lastFillerCountRef.current) {
      lastFillerCountRef.current = fillers.total;
      const t = Number(((Date.now() - startedAt.current) / 1000).toFixed(1));
      const topFiller = fillers.found[0]?.label;
      timelineEventsRef.current.push({
        t,
        type: 'filler',
        label: topFiller ? `พบคำติดปาก (${topFiller})` : 'พบคำติดปาก',
      });
    }
  }, [live, fullLiveText]);

  // เชื่อมต่อ WebSocket เมื่อเปิดโหมดเวที
  useEffect(() => {
    if (!stageMode) {
      socketRef.current?.disconnect();
      socketRef.current = null;
      setRoomCode(null);
      setRoomError(null);
      setRemoteConnected(false);
      setLaser(null);
      return;
    }

    setRoomError(null);
    const socket = createSocket();
    socketRef.current = socket;

    const requestRoom = () => {
      setRoomError(null);
      socket.emit('create_room', (res) => {
        if (res?.code) setRoomCode(res.code);
        if (res?.lanIp) setLanIp(res.lanIp);
      });
    };

    socket.on('connect', requestRoom);
    if (socket.connected) requestRoom();

    socket.on('connect_error', (err) => {
      setRoomError(err?.message || 'เชื่อมต่อเซิร์ฟเวอร์รีโมตไม่สำเร็จ กรุณาเช็กว่า Backend กำลังรันอยู่');
    });

    socket.on('remote_joined', () => {
      setRemoteConnected(true);
      setQrModalOpen(false);
    });

    socket.on('stage_command', ({ action }) => {
      const {
        start: s,
        stop: st,
        handleContinuousNext: contNext,
        live: isLive,
        index: idx,
        total: t,
        setIndex: setIdx,
        onFinish: finish,
        isContinuous: cont,
      } = actionsRef.current;
      if (action === 'prev' && !isLive && idx > 0) setIdx(idx - 1);
      if (action === 'next') {
        if (cont && isLive && idx < t - 1) void contNext();
        else if (!isLive && idx < t - 1) setIdx(idx + 1);
      }
      if (action === 'finish') {
        if (cont && isLive) void st({ goFinish: true });
        else if (!isLive) finish();
      }
      if (action === 'start' && !isLive) void s();
      if (action === 'stop' && isLive) void st();
    });

    socket.on('stage_laser', (pos) => {
      setLaser(pos?.active ? pos : null);
    });

    socket.on('stage_transcript', (data) => {
      setMobileTranscript(data);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [stageMode]);

  // ซิงก์สถานะสไลด์และเวลาไปที่มือถือ + สั่นเตือนเมื่อใกล้หมดเวลา/เกินเวลา
  useEffect(() => {
    if (!stageMode || !roomCode || !socketRef.current) return;
    const currentSlide = deck.slides[index];
    socketRef.current.emit('stage_state', {
      code: roomCode,
      slideIndex: index,
      totalSlides: total,
      live,
      continuous: isContinuous,
      elapsedSec: totalElapsedSec,
      targetSec: presentTargetSec,
      slide: currentSlide
        ? {
            src: currentSlide.src || null,
            title: currentSlide.title || '',
            points: currentSlide.points || [],
          }
        : null,
    });

    if (isNearEnd && !vibratedRef.current.warn60) {
      vibratedRef.current.warn60 = true;
      socketRef.current.emit('stage_vibrate', { code: roomCode, pattern: [150, 100, 150] });
    }
    if (isOvertime && !vibratedRef.current.overtime) {
      vibratedRef.current.overtime = true;
      socketRef.current.emit('stage_vibrate', { code: roomCode, pattern: [400, 150, 400] });
    }
  }, [stageMode, roomCode, remoteConnected, index, total, live, Math.floor(totalElapsedSec), presentTargetSec, isNearEnd, isOvertime, deck.slides]);

  // ทุก 0.25 วิ: อัปเดตเวลา + เก็บจำนวนคำ แล้วคำนวณความเร็วจากช่วง 10 วิล่าสุด
  useEffect(() => {
    if (!live) return;
    samples.current = [{ t: 0, w: 0 }];
    setLiveWpm(0);
    const id = setInterval(() => {
      const t = (Date.now() - startedAt.current) / 1000;
      const w = countWords(textRef.current);
      setElapsed(t);

      const s = samples.current;
      s.push({ t, w });
      while (s.length > 1 && s[1].t <= t - WINDOW_SEC) s.shift();
      const span = t - s[0].t;
      setLiveWpm(t >= WARMUP_SEC && span > 0 ? Math.max(0, Math.round((w - s[0].w) / (span / 60))) : 0);
    }, 250);
    return () => clearInterval(id);
  }, [live]);

  async function start() {
    setAiError(null);
    if (result?.audioUrl) URL.revokeObjectURL(result.audioUrl);
    if (result?.videoUrl) URL.revokeObjectURL(result.videoUrl);
    setMobileTranscript({ finalText: '', interim: '', listening: false });
    const now = Date.now();
    startedAt.current = now;
    segmentStartAt.current = now;
    segmentOffset.current = 0;
    timelineEventsRef.current = [{ t: 0, type: 'slide', label: `เริ่มสไลด์ ${index + 1}` }];
    lastPacePinAtRef.current = -10;
    lastLookingDownRef.current = 0;
    lastFillerCountRef.current = 0;
    setElapsed(0);
    speech.start();
    const audioStream = await recorder.start();
    if (vision.cameraActive) {
      vision.startTracking();
      videoRecorder.start(vision.getStream(), audioStream);
    }
  }

  async function stop({ goFinish = false, skipInterrupt = false } = {}) {
    const now = Date.now();
    const fullText = `${mobileTranscript.finalText || speech.finalText} ${mobileTranscript.interim || speech.interim}`.trim();
    const transcript = isContinuous ? fullText.slice(segmentOffset.current).trim() : fullText;
    const duration = Math.max(0.5, (now - (isContinuous ? segmentStartAt.current : startedAt.current)) / 1000);
    speech.stop();
    const recResult = await recorder.stop();
    const videoResult = await videoRecorder.stop();
    const visionStats = vision.stopTracking();

    onResult(index, {
      ...analyze(transcript, duration),
      audioUrl: recResult.audioUrl,
      videoUrl: videoResult.videoUrl,
      videoExt: videoResult.videoExt,
      deadAir: recResult.deadAir,
      vision: visionStats,
      timelineEvents: [...timelineEventsRef.current],
      aiCheck: null,
    });

    if (goFinish) {
      onFinish();
      return;
    }

    if (!skipInterrupt && interruptEnabled && pickedInterruptSlides.has(index) && !interruptResults?.[index]) {
      setActiveInterruptSlide(index);
    }
  }

  async function handleContinuousNext() {
    if (!isContinuous || !live || index >= total - 1) return;
    const now = Date.now();
    const fullText = textRef.current;
    const slideTranscript = fullText.slice(segmentOffset.current).trim();
    const slideDuration = Math.max(0.5, (now - segmentStartAt.current) / 1000);

    onResult(index, {
      ...analyze(slideTranscript, slideDuration),
      aiCheck: null,
    });

    if (interruptEnabled && pickedInterruptSlides.has(index) && !interruptResults?.[index]) {
      resumeAfterInterrupt.current = index + 1;
      speech.stop();
      const recResult = await recorder.stop();
      const videoResult = await videoRecorder.stop();
      const visionStats = vision.stopTracking();
      onResult(index, {
        ...analyze(slideTranscript, slideDuration),
        audioUrl: recResult.audioUrl,
        videoUrl: videoResult.videoUrl,
        videoExt: videoResult.videoExt,
        deadAir: recResult.deadAir,
        vision: visionStats,
        timelineEvents: [...timelineEventsRef.current],
        aiCheck: null,
      });
      setActiveInterruptSlide(index);
      return;
    }

    const slideT = Number(((now - startedAt.current) / 1000).toFixed(1));
    timelineEventsRef.current.push({ t: slideT, type: 'slide', label: `เริ่มสไลด์ ${index + 2}` });
    segmentOffset.current = fullText.length;
    segmentStartAt.current = now;
    setIndex(index + 1);
  }

  async function handleCheckSlide() {
    if (!result || aiChecking) return;
    const ok = await askConfirm({
      key: 'token-spend',
      title: 'ยืนยันการใช้ 1 Token',
      message: 'ระบบจะใช้ 1 Token เพื่อวิเคราะห์ความตรงสไลด์ในหน้านี้ด้วย AI',
      confirmText: 'ใช้ 1 Token',
    });
    if (!ok) return;
    setAiChecking(true);
    setAiError(null);
    try {
      const slide = deck.slides[index];
      const slideText = slide.text || (slide.bullets ? `${slide.title || ''} - ${slide.bullets.join(', ')}` : slide.title || '');
      const aiCheck = await checkSlideWithAi({
        slideTitle: slide.title,
        slideText,
        slideImageBase64: slide.src || slide.url,
        transcript: result.transcript,
        audience,
      });
      onResult(index, { ...result, aiCheck });
    } catch (err) {
      setAiError(err.message || 'ไม่สามารถเช็กหน้านี้ได้ในขณะนี้');
    } finally {
      setAiChecking(false);
    }
  }

  const p = result ? pace(result.wpm) : null;

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      {/* หน้าต่างกล้องลอย (สามารถคลิกลากไปวางได้ทุกจุดบนหน้าจอ) */}
      <FloatingCamera vision={vision} live={live} />

      {/* หน้าต่าง QR Code สำหรับเชื่อมรีโมตมือถือ */}
      {stageMode && qrModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4 backdrop-blur-[2px]">
          <div className="w-full max-w-sm rounded-2xl border border-line bg-white p-6 shadow-xl text-center space-y-4">
            <div className="flex items-center justify-between border-b border-line pb-3 text-left">
              <div>
                <h3 className="text-sm font-semibold text-ink">สแกน QR เพื่อใช้มือถือเป็นรีโมต</h3>
                <p className="text-xs text-muted">
                  {remoteConnected
                    ? 'เชื่อมต่อมือถือแล้ว'
                    : roomCode
                      ? `รหัสห้อง: ${roomCode}`
                      : roomError
                        ? 'เชื่อมต่อไม่สำเร็จ'
                        : 'กำลังสร้างห้อง...'}
                </p>
              </div>
              <span
                className={`size-2.5 rounded-full ${
                  remoteConnected ? 'bg-ok' : 'bg-faint animate-pulse'
                }`}
              />
            </div>

            {roomError && <p className="text-xs text-accent text-left">{roomError}</p>}

            {roomCode && (() => {
              const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
              const remoteOrigin = isLocal && lanIp
                ? `${window.location.protocol}//${lanIp}:${window.location.port}`
                : window.location.origin;
              const remoteUrl = `${remoteOrigin}/?remote=${roomCode}`;
              return (
                <div className="flex flex-col items-center gap-3 rounded-xl bg-paper p-4">
                  <QRCodeSVG value={remoteUrl} size={176} />
                  <p className="break-all font-mono text-[11px] text-muted">{remoteUrl}</p>
                </div>
              );
            })()}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setStageMode(false);
                  setQrModalOpen(false);
                }}
                className="flex-1 rounded-lg border border-line py-2 text-xs font-medium text-muted hover:border-faint hover:text-ink cursor-pointer"
              >
                ปิดโหมดเวที
              </button>
              <button
                type="button"
                onClick={() => setQrModalOpen(false)}
                className="flex-1 rounded-lg bg-ink py-2 text-xs font-medium text-paper hover:bg-ink/85 cursor-pointer"
              >
                ซ่อนหน้าต่าง QR
              </button>
            </div>
          </div>
        </div>
      )}

      {activeInterruptSlide !== null && (() => {
        const slide = deck.slides[activeInterruptSlide];
        const slideText = slide?.text || (slide?.bullets ? `${slide.title || ''} - ${slide.bullets.join(', ')}` : slide?.title || '');
        return (
          <InterruptModal
            slideNumber={activeInterruptSlide + 1}
            slideTitle={slide?.title}
            slideText={slideText}
            slideImageBase64={slide?.src || slide?.url}
            transcript={results[activeInterruptSlide]?.transcript || ''}
            audience={audience}
            vision={vision}
            onSpeakQuestion={(q) => {
              if (stageMode && roomCode) {
                socketRef.current?.emit('stage_speak', { code: roomCode, text: q });
              }
            }}
            onSave={(saved) => onInterruptResult(activeInterruptSlide, saved)}
            onClose={() => {
              setActiveInterruptSlide(null);
              if (resumeAfterInterrupt.current !== null) {
                const nextIdx = resumeAfterInterrupt.current;
                resumeAfterInterrupt.current = null;
                setIndex(nextIdx);
                void start();
              }
            }}
          />
        );
      })()}

      {/* แถบบน */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          onClick={onBack}
          disabled={live}
          className="text-sm text-muted transition hover:text-ink disabled:opacity-30"
        >
          ← เปลี่ยนสไลด์
        </button>
        <div className="flex flex-wrap items-center gap-2.5">
          {presentTargetSec > 0 && (
            <span
              className={`rounded-full border px-3 py-1 font-mono text-xs tabular-nums ${
                isOvertime
                  ? 'border-accent bg-accent/10 text-accent font-medium'
                  : isNearEnd
                    ? 'border-slow bg-slow/10 text-slow font-medium'
                    : 'border-line bg-white text-ink'
              }`}
            >
              เวลารวม {formatTime(totalElapsedSec)} / {formatTime(presentTargetSec)}
            </span>
          )}
          <button
            type="button"
            onClick={() => {
              if (vision.cameraActive) {
                vision.stopCamera();
                if (cameraEnabled) onCameraToggle?.();
              } else {
                void vision.startCamera();
                if (!cameraEnabled) onCameraToggle?.();
              }
            }}
            disabled={vision.modelLoading || live}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition disabled:opacity-40 cursor-pointer ${
              vision.cameraActive
                ? 'border-ok bg-ok/10 text-ok'
                : 'border-line bg-white text-muted hover:border-faint hover:text-ink'
            }`}
          >
            {vision.modelLoading
              ? 'กำลังโหลดกล้อง...'
              : vision.cameraActive
                ? `กล้อง: เปิด (${vision.eyeContactPct}%)`
                : 'กล้อง: ปิด'}
          </button>
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowOptionsMenu((v) => !v)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition cursor-pointer ${
                showOptionsMenu || stageMode
                  ? 'border-ink bg-ink text-paper'
                  : 'border-line bg-white text-muted hover:border-faint hover:text-ink'
              }`}
            >
              {stageMode ? (remoteConnected ? 'เพิ่มเติม · รีโมตเชื่อมแล้ว' : 'เพิ่มเติม · รอ QR') : 'เพิ่มเติม'}
            </button>

            {showOptionsMenu && (
              <div className="absolute right-0 z-30 mt-2 w-80 rounded-xl border border-line bg-white p-3.5 shadow-lg space-y-2.5">
                <p className="px-1 text-xs font-semibold text-muted">ตัวเลือกห้องซ้อม</p>
                {stageMode ? (
                  <button
                    type="button"
                    onClick={() => {
                      setQrModalOpen(true);
                      setShowOptionsMenu(false);
                    }}
                    disabled={live}
                    className="flex w-full items-center justify-between rounded-lg border border-accent/30 bg-accent/5 px-3 py-2 text-left text-xs font-medium text-accent disabled:opacity-40 cursor-pointer"
                  >
                    <span>{remoteConnected ? 'รีโมตเชื่อมแล้ว (ดู QR)' : 'รอสแกน QR รีโมต'}</span>
                    <span>ดู QR →</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setStageMode(true);
                      setQrModalOpen(true);
                      setShowOptionsMenu(false);
                    }}
                    disabled={live}
                    className="flex w-full items-center justify-between rounded-lg border border-line bg-paper px-3 py-2 text-left text-xs font-medium text-ink hover:border-faint disabled:opacity-40 cursor-pointer"
                  >
                    <span>โหมดเวที (QR รีโมตมือถือ)</span>
                    <span className="text-muted">เปิดใช้งาน →</span>
                  </button>
                )}

                <div className="flex w-full items-center justify-between gap-2 rounded-lg border border-line bg-paper px-3 py-2 text-xs text-ink">
                  <span>ซ่อนตัวช่วยระหว่างพูด</span>
                  <ToggleSwitch
                    checked={hideLiveCoach}
                    onChange={(val) => setHideLiveCoach(val)}
                    labelOn="เปิด"
                    labelOff="ปิด"
                    ariaLabel="ซ่อนตัวช่วยระหว่างพูด"
                  />
                </div>

                <div className={`flex w-full items-center justify-between gap-2 rounded-lg border border-line bg-paper px-3 py-2 text-xs text-ink ${live ? 'opacity-45 pointer-events-none' : ''}`}>
                  <span>สุ่มถามแทรก (-1 Token/ข้อ)</span>
                  <ToggleSwitch
                    checked={interruptEnabled}
                    onChange={() => !live && onInterruptToggle?.()}
                    labelOn="เปิด"
                    labelOff="ปิด"
                    ariaLabel="สุ่มถามแทรก"
                  />
                </div>
              </div>
            )}
          </div>
          <p className="text-sm text-muted">
            ซ้อมแล้ว <span className="font-mono tabular-nums text-ink">{doneCount}</span> จาก {total} หน้า
          </p>
        </div>
      </div>

      <div className="mt-4 flex gap-1">
        {deck.slides.map((s, i) => (
          <button
            key={s.id}
            onClick={() => !live && setIndex(i)}
            aria-label={`ไปหน้า ${i + 1}`}
            className={`h-1 flex-1 rounded-full transition ${
              i === index ? 'bg-accent' : results[i] ? 'bg-ink' : 'bg-line hover:bg-faint'
            }`}
          />
        ))}
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_360px]">
        <SlideViewer
          slides={deck.slides}
          index={index}
          onIndexChange={(nextIdx) => {
            if (isContinuous && live && nextIdx === index + 1) {
              void handleContinuousNext();
            } else if (!live) {
              setIndex(nextIdx);
            }
          }}
          locked={live && !isContinuous}
          laser={laser}
        />

        <aside className="flex flex-col rounded-xl border border-line bg-white">
          <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
            <span className="text-sm font-medium">หน้า {index + 1}</span>
            {live ? (
              <span className="flex items-center gap-2 text-xs text-accent">
                <span className="size-1.5 animate-pulse rounded-full bg-accent" />
                กำลังฟัง & บันทึกเสียง
              </span>
            ) : (
              <span className="text-xs text-faint">{result ? 'ซ้อมแล้ว' : 'ยังไม่ได้ซ้อม'}</span>
            )}
          </div>

          <div className="flex flex-1 flex-col gap-5 px-5 py-5">
            <p className="font-mono text-4xl tabular-nums tracking-tight">
              {formatTime(live ? elapsed : result?.duration)}
            </p>

            {/* คลื่นเสียงเต้นสด + เตือนเดดแอร์ ระหว่างพูด */}
            {live && !hideLiveCoach && (
              <div className="space-y-3">
                <LivePace wpm={liveWpm} fillers={countFillers(liveText).total} />
                <LiveWaveform volume={recorder.volume} isDeadAir={recorder.isDeadAir} />
              </div>
            )}

            {/* ปรับความดังไมโครโฟนของฉัน */}
            <div className="rounded-lg border border-line bg-paper/70 px-3.5 py-2.5 space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-ink">เสียงไมค์ของฉัน</span>
                <span className="font-mono text-[11px] tabular-nums text-muted">
                  {Math.round(recorder.micGain * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={2}
                step={0.05}
                value={recorder.micGain}
                onChange={(e) => recorder.setMicGain(Number(e.target.value))}
                className="w-full accent-ink cursor-pointer"
              />
            </div>

            {vision.cameraError && (
              <p className="text-xs text-accent">{vision.cameraError}</p>
            )}

            {/* กล่องแสดงข้อความที่พูด */}
            {live && hideLiveCoach ? (
              <div className="flex min-h-36 flex-1 items-center justify-center rounded-lg bg-paper px-4 py-6 text-center text-sm text-muted">
                กำลังบันทึกการพรีเซนต์ โฟกัสที่สไลด์และผู้ฟังได้เลย
              </div>
            ) : (
              <div className="min-h-36 flex-1 rounded-lg bg-paper px-4 py-3 text-[15px] leading-7">
                {live ? (
                  liveText ? (
                    <p>{liveText}</p>
                  ) : (
                    <p className="text-faint">เริ่มพูดได้เลย…</p>
                  )
                ) : result ? (
                  <p>{result.transcript || <span className="text-faint">ไม่ได้ยินเสียงพูด ลองอัดใหม่อีกครั้ง</span>}</p>
                ) : (
                  <p className="text-faint">
                    {isContinuous
                      ? 'กด “เริ่มซ้อมใหญ่” แล้วพูดต่อเนื่องไปเรื่อยๆ กดหน้าถัดไปเพื่อเปลี่ยนสไลด์'
                      : 'กด “เริ่มพูด” แล้วนำเสนอสไลด์หน้านี้ ข้อความที่พูดจะแสดงที่นี่'}
                  </p>
                )}
              </div>
            )}

            {/* แถบกดฟังเสียงย้อนหลัง (ถ้าอัดเสร็จแล้ว) */}
            {result?.audioUrl && !live && (
              <div className="rounded-lg border border-line bg-paper px-3 py-2.5">
                <div className="flex items-center justify-between text-xs text-muted mb-1.5">
                  <span>ฟังเสียงที่เพิ่งอัด</span>
                  <span className="font-mono">{formatTime(result.duration)}</span>
                </div>
                <audio controls src={result.audioUrl} className="w-full h-8" />
              </div>
            )}

            {/* สรุปสถิติหลังพูดเสร็จ + ปุ่มขอคำแนะนำ AI เฉพาะหน้า (กดเมื่อต้องการ) */}
            {result && !live && (
              <>
                <div className="grid grid-cols-2 gap-4 border-t border-line pt-5 sm:grid-cols-3">
                  <Stat label="เวลา" value={formatTime(result.duration)} />
                  <Stat label="คำ/นาที" value={result.wpm || '–'} note={p?.label} noteClass={p ? PACE_TEXT[p.tone] : ''} />
                  {result.deadAir?.count > 0 && (
                    <Stat
                      label="เดดแอร์"
                      value={`${result.deadAir.count} ครั้ง`}
                      note={`${result.deadAir.totalSeconds} วิ`}
                      noteClass="text-slow"
                    />
                  )}
                  {result.fillers?.total > 0 && (
                    <Stat
                      label="คำติดปากที่พบ"
                      value={result.fillers.total}
                      note={result.fillers.found.map((f) => `${f.label} ×${f.count}`).join(', ')}
                      noteClass="text-accent"
                    />
                  )}
                  {result.vision?.cameraUsed && (
                    <>
                      <Stat
                        label="Eye Contact"
                        value={`${result.vision.eyeContactPct}%`}
                        note={result.vision.eyeContactPct >= 70 ? 'สบตาดีมาก' : 'ควรมองกล้องเพิ่ม'}
                        noteClass={result.vision.eyeContactPct >= 70 ? 'text-ok' : 'text-slow'}
                      />
                      {result.vision.lookingDownCount > 0 && (
                        <Stat
                          label="ก้มอ่านโพย"
                          value={`${result.vision.lookingDownCount} ครั้ง`}
                          note={`${result.vision.lookingDownSec} วิ`}
                          noteClass="text-accent"
                        />
                      )}
                    </>
                  )}
                </div>

                {/* ส่วนเช็กความตรงสไลด์ & ขอคำแนะนำเฉพาะหน้า (ไม่บังคับ) */}
                {result.aiCheck ? (
                  <div className="rounded-lg border border-line bg-paper p-3.5 text-xs space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-ink">ผลตรวจหน้านี้</span>
                      <span className="font-mono font-medium text-ink">
                        {result.aiCheck.coverage || 'สรุปจาก AI'}
                      </span>
                    </div>
                    {result.aiCheck.summary && (
                      <p className="text-muted leading-relaxed">{result.aiCheck.summary}</p>
                    )}
                    {result.aiCheck.missedPoints?.length > 0 && (
                      <p className="text-accent leading-relaxed">
                        ยังไม่ได้พูด: {result.aiCheck.missedPoints.join(', ')}
                      </p>
                    )}
                    {result.aiCheck.suggestion && (
                      <p className="text-ink leading-relaxed border-t border-line/70 pt-2">
                        คำแนะนำ: {result.aiCheck.suggestion}
                      </p>
                    )}
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={handleCheckSlide}
                    disabled={aiChecking}
                    className="w-full rounded-lg border border-line bg-paper py-2 text-xs font-medium text-ink transition hover:border-faint disabled:opacity-50 cursor-pointer"
                  >
                    {aiChecking ? 'กำลังวิเคราะห์หน้านี้...' : 'ให้ AI เช็กหน้านี้ (-1 Token)'}
                  </button>
                )}

                {aiError && <p className="text-xs text-accent">{aiError}</p>}
              </>
            )}

            {!speech.supported && (
              <p className="text-sm text-accent">เบราว์เซอร์นี้ไม่รองรับการถอดเสียง แนะนำให้ใช้ Chrome หรือ Edge</p>
            )}
            {speech.error && <p className="text-sm text-accent">{speech.error}</p>}

            {live ? (
              isContinuous ? (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => stop()}
                    className="flex items-center justify-center gap-2 rounded-lg border border-line py-3 text-sm text-ink transition hover:border-faint cursor-pointer"
                  >
                    หยุด
                  </button>
                  <button
                    onClick={() => (isLast ? stop() : handleContinuousNext())}
                    className="rounded-lg bg-accent py-3 text-sm font-medium text-white transition hover:bg-accent/90 cursor-pointer"
                  >
                    {isLast ? 'จบการซ้อม' : 'หน้าถัดไป'}
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => stop()}
                  className="flex items-center justify-center gap-2 rounded-lg bg-accent py-3 text-sm font-medium text-white transition hover:bg-accent/90 cursor-pointer"
                >
                  <span className="size-2.5 rounded-[2px] bg-white" />
                  หยุดและดูผล
                </button>
              )
            ) : result ? (
              isLast ? (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <button
                    onClick={start}
                    disabled={!speech.supported}
                    className="rounded-lg border border-line py-3 text-sm transition hover:border-faint disabled:opacity-40 cursor-pointer"
                  >
                    อัดใหม่
                  </button>
                  <button
                    onClick={() => onFinish(true)}
                    className="rounded-lg bg-ink py-3 text-sm font-medium text-paper transition hover:bg-ink/85 cursor-pointer"
                  >
                    ดูสรุปผล (ฟรี)
                  </button>
                  <button
                    onClick={async () => {
                      const ok = await askConfirm({
                        key: 'token-spend',
                        title: 'ยืนยันการใช้ 1 Token',
                        message: 'ระบบจะใช้ 1 Token เพื่อสร้างชุดคำถามช่วงถาม-ตอบ (Q&A)',
                        confirmText: 'ใช้ 1 Token',
                      });
                      if (ok) onFinish(false);
                    }}
                    className="rounded-lg border border-accent bg-accent/10 py-3 text-sm font-medium text-accent transition hover:bg-accent hover:text-white cursor-pointer"
                  >
                    ไปช่วงถาม-ตอบ (-1 Token)
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={start}
                    disabled={!speech.supported}
                    className="rounded-lg border border-line py-3 text-sm transition hover:border-faint disabled:opacity-40 cursor-pointer"
                  >
                    อัดใหม่
                  </button>
                  <button
                    onClick={() => setIndex(index + 1)}
                    className="rounded-lg bg-ink py-3 text-sm font-medium text-paper transition hover:bg-ink/85 cursor-pointer"
                  >
                    หน้าถัดไป
                  </button>
                </div>
              )
            ) : (
              <button
                onClick={start}
                disabled={!speech.supported}
                className="flex items-center justify-center gap-2 rounded-lg bg-ink py-3 text-sm font-medium text-paper transition hover:bg-ink/85 disabled:opacity-40 cursor-pointer"
              >
                <MicIcon />
                {isContinuous ? 'เริ่มซ้อมใหญ่' : 'เริ่มพูด'}
              </button>
            )}
          </div>

          <div className="border-t border-line px-5 py-3.5 text-xs leading-5 text-faint">
            ไฟล์เสียงถูกบันทึกชั่วคราวในเครื่องเพื่อใช้ฟังซ้ำ ไม่มีการส่งออกนอกเบราว์เซอร์
          </div>
        </aside>
      </div>
    </div>
  );
}
