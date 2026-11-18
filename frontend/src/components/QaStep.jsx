import { useEffect, useRef, useState } from 'react';
import FloatingCamera from './FloatingCamera';
import { SkeletonQaCard } from './ui/Skeleton';
import { useSpeechRecognition } from '../lib/useSpeechRecognition';
import { useFaceLandmarker } from '../lib/useFaceLandmarker';
import { useAudioRecorder } from '../lib/useAudioRecorder';
import { useVideoRecorder } from '../lib/useVideoRecorder';
import { generateQaQuestions } from '../lib/api';
import { preloadAllQuestionsSpeech, preloadQuestionSpeech, speakQuestion, stopSpeaking } from '../lib/speech';
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

function getSlideText(slide) {
  if (!slide) return '';
  if (slide.text) return slide.text;
  if (slide.bullets?.length) return `${slide.title || ''} - ${slide.bullets.join(', ')}`;
  return slide.title || '';
}

export default function QaStep({
  deck,
  audience,
  timeBudget,
  cameraEnabled = true,
  onCameraToggle,
  results,
  qaResults,
  onQaResultsChange,
  onBack,
  onFinish,
}) {
  const [questions, setQuestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingStage, setLoadingStage] = useState('questions'); // 'questions' | 'audio'
  const [loadingQuestionCount, setLoadingQuestionCount] = useState(0);
  const [error, setError] = useState(null);

  const [currentIdx, setCurrentIdx] = useState(0);
  const [answerText, setAnswerText] = useState('');
  const [draftAnswers, setDraftAnswers] = useState([]);
  const [evaluating, setEvaluating] = useState(false);
  const [audioLoading, setAudioLoading] = useState(false);

  const [elapsed, setElapsed] = useState(0);
  const [qaTotalSec, setQaTotalSec] = useState(0);
  const [liveWpm, setLiveWpm] = useState(0);
  const [qaPhase, setQaPhase] = useState('idle'); // 'idle' | 'asking' | 'answering'
  const startedAt = useRef(0);
  const answerStartedAt = useRef(0);
  const samples = useRef([]);
  const textRef = useRef('');

  const speech = useSpeechRecognition('th-TH');
  const vision = useFaceLandmarker();
  const autoCameraStarted = useRef(false);

  useEffect(() => {
    if (cameraEnabled && !autoCameraStarted.current && !vision.cameraActive && !vision.loadingModel) {
      autoCameraStarted.current = true;
      void vision.startCamera();
    }
  }, [cameraEnabled, vision]);
  const recorder = useAudioRecorder({ silenceThreshold: 0.02, deadAirLimitSec: 2.5 });
  const videoRecorder = useVideoRecorder();
  const draftMediaRef = useRef({});
  const qaTimelineRef = useRef([]);
  const lastPacePinAtRef = useRef(-10);
  const lastLookingDownRef = useRef(0);
  const lastFillerCountRef = useRef(0);

  // บันทึกหมุด Timeline ระหว่างตอบ Q&A
  useEffect(() => {
    if (!speech.listening || !startedAt.current) return;
    if (recorder.isDeadAir) {
      const t = Number(((Date.now() - startedAt.current) / 1000).toFixed(1));
      qaTimelineRef.current.push({ t, type: 'deadair', label: 'เงียบค้าง (> 2.5 วิ)' });
    }
  }, [speech.listening, recorder.isDeadAir]);

  useEffect(() => {
    if (qaPhase === 'idle' || !startedAt.current) return;
    if (vision.lookingDownCount > lastLookingDownRef.current) {
      lastLookingDownRef.current = vision.lookingDownCount;
      const t = Number(((Date.now() - startedAt.current) / 1000).toFixed(1));
      qaTimelineRef.current.push({ t, type: 'eye', label: 'ก้มอ่าน / สายตาหลุดกล้อง' });
    }
  }, [qaPhase, vision.lookingDownCount]);

  useEffect(() => {
    if (!speech.listening || !startedAt.current || liveWpm <= 0) return;
    const t = Number(((Date.now() - startedAt.current) / 1000).toFixed(1));
    if (t - lastPacePinAtRef.current < 4) return;
    if (liveWpm > LIVE_PACE_FAST) {
      lastPacePinAtRef.current = t;
      qaTimelineRef.current.push({ t, type: 'pace_fast', label: `พูดเร็ว (${liveWpm} คำ/นาที)` });
    } else if (liveWpm < LIVE_PACE_SLOW && t >= PACE_WARMUP_SEC) {
      lastPacePinAtRef.current = t;
      qaTimelineRef.current.push({ t, type: 'pace_slow', label: `พูดช้า (${liveWpm} คำ/นาที)` });
    }
  }, [speech.listening, liveWpm]);

  useEffect(() => {
    if (!speech.listening || !startedAt.current || !answerText) return;
    const { fillers } = analyze(answerText, 1);
    if (fillers.total > lastFillerCountRef.current) {
      lastFillerCountRef.current = fillers.total;
      const t = Number(((Date.now() - startedAt.current) / 1000).toFixed(1));
      const topFiller = fillers.found[0]?.label;
      qaTimelineRef.current.push({
        t,
        type: 'filler',
        label: topFiller ? `พบคำติดปาก (${topFiller})` : 'พบคำติดปาก',
      });
    }
  }, [speech.listening, answerText]);

  // ซิงก์เสียงพูดสดเข้ากับช่องคำตอบ
  useEffect(() => {
    if (speech.listening) {
      const combined = `${speech.finalText} ${speech.interim}`.trim();
      setAnswerText(combined);
      textRef.current = combined;
    }
  }, [speech.listening, speech.finalText, speech.interim]);

  // จับเวลาและคำนวณ WPM เฉพาะช่วงที่เริ่มตอบคำถามจริง (ไม่นับช่วงฟังกรรมการถาม)
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

  // นับเวลารวมช่วงถาม-ตอบเทียบกับเวลาเป้าหมาย (นับเฉพาะช่วงที่ผู้พูดกำลังตอบจริง ไม่นับช่วงโหลดหรือฟังคำถาม)
  useEffect(() => {
    const qaTargetSec = (timeBudget?.qaMinutes || 0) * 60;
    if (qaTargetSec <= 0 || loading || questions.length === 0 || qaPhase !== 'answering') return;
    const id = setInterval(() => setQaTotalSec((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [timeBudget?.qaMinutes, loading, questions.length, qaPhase]);

  const qaTargetSec = (timeBudget?.qaMinutes || 0) * 60;
  const qaRemaining = qaTargetSec > 0 ? qaTargetSec - qaTotalSec : null;
  const qaOvertime = qaRemaining !== null && qaRemaining < 0;

  const generatePromiseRef = useRef(null);

  async function loadQuestions() {
    setLoading(true);
    setLoadingStage('questions');
    setLoadingQuestionCount(0);
    setError(null);
    try {
      if (!generatePromiseRef.current) {
        const slidesPayload = deck.slides.map((s, i) => ({
          index: i,
          title: s.title || `หน้า ${i + 1}`,
          text: getSlideText(s),
          transcript: results[i]?.transcript || '',
        }));
        const qaMins = timeBudget?.qaMinutes || 0;
        const questionCount =
          qaMins <= 0 ? 3 : Math.min(8, Math.max(2, Math.round((qaMins * 60) / 50)));
        generatePromiseRef.current = generateQaQuestions({
          deckName: deck.name,
          audience,
          questionCount,
          slides: slidesPayload,
        });
      }
      const data = await generatePromiseRef.current;
      const list = Array.isArray(data?.questions) ? data.questions : [];
      if (list.length === 0) {
        generatePromiseRef.current = null;
        setError('AI ไม่สามารถสร้างคำถามจากสไลด์นี้ได้');
      } else {
        // เตรียมเสียงอ่านคำถาม Edge-TTS ครบทุกข้อก่อนแสดงโจทย์และเริ่มจับเวลา
        setLoadingQuestionCount(list.length);
        setLoadingStage('audio');
        await preloadAllQuestionsSpeech(list);
        setQuestions(list);
      }
    } catch (err) {
      generatePromiseRef.current = null;
      setError(err.message || 'ไม่สามารถสร้างคำถามได้');
    } finally {
      setLoading(false);
    }
  }

  // สร้างคำถาม Q&A ทันทีเมื่อเข้ามาหน้านี้ (กันยิงซ้ำใน StrictMode)
  useEffect(() => {
    void loadQuestions();
    return () => {
      stopSpeaking();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const currentQ = questions[currentIdx];
  const isLast = currentIdx === questions.length - 1;

  // เริ่มอัดตั้งแต่กรรมการถาม -> จบคำถามแล้วเปิดไมค์ถอดเสียงและเริ่มนับ WPM อัตโนมัติ
  useEffect(() => {
    let active = true;
    if (loading || evaluating || !currentQ?.question) return () => {};

    const nextQ = questions[currentIdx + 1];
    if (nextQ?.question && !qaOvertime) {
      void preloadQuestionSpeech(nextQ.question);
    }

    async function beginQuestionTurn() {
      stopSpeaking();
      recorder.stopTtsMix();
      startedAt.current = Date.now();
      answerStartedAt.current = 0;
      qaTimelineRef.current = [{ t: 0, type: 'qa', label: `เริ่มตอบ Q&A ข้อ ${currentIdx + 1}` }];
      lastPacePinAtRef.current = -10;
      lastLookingDownRef.current = 0;
      lastFillerCountRef.current = 0;
      setElapsed(0);
      setLiveWpm(0);
      setAnswerText('');
      textRef.current = '';
      setQaPhase('asking');
      recorder.setDeadAirPaused(true);

      await speakQuestion(currentQ.question);
      if (!active) return;

      const audioStream = await recorder.start();
      if (!active) {
        await recorder.stop();
        return;
      }
      if (vision.cameraActive) {
        vision.startTracking();
        videoRecorder.start(vision.getStream(), audioStream);
      }

      const ansNow = Date.now();
      startedAt.current = ansNow;
      answerStartedAt.current = ansNow;
      recorder.setDeadAirPaused(false);
      setQaPhase('answering');
      speech.start();
    }

    void beginQuestionTurn();

    return () => {
      active = false;
      stopSpeaking();
      recorder.stopTtsMix();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, evaluating, currentIdx, currentQ?.question]);

  async function stopRecordingForCurrent() {
    stopSpeaking();
    recorder.stopTtsMix();
    recorder.setDeadAirPaused(false);
    speech.stop();
    const recResult = await recorder.stop();
    const videoResult = await videoRecorder.stop();
    vision.stopTracking();
    setQaPhase('idle');

    const prev = draftMediaRef.current[currentIdx];
    if (recResult?.audioUrl) {
      if (prev?.audioUrl && prev.audioUrl !== recResult.audioUrl) {
        URL.revokeObjectURL(prev.audioUrl);
      }
    }
    if (videoResult?.videoUrl) {
      if (prev?.videoUrl && prev.videoUrl !== videoResult.videoUrl) {
        URL.revokeObjectURL(prev.videoUrl);
      }
    }
    const duration = startedAt.current ? Math.max(0.5, (Date.now() - startedAt.current) / 1000) : 0;
    draftMediaRef.current[currentIdx] = {
      audioUrl: recResult?.audioUrl || prev?.audioUrl || null,
      videoUrl: videoResult?.videoUrl || prev?.videoUrl || null,
      videoExt: videoResult?.videoExt || prev?.videoExt || 'webm',
      duration,
      timelineEvents: [...qaTimelineRef.current],
    };
  }

  async function toggleMic() {
    if (speech.listening || recorder.recording || qaPhase !== 'idle') {
      await stopRecordingForCurrent();
    } else {
      stopSpeaking();
      startedAt.current = Date.now();
      answerStartedAt.current = Date.now();
      qaTimelineRef.current = [{ t: 0, type: 'qa', label: `เริ่มตอบ Q&A ข้อ ${currentIdx + 1}` }];
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
      if (vision.cameraActive) {
        vision.startTracking();
        videoRecorder.start(vision.getStream(), audioStream);
      }
    }
  }

  function finishAndSaveAll(allAnswers) {
    stopSpeaking();
    const answeredCount = Math.min(questions.length, currentIdx + 1);
    const targetQuestions = questions.slice(0, answeredCount);
    const savedResults = targetQuestions.map((q, idx) => {
      const media = draftMediaRef.current[idx] || {};
      const text = (allAnswers[idx] || '').trim();
      return {
        question: q.question,
        slideIndex: q.slideIndex,
        answerTranscript: text,
        audioUrl: media.audioUrl || null,
        videoUrl: media.videoUrl || null,
        videoExt: media.videoExt || 'webm',
        duration: media.duration || 0,
        timelineEvents: media.timelineEvents || [],
        score: null,
        directness: text ? '' : 'ยังไม่ได้ตอบ',
        feedback: '',
        betterAnswer: '',
      };
    });
    onQaResultsChange(savedResults);
    onFinish();
  }

  async function recordAndAdvance(answerValue) {
    if (!currentQ || evaluating) return;
    stopSpeaking();
    if (speech.listening || recorder.recording || qaPhase !== 'idle') {
      await stopRecordingForCurrent();
    }

    const updatedAnswers = [...draftAnswers];
    updatedAnswers[currentIdx] = answerValue;
    setDraftAnswers(updatedAnswers);

    if (isLast || qaOvertime) {
      finishAndSaveAll(updatedAnswers);
    } else {
      setCurrentIdx((prev) => prev + 1);
      setAnswerText('');
      textRef.current = '';
      setElapsed(0);
      setLiveWpm(0);
    }
  }

  function handleSubmitAnswer() {
    void recordAndAdvance(answerText.trim());
  }

  function handleSkip() {
    void recordAndAdvance('');
  }

  const livePace = pace(liveWpm);

  return (
    <div className="mx-auto w-full max-w-2xl px-3 py-6 sm:px-6 sm:py-12">
      <FloatingCamera vision={vision} live={speech.listening} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          onClick={onBack}
          disabled={speech.listening || evaluating}
          className="rounded-xl border border-line bg-white px-3 py-2 text-xs font-medium text-muted transition hover:border-faint hover:text-ink disabled:opacity-30 cursor-pointer"
        >
          ← กลับไปหน้าซ้อม
        </button>
        <div className="flex flex-wrap items-center gap-2">
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
            disabled={speech.listening || vision.loadingModel}
            className={`rounded-xl border px-3 py-2 text-xs font-medium transition disabled:opacity-40 cursor-pointer ${
              vision.cameraActive
                ? 'border-ink bg-ink text-paper'
                : 'border-line bg-white text-ink hover:border-faint'
            }`}
          >
            {vision.loadingModel
              ? 'กำลังโหลดกล้อง...'
              : vision.cameraActive
                ? 'ปิดกล้อง'
                : 'เปิดกล้องเช็กสายตา'}
          </button>
          <button
            onClick={onFinish}
            className="rounded-xl border border-line bg-white px-3 py-2 text-xs font-medium text-ink transition hover:border-faint cursor-pointer"
          >
            ข้ามไปหน้าสรุปผล
          </button>
        </div>
      </div>

      <div className="mt-8 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">ช่วงถาม-ตอบ</h1>
          <p className="mt-1.5 text-sm text-muted">
            ลองตอบคำถามจากสิ่งที่คุณเพิ่งนำเสนอ เพื่อเช็กความเข้าใจก่อนขึ้นเวทีจริง
          </p>
        </div>
        {qaRemaining !== null && (
          <span
            className={`rounded-full border px-3 py-1 font-mono text-xs tabular-nums ${
              qaOvertime
                ? 'border-accent bg-accent/10 text-accent font-medium'
                : qaRemaining <= 60
                  ? 'border-slow bg-slow/10 text-slow font-medium'
                  : 'border-line bg-white text-ink'
            }`}
          >
            {qaOvertime
              ? `เกินเวลา +${formatTime(Math.abs(qaRemaining))}`
              : `เหลือเวลา ${formatTime(qaRemaining)}`}
          </span>
        )}
      </div>

      {loading && (
        <div className="mt-8">
          <SkeletonQaCard
            message={
              loadingStage === 'audio'
                ? 'กำลังสร้างเสียงอ่านคำถาม...'
                : 'กำลังสร้างคำถามจากสไลด์ของคุณ...'
            }
            subMessage={
              loadingStage === 'audio'
                ? `ได้คำถามครบ ${loadingQuestionCount || ''} ข้อแล้ว กำลังเตรียมเสียงกรรมการให้พร้อมก่อนแสดงโจทย์และเริ่มจับเวลา`
                : 'AI กำลังวิเคราะห์สไลด์และคำพูดของคุณเพื่อออกแบบคำถาม รอสักครู่'
            }
          />
        </div>
      )}

      {!loading && error && questions.length === 0 && (
        <div className="mt-8 rounded-xl border border-line bg-white p-6 space-y-4">
          <p className="text-sm text-accent">{error}</p>
          <p className="text-xs text-muted">
            คุณยังสามารถดูสรุปการพูด ฟังเสียง และคะแนนสายตาในหน้าถัดไปได้ตามปกติ
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                generatePromiseRef.current = null;
                void loadQuestions();
              }}
              className="rounded-lg border border-line px-4 py-2.5 text-sm font-medium text-ink transition hover:border-faint cursor-pointer"
            >
              ลองสร้างคำถามใหม่
            </button>
            <button
              onClick={onFinish}
              className="rounded-lg bg-ink px-5 py-2.5 text-sm font-medium text-paper transition hover:bg-ink/85 cursor-pointer"
            >
              ไปหน้าสรุปผล
            </button>
          </div>
        </div>
      )}

      {!loading && currentQ && (
        <div className="mt-8 space-y-5">
          {/* การ์ดคำถาม */}
          <div className="rounded-2xl border border-line bg-white p-4 sm:p-7">
            <div className="flex items-center justify-between text-xs text-muted">
              <span className="rounded-full bg-paper border border-line px-2.5 py-0.5 font-mono text-[11px] font-medium text-ink">
                คำถาม {currentIdx + 1} / {questions.length}
              </span>
              <button
                type="button"
                onClick={async () => {
                  const wasAnswering = qaPhase === 'answering' && speech.listening;
                  if (wasAnswering) {
                    speech.stop();
                    recorder.setDeadAirPaused(true);
                  }
                  await speakQuestion(currentQ.question);
                  if (wasAnswering) {
                    recorder.setDeadAirPaused(false);
                    speech.start({ preserveText: true });
                  }
                }}
                disabled={audioLoading || qaPhase === 'asking'}
                className="rounded-lg border border-line bg-paper px-3 py-1.5 font-medium text-ink transition hover:border-faint disabled:opacity-50 cursor-pointer"
              >
                {audioLoading ? 'กำลังโหลดเสียง...' : 'ฟังคำถามอีกครั้ง'}
              </button>
            </div>

            <p className="mt-5 text-xl font-semibold leading-snug text-ink">{currentQ.question}</p>
            {currentQ.intent && (
              <p className="mt-2.5 text-xs leading-relaxed text-muted">
                <span className="font-medium text-ink/75">จุดประสงค์:</span> {currentQ.intent}
              </p>
            )}
          </div>

          {/* ช่องตอบคำถาม */}
          <div className="rounded-2xl border border-line bg-white p-4 sm:p-6 space-y-4 shadow-[0_1px_4px_rgba(27,27,26,0.05)]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <span className="text-sm font-semibold text-ink">คำตอบของคุณ</span>
                {qaPhase === 'asking' ? (
                  <span className="rounded-full bg-paper px-2.5 py-0.5 text-xs font-medium text-muted">
                    กรรมการกำลังถาม...
                  </span>
                ) : speech.listening ? (
                  <span className="flex items-center gap-1.5 text-xs font-medium text-accent">
                    <span className="size-1.5 rounded-full bg-accent animate-pulse" />
                    กำลังฟัง &amp; บันทึกเสียง
                  </span>
                ) : null}
              </div>
              {speech.supported && (
                <button
                  type="button"
                  onClick={toggleMic}
                  disabled={evaluating || qaPhase === 'asking'}
                  className={`rounded-lg px-3.5 py-1.5 text-xs font-medium transition disabled:opacity-40 cursor-pointer ${
                    speech.listening
                      ? 'bg-accent text-white'
                      : 'border border-line bg-paper text-ink hover:border-faint'
                  }`}
                >
                  {qaPhase === 'asking'
                    ? 'รอฟังคำถาม...'
                    : speech.listening
                      ? 'หยุดอัดเสียง'
                      : 'กดเพื่อตอบด้วยเสียง'}
                </button>
              )}
            </div>

            {(speech.listening || elapsed > 0) && (
              <div className="space-y-2.5 rounded-xl bg-paper/70 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono text-3xl font-semibold tracking-tight tabular-nums text-ink">
                    {formatTime(elapsed)}
                  </span>
                  {vision.cameraActive && (
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        vision.isLooking ? 'bg-ok/10 text-ok' : 'bg-slow/10 text-slow'
                      }`}
                    >
                      {vision.isLooking ? 'มองกล้องอยู่' : 'สายตาหลุดจากกล้อง'}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span
                    className={`rounded-full px-2.5 py-0.5 font-medium ${
                      livePace ? PACE_PILL[livePace.tone] : 'bg-white text-muted border border-line'
                    }`}
                  >
                    {elapsed < PACE_WARMUP_SEC
                      ? 'กำลังจับจังหวะ...'
                      : livePace
                        ? `${livePace.label} · ${liveWpm} คำ/นาที`
                        : 'กำลังฟัง...'}
                  </span>
                </div>
              </div>
            )}

            <textarea
              rows={4}
              value={answerText}
              onChange={(e) => setAnswerText(e.target.value)}
              disabled={evaluating}
              placeholder="กดปุ่มด้านบนเพื่อพูดตอบ หรือพิมพ์คำตอบที่นี่..."
              className="w-full rounded-xl border border-line bg-paper p-3.5 text-base leading-relaxed focus:border-ink focus:outline-none disabled:opacity-60"
            />

            {error && <p className="text-xs text-accent">{error}</p>}

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <p className="text-[11px] text-muted">
                คำตอบจะถูกบันทึกไว้ก่อน (เลือกให้ AI ตรวจคำแนะนำทีหลังได้ในหน้าสรุปผล)
              </p>
              <div className="flex flex-wrap justify-end gap-2 w-full sm:w-auto">
              <button
                type="button"
                onClick={handleSkip}
                disabled={evaluating}
                className="min-h-[44px] flex-1 sm:flex-initial rounded-lg border border-line px-4 py-2.5 text-sm text-muted transition hover:border-faint hover:text-ink disabled:opacity-40 cursor-pointer"
              >
                {isLast || qaOvertime ? 'ข้ามและดูสรุปผล' : 'ข้ามข้อนี้'}
              </button>
              <button
                type="button"
                onClick={handleSubmitAnswer}
                disabled={!answerText.trim() || evaluating}
                className="min-h-[44px] flex-1 sm:flex-initial rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-accent/90 disabled:opacity-40 cursor-pointer"
              >
                {evaluating
                  ? 'กำลังตรวจคำตอบทั้งหมด...'
                  : isLast || qaOvertime
                    ? 'ส่งคำตอบและดูสรุปผล'
                    : 'ส่งคำตอบและไปข้อถัดไป'}
              </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
