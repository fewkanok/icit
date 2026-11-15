import { useEffect, useRef, useState } from 'react';
import { useSpeechRecognition } from '../lib/useSpeechRecognition';
import { useAudioRecorder } from '../lib/useAudioRecorder';
import { useVideoRecorder } from '../lib/useVideoRecorder';
import { evaluateQaAnswer, generateInterruptQuestion } from '../lib/api';
import { speakQuestion, stopSpeaking } from '../lib/speech';
import {
  analyze,
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
import { askConfirm } from './ConfirmModal';

export default function InterruptModal({
  slideNumber,
  slideTitle,
  slideText,
  slideImageBase64,
  transcript,
  audience,
  useGeminiTts = false,
  vision = null,
  onSpeakQuestion,
  onSave,
  onClose,
}) {
  const [loading, setLoading] = useState(true);
  const [question, setQuestion] = useState(null);
  const [answerText, setAnswerText] = useState('');
  const [evaluating, setEvaluating] = useState(false);
  const [evaluation, setEvaluation] = useState(null);
  const [error, setError] = useState(null);
  const [qaPhase, setQaPhase] = useState('idle'); // 'idle' | 'asking' | 'answering'
  const [elapsed, setElapsed] = useState(0);
  const [liveWpm, setLiveWpm] = useState(0);

  const startedAt = useRef(0);
  const answerStartedAt = useRef(0);
  const samples = useRef([]);
  const textRef = useRef('');
  const timelineEventsRef = useRef([]);
  const lastPacePinAtRef = useRef(-10);
  const lastLookingDownRef = useRef(0);
  const lastFillerCountRef = useRef(0);
  const recordedMediaRef = useRef(null);

  const speech = useSpeechRecognition('th-TH');
  const recorder = useAudioRecorder({ silenceThreshold: 0.02, deadAirLimitSec: 2.5 });
  const videoRecorder = useVideoRecorder();

  useEffect(() => {
    if (speech.listening) {
      const combined = `${speech.finalText} ${speech.interim}`.trim();
      setAnswerText(combined);
      textRef.current = combined;
    }
  }, [speech.listening, speech.finalText, speech.interim]);

  // นับเวลาและ WPM เฉพาะช่วงเริ่มตอบคำถามจริง
  useEffect(() => {
    if (qaPhase !== 'answering' || !answerStartedAt.current) return;
    samples.current = [{ t: 0, w: 0 }];
    setLiveWpm(0);
    const id = setInterval(() => {
      const t = (Date.now() - answerStartedAt.current) / 1000;
      const w = countWords(textRef.current);
      setElapsed(t);
      const s = samples.current;
      s.push({ t, w });
      while (s.length > 1 && s[1].t <= t - PACE_WINDOW_SEC) s.shift();
      const span = t - s[0].t;
      setLiveWpm(t >= PACE_WARMUP_SEC && span > 0 ? Math.max(0, Math.round((w - s[0].w) / (span / 60))) : 0);
    }, 250);
    return () => clearInterval(id);
  }, [qaPhase]);

  // ปักหมุด Timeline ระหว่างคำถามแทรก
  useEffect(() => {
    if (qaPhase !== 'answering' || !startedAt.current) return;
    if (recorder.isDeadAir) {
      const t = Number(((Date.now() - startedAt.current) / 1000).toFixed(1));
      timelineEventsRef.current.push({ t, type: 'deadair', label: 'เงียบค้าง (> 2.5 วิ)' });
    }
  }, [qaPhase, recorder.isDeadAir]);

  useEffect(() => {
    if (qaPhase === 'idle' || !startedAt.current || !vision) return;
    if (vision.lookingDownCount > lastLookingDownRef.current) {
      lastLookingDownRef.current = vision.lookingDownCount;
      const t = Number(((Date.now() - startedAt.current) / 1000).toFixed(1));
      timelineEventsRef.current.push({ t, type: 'eye', label: 'ก้มอ่าน / สายตาหลุดกล้อง' });
    }
  }, [qaPhase, vision?.lookingDownCount]);

  useEffect(() => {
    if (qaPhase !== 'answering' || !startedAt.current || liveWpm <= 0) return;
    const t = Number(((Date.now() - startedAt.current) / 1000).toFixed(1));
    if (t - lastPacePinAtRef.current < 4) return;
    if (liveWpm > LIVE_PACE_FAST) {
      lastPacePinAtRef.current = t;
      timelineEventsRef.current.push({ t, type: 'pace_fast', label: `พูดเร็ว (${liveWpm} คำ/นาที)` });
    } else if (liveWpm < LIVE_PACE_SLOW && elapsed >= PACE_WARMUP_SEC) {
      lastPacePinAtRef.current = t;
      timelineEventsRef.current.push({ t, type: 'pace_slow', label: `พูดช้า (${liveWpm} คำ/นาที)` });
    }
  }, [qaPhase, liveWpm, elapsed]);

  useEffect(() => {
    if (qaPhase !== 'answering' || !startedAt.current || !answerText) return;
    const { fillers } = analyze(answerText, 1);
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
  }, [qaPhase, answerText]);

  const stopRecordingNow = async () => {
    stopSpeaking();
    recorder.stopTtsMix();
    recorder.setDeadAirPaused(false);
    speech.stop();
    const recResult = await recorder.stop();
    const videoResult = await videoRecorder.stop();
    vision?.stopTracking();
    setQaPhase('idle');

    const duration = startedAt.current ? Math.max(0.5, (Date.now() - startedAt.current) / 1000) : 0;
    const media = {
      audioUrl: recResult?.audioUrl || recordedMediaRef.current?.audioUrl || null,
      videoUrl: videoResult?.videoUrl || recordedMediaRef.current?.videoUrl || null,
      videoExt: videoResult?.videoExt || recordedMediaRef.current?.videoExt || 'webm',
      duration,
      timelineEvents: [...timelineEventsRef.current],
    };
    recordedMediaRef.current = media;
    return media;
  };

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const data = await generateInterruptQuestion({
          slideNumber,
          slideTitle,
          slideText,
          slideImageBase64,
          transcript,
          audience,
        });
        if (!active) return;
        setQuestion(data);
        setLoading(false);

        if (data?.question) {
          onSpeakQuestion?.(data.question);
          startedAt.current = Date.now();
          answerStartedAt.current = 0;
          timelineEventsRef.current = [{ t: 0, type: 'qa', label: 'กรรมการถามแทรก' }];
          lastPacePinAtRef.current = -10;
          lastLookingDownRef.current = 0;
          lastFillerCountRef.current = 0;
          recordedMediaRef.current = null;
          setQaPhase('asking');
          recorder.setDeadAirPaused(true);

          const audioStream = await recorder.start();
          if (!active) {
            await recorder.stop();
            return;
          }
          if (vision?.cameraActive) {
            vision.startTracking();
            videoRecorder.start(vision.getStream(), audioStream);
          }

          await speakQuestion(data.question, {
            useGemini: useGeminiTts,
            onAudioUrl: (url) => recorder.playTtsIntoMix(url),
          });
          if (!active) return;

          const ansNow = Date.now();
          answerStartedAt.current = ansNow;
          const ansT = Number(((ansNow - startedAt.current) / 1000).toFixed(1));
          timelineEventsRef.current.push({ t: ansT, type: 'qa', label: 'เริ่มตอบคำถาม' });
          recorder.setDeadAirPaused(false);
          setQaPhase('answering');
          speech.start();
        }
      } catch (err) {
        if (active) {
          setError(err.message || 'ไม่สามารถสร้างคำถามแทรกได้');
          setLoading(false);
        }
      }
    }
    void load();
    return () => {
      active = false;
      stopSpeaking();
      recorder.stopTtsMix();
      void recorder.stop();
      void videoRecorder.stop();
      vision?.stopTracking();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slideNumber, slideTitle, slideText, slideImageBase64, transcript, audience]);

  async function toggleMic() {
    if (speech.listening || recorder.recording || qaPhase !== 'idle') {
      await stopRecordingNow();
    } else {
      stopSpeaking();
      startedAt.current = Date.now();
      answerStartedAt.current = Date.now();
      timelineEventsRef.current = [{ t: 0, type: 'qa', label: 'เริ่มตอบคำถาม' }];
      lastPacePinAtRef.current = -10;
      lastLookingDownRef.current = 0;
      lastFillerCountRef.current = 0;
      setElapsed(0);
      setAnswerText('');
      textRef.current = '';
      recorder.setDeadAirPaused(false);
      setQaPhase('answering');
      speech.start();
      const audioStream = await recorder.start();
      if (vision?.cameraActive) {
        vision.startTracking();
        videoRecorder.start(vision.getStream(), audioStream);
      }
    }
  }

  async function handleSubmit() {
    if (!question?.question || evaluating) return;
    let media = recordedMediaRef.current;
    if (speech.listening || recorder.recording || qaPhase !== 'idle') {
      media = await stopRecordingNow();
    }
    const ok = await askConfirm({
      key: 'token-spend',
      title: 'ยืนยันการใช้ 1 Token',
      message: 'ระบบจะใช้ 1 Token เพื่อตรวจคำตอบคำถามแทรกนี้ด้วย AI',
      confirmText: 'ใช้ 1 Token',
    });
    if (!ok) return;
    setEvaluating(true);
    setError(null);
    try {
      const result = await evaluateQaAnswer({
        question: question.question,
        slideContext: slideText,
        answerTranscript: answerText.trim(),
        audience,
        timelineEvents: media?.timelineEvents || [],
      });
      const saved = {
        slideIndex: slideNumber - 1,
        question: question.question,
        answerTranscript: answerText.trim(),
        isInterrupt: true,
        audioUrl: media?.audioUrl || null,
        videoUrl: media?.videoUrl || null,
        videoExt: media?.videoExt || 'webm',
        duration: media?.duration || 0,
        timelineEvents: media?.timelineEvents || [],
        ...result,
      };
      setEvaluation(saved);
      onSave(saved);
    } catch (err) {
      setError(err.message || 'ไม่สามารถตรวจคำตอบได้');
    } finally {
      setEvaluating(false);
    }
  }

  async function handleClose() {
    if (speech.listening || recorder.recording || qaPhase !== 'idle') {
      await stopRecordingNow();
    } else {
      stopSpeaking();
    }
    onClose();
  }

  const livePace = pace(liveWpm);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4 backdrop-blur-[2px]">
      <div className="w-full max-w-lg rounded-xl border border-line bg-white p-6 shadow-xl space-y-4">
        <div className="flex items-center justify-between border-b border-line pb-3">
          <div>
            <span className="text-xs font-medium text-accent">คำถามแทรกระหว่างพรีเซนต์</span>
            <p className="text-xs text-muted">หน้า {slideNumber}</p>
          </div>
          {question?.question && (
            <button
              type="button"
              disabled={qaPhase === 'asking'}
              onClick={async () => {
                const wasAnswering = qaPhase === 'answering' && speech.listening;
                if (wasAnswering) {
                  speech.stop();
                  recorder.setDeadAirPaused(true);
                }
                await speakQuestion(question.question, {
                  useGemini: useGeminiTts,
                  onAudioUrl: recorder.recording ? (url) => recorder.playTtsIntoMix(url) : null,
                });
                if (wasAnswering) {
                  recorder.setDeadAirPaused(false);
                  speech.start({ preserveText: true });
                }
              }}
              className="rounded-md border border-line px-2.5 py-1 text-xs text-ink transition hover:border-faint disabled:opacity-40 cursor-pointer"
            >
              ฟังซ้ำ
            </button>
          )}
        </div>

        {loading && (
          <p className="py-6 text-center text-sm text-muted">ผู้ฟังกำลังนึกคำถามแทรก...</p>
        )}

        {!loading && error && !question && (
          <div className="space-y-4">
            <p className="text-sm text-accent">{error}</p>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleClose}
                className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-paper cursor-pointer"
              >
                ไปต่อ
              </button>
            </div>
          </div>
        )}

        {!loading && question && !evaluation && (
          <div className="space-y-5">
            <p className="text-lg font-semibold leading-snug text-ink">{question.question}</p>

            {(qaPhase !== 'idle' || elapsed > 0) && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-paper px-3 py-2 text-xs">
                <div className="flex items-center gap-2.5">
                  <span className="font-mono tabular-nums text-ink">{formatTime(elapsed)}</span>
                  <span className="text-faint">•</span>
                  <span className={`font-mono tabular-nums ${livePace ? PACE_TEXT[livePace.tone] : 'text-muted'}`}>
                    {liveWpm || '–'} คำ/นาที
                  </span>
                  {livePace && (
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${PACE_PILL[livePace.tone]}`}>
                      {livePace.label}
                    </span>
                  )}
                </div>
                <span className="text-[11px] text-accent font-medium">
                  {qaPhase === 'asking' ? 'กำลังอัดช่วงกรรมการถาม...' : 'กำลังอัดคำตอบ'}
                </span>
              </div>
            )}

            {speech.supported && (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={toggleMic}
                  disabled={qaPhase === 'asking'}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition disabled:opacity-40 cursor-pointer ${
                    speech.listening
                      ? 'bg-accent text-white'
                      : 'border border-line bg-paper text-ink hover:border-faint'
                  }`}
                >
                  {qaPhase === 'asking'
                    ? 'กรรมการกำลังถาม...'
                    : speech.listening
                      ? 'หยุดอัดเสียง'
                      : 'กดเพื่อตอบด้วยเสียง'}
                </button>
              </div>
            )}

            <textarea
              rows={3}
              value={answerText}
              onChange={(e) => setAnswerText(e.target.value)}
              placeholder="พูดตอบสั้นๆ หรือพิมพ์คำตอบ..."
              className="w-full rounded-lg border border-line bg-paper p-3 text-sm focus:border-ink focus:outline-none"
            />

            {error && <p className="text-xs text-accent">{error}</p>}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={handleClose}
                className="rounded-lg border border-line px-4 py-2 text-sm text-muted hover:border-faint hover:text-ink cursor-pointer"
              >
                ข้าม
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!answerText.trim() || evaluating}
                className="rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white hover:bg-accent/90 disabled:opacity-40 cursor-pointer"
              >
                {evaluating ? 'กำลังตรวจ...' : 'ส่งคำตอบ (-1 Token)'}
              </button>
            </div>
          </div>
        )}

        {evaluation && (
          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-lg bg-paper px-3.5 py-2.5">
              <span className="text-sm font-medium text-ink">{evaluation.directness}</span>
            </div>
            <p className="text-sm text-muted">{evaluation.feedback}</p>
            {evaluation.timelineNote && (
              <p className="text-xs text-ink/85">
                <span className="font-medium">จังหวะระหว่างตอบ: </span>
                {evaluation.timelineNote}
              </p>
            )}
            {evaluation.betterAnswer && (
              <p className="rounded-lg border border-line bg-paper p-3 text-xs leading-relaxed text-ink">
                <span className="font-medium">แนวทางตอบ: </span>
                {evaluation.betterAnswer}
              </p>
            )}
            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={handleClose}
                className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-paper hover:bg-ink/85 cursor-pointer"
              >
                ซ้อมหน้าถัดไป
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
