import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useGroupRtc } from '../lib/useGroupRtc';
import { useFaceLandmarker } from '../lib/useFaceLandmarker';
import {
  analyze,
  countFillers,
  countWords,
  formatTime,
  LIVE_PACE_FAST,
  LIVE_PACE_SLOW,
  pace,
  PACE_PILL,
  PACE_WARMUP_SEC,
} from '../lib/metrics';
import { uploadGroupClip } from '../lib/api';
import {
  preloadAllQuestionsSpeech,
  speakQuestion,
  stopSpeaking,
} from '../lib/speech';

function LiveWaveform({ level }) {
  const heights = [0.4, 0.7, 1, 0.8, 0.5, 0.9, 0.6, 0.85, 0.45, 0.75, 0.55, 0.95, 0.65, 0.4];
  return (
    <div className="flex h-6 items-center gap-[3px]" aria-hidden="true">
      {heights.map((factor, i) => {
        const h = Math.max(3, Math.min(24, Math.round(3 + level * 42 * factor)));
        return (
          <span
            key={i}
            className="w-[2.5px] rounded-full bg-accent transition-[height] duration-75"
            style={{ height: `${h}px` }}
          />
        );
      })}
    </div>
  );
}

function RemotePeerAudio({ stream, volume = 1 }) {
  const audioRef = useRef(null);
  useEffect(() => {
    if (audioRef.current && stream) {
      audioRef.current.srcObject = stream;
    }
  }, [stream]);
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = Math.max(0, Math.min(1, volume));
    }
  }, [volume]);
  return <audio ref={audioRef} autoPlay playsInline className="hidden" />;
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('อ่านไฟล์คลิปไม่สำเร็จ'));
    reader.readAsDataURL(blob);
  });
}

function pickRecorderMime(hasVideo) {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = hasVideo
    ? ['video/webm;codecs=vp8,opus', 'video/webm']
    : ['audio/webm;codecs=opus', 'audio/webm'];
  return candidates.find((t) => MediaRecorder.isTypeSupported(t)) || '';
}

export default function GroupQaView({
  socket,
  room,
  selfId,
  peerVolumes: externalPeerVolumes,
  onPeerVolumesChange,
  onFinishToSummary,
  onLeaveRoom,
}) {
  const questions = room.qaQuestions || [];
  const qaIdx = Math.max(0, Math.min(questions.length - 1, room.qaIndex || 0));
  const currentQ = questions[qaIdx] || null;
  const members = room.members || [];
  const memberMap = new Map(members.map((m) => [m.id, m]));
  const isHost = room.hostId === selfId;
  const me = memberMap.get(selfId);

  const claim = room.qaClaims?.[qaIdx] || null;
  const savedAnswer = room.qaAnswers?.[qaIdx] || null;
  const isMyClaim = claim?.responderId === selfId;
  const responderId = claim?.responderId || room.hostId;
  const responder = memberMap.get(responderId) || null;
  const isSelfResponder = responderId === selfId && isMyClaim;

  const {
    localStream,
    remoteStreams,
    micEnabled,
    camEnabled,
    micGain,
    setMicGain,
    toggleMic,
    toggleCam,
  } = useGroupRtc({
    socket,
    active: true,
    selfId,
    members,
  });

  const [localPeerVolumes, setLocalPeerVolumes] = useState({});
  const peerVolumes = externalPeerVolumes ?? localPeerVolumes;
  const setPeerVolumes = onPeerVolumesChange ?? setLocalPeerVolumes;
  const [audioMixerOpen, setAudioMixerOpen] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [qaPhase, setQaPhase] = useState('idle'); // 'idle' | 'asking' | 'answering'
  const [elapsedSec, setElapsedSec] = useState(0);
  const [liveTranscript, setLiveTranscript] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [qaTotalSec, setQaTotalSec] = useState(0);
  const [isReadingQuestion, setIsReadingQuestion] = useState(false);
  const [audioReady, setAudioReady] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);

  useEffect(() => {
    const base = Number(room.qaElapsedBaseMs || 0);
    const since = room.qaRunningSince ? Number(room.qaRunningSince) : null;
    const sync = () => {
      const totalMs = base + (since ? Math.max(0, Date.now() - since) : 0);
      setQaTotalSec(Math.floor(totalMs / 1000));
    };
    sync();
    if (!since) return undefined;
    const t = setInterval(sync, 500);
    return () => clearInterval(t);
  }, [room.qaElapsedBaseMs, room.qaRunningSince]);

  // Floating camera state (เหมือน FloatingCamera ของซ้อมเดี่ยว)
  const [camCollapsed, setCamCollapsed] = useState(false);
  const [camHidden, setCamHidden] = useState(false);
  const [camWidth, setCamWidth] = useState(320);
  const [floatPos, setFloatPos] = useState(() => {
    if (typeof window === 'undefined') return { x: 24, y: 90 };
    return { x: Math.max(20, window.innerWidth - 350), y: 90 };
  });
  const dragRef = useRef(null);
  const resizeRef = useRef(null);

  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const recQaIdxRef = useRef(null);
  const recStartRef = useRef(0);
  const transcriptRef = useRef('');
  const recognitionRef = useRef(null);
  const vision = useFaceLandmarker();
  const visionStatusRef = useRef(vision.currentStatus);
  visionStatusRef.current = vision.currentStatus;
  const timelineEventsRef = useRef([]);
  const lastPacePinRef = useRef(-10);
  const lastFillerRef = useRef(0);
  const lastEyePinRef = useRef(-10);
  const silenceStartRef = useRef(null);
  const inDeadAirRef = useRef(false);
  const deadAirCountRef = useRef(0);

  useEffect(() => {
    if (isSelfResponder && localStream && camEnabled && localStream.getVideoTracks().length > 0) {
      void vision.attachExternalStream(localStream);
    } else if (vision.cameraActive) {
      vision.stopCamera();
    }
  }, [isSelfResponder, localStream, camEnabled]);

  useEffect(() => {
    return () => {
      stopSpeaking();
    };
  }, []);

  // เตรียมเสียงอ่านคำถามให้พร้อมก่อนเริ่มหน้าถาม-ตอบ (เสียงฟรีเตรียมทุกข้อ, เสียง Gemini เตรียมข้อแรก)
  const qaQuestionsKey = useMemo(
    () => questions.map((q) => q?.question || '').join('||'),
    [questions],
  );
  const preparedKeyRef = useRef('');

  useEffect(() => {
    let active = true;
    if (!qaQuestionsKey) {
      preparedKeyRef.current = '';
      setAudioReady(true);
      return () => {
        active = false;
      };
    }
    const cacheKey = qaQuestionsKey;
    if (preparedKeyRef.current === cacheKey) {
      setAudioReady(true);
      return () => {
        active = false;
      };
    }

    setAudioReady(false);
    void preloadAllQuestionsSpeech(questions)
      .catch(() => {})
      .finally(() => {
        if (active) {
          preparedKeyRef.current = cacheKey;
          setAudioReady(true);
        }
      });

    return () => {
      active = false;
    };
  }, [qaQuestionsKey]);

  const discardRecorder = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
      recognitionRef.current = null;
    }
    const rec = recorderRef.current;
    if (rec) {
      rec.onstop = null;
      rec.ondataavailable = null;
      if (rec.state !== 'inactive') {
        try {
          rec.stop();
        } catch {
          // ignore
        }
      }
      recorderRef.current = null;
    }
    recQaIdxRef.current = null;
    chunksRef.current = [];
    vision.stopTracking();
    setAudioLevel(0);
    setIsRecording(false);
    setQaPhase('idle');
  }, [vision]);

  const startSpeechRecognition = useCallback(() => {
    if (recognitionRef.current) return;
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) return;
    try {
      const sr = new SpeechRec();
      sr.lang = 'th-TH';
      sr.continuous = true;
      sr.interimResults = true;
      let finalized = '';
      sr.onresult = (ev) => {
        let interim = '';
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const t = ev.results[i][0]?.transcript || '';
          if (ev.results[i].isFinal) finalized += `${t} `;
          else interim += t;
        }
        const full = `${finalized}${interim}`.trim();
        transcriptRef.current = full;
        setLiveTranscript(full);
      };
      sr.onerror = () => {};
      sr.start();
      recognitionRef.current = sr;
    } catch {
      // ignore SpeechRecognition failure
    }
  }, []);

  const beginRecordingStream = useCallback(async () => {
    if (!localStream || recorderRef.current) return false;
    const hasVideo = localStream.getVideoTracks().length > 0;
    const mimeType = pickRecorderMime(hasVideo);
    try {
      const rec = mimeType
        ? new MediaRecorder(localStream, {
            mimeType,
            videoBitsPerSecond: hasVideo ? 450_000 : undefined,
          })
        : new MediaRecorder(localStream);

      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.start(1000);

      recorderRef.current = rec;
      recQaIdxRef.current = qaIdx;
      recStartRef.current = Date.now();
      transcriptRef.current = '';
      timelineEventsRef.current = [];
      lastPacePinRef.current = -10;
      lastFillerRef.current = 0;
      lastEyePinRef.current = -10;
      silenceStartRef.current = null;
      inDeadAirRef.current = false;
      deadAirCountRef.current = 0;
      setElapsedSec(0);
      setLiveTranscript('');
      setIsRecording(true);
      setQaPhase('answering');
      vision.startTracking();
      startSpeechRecognition();
      return true;
    } catch {
      return false;
    }
  }, [localStream, qaIdx, startSpeechRecognition, vision]);

  const discardRecorderRef = useRef(discardRecorder);
  discardRecorderRef.current = discardRecorder;
  const lastAutoSpokenIdxRef = useRef(-1);

  // อ่านคำถามออกเสียง Edge-TTS อัตโนมัติเมื่อขึ้นข้อใหม่ และแจ้งเซิร์ฟเวอร์เริ่มนับเวลาเมื่ออ่านจบ
  useEffect(() => {
    if (!audioReady) return () => {};
    let active = true;
    let finished = false;
    if (currentQ?.question && !savedAnswer && lastAutoSpokenIdxRef.current !== qaIdx) {
      lastAutoSpokenIdxRef.current = qaIdx;
      setIsReadingQuestion(true);
      void speakQuestion(currentQ.question).finally(() => {
        finished = true;
        if (!active) return;
        setIsReadingQuestion(false);
        if (isHost) {
          socket?.emit('group:qa_timer_resume');
        }
      });
    } else if (!currentQ?.question || savedAnswer) {
      finished = true;
      setIsReadingQuestion(false);
    } else {
      finished = true;
    }
    return () => {
      active = false;
      if (!finished) {
        lastAutoSpokenIdxRef.current = -1;
      }
      stopSpeaking();
      discardRecorderRef.current();
    };
  }, [audioReady, qaIdx, currentQ?.question, Boolean(savedAnswer), isHost, socket]);

  // ถ้าเพื่อนกดรับตอบข้อนี้ให้หยุดอัดฝั่งเราทันที
  useEffect(() => {
    if (claim && !isMyClaim && (isRecording || recorderRef.current)) {
      discardRecorderRef.current();
    }
  }, [claim?.responderId, isMyClaim, isRecording]);

  useEffect(() => {
    const onMove = (e) => {
      if (dragRef.current) {
        const dx = e.clientX - dragRef.current.startX;
        const dy = e.clientY - dragRef.current.startY;
        const maxX = Math.max(10, window.innerWidth - camWidth - 10);
        const maxY = Math.max(10, window.innerHeight - 80);
        setFloatPos({
          x: Math.max(10, Math.min(maxX, dragRef.current.origX + dx)),
          y: Math.max(10, Math.min(maxY, dragRef.current.origY + dy)),
        });
      }
      if (resizeRef.current) {
        const dx = e.clientX - resizeRef.current.startX;
        setCamWidth(Math.max(220, Math.min(520, resizeRef.current.origW + dx)));
      }
    };
    const onUp = () => {
      dragRef.current = null;
      resizeRef.current = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [camWidth]);

  useEffect(() => {
    if (!isRecording) return undefined;
    const timer = setInterval(() => {
      const sec = Math.max(0, Math.round((Date.now() - recStartRef.current) / 1000));
      setElapsedSec(sec);
      const txt = transcriptRef.current.trim();
      const words = countWords(txt);
      const wpm = sec > 3 ? Math.round(words / (sec / 60)) : 0;
      const fillersNow = countFillers(txt).total;

      if (sec >= PACE_WARMUP_SEC && sec - lastPacePinRef.current >= 8) {
        if (wpm >= LIVE_PACE_FAST) {
          lastPacePinRef.current = sec;
          timelineEventsRef.current.push({
            t: sec,
            type: 'pace_fast',
            label: `พูดเร็วไป (${wpm} คำ/นาที)`,
          });
        } else if (wpm > 0 && wpm <= LIVE_PACE_SLOW) {
          lastPacePinRef.current = sec;
          timelineEventsRef.current.push({
            t: sec,
            type: 'pace_slow',
            label: `พูดช้าไป (${wpm} คำ/นาที)`,
          });
        }
      }
      if (fillersNow > lastFillerRef.current) {
        lastFillerRef.current = fillersNow;
        timelineEventsRef.current.push({
          t: sec,
          type: 'filler',
          label: `พบคำติดปาก (รวม ${fillersNow} ครั้ง)`,
        });
      }
      const eyeStatus = visionStatusRef.current;
      if (
        (eyeStatus === 'looking_down' || eyeStatus === 'looking_away') &&
        sec - lastEyePinRef.current >= 5
      ) {
        lastEyePinRef.current = sec;
        timelineEventsRef.current.push({
          t: sec,
          type: 'eye',
          label: eyeStatus === 'looking_down' ? 'ก้มอ่านโพย' : 'สายตาหลุดกล้อง',
        });
      }
    }, 500);

    let rafId = 0;
    let audioCtx = null;
    if (localStream && localStream.getAudioTracks().length > 0) {
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        audioCtx = new AudioCtx();
        const src = audioCtx.createMediaStreamSource(localStream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        src.connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);
        const tick = () => {
          analyser.getByteFrequencyData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i++) sum += data[i];
          const avg = sum / (data.length * 255);
          setAudioLevel(avg);
          const now = Date.now();
          if (avg < 0.018) {
            if (!silenceStartRef.current) silenceStartRef.current = now;
            if (now - silenceStartRef.current >= 2500 && !inDeadAirRef.current) {
              inDeadAirRef.current = true;
              deadAirCountRef.current += 1;
              const sec = Math.max(0, Math.round((now - recStartRef.current) / 1000));
              timelineEventsRef.current.push({
                t: sec,
                type: 'deadair',
                label: 'เงียบค้าง 2.5+ วิ',
              });
            }
          } else {
            silenceStartRef.current = null;
            inDeadAirRef.current = false;
          }
          rafId = requestAnimationFrame(tick);
        };
        tick();
      } catch {
        // ignore
      }
    }
    return () => {
      clearInterval(timer);
      if (rafId) cancelAnimationFrame(rafId);
      if (audioCtx) audioCtx.close().catch(() => {});
    };
  }, [isRecording, localStream]);

  const stopAndSaveAnswer = useCallback(async () => {
    const rec = recorderRef.current;
    const idx = recQaIdxRef.current;
    if (!rec || idx === null) return;

    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
      recognitionRef.current = null;
    }

    const durationSec = Math.max(1, Math.round((Date.now() - recStartRef.current) / 1000));
    const spokenText = transcriptRef.current.trim();
    const mimeType = rec.mimeType || 'video/webm';

    const blob = await new Promise((resolve) => {
      if (rec.state === 'inactive') {
        resolve(new Blob(chunksRef.current, { type: mimeType }));
        return;
      }
      rec.onstop = () => resolve(new Blob(chunksRef.current, { type: mimeType }));
      try {
        rec.stop();
      } catch {
        resolve(new Blob(chunksRef.current, { type: mimeType }));
      }
    });

    recorderRef.current = null;
    recQaIdxRef.current = null;
    chunksRef.current = [];
    setAudioLevel(0);
    setIsRecording(false);
    setQaPhase('idle');
    const visionStats = vision.stopTracking();

    const analysis = {
      ...analyze(spokenText, durationSec),
      deadAir: { count: deadAirCountRef.current },
      vision: camEnabled
        ? {
            cameraUsed: true,
            eyeContactPct: visionStats.eyeContactPct,
            lookingDownCount: visionStats.lookingDownCount,
            lookingDownSec: visionStats.lookingDownSec,
          }
        : { cameraUsed: false },
      timelineEvents: [...timelineEventsRef.current],
    };
    setSaving(true);
    try {
      socket?.emit('group:qa_save_answer', {
        index: idx,
        transcript: spokenText,
        duration: durationSec,
        wpm: analysis.wpm,
        words: analysis.words,
        fillers: analysis.fillers,
      });
      if (blob.size >= 256) {
        const mediaBase64 = await blobToBase64(blob);
        await uploadGroupClip(room.code, {
          slideIndex: 1000 + idx,
          memberId: selfId,
          memberName: me?.name || 'สมาชิก',
          mimeType,
          mediaBase64,
          analysis,
        });
      }
    } catch (err) {
      setError(err?.message || 'บันทึกคำตอบ Q&A ไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  }, [socket, room.code, selfId, me?.name, camEnabled]);

  const startRecordingAnswer = async () => {
    if (!isMyClaim || !localStream || recorderRef.current) return;
    setIsReadingQuestion(false);
    stopSpeaking();
    setError('');
    const ok = await beginRecordingStream();
    if (!ok) {
      setError('ไม่สามารถเริ่มอัดคำตอบได้');
    }
  };

  useEffect(() => {
    if (!isRecording) {
      setElapsedSec(0);
      setLiveTranscript('');
    }
  }, [qaIdx, isRecording]);

  const handleClaim = () => {
    setIsReadingQuestion(false);
    stopSpeaking();
    setError('');
    socket?.emit('group:qa_claim', { index: qaIdx }, (res) => {
      if (!res?.ok) setError(res?.message || 'กดรับตอบข้อนี้ไม่สำเร็จ');
    });
  };

  const handleRelease = () => {
    if (isRecording || recorderRef.current) {
      discardRecorder();
    }
    socket?.emit('group:qa_release', { index: qaIdx });
  };

  const handleNav = async (nextIdx) => {
    if (isRecording) await stopAndSaveAnswer();
    socket?.emit('group:qa_nav', { index: nextIdx });
  };

  const handleFinish = async () => {
    if (isRecording) await stopAndSaveAnswer();
    onFinishToSummary();
  };

  const speakerStream = isSelfResponder ? localStream : remoteStreams[responderId] || null;
  const speakerCamOn = isSelfResponder ? camEnabled : responder?.camEnabled !== false;
  const speakerMicOn = isSelfResponder ? micEnabled : responder?.micEnabled !== false;
  const hasSpeakerVideo = Boolean(
    speakerCamOn && speakerStream && speakerStream.getVideoTracks().length > 0,
  );

  const speakerVideoRef = useRef(null);
  const setSpeakerVideoEl = useCallback(
    (node) => {
      speakerVideoRef.current = node;
      if (isSelfResponder) {
        vision.setVideoRef(node);
      }
    },
    [isSelfResponder, vision.setVideoRef],
  );
  useEffect(() => {
    const el = speakerVideoRef.current;
    if (el && !camCollapsed && !camHidden) {
      const target = hasSpeakerVideo ? speakerStream : null;
      if (el.srcObject !== target) {
        el.srcObject = target;
      }
      if (target) {
        el.play().catch(() => {});
      }
    }
  }, [hasSpeakerVideo, speakerStream, camCollapsed, camHidden, isSelfResponder]);

  const liveWords = useMemo(() => countWords(liveTranscript), [liveTranscript]);
  const liveWpm = elapsedSec > 3 ? Math.round(liveWords / (elapsedSec / 60)) : 0;
  const liveFillers = useMemo(() => countFillers(liveTranscript).total, [liveTranscript]);
  const livePace = elapsedSec >= PACE_WARMUP_SEC ? pace(liveWpm) : null;
  const isLast = qaIdx >= questions.length - 1;
  const canNav = isHost || isMyClaim;

  if (!audioReady && questions.length > 0) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-12">
        {Object.entries(remoteStreams).map(([peerId, stream]) =>
          peerId !== selfId ? (
            <RemotePeerAudio key={peerId} stream={stream} volume={peerVolumes[peerId] ?? 1} />
          ) : null,
        )}
        <div className="rounded-2xl border border-line bg-white p-10 text-center">
          <div className="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-ink border-t-transparent" />
          <p className="mt-4 text-sm font-medium text-ink">
            กำลังเตรียมเสียงอ่านคำถามจาก AI ให้พร้อม...
          </p>
          <p className="mt-1 text-xs text-muted">
            รอสักครู่ เมื่อเสียงพร้อมแล้วจึงจะเริ่มนับเวลาและอ่านโจทย์ข้อแรก
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      {Object.entries(remoteStreams).map(([peerId, stream]) =>
        peerId !== selfId ? (
          <RemotePeerAudio key={peerId} stream={stream} volume={peerVolumes[peerId] ?? 1} />
        ) : null,
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="rounded-md border border-line bg-white px-2.5 py-1 font-mono text-xs font-semibold text-ink">
          ห้อง {room.code}
        </span>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setAudioMixerOpen((v) => !v)}
            className={`rounded-xl border px-3 py-2 text-xs font-medium transition cursor-pointer ${
              audioMixerOpen
                ? 'border-ink bg-ink text-paper'
                : 'border-line bg-white text-ink hover:border-faint'
            }`}
          >
            ปรับเสียงไมค์
          </button>
          {(isHost || isMyClaim) && (
            <button
              type="button"
              onClick={handleFinish}
              disabled={saving}
              className="rounded-xl border border-line bg-white px-3 py-2 text-xs font-medium text-ink transition hover:border-faint disabled:opacity-50 cursor-pointer"
            >
              ข้ามไปหน้าสรุปผล
            </button>
          )}
          <button
            type="button"
            onClick={onLeaveRoom}
            className="rounded-xl border border-line bg-white px-3 py-2 text-xs text-muted transition hover:text-ink cursor-pointer"
          >
            ออกจากห้อง
          </button>
        </div>
      </div>

      {audioMixerOpen && (
        <div className="mt-4 rounded-xl border border-line bg-white p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-ink">ตั้งค่าระดับเสียงไมโครโฟน</p>
            <button
              type="button"
              onClick={() => setAudioMixerOpen(false)}
              className="text-xs text-muted hover:text-ink cursor-pointer"
            >
              ปิด
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-line bg-paper/70 px-3 py-2 space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-ink">ไมค์ของฉัน</span>
                <span className="font-mono text-[11px] text-muted">{Math.round(micGain * 100)}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={2}
                step={0.05}
                value={micGain}
                onChange={(e) => setMicGain(Number(e.target.value))}
                className="w-full accent-ink cursor-pointer"
              />
            </div>
            {members
              .filter((m) => m.id !== selfId)
              .map((m) => {
                const vol = peerVolumes[m.id] ?? 1;
                return (
                  <div key={m.id} className="rounded-lg border border-line bg-paper/70 px-3 py-2 space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-ink">เสียงของ {m.name}</span>
                      <span className="font-mono text-[11px] text-muted">{Math.round(vol * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={vol}
                      onChange={(e) =>
                        setPeerVolumes((prev) => ({ ...prev, [m.id]: Number(e.target.value) }))
                      }
                      className="w-full accent-accent cursor-pointer"
                    />
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* หัวข้อเหมือน QaStep */}
      <div className="mt-8 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">ช่วงถาม-ตอบ</h1>
          <p className="mt-1.5 text-sm text-muted">
            ลองตอบคำถามจากสิ่งที่กลุ่มของคุณเพิ่งนำเสนอ เพื่อเช็กความเข้าใจก่อนขึ้นเวทีจริง
          </p>
        </div>
        {Number(room.settings?.qaMins || 0) > 0 && (() => {
          const remaining = room.settings.qaMins * 60 - qaTotalSec;
          const overtime = remaining < 0;
          return (
            <span
              className={`rounded-full border px-3 py-1 font-mono text-xs tabular-nums ${
                overtime
                  ? 'border-accent bg-accent/10 text-accent font-medium'
                  : remaining <= 60
                    ? 'border-slow bg-slow/10 text-slow font-medium'
                    : 'border-line bg-white text-ink'
              }`}
            >
              {overtime
                ? `เกินเวลา +${formatTime(Math.abs(remaining))}`
                : `เหลือเวลา ${formatTime(remaining)}`}
            </span>
          );
        })()}
      </div>

      {/* แถบ Progress ข้อคำถาม */}
      <div className="mt-5 flex gap-1">
        {questions.map((_, i) => {
          const done = Boolean(room.qaAnswers?.[i]);
          return (
            <button
              key={i}
              type="button"
              disabled={!canNav}
              onClick={() => handleNav(i)}
              className={`h-1 flex-1 rounded-full transition ${
                i === qaIdx ? 'bg-accent' : done ? 'bg-ink' : 'bg-line'
              } ${canNav ? 'cursor-pointer' : 'cursor-default'}`}
            />
          );
        })}
      </div>

      {error && (
        <p className="mt-4 rounded-xl bg-accent/10 px-4 py-2.5 text-xs text-accent">{error}</p>
      )}

      {/* การ์ดคำถาม */}
      {currentQ && (
        <div className="mt-6 rounded-xl border border-line bg-white p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-accent">
                คำถามที่ {qaIdx + 1} จาก {questions.length}
              </span>
              {isReadingQuestion && (
                <span className="rounded-full bg-paper border border-line px-2 py-0.5 text-[11px] text-muted">
                  กำลังอ่านคำถาม...
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => speakQuestion(currentQ.question)}
              className="rounded-md border border-line bg-paper px-2.5 py-1 text-xs font-medium text-ink hover:border-faint cursor-pointer"
            >
              ฟังเสียงคำถาม
            </button>
          </div>

          <p className="text-lg font-medium leading-relaxed text-ink">{currentQ.question}</p>

          {/* สถานะคนอาสาตอบ + ปุ่มกดอาสา */}
          <div className="rounded-xl border border-line bg-paper/70 p-4 space-y-3">
            {!claim ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold text-ink">ยังไม่มีผู้ตอบคำถามข้อนี้</p>
                  <p className="mt-0.5 text-[11px] text-muted">
                    ใครพร้อมตอบข้อนี้ กดปุ่ม &quot;ฉันตอบข้อนี้&quot; ได้เลย (ใครกดก่อนได้สิทธิ์ตอบก่อน)
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleClaim}
                  className="rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-white transition hover:bg-accent/90 cursor-pointer"
                >
                  ฉันตอบข้อนี้
                </button>
              </div>
            ) : isMyClaim ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="rounded-full bg-accent px-2.5 py-0.5 text-[11px] font-medium text-white">
                    คุณรับหน้าที่ตอบข้อนี้
                  </span>
                  {isRecording ? (
                    <span className="flex items-center gap-1.5 text-xs font-medium text-accent">
                      <span className="size-1.5 rounded-full bg-accent animate-pulse" />
                      กำลังฟัง &amp; บันทึกเสียง
                    </span>
                  ) : savedAnswer ? (
                    <span className="text-xs text-muted">บันทึกคลิปแล้ว</span>
                  ) : (
                    <button
                      type="button"
                      onClick={handleRelease}
                      className="text-xs text-muted hover:text-ink underline-offset-2 hover:underline cursor-pointer"
                    >
                      สละสิทธิ์ให้เพื่อนตอบ
                    </button>
                  )}
                </div>

                {(isRecording || savedAnswer) && (
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-3xl font-semibold tracking-tight tabular-nums text-ink">
                      {formatTime(isRecording ? elapsedSec : savedAnswer?.duration || 0)}
                    </span>
                    {isRecording && <LiveWaveform level={audioLevel} />}
                  </div>
                )}

                {isRecording && (
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span
                      className={`rounded-full px-2.5 py-0.5 font-medium ${
                        livePace ? PACE_PILL[livePace.tone] : 'bg-white text-muted border border-line'
                      }`}
                    >
                      {elapsedSec < PACE_WARMUP_SEC
                        ? 'กำลังจับจังหวะ...'
                        : livePace
                          ? `${livePace.label} · ${liveWpm} คำ/นาที`
                          : 'กำลังฟัง...'}
                    </span>
                    {liveFillers > 0 && (
                      <span className="rounded-full bg-accent/10 px-2.5 py-0.5 font-medium text-accent">
                        คำติดปาก {liveFillers}
                      </span>
                    )}
                  </div>
                )}

                <div className="min-h-28 rounded-lg border border-line bg-white px-4 py-3 text-sm leading-relaxed text-ink">
                  {isRecording ? (
                    liveTranscript || (
                      <span className="text-faint">กำลังฟังเสียงพูดของคุณ...</span>
                    )
                  ) : savedAnswer?.transcript ? (
                    <p>{savedAnswer.transcript}</p>
                  ) : (
                    <span className="text-faint">กด &quot;เริ่มอัดคำตอบ&quot; เพื่อพูดตอบข้อนี้</span>
                  )}
                </div>

                {!isRecording && savedAnswer && (
                  <div className="grid grid-cols-2 gap-3 border-t border-line pt-3 text-xs">
                    <div>
                      <p className="text-muted">ความเร็ว</p>
                      <p className="mt-0.5 font-semibold text-ink">
                        {savedAnswer.wpm || 0} คำ/นาที
                      </p>
                    </div>
                    <div>
                      <p className="text-muted">เวลาพูด</p>
                      <p className="mt-0.5 font-semibold text-ink font-mono">
                        {formatTime(savedAnswer.duration || 0)}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted">จำนวนคำ</p>
                      <p className="mt-0.5 font-semibold text-ink">{savedAnswer.words || 0} คำ</p>
                    </div>
                    <div>
                      <p className="text-muted">คำติดปาก</p>
                      <p className="mt-0.5 font-semibold text-ink">
                        {savedAnswer.fillers?.total || 0} ครั้ง
                      </p>
                    </div>
                  </div>
                )}

                {isRecording ? (
                  <button
                    type="button"
                    onClick={() => void stopAndSaveAnswer()}
                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent py-3 text-sm font-semibold text-white transition hover:bg-accent/90 cursor-pointer"
                  >
                    <span className="size-2.5 rounded-[2px] bg-white" />
                    หยุดอัดและบันทึกคำตอบ
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={saving || !localStream}
                    onClick={startRecordingAnswer}
                    className="w-full rounded-lg bg-ink py-3 text-sm font-semibold text-paper transition hover:bg-ink/90 disabled:opacity-40 cursor-pointer"
                  >
                    {saving
                      ? 'กำลังบันทึกคำตอบ...'
                      : savedAnswer
                        ? 'อัดคำตอบข้อนี้ใหม่'
                        : 'เริ่มอัดคำตอบ'}
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-ink">
                    ผู้รับหน้าที่ตอบ: {claim.responderName}
                  </span>
                  {savedAnswer ? (
                    <span className="rounded-full bg-ok/10 px-2.5 py-0.5 text-[11px] font-medium text-ok">
                      บันทึกคำตอบแล้ว
                    </span>
                  ) : (
                    <span className="rounded-full bg-white border border-line px-2.5 py-0.5 text-[11px] text-muted">
                      กำลังรอ / กำลังตอบ...
                    </span>
                  )}
                </div>
                {savedAnswer?.transcript && (
                  <p className="rounded-lg border border-line bg-white px-3.5 py-2.5 text-xs text-ink">
                    &quot;{savedAnswer.transcript}&quot;
                  </p>
                )}
              </div>
            )}
          </div>

          {/* ปุ่มเปลี่ยนข้อ / จบช่วงถาม-ตอบ */}
          {canNav && (
            <div className="flex items-center justify-between border-t border-line pt-4">
              <button
                type="button"
                disabled={qaIdx === 0 || isRecording || saving}
                onClick={() => void handleNav(qaIdx - 1)}
                className="rounded-lg border border-line px-3.5 py-2 text-xs font-medium text-ink transition hover:border-faint disabled:opacity-40 cursor-pointer"
              >
                ← ข้อก่อนหน้า
              </button>
              {!isLast ? (
                <button
                  type="button"
                  disabled={isRecording || saving}
                  onClick={() => void handleNav(qaIdx + 1)}
                  className="rounded-lg bg-ink px-4 py-2 text-xs font-semibold text-paper transition hover:opacity-90 disabled:opacity-40 cursor-pointer"
                >
                  ข้อถัดไป →
                </button>
              ) : (
                <button
                  type="button"
                  disabled={isRecording || saving}
                  onClick={() => void handleFinish()}
                  className="rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-white transition hover:bg-accent/90 disabled:opacity-40 cursor-pointer"
                >
                  จบช่วงถาม-ตอบและดูสรุปผล
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* หน้าต่างกล้องลอยของผู้ตอบข้อนี้ (ดีไซน์เดียวกับ FloatingCamera) */}
      {camHidden ? (
        <button
          type="button"
          onClick={() => setCamHidden(false)}
          className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full border border-line bg-white px-4 py-2 text-xs font-medium text-ink shadow-lg hover:border-faint cursor-pointer"
        >
          แสดงหน้าต่างกล้อง ({responder?.name || 'ผู้ตอบ'})
        </button>
      ) : (
        <div
          style={{
            left: `${floatPos.x}px`,
            top: `${floatPos.y}px`,
            width: `${camCollapsed ? Math.min(camWidth, 260) : camWidth}px`,
          }}
          className="fixed z-40 overflow-hidden rounded-xl border border-line bg-white shadow-xl transition-shadow"
        >
          <div
            onPointerDown={(e) => {
              if (e.target.closest('button')) return;
              dragRef.current = {
                startX: e.clientX,
                startY: e.clientY,
                origX: floatPos.x,
                origY: floatPos.y,
              };
            }}
            className="flex items-center justify-between border-b border-line bg-paper px-3 py-2 cursor-move select-none"
          >
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-muted text-xs shrink-0">⋮⋮</span>
              <span className="truncate text-xs font-medium text-ink">
                กล้องลอย · {responder?.name || 'ผู้ตอบ'}
                {isSelfResponder ? ' (คุณ)' : ''}
              </span>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              {!camCollapsed && (
                <div className="flex items-center rounded-md border border-line/80 bg-white p-0.5 text-[10px] font-mono text-muted">
                  {[
                    { label: 'S', w: 240, active: camWidth <= 260 },
                    { label: 'M', w: 320, active: camWidth > 260 && camWidth <= 360 },
                    { label: 'L', w: 440, active: camWidth > 360 },
                  ].map((sz) => (
                    <button
                      key={sz.label}
                      type="button"
                      onClick={() => setCamWidth(sz.w)}
                      className={`px-1.5 py-0.5 rounded transition cursor-pointer ${
                        sz.active ? 'bg-ink text-paper font-semibold' : 'hover:text-ink'
                      }`}
                    >
                      {sz.label}
                    </button>
                  ))}
                </div>
              )}
              <button
                type="button"
                onClick={() => setCamCollapsed((v) => !v)}
                className="flex size-5 items-center justify-center rounded text-muted hover:bg-line/60 hover:text-ink cursor-pointer text-xs"
              >
                {camCollapsed ? '▢' : '–'}
              </button>
              <button
                type="button"
                onClick={() => setCamHidden(true)}
                className="flex size-5 items-center justify-center rounded text-muted hover:bg-line/60 hover:text-accent cursor-pointer text-xs"
              >
                ✕
              </button>
            </div>
          </div>

          {!camCollapsed && (
            <div className="relative p-3 space-y-2.5">
              <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-black">
                {hasSpeakerVideo ? (
                  <video
                    ref={setSpeakerVideoEl}
                    autoPlay
                    playsInline
                    muted
                    className={`h-full w-full object-cover ${isSelfResponder ? '-scale-x-100' : ''}`}
                  />
                ) : (
                  <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 text-white/75">
                    <div className="flex size-10 items-center justify-center rounded-full bg-white/10 text-sm font-semibold">
                      {(responder?.name || '?').slice(0, 1).toUpperCase()}
                    </div>
                    <span className="text-[11px]">
                      {speakerCamOn ? 'กำลังเชื่อมต่อกล้อง...' : 'ปิดกล้องอยู่'}
                    </span>
                  </div>
                )}
              </div>

              {isSelfResponder && vision.cameraActive && (
                <div className="space-y-1">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-muted">Eye Contact (การสบตา)</span>
                    <span className="font-mono font-medium text-ink">{vision.eyeContactPct}%</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-line">
                    <div
                      className={`h-full transition-all duration-200 ${
                        vision.eyeContactPct >= 70
                          ? 'bg-ok'
                          : vision.eyeContactPct >= 45
                            ? 'bg-slow'
                            : 'bg-accent'
                      }`}
                      style={{ width: `${vision.eyeContactPct}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-[10px] text-faint font-mono">
                    <span>ก้ม/เงย: {vision.poseAngles.pitch}°</span>
                    <span>หันซ้าย/ขวา: {vision.poseAngles.yaw}°</span>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-1.5 pr-3">
                <button
                  type="button"
                  onClick={toggleMic}
                  className={`rounded-lg border py-1.5 text-[11px] font-medium transition cursor-pointer ${
                    micEnabled
                      ? 'border-line bg-paper text-ink hover:border-faint'
                      : 'border-accent bg-accent text-white'
                  }`}
                >
                  {micEnabled ? 'ปิดไมค์' : 'เปิดไมค์'}
                </button>
                <button
                  type="button"
                  onClick={toggleCam}
                  className={`rounded-lg border py-1.5 text-[11px] font-medium transition cursor-pointer ${
                    camEnabled
                      ? 'border-line bg-paper text-ink hover:border-faint'
                      : 'border-accent bg-accent text-white'
                  }`}
                >
                  {camEnabled ? 'ปิดกล้อง' : 'เปิดกล้อง'}
                </button>
              </div>

              <div
                onPointerDown={(e) => {
                  e.stopPropagation();
                  resizeRef.current = { startX: e.clientX, origW: camWidth };
                }}
                className="absolute bottom-1 right-1 flex size-4 items-end justify-end p-0.5 cursor-nwse-resize text-faint hover:text-ink transition"
              >
                <svg viewBox="0 0 10 10" className="size-2.5" fill="currentColor">
                  <path d="M9 1v8H1l8-8zm-4 8h4V5l-4 4z" />
                </svg>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
