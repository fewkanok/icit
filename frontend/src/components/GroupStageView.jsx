import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import SlideViewer from './SlideViewer';
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
import {
  checkSlideWithAi,
  evaluateQaAnswer,
  fetchGroupClips,
  generateInterruptQuestion,
  generateQaQuestions,
  uploadGroupClip,
} from '../lib/api';
import {
  preloadAllQuestionsSpeech,
  speakQuestion,
  stopSpeaking,
} from '../lib/speech';
import { askConfirm } from './ConfirmModal';

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

function LivePace({ wpm, fillers, elapsed }) {
  const warming = elapsed < PACE_WARMUP_SEC;
  const p = warming ? null : pace(wpm);
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span
        className={`rounded-full px-2.5 py-0.5 font-medium ${
          p ? PACE_PILL[p.tone] : 'bg-paper text-muted border border-line'
        }`}
      >
        {warming ? 'กำลังจับจังหวะ...' : p ? `${p.label} · ${wpm} คำ/นาที` : 'พร้อมวัดความเร็ว'}
      </span>
      {fillers > 0 && (
        <span className="rounded-full bg-accent/10 px-2.5 py-0.5 font-medium text-accent">
          คำติดปาก {fillers}
        </span>
      )}
    </div>
  );
}

function LiveWaveform({ level }) {
  const bars = 14;
  return (
    <div className="flex h-6 items-center gap-1" aria-hidden="true">
      {Array.from({ length: bars }).map((_, i) => {
        const factor = Math.sin((i / (bars - 1)) * Math.PI);
        const h = Math.max(4, Math.round(4 + level * 20 * (0.45 + factor * 0.55)));
        return (
          <span
            key={i}
            className="w-1 rounded-full bg-accent transition-all duration-75"
            style={{ height: `${h}px` }}
          />
        );
      })}
    </div>
  );
}

export default function GroupStageView({
  socket,
  room,
  selfId,
  peerVolumes: externalPeerVolumes,
  onPeerVolumesChange,
  onChangeSlide,
  onFinishRehearsal,
  onStopRehearsal,
  onLeaveRoom,
}) {
  const slides = room.slides || [];
  const assignments = room.assignments || {};
  const members = room.members || [];
  const memberMap = new Map(members.map((m) => [m.id, m]));
  const isHost = room.hostId === selfId;
  const me = memberMap.get(selfId);

  const curIdx = Math.max(0, Math.min(slides.length - 1, room.currentSlideIndex || 0));
  const currentOwnerId = assignments[curIdx];
  const currentOwner = currentOwnerId ? memberMap.get(currentOwnerId) : null;
  const isMyTurn = currentOwnerId === selfId;
  const canControlSlide = isHost || isMyTurn || Boolean(room.settings?.allowAnySlideControl);
  const isLastSlide = curIdx >= slides.length - 1;
  const canFinish = isHost || (isLastSlide && isMyTurn);

  const speakerId = currentOwnerId || room.hostId;
  const speaker = memberMap.get(speakerId) || null;
  const isSelfSpeaker = speakerId === selfId;

  const nextOwnerId = curIdx + 1 < slides.length ? assignments[curIdx + 1] : null;
  const nextOwner = nextOwnerId ? memberMap.get(nextOwnerId) : null;
  const isHandoffNext = Boolean(nextOwner && nextOwner.id !== currentOwnerId);

  const {
    localStream,
    remoteStreams,
    micEnabled,
    camEnabled,
    micGain,
    setMicGain,
    mediaError,
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
  const [qaLoading, setQaLoading] = useState(false);
  const [qaError, setQaError] = useState('');
  const [stageElapsedSec, setStageElapsedSec] = useState(0);
  const [interruptLoading, setInterruptLoading] = useState(false);
  const [intAnswering, setIntAnswering] = useState(false);
  const [intAnswerText, setIntAnswerText] = useState('');
  const [intEvaluating, setIntEvaluating] = useState(false);
  const [intEvalResult, setIntEvalResult] = useState(null);
  const pendingNextSlideRef = useRef(null);
  const intRecognitionRef = useRef(null);
  const intTextRef = useRef('');

  useEffect(() => {
    const startedAt = room.stageStartedAt;
    if (!startedAt) return undefined;
    const sync = () => {
      setStageElapsedSec(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    };
    sync();
    const t = setInterval(sync, 500);
    return () => clearInterval(t);
  }, [room.stageStartedAt]);

  const [isRecording, setIsRecording] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);
  const [uploadingCount, setUploadingCount] = useState(0);
  const [liveTranscript, setLiveTranscript] = useState('');
  const [slideResults, setSlideResults] = useState({});
  const [camCollapsed, setCamCollapsed] = useState(false);
  const [camHidden, setCamHidden] = useState(false);
  const [camWidth, setCamWidth] = useState(268);
  const [floatPos, setFloatPos] = useState(() => {
    if (typeof window === 'undefined') return { x: 24, y: 90 };
    return {
      x: Math.max(16, window.innerWidth - 296),
      y: Math.max(90, window.innerHeight - 250),
    };
  });

  const vision = useFaceLandmarker();
  const [isDeadAir, setIsDeadAir] = useState(false);
  const [aiChecking, setAiChecking] = useState(false);
  const [aiCheckError, setAiCheckError] = useState('');
  const [aiCheckMap, setAiCheckMap] = useState({});

  const dragRef = useRef(null);
  const resizeRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const recSlideRef = useRef(null);
  const recStartRef = useRef(0);
  const transcriptRef = useRef('');
  const recognitionRef = useRef(null);
  const stoppingPromiseRef = useRef(null);
  const pendingQaQuestionsRef = useRef(null);
  const timelineEventsRef = useRef([]);
  const lastPacePinRef = useRef(-10);
  const lastFillerRef = useRef(0);
  const lastEyePinRef = useRef(-10);
  const silenceStartRef = useRef(null);
  const inDeadAirRef = useRef(false);
  const deadAirCountRef = useRef(0);

  // เชื่อม FaceLandmarker กับ WebRTC localStream เมื่อเป็นคิวของเราและเปิดกล้องอยู่
  useEffect(() => {
    if (isSelfSpeaker && localStream && camEnabled && localStream.getVideoTracks().length > 0) {
      void vision.attachExternalStream(localStream);
    } else if (vision.cameraActive) {
      vision.stopCamera();
    }
  }, [isSelfSpeaker, localStream, camEnabled]);

  // จับเวลาและระดับเสียงระหว่างอัด
  useEffect(() => {
    if (!isRecording) {
      setAudioLevel(0);
      return;
    }
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

      if (
        (vision.currentStatus === 'looking_down' || vision.currentStatus === 'looking_away') &&
        sec - lastEyePinRef.current >= 5
      ) {
        lastEyePinRef.current = sec;
        timelineEventsRef.current.push({
          t: sec,
          type: 'eye',
          label: vision.currentStatus === 'looking_down' ? 'ก้มอ่านโพย' : 'สายตาหลุดกล้อง',
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
          setAudioLevel(Math.min(1, avg * 2.8));

          // ตรวจจับ Dead Air (เงียบค้าง >= 2.5 วินาที)
          const now = Date.now();
          if (avg < 0.018) {
            if (!silenceStartRef.current) silenceStartRef.current = now;
            if (now - silenceStartRef.current >= 2500 && !inDeadAirRef.current) {
              inDeadAirRef.current = true;
              setIsDeadAir(true);
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
            if (inDeadAirRef.current) {
              inDeadAirRef.current = false;
              setIsDeadAir(false);
            }
          }
          rafId = requestAnimationFrame(tick);
        };
        tick();
      } catch {
        // ignore audio meter errors
      }
    }

    return () => {
      clearInterval(timer);
      if (rafId) cancelAnimationFrame(rafId);
      if (audioCtx) audioCtx.close().catch(() => {});
    };
  }, [isRecording, localStream]);

  const stopAndUploadCurrent = useCallback(async () => {
    if (stoppingPromiseRef.current) {
      return stoppingPromiseRef.current;
    }

    const rec = recorderRef.current;
    const slideIdx = recSlideRef.current;
    if (!rec || slideIdx === null) return;

    const promise = (async () => {
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
        rec.onstop = () => {
          resolve(new Blob(chunksRef.current, { type: mimeType }));
        };
        try {
          rec.stop();
        } catch {
          resolve(new Blob(chunksRef.current, { type: mimeType }));
        }
      });

      recorderRef.current = null;
      recSlideRef.current = null;
      chunksRef.current = [];
      setIsRecording(false);
      setIsDeadAir(false);
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
      setSlideResults((prev) => ({
        ...prev,
        [slideIdx]: {
          ...analysis,
          transcript: spokenText,
        },
      }));

      if (blob.size < 256) return;

      setUploadingCount((c) => c + 1);
      try {
        const mediaBase64 = await blobToBase64(blob);
        await uploadGroupClip(room.code, {
          slideIndex: slideIdx,
          memberId: selfId,
          memberName: me?.name || 'สมาชิก',
          mimeType,
          mediaBase64,
          analysis,
        });
      } catch (err) {
        console.warn('[GroupClip] Upload failed:', err);
      } finally {
        setUploadingCount((c) => Math.max(0, c - 1));
      }
    })();

    stoppingPromiseRef.current = promise;
    try {
      await promise;
    } finally {
      stoppingPromiseRef.current = null;
    }
  }, [room.code, selfId, me?.name]);

  const startRecordingSlide = () => {
    if (!isSelfSpeaker || !localStream || recorderRef.current) return;

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
      recSlideRef.current = curIdx;
      recStartRef.current = Date.now();
      transcriptRef.current = '';
      timelineEventsRef.current = [];
      lastPacePinRef.current = -10;
      lastFillerRef.current = 0;
      lastEyePinRef.current = -10;
      silenceStartRef.current = null;
      inDeadAirRef.current = false;
      deadAirCountRef.current = 0;
      setIsDeadAir(false);
      setElapsedSec(0);
      setLiveTranscript('');
      setIsRecording(true);
      vision.startTracking();

      const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SpeechRec) {
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
              if (ev.results[i].isFinal) {
                finalized += `${t} `;
              } else {
                interim += t;
              }
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
      }
    } catch (err) {
      console.warn('[GroupClip] MediaRecorder failed:', err);
    }
  };

  // หยุดอัดอัตโนมัติถ้าเปลี่ยนสไลด์หรือเปลี่ยนคิว
  useEffect(() => {
    if (isRecording && (recSlideRef.current !== curIdx || !isSelfSpeaker)) {
      void stopAndUploadCurrent();
    }
  }, [curIdx, isSelfSpeaker, isRecording, stopAndUploadCurrent]);

  // Reset live transcript display when switching slide while idle
  useEffect(() => {
    if (!isRecording) {
      setElapsedSec(0);
      setLiveTranscript('');
    }
  }, [curIdx, isRecording]);

  useEffect(() => {
    return () => {
      void stopAndUploadCurrent();
    };
  }, [stopAndUploadCurrent]);

  // ลากและปรับขนาดหน้าต่างกล้องลอย (เหมือนซ้อมเดี่ยว)
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

  const speakerStream = isSelfSpeaker ? localStream : remoteStreams[speakerId] || null;
  const speakerCamOn = isSelfSpeaker ? camEnabled : speaker?.camEnabled !== false;
  const speakerMicOn = isSelfSpeaker ? micEnabled : speaker?.micEnabled !== false;
  const hasSpeakerVideo = Boolean(
    speakerCamOn && speakerStream && speakerStream.getVideoTracks().length > 0,
  );

  const speakerVideoRef = useRef(null);
  const setSpeakerVideoEl = useCallback(
    (node) => {
      speakerVideoRef.current = node;
      if (isSelfSpeaker) {
        vision.setVideoRef(node);
      }
    },
    [isSelfSpeaker, vision.setVideoRef],
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
  }, [hasSpeakerVideo, speakerStream, camCollapsed, camHidden, isSelfSpeaker]);

  const handleSlideNav = async (nextIdx) => {
    if (interruptLoading || room.activeInterrupt) return;
    if (isRecording) {
      await stopAndUploadCurrent();
    }

    const shouldInterrupt =
      nextIdx > curIdx &&
      Boolean(room.settings?.interruptEnabled) &&
      Array.isArray(room.interruptSlides) &&
      room.interruptSlides.includes(curIdx) &&
      !room.interruptResults?.[curIdx];

    if (shouldInterrupt) {
      setInterruptLoading(true);
      pendingNextSlideRef.current = nextIdx;
      try {
        const curSlide = slides[curIdx] || {};
        const slideText =
          curSlide.text ||
          (Array.isArray(curSlide.points) ? curSlide.points.join(', ') : curSlide.title || '');
        const res = await generateInterruptQuestion({
          deckName: room.deckName || 'ชุดสไลด์พรีเซนต์กลุ่ม',
          audience: room.settings?.audience || 'general',
          slideNumber: curIdx + 1,
          slideTitle: curSlide.title || `สไลด์หน้า ${curIdx + 1}`,
          slideText,
          slideImageBase64: curSlide.src || undefined,
          transcript: slideResults[curIdx]?.transcript || '',
        });
        if (res?.question) {
          socket?.emit('group:interrupt_open', {
            slideIndex: curIdx,
            question: res.question,
            speakerId: currentOwnerId || room.hostId,
            speakerName: currentOwner?.name || speaker?.name || 'ผู้พูด',
          });
          setInterruptLoading(false);
          return;
        }
      } catch (err) {
        setQaError(err?.message || 'ไม่สามารถสร้างคำถามแทรกได้ (ข้ามไปสไลด์ถัดไป)');
      } finally {
        setInterruptLoading(false);
      }
      pendingNextSlideRef.current = null;
    }

    onChangeSlide(nextIdx);
  };

  // อ่านคำถามแทรกออกเสียงอัตโนมัติเมื่อมีคำถามแทรกขึ้นมา
  useEffect(() => {
    if (room.activeInterrupt?.question) {
      setIntAnswerText(room.activeInterrupt.answerTranscript || '');
      intTextRef.current = room.activeInterrupt.answerTranscript || '';
      setIntEvalResult(room.activeInterrupt.evaluation || null);
      speakQuestion(room.activeInterrupt.question);
    } else {
      stopSpeaking();
      if (intRecognitionRef.current) {
        try {
          intRecognitionRef.current.stop();
        } catch {
          // ignore
        }
        intRecognitionRef.current = null;
      }
      setIntAnswering(false);
    }
  }, [room.activeInterrupt?.slideIndex, room.activeInterrupt?.question]);

  const toggleIntRecording = () => {
    if (intAnswering) {
      if (intRecognitionRef.current) {
        try {
          intRecognitionRef.current.stop();
        } catch {
          // ignore
        }
        intRecognitionRef.current = null;
      }
      setIntAnswering(false);
      return;
    }
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
        intTextRef.current = full;
        setIntAnswerText(full);
      };
      sr.onerror = () => setIntAnswering(false);
      sr.onend = () => setIntAnswering(false);
      sr.start();
      intRecognitionRef.current = sr;
      setIntAnswering(true);
    } catch {
      setIntAnswering(false);
    }
  };

  const handleEvaluateInterrupt = async () => {
    if (!room.activeInterrupt || intEvaluating) return;
    const ok = await askConfirm({
      key: 'token-spend',
      title: 'ยืนยันการใช้ 1 Token',
      message: 'ระบบจะใช้ 1 Token เพื่อให้ AI ประเมินคำตอบถามแทรกข้อนี้',
      confirmText: 'ใช้ 1 Token',
    });
    if (!ok) return;
    setIntEvaluating(true);
    try {
      const sIdx = room.activeInterrupt.slideIndex;
      const curSlide = slides[sIdx] || {};
      const evaluation = await evaluateQaAnswer({
        audience: room.settings?.audience || 'general',
        question: room.activeInterrupt.question,
        slideContext: `${curSlide.title || ''}: ${curSlide.text || ''}`.slice(0, 800),
        answerTranscript: intAnswerText.trim(),
        timelineEvents: [],
      });
      setIntEvalResult(evaluation);
      socket?.emit('group:interrupt_save', {
        slideIndex: sIdx,
        answerTranscript: intAnswerText.trim(),
        evaluation,
        close: false,
      });
    } catch (err) {
      setQaError(err?.message || 'ตรวจคำตอบถามแทรกไม่สำเร็จ');
    } finally {
      setIntEvaluating(false);
    }
  };

  const handleCloseInterrupt = () => {
    if (intAnswering) toggleIntRecording();
    const sIdx = room.activeInterrupt?.slideIndex;
    if (typeof sIdx === 'number') {
      socket?.emit('group:interrupt_save', {
        slideIndex: sIdx,
        answerTranscript: intAnswerText.trim(),
        evaluation: intEvalResult,
        close: true,
      });
    } else {
      socket?.emit('group:interrupt_close');
    }
    const nextIdx = pendingNextSlideRef.current;
    pendingNextSlideRef.current = null;
    if (typeof nextIdx === 'number') {
      onChangeSlide(nextIdx);
    }
  };

  const handleFinishClick = async () => {
    await stopAndUploadCurrent();
    onFinishRehearsal();
  };

  const handleStartQaClick = async () => {
    if (qaLoading) return;
    if (!socket?.connected) {
      setQaError('การเชื่อมต่อห้องขาดหาย กรุณารอสักครู่แล้วลองใหม่ (ยังไม่หัก Token)');
      return;
    }

    // ถ้ามีคำถามที่สร้างสำเร็จค้างไว้จากการกดครั้งก่อน (เช่น socket ส่งไม่ผ่าน) ให้ใช้ซ้ำโดยไม่หัก Token ซ้ำ
    if (Array.isArray(pendingQaQuestionsRef.current) && pendingQaQuestionsRef.current.length > 0) {
      setQaError('');
      socket.emit('group:start_qa', { questions: pendingQaQuestionsRef.current }, (res) => {
        if (res?.ok) {
          pendingQaQuestionsRef.current = null;
        } else {
          setQaError(res?.message || 'เปิดช่วง Q&A ไม่สำเร็จ');
        }
      });
      return;
    }

    const ok = await askConfirm({
      key: 'token-spend',
      title: 'ยืนยันการใช้ 1 Token',
      message: 'ระบบจะใช้ 1 Token เพื่อสร้างชุดคำถามช่วงถาม-ตอบ (Q&A) สำหรับทั้งกลุ่ม',
      confirmText: 'ใช้ 1 Token',
    });
    if (!ok) return;

    setQaError('');
    setQaLoading(true);
    try {
      await stopAndUploadCurrent();
      const clips = await fetchGroupClips(room.code).catch(() => []);
      const clipBySlide = new Map(clips.map((c) => [c.slideIndex, c]));
      const slideSummaries = slides.map((s, idx) => {
        const c = clipBySlide.get(idx);
        const owner = assignments[idx] ? memberMap.get(assignments[idx]) : null;
        const speakerName = c?.memberName || owner?.name || '';
        const rawTranscript = c?.analysis?.transcript || slideResults[idx]?.transcript || '';
        const transcript = rawTranscript && speakerName ? `[ผู้พูด: ${speakerName}] ${rawTranscript}` : rawTranscript;
        return {
          index: idx,
          title: s.title || `สไลด์หน้า ${idx + 1}`,
          text: s.text || (Array.isArray(s.points) ? s.points.join(', ') : ''),
          transcript,
        };
      });

      const qaMins = Number(room.settings?.qaMins ?? 5);
      const questionCount =
        qaMins <= 0 ? 3 : Math.min(8, Math.max(2, Math.round((qaMins * 60) / 50)));
      const data = await generateQaQuestions({
        deckName: room.deckName || 'ชุดสไลด์พรีเซนต์กลุ่ม',
        audience: room.settings?.audience || 'general',
        questionCount,
        slides: slideSummaries,
      });

      const rawQs = Array.isArray(data?.questions) ? data.questions : [];
      if (rawQs.length === 0) {
        throw new Error('AI ไม่สามารถสร้างคำถามได้ กรุณาลองใหม่อีกครั้ง');
      }

      // เตรียมเสียงอ่านคำถาม Edge-TTS ให้พร้อมบนเซิร์ฟเวอร์ก่อนเข้าสู่หน้าถาม-ตอบ
      await preloadAllQuestionsSpeech(rawQs);

      pendingQaQuestionsRef.current = rawQs;
      socket.emit('group:start_qa', { questions: rawQs }, (res) => {
        if (res?.ok) {
          pendingQaQuestionsRef.current = null;
        } else {
          setQaError(res?.message || 'เปิดช่วง Q&A ไม่สำเร็จ (คำถามถูกบันทึกไว้แล้ว กดลองอีกครั้งได้โดยไม่เสีย Token)');
        }
      });
    } catch (err) {
      setQaError(err?.message || 'สร้างคำถาม Q&A ไม่สำเร็จ');
    } finally {
      setQaLoading(false);
    }
  };

  const uploadedSet = new Set(room.uploadedSlides || []);
  const slideResult = slideResults[curIdx] || null;
  const isSlideUploaded = uploadedSet.has(curIdx);
  const aiCheck = aiCheckMap[curIdx] || null;

  const handleCheckSlide = async () => {
    if (!slideResult || aiChecking) return;
    const ok = await askConfirm({
      key: 'token-spend',
      title: 'ยืนยันการใช้ 1 Token',
      message: 'ระบบจะใช้ 1 Token เพื่อตรวจสอบความครบถ้วนและแนะนำจุดปรับปรุงของสไลด์หน้านี้',
      confirmText: 'ใช้ 1 Token',
    });
    if (!ok) return;

    setAiChecking(true);
    setAiCheckError('');
    try {
      const s = slides[curIdx] || {};
      const slideText = s.text || (Array.isArray(s.points) ? s.points.join(', ') : s.title || '');
      const data = await checkSlideWithAi({
        deckName: room.deckName || 'ชุดสไลด์พรีเซนต์กลุ่ม',
        audience: room.settings?.audience || 'general',
        slideNumber: curIdx + 1,
        slideTitle: s.title || `สไลด์หน้า ${curIdx + 1}`,
        slideText,
        slideImageBase64: s.src || undefined,
        transcript: slideResult.transcript || '',
      });
      setAiCheckMap((prev) => ({ ...prev, [curIdx]: data }));
    } catch (err) {
      setAiCheckError(err?.message || 'ตรวจสไลด์ด้วย AI ไม่สำเร็จ');
    } finally {
      setAiChecking(false);
    }
  };

  const liveWords = useMemo(() => countWords(liveTranscript), [liveTranscript]);
  const liveWpm = elapsedSec > 3 ? Math.round(liveWords / (elapsedSec / 60)) : 0;
  const liveFillers = useMemo(() => countFillers(liveTranscript).total, [liveTranscript]);

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      {Object.entries(remoteStreams).map(([peerId, stream]) =>
        peerId !== selfId ? (
          <RemotePeerAudio key={peerId} stream={stream} volume={peerVolumes[peerId] ?? 1} />
        ) : null,
      )}

      {/* แถบหัวห้อง + ปุ่มจบ / กลับ / ออก */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="rounded-md border border-line bg-white px-2.5 py-1 font-mono text-xs font-semibold text-ink">
            ห้อง {room.code}
          </span>
          {Number(room.settings?.presentMins || 0) > 0 && (() => {
            const remaining = room.settings.presentMins * 60 - stageElapsedSec;
            const overtime = remaining < 0;
            return (
              <span
                className={`rounded-full border px-2.5 py-0.5 font-mono text-[11px] tabular-nums ${
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
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted">
              คิวหน้า {curIdx + 1}/{slides.length}:
            </span>
            <span className="font-semibold text-ink">
              {currentOwner ? currentOwner.name : `${speaker?.name || 'หัวหน้ากลุ่ม'} (คุมสไลด์กลาง)`}
            </span>
            {isMyTurn && (
              <span className="rounded-full bg-accent px-2.5 py-0.5 text-[11px] font-medium text-white">
                ถึงคิวคุณพูด
              </span>
            )}
            {uploadingCount > 0 && (
              <span className="rounded-full border border-line bg-white px-2.5 py-0.5 text-[11px] text-muted">
                กำลังบันทึกคลิปเข้าห้อง...
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isHost && (
            <button
              type="button"
              onClick={() =>
                socket?.emit('group:set_settings', {
                  ...room.settings,
                  allowAnySlideControl: !room.settings?.allowAnySlideControl,
                })
              }
              className={`rounded-xl border px-3 py-2 text-xs font-medium transition cursor-pointer ${
                room.settings?.allowAnySlideControl
                  ? 'border-ink bg-ink text-paper'
                  : 'border-line bg-white text-ink hover:border-faint'
              }`}
            >
              เพื่อนช่วยเลื่อนสไลด์: {room.settings?.allowAnySlideControl ? 'เปิด' : 'ปิด'}
            </button>
          )}
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
          {canFinish && (
            <button
              type="button"
              onClick={handleFinishClick}
              disabled={uploadingCount > 0}
              className="rounded-xl bg-ink px-3.5 py-2 text-xs font-semibold text-paper hover:opacity-90 disabled:opacity-50 cursor-pointer"
            >
              จบการนำเสนอและดูสรุปผล
            </button>
          )}
          {isHost && (
            <button
              type="button"
              onClick={onStopRehearsal}
              className="rounded-xl border border-line bg-white px-3 py-2 text-xs font-medium text-ink hover:border-faint cursor-pointer"
            >
              กลับหน้า Lobby
            </button>
          )}
          <button
            type="button"
            onClick={onLeaveRoom}
            className="rounded-xl border border-line bg-white px-3 py-2 text-xs text-muted hover:text-ink cursor-pointer"
          >
            ออกจากห้อง
          </button>
        </div>
      </div>

      {/* แผงปรับระดับเสียงไมค์ตัวเอง และเสียงเพื่อนในห้อง */}
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
            <div className="rounded-lg border border-line bg-paper/70 px-3.5 py-2.5 space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-ink">ไมค์ของฉัน ({me?.name || 'คุณ'})</span>
                <span className="font-mono text-[11px] tabular-nums text-muted">
                  {Math.round(micGain * 100)}%
                </span>
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
                  <div
                    key={m.id}
                    className="rounded-lg border border-line bg-paper/70 px-3.5 py-2.5 space-y-1.5"
                  >
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-ink">เสียงของ {m.name}</span>
                      <span className="font-mono text-[11px] tabular-nums text-muted">
                        {Math.round(vol * 100)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={vol}
                      onChange={(e) =>
                        setPeerVolumes((prev) => ({
                          ...prev,
                          [m.id]: Number(e.target.value),
                        }))
                      }
                      className="w-full accent-accent cursor-pointer"
                    />
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* แถบ Progress สไลด์เหมือนหน้าซ้อมเดี่ยว */}
      <div className="mt-5 flex gap-1">
        {slides.map((_, i) => {
          const isCur = i === curIdx;
          const isDone = uploadedSet.has(i) || Boolean(slideResults[i]);
          return (
            <button
              key={i}
              type="button"
              disabled={!canControlSlide}
              onClick={() => handleSlideNav(i)}
              title={`หน้า ${i + 1}`}
              className={`h-1 flex-1 rounded-full transition ${
                isCur ? 'bg-accent' : isDone ? 'bg-ink' : 'bg-line'
              } ${canControlSlide ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}`}
            />
          );
        })}
      </div>

      {mediaError && (
        <p className="mt-4 rounded-xl bg-accent/10 px-4 py-2.5 text-xs text-accent">{mediaError}</p>
      )}
      {qaError && (
        <p className="mt-4 rounded-xl bg-accent/10 px-4 py-2.5 text-xs text-accent">{qaError}</p>
      )}

      {/* Grid 2 คอลัมน์เหมือน RehearsalStep */}
      <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_360px]">
        {/* ซ้าย: สไลด์กลาง + ปุ่มเปลี่ยนหน้า / คิว */}
        <div className="space-y-4">
          <SlideViewer
            slides={slides}
            index={curIdx}
            locked={!canControlSlide}
            hideNav
            onIndexChange={handleSlideNav}
          />

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-white px-4 py-3">
            <div className="text-xs text-muted">
              {canControlSlide ? (
                isHandoffNext ? (
                  <span>
                    หน้าถัดไปจะส่งไม้ต่อให้{' '}
                    <strong className="text-ink">{nextOwner.name}</strong>
                  </span>
                ) : isLastSlide ? (
                  <span>หน้าสุดท้ายแล้ว สามารถกด &quot;จบการนำเสนอและดูสรุปผล&quot; ได้เลย</span>
                ) : (
                  <span>คุณสามารถเปลี่ยนหน้าสไลด์เมื่อพูดจบหน้านี้ได้</span>
                )
              ) : (
                <span>
                  กำลังดูสไลด์กลาง (คุมโดย{' '}
                  <strong className="text-ink">
                    {currentOwner?.name || speaker?.name || 'ผู้พูด'}
                  </strong>
                  )
                </span>
              )}
            </div>

            {canControlSlide && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={curIdx === 0}
                  onClick={() => handleSlideNav(curIdx - 1)}
                  className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink transition hover:border-faint disabled:opacity-40 cursor-pointer"
                >
                  สไลด์ก่อนหน้า
                </button>
                {!isLastSlide ? (
                  <button
                    type="button"
                    onClick={() => handleSlideNav(curIdx + 1)}
                    className="rounded-lg bg-accent px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-accent/90 cursor-pointer"
                  >
                    {isHandoffNext
                      ? `สไลด์ถัดไป (ส่งต่อ ${nextOwner.name})`
                      : 'สไลด์ถัดไป'}
                  </button>
                ) : (
                  canFinish && (
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={handleFinishClick}
                        disabled={uploadingCount > 0 || qaLoading}
                        className="rounded-lg border border-line bg-white px-3.5 py-1.5 text-xs font-semibold text-ink transition hover:border-faint disabled:opacity-50 cursor-pointer"
                      >
                        จบและดูสรุปผลเลย (ฟรี)
                      </button>
                      <button
                        type="button"
                        onClick={handleStartQaClick}
                        disabled={uploadingCount > 0 || qaLoading}
                        className="rounded-lg bg-accent px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-accent/90 disabled:opacity-50 cursor-pointer"
                      >
                        {qaLoading ? 'กำลังสร้างคำถาม Q&A...' : 'เข้าช่วงถาม-ตอบ Q&A (-1 Token)'}
                      </button>
                    </div>
                  )
                )}
              </div>
            )}
          </div>

          {/* คิวสไลด์ทั้งหมด */}
          <div className="rounded-xl border border-line bg-white px-4 py-3">
            <p className="text-[11px] text-muted">
              คิวสไลด์ทั้งหมด (บันทึกคลิปแล้ว {uploadedSet.size}/{slides.length} หน้า)
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {slides.map((_, idx) => {
                const owner = assignments[idx] ? memberMap.get(assignments[idx]) : null;
                const active = idx === curIdx;
                const hasClip = uploadedSet.has(idx);
                return (
                  <button
                    key={idx}
                    type="button"
                    disabled={!canControlSlide}
                    onClick={() => handleSlideNav(idx)}
                    className={`rounded-lg border px-2.5 py-1 text-[11px] transition ${
                      active
                        ? 'border-ink bg-ink text-paper font-medium'
                        : hasClip
                          ? 'border-line bg-paper text-ink'
                          : 'border-line bg-white text-muted'
                    } ${canControlSlide ? 'cursor-pointer hover:border-faint' : 'cursor-default'}`}
                  >
                    #{idx + 1} · {owner ? owner.name : 'ส่วนกลาง'}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* ขวา: แผงควบคุมการพูด & ถอดเสียงสด (สไตล์เดียวกับ RehearsalStep) */}
        <aside className="flex flex-col rounded-xl border border-line bg-white">
          <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
            <span className="text-xs font-medium text-ink">หน้า {curIdx + 1}</span>
            {isRecording ? (
              <span className="flex items-center gap-1.5 text-xs text-accent">
                <span className="size-1.5 animate-pulse rounded-full bg-accent" />
                กำลังฟัง &amp; บันทึกเสียง
              </span>
            ) : isSlideUploaded || slideResult ? (
              <span className="text-xs text-muted">บันทึกคลิปแล้ว</span>
            ) : (
              <span className="text-xs text-muted">
                {isSelfSpeaker ? 'รอเริ่มพูด' : `คิวของ ${speaker?.name || 'ผู้พูด'}`}
              </span>
            )}
          </div>

          <div className="flex flex-1 flex-col gap-5 p-5">
            {/* นาฬิกาจับเวลา + สถิติสด (โครงสร้างเดียวกับซ้อมเดี่ยว) */}
            <div className="font-mono text-4xl tabular-nums tracking-tight text-ink">
              {formatTime(isRecording ? elapsedSec : slideResult?.duration || 0)}
            </div>

            {isRecording && (
              <div className="space-y-2.5">
                <div className="rounded-xl border border-line bg-white p-3 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-muted">ความเร็วตอนนี้</span>
                    <LivePace wpm={liveWpm} fillers={liveFillers} elapsed={elapsedSec} />
                    {isDeadAir && (
                      <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-medium text-amber-800">
                        เงียบค้าง!
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center justify-between rounded-xl border border-line bg-white px-3.5 py-2.5">
                  <LiveWaveform level={audioLevel} />
                  <span className="font-mono text-[10px] tracking-wider text-muted">LIVE AUDIO</span>
                </div>
              </div>
            )}

            {/* กล่องคำพูดที่ถอดความได้ */}
            <div className="min-h-36 flex-1 rounded-lg bg-paper px-4 py-3 text-[15px] leading-7">
              {isRecording ? (
                liveTranscript ? (
                  <p className="text-ink">{liveTranscript}</p>
                ) : (
                  <p className="text-faint">เริ่มพูดได้เลย...</p>
                )
              ) : slideResult ? (
                slideResult.transcript ? (
                  <p className="text-ink">{slideResult.transcript}</p>
                ) : (
                  <p className="text-faint">ยังไม่มีข้อความที่ถอดเสียงได้ในหน้านี้</p>
                )
              ) : isSelfSpeaker ? (
                <p className="text-faint">
                  กดปุ่ม &quot;เริ่มพูดและอัดหน้านี้&quot; ด้านล่างเมื่อพร้อมพูดสไลด์หน้านี้
                </p>
              ) : (
                <p className="text-faint">
                  ถึงคิวของ {speaker?.name || 'สมาชิก'} พูดหน้านี้ ระบบกำลังถ่ายทอดเสียงและกล้องสด
                </p>
              )}
            </div>

            {/* สรุปสถิติย่อหลังอัดเสร็จ */}
            {!isRecording && slideResult && (
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-line pt-4 text-xs">
                <div>
                  <span className="text-muted">ความเร็ว</span>
                  <p className="mt-0.5 font-mono font-semibold text-ink">
                    {slideResult.wpm || 0} คำ/นาที
                  </p>
                </div>
                <div>
                  <span className="text-muted">เวลาพูด</span>
                  <p className="mt-0.5 font-mono font-semibold text-ink">
                    {formatTime(slideResult.duration || 0)}
                  </p>
                </div>
                <div>
                  <span className="text-muted">จำนวนคำ</span>
                  <p className="mt-0.5 font-mono font-semibold text-ink">
                    {slideResult.words || 0} คำ
                  </p>
                </div>
                <div>
                  <span className="text-muted">คำติดปาก</span>
                  <p className="mt-0.5 font-mono font-semibold text-ink">
                    {slideResult.fillers?.total || 0} ครั้ง
                  </p>
                </div>
                {slideResult.vision?.cameraUsed && (
                  <div>
                    <span className="text-muted">สบตากล้อง</span>
                    <p className="mt-0.5 font-mono font-semibold text-ink">
                      {slideResult.vision.eyeContactPct ?? 100}%
                    </p>
                  </div>
                )}
                {slideResult.deadAir?.count > 0 && (
                  <div>
                    <span className="text-muted">เงียบค้าง</span>
                    <p className="mt-0.5 font-mono font-semibold text-accent">
                      {slideResult.deadAir.count} ครั้ง
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* ปุ่มให้ AI เช็กหน้านี้ (-1 Token) เหมือนซ้อมเดี่ยว */}
            {!isRecording && slideResult && isSelfSpeaker && (
              <div className="space-y-2">
                {aiCheck ? (
                  <div className="rounded-lg border border-line bg-paper p-3.5 text-xs space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-ink">ผลตรวจหน้านี้</span>
                      <span className="font-mono font-medium text-ink">
                        {aiCheck.coverage || 'สรุปจาก AI'}
                      </span>
                    </div>
                    {aiCheck.summary && (
                      <p className="text-muted leading-relaxed">{aiCheck.summary}</p>
                    )}
                    {aiCheck.missedPoints?.length > 0 && (
                      <p className="text-accent leading-relaxed">
                        ยังไม่ได้พูด: {aiCheck.missedPoints.join(', ')}
                      </p>
                    )}
                    {aiCheck.suggestion && (
                      <p className="text-ink leading-relaxed border-t border-line/70 pt-2">
                        คำแนะนำ: {aiCheck.suggestion}
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
                {aiCheckError && <p className="text-xs text-accent">{aiCheckError}</p>}
              </div>
            )}

            {/* ปุ่มเริ่ม/หยุดอัดคลิป */}
            {isSelfSpeaker ? (
              isRecording ? (
                <button
                  type="button"
                  onClick={() => void stopAndUploadCurrent()}
                  className="flex items-center justify-center gap-2 rounded-lg bg-accent py-3 text-sm font-medium text-white transition hover:bg-accent/90 cursor-pointer"
                >
                  <span className="size-2.5 rounded-[2px] bg-white" />
                  หยุดอัดและบันทึกหน้านี้
                </button>
              ) : (
                <button
                  type="button"
                  onClick={startRecordingSlide}
                  disabled={!localStream}
                  className="rounded-lg bg-ink py-3 text-sm font-medium text-paper transition hover:bg-ink/90 disabled:opacity-40 cursor-pointer"
                >
                  {isSlideUploaded || slideResult
                    ? 'อัดหน้านี้ใหม่อีกครั้ง'
                    : 'เริ่มพูดและอัดหน้านี้'}
                </button>
              )
            ) : (
              <div className="rounded-lg border border-line bg-paper px-3.5 py-2.5 text-center text-xs text-muted">
                กำลังรอคิวของ <strong className="text-ink">{speaker?.name || 'ผู้พูด'}</strong>
              </div>
            )}
          </div>
        </aside>
      </div>

      {/* หน้าต่างกล้องลอย (ดีไซน์เดียวกับ FloatingCamera ของซ้อมเดี่ยว) */}
      {camHidden ? (
        <button
          type="button"
          onClick={() => setCamHidden(false)}
          className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full border border-line bg-white px-4 py-2 text-xs font-medium text-ink shadow-lg hover:border-faint cursor-pointer"
        >
          <span
            className={`size-2 rounded-full ${
              speakerMicOn ? 'bg-emerald-500' : 'bg-zinc-400'
            }`}
          />
          แสดงหน้าต่างกล้อง ({speaker?.name || 'ผู้พูด'})
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
          {/* แถบหัวหน้าต่าง: ลากย้าย + ปุ่มขนาด S/M/L + ย่อ/ปิด */}
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
                กล้องลอย · {speaker?.name || 'ผู้พูด'}
                {isSelfSpeaker ? ' (คุณ)' : ''}
              </span>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              {!camCollapsed && (
                <div className="flex items-center rounded-md border border-line/80 bg-white p-0.5 text-[10px] font-mono text-muted">
                  <button
                    type="button"
                    onClick={() => setCamWidth(240)}
                    className={`px-1.5 py-0.5 rounded transition cursor-pointer ${
                      camWidth <= 260 ? 'bg-ink text-paper font-semibold' : 'hover:text-ink'
                    }`}
                    title="ขนาดกะทัดรัด (240px)"
                  >
                    S
                  </button>
                  <button
                    type="button"
                    onClick={() => setCamWidth(320)}
                    className={`px-1.5 py-0.5 rounded transition cursor-pointer ${
                      camWidth > 260 && camWidth <= 360 ? 'bg-ink text-paper font-semibold' : 'hover:text-ink'
                    }`}
                    title="ขนาดมาตรฐาน (320px)"
                  >
                    M
                  </button>
                  <button
                    type="button"
                    onClick={() => setCamWidth(440)}
                    className={`px-1.5 py-0.5 rounded transition cursor-pointer ${
                      camWidth > 360 ? 'bg-ink text-paper font-semibold' : 'hover:text-ink'
                    }`}
                    title="ขนาดใหญ่ (440px)"
                  >
                    L
                  </button>
                </div>
              )}

              <button
                type="button"
                onClick={() => setCamCollapsed((v) => !v)}
                className="flex size-5 items-center justify-center rounded text-muted hover:bg-line/60 hover:text-ink cursor-pointer text-xs"
                title={camCollapsed ? 'ขยายหน้าต่าง' : 'ย่อหน้าต่าง'}
              >
                {camCollapsed ? '▢' : '–'}
              </button>
              <button
                type="button"
                onClick={() => setCamHidden(true)}
                className="flex size-5 items-center justify-center rounded text-muted hover:bg-line/60 hover:text-accent cursor-pointer text-xs"
                title="ซ่อนหน้าต่างกล้อง"
              >
                ✕
              </button>
            </div>
          </div>

          {!camCollapsed ? (
            <div className="relative p-3 space-y-2.5">
              <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-black">
                {hasSpeakerVideo ? (
                  <video
                    ref={setSpeakerVideoEl}
                    autoPlay
                    playsInline
                    muted
                    className={`h-full w-full object-cover ${isSelfSpeaker ? '-scale-x-100' : ''}`}
                  />
                ) : (
                  <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 text-white/75">
                    <div className="flex size-10 items-center justify-center rounded-full bg-white/10 text-sm font-semibold">
                      {(speaker?.name || '?').slice(0, 1).toUpperCase()}
                    </div>
                    <span className="text-[11px]">
                      {speakerCamOn ? 'กำลังเชื่อมต่อกล้อง...' : 'ปิดกล้องอยู่'}
                    </span>
                  </div>
                )}

                <div className="absolute top-2 right-2 flex items-center gap-1.5 rounded-full bg-ink/80 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur-xs">
                  {isSelfSpeaker && vision.cameraActive && vision.currentStatus !== 'off' ? (
                    <>
                      <span
                        className={`size-1.5 rounded-full ${
                          vision.currentStatus === 'eye_contact'
                            ? 'bg-emerald-400 animate-pulse'
                            : vision.currentStatus === 'looking_down'
                              ? 'bg-amber-400 animate-pulse'
                              : 'bg-white/70'
                        }`}
                      />
                      <span>
                        {vision.currentStatus === 'eye_contact'
                          ? 'สบตาคนฟัง'
                          : vision.currentStatus === 'looking_down'
                            ? 'ก้มอ่านโพย!'
                            : vision.currentStatus === 'looking_away'
                              ? 'หันมองสไลด์'
                              : 'ไม่พบใบหน้า'}
                      </span>
                    </>
                  ) : (
                    <>
                      <span
                        className={`size-1.5 rounded-full ${
                          isRecording ? 'bg-red-500 animate-pulse' : speakerMicOn ? 'bg-emerald-400' : 'bg-zinc-400'
                        }`}
                      />
                      <span>
                        {isRecording ? 'กำลังอัดคลิป' : speakerMicOn ? 'ไมค์เปิดอยู่' : 'ปิดไมค์'}
                      </span>
                    </>
                  )}
                </div>
              </div>

              {isSelfSpeaker && vision.cameraActive && (
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

              {/* มุมขวาล่างสำหรับลากย่อ/ขยายขนาดกล้อง */}
              <div
                onPointerDown={(e) => {
                  e.stopPropagation();
                  resizeRef.current = { startX: e.clientX, origW: camWidth };
                }}
                className="absolute bottom-1 right-1 flex size-4 items-end justify-end p-0.5 cursor-nwse-resize text-faint hover:text-ink transition"
                title="คลิกลากเพื่อปรับขนาดจอกล้องได้อย่างอิสระ"
              >
                <svg viewBox="0 0 10 10" className="size-2.5" fill="currentColor">
                  <path d="M9 1v8H1l8-8zm-4 8h4V5l-4 4z" />
                </svg>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between px-3 py-2 text-xs">
              <div className="flex items-center gap-2">
                <span
                  className={`size-2 rounded-full ${
                    speakerMicOn ? 'bg-emerald-500' : 'bg-zinc-400'
                  }`}
                />
                <span className="text-[11px] text-ink">
                  {isRecording ? 'กำลังอัดคลิป' : speakerCamOn ? 'กล้องเปิดอยู่' : 'ปิดกล้องอยู่'}
                </span>
              </div>
              <span className="text-[10px] text-faint font-mono">ลากย้ายได้</span>
            </div>
          )}
        </div>
      )}

      {/* หน้าต่างถามแทรกระหว่างซ้อม (ซิงก์ทั้งห้องเหมือน InterruptModal) */}
      {room.activeInterrupt && (() => {
        const activeInt = room.activeInterrupt;
        const canAnswerInt = activeInt.speakerId === selfId || isHost;
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/45 p-4 backdrop-blur-xs">
            <div className="w-full max-w-lg rounded-2xl border border-line bg-white p-6 shadow-2xl space-y-4">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-accent px-2.5 py-0.5 text-[11px] font-semibold text-white">
                    คำถามแทรก · หน้า {activeInt.slideIndex + 1}
                  </span>
                  <span className="rounded-full border border-line bg-paper px-2.5 py-0.5 text-[11px] font-medium text-ink">
                    ผู้ตอบ: {activeInt.speakerName}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => speakQuestion(activeInt.question)}
                  className="rounded-md border border-line bg-paper px-2.5 py-1 text-xs font-medium text-ink hover:border-faint cursor-pointer"
                >
                  ฟังคำถาม
                </button>
              </div>

              <p className="text-base font-semibold leading-relaxed text-ink">
                {activeInt.question}
              </p>

              {canAnswerInt ? (
                <div className="space-y-3">
                  <textarea
                    rows={3}
                    value={intAnswerText}
                    onChange={(e) => {
                      intTextRef.current = e.target.value;
                      setIntAnswerText(e.target.value);
                    }}
                    placeholder="กดอัดเสียงตอบคำถามแทรก หรือพิมพ์คำตอบ..."
                    className="w-full rounded-xl border border-line bg-paper/50 p-3 text-sm text-ink focus:border-ink focus:bg-white focus:outline-none"
                  />

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={toggleIntRecording}
                      className={`rounded-lg px-3.5 py-2 text-xs font-semibold transition cursor-pointer ${
                        intAnswering
                          ? 'bg-accent text-white'
                          : 'border border-line bg-white text-ink hover:border-faint'
                      }`}
                    >
                      {intAnswering ? 'หยุดอัดคำตอบ' : 'อัดเสียงตอบคำถาม'}
                    </button>

                    {!intEvalResult && intAnswerText.trim() && (
                      <button
                        type="button"
                        disabled={intEvaluating || intAnswering}
                        onClick={handleEvaluateInterrupt}
                        className="rounded-lg bg-ink px-3.5 py-2 text-xs font-semibold text-paper hover:opacity-90 disabled:opacity-50 cursor-pointer"
                      >
                        {intEvaluating ? 'กำลังตรวจ...' : 'ให้ AI ตรวจคำตอบ (-1 Token)'}
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-line bg-paper/60 p-4 text-xs text-muted space-y-2">
                  <p>กำลังรอ <strong className="text-ink">{activeInt.speakerName}</strong> ตอบคำถามแทรก...</p>
                  {activeInt.answerTranscript && (
                    <p className="rounded-lg bg-white p-3 text-sm text-ink">
                      &quot;{activeInt.answerTranscript}&quot;
                    </p>
                  )}
                </div>
              )}

              {(intEvalResult || activeInt.evaluation) && (() => {
                const ev = intEvalResult || activeInt.evaluation;
                return (
                  <div className="rounded-xl border border-line bg-paper/70 p-3.5 text-xs space-y-1.5">
                    {ev.directness && (
                      <span className="inline-block rounded-full bg-accent/10 px-2.5 py-0.5 text-[11px] font-medium text-accent">
                        {ev.directness}
                      </span>
                    )}
                    {ev.feedback && <p className="text-ink leading-relaxed">{ev.feedback}</p>}
                    {ev.betterAnswer && (
                      <p className="text-muted leading-relaxed">
                        <strong className="text-ink">แนวทางตอบ:</strong> {ev.betterAnswer}
                      </p>
                    )}
                  </div>
                );
              })()}

              {canAnswerInt && (
                <div className="flex justify-end border-t border-line pt-3">
                  <button
                    type="button"
                    onClick={handleCloseInterrupt}
                    className="rounded-xl bg-accent px-5 py-2 text-xs font-semibold text-white hover:bg-accent/90 cursor-pointer"
                  >
                    ดำเนินการต่อ →
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
