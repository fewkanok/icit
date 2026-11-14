import { useEffect, useRef, useState } from 'react';
import FloatingCamera from './FloatingCamera';
import { useSpeechRecognition } from '../lib/useSpeechRecognition';
import { useFaceLandmarker } from '../lib/useFaceLandmarker';
import { useAudioRecorder } from '../lib/useAudioRecorder';
import { useVideoRecorder } from '../lib/useVideoRecorder';
import { generateQaQuestions } from '../lib/api';
import { preloadQuestionSpeech, speakQuestion, stopSpeaking } from '../lib/speech';
import { analyze, countWords, formatTime, pace, PACE_PILL, PACE_TEXT } from '../lib/metrics';

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
  useGeminiTts = false,
  onGeminiTtsToggle,
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
  const [error, setError] = useState(null);

  const [currentIdx, setCurrentIdx] = useState(0);
  const [answerText, setAnswerText] = useState('');
  const [draftAnswers, setDraftAnswers] = useState([]);
  const [evaluating, setEvaluating] = useState(false);
  const [audioLoading, setAudioLoading] = useState(false);

  const [elapsed, setElapsed] = useState(0);
  const [qaTotalSec, setQaTotalSec] = useState(0);
  const [liveWpm, setLiveWpm] = useState(0);
  const startedAt = useRef(0);
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
    if (!speech.listening || !startedAt.current) return;
    if (vision.lookingDownCount > lastLookingDownRef.current) {
      lastLookingDownRef.current = vision.lookingDownCount;
      const t = Number(((Date.now() - startedAt.current) / 1000).toFixed(1));
      qaTimelineRef.current.push({ t, type: 'eye', label: 'ก้มอ่าน / สายตาหลุดกล้อง' });
    }
  }, [speech.listening, vision.lookingDownCount]);

  useEffect(() => {
    if (!speech.listening || !startedAt.current || liveWpm <= 0) return;
    const t = Number(((Date.now() - startedAt.current) / 1000).toFixed(1));
    if (t - lastPacePinAtRef.current < 4) return;
    if (liveWpm > 180) {
      lastPacePinAtRef.current = t;
      qaTimelineRef.current.push({ t, type: 'pace_fast', label: `พูดเร็ว (${liveWpm} คำ/นาที)` });
    } else if (liveWpm < 95 && t >= 6) {
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

  // จับเวลาและคำนวณ WPM ระหว่างอัดเสียงตอบ
  useEffect(() => {
    if (!speech.listening) return;
    samples.current = [{ t: 0, w: 0 }];
    setLiveWpm(0);
    const id = setInterval(() => {
      const t = (Date.now() - startedAt.current) / 1000;
      const w = countWords(textRef.current);
      setElapsed(t);
      const s = samples.current;
      s.push({ t, w });
      while (s.length > 1 && s[1].t <= t - 10) s.shift();
      const span = t - s[0].t;
      setLiveWpm(t >= 5 && span > 0 ? Math.max(0, Math.round((w - s[0].w) / (span / 60))) : 0);
    }, 250);
    return () => clearInterval(id);
  }, [speech.listening]);

  // นับเวลารวมช่วงถาม-ตอบเทียบกับเวลาเป้าหมาย (เริ่มนับเฉพาะเมื่อโหลดคำถามเสร็จแล้ว)
  useEffect(() => {
    const qaTargetSec = (timeBudget?.qaMinutes || 0) * 60;
    if (qaTargetSec <= 0 || loading || questions.length === 0) return;
    const id = setInterval(() => setQaTotalSec((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [timeBudget?.qaMinutes, loading, questions.length]);

  const qaTargetSec = (timeBudget?.qaMinutes || 0) * 60;
  const qaRemaining = qaTargetSec > 0 ? qaTargetSec - qaTotalSec : null;
  const qaOvertime = qaRemaining !== null && qaRemaining < 0;

  const generatePromiseRef = useRef(null);

  async function loadQuestions() {
    setLoading(true);
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

  // เล่นเสียงคำถามอัตโนมัติทุกครั้งที่ขึ้นคำถามใหม่ และโหลดเสียงข้อถัดไปล่วงหน้าถ้าเปิด Gemini TTS
  useEffect(() => {
    let active = true;
    if (!loading && !evaluating && currentQ?.question) {
      if (useGeminiTts) setAudioLoading(true);
      void speakQuestion(currentQ.question, { useGemini: useGeminiTts }).finally(() => {
        if (active) setAudioLoading(false);
      });
      const nextQ = questions[currentIdx + 1];
      if (useGeminiTts && nextQ?.question && !qaOvertime) {
        void preloadQuestionSpeech(nextQ.question);
      }
    }
    return () => {
      active = false;
    };
  }, [loading, evaluating, currentIdx, currentQ?.question, questions, useGeminiTts, qaOvertime]);

  async function stopRecordingForCurrent() {
    speech.stop();
    const recResult = await recorder.stop();
    const videoResult = await videoRecorder.stop();
    vision.stopTracking();

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
    if (speech.listening) {
      await stopRecordingForCurrent();
    } else {
      stopSpeaking();
      startedAt.current = Date.now();
      qaTimelineRef.current = [{ t: 0, type: 'qa', label: `เริ่มตอบ Q&A ข้อ ${currentIdx + 1}` }];
      lastPacePinAtRef.current = -10;
      lastLookingDownRef.current = 0;
      lastFillerCountRef.current = 0;
      setElapsed(0);
      setAnswerText('');
      textRef.current = '';
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
    if (speech.listening) {
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
    <div className="mx-auto max-w-2xl px-6 py-12">
      <FloatingCamera vision={vision} live={speech.listening} />

      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          disabled={speech.listening || evaluating}
          className="text-sm text-muted transition hover:text-ink disabled:opacity-30 cursor-pointer"
        >
          ← กลับไปหน้าซ้อม
        </button>
        <div className="flex items-center gap-3">
          {onGeminiTtsToggle && (
            <button
              type="button"
              onClick={onGeminiTtsToggle}
              className={`rounded-full border px-2.5 py-1 text-xs font-medium transition cursor-pointer ${
                useGeminiTts
                  ? 'border-ink bg-ink text-paper'
                  : 'border-line bg-white text-muted hover:border-faint hover:text-ink'
              }`}
            >
              เสียง Gemini: {useGeminiTts ? 'เปิด' : 'ปิด'} (-1 Token/ข้อ)
            </button>
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
            disabled={speech.listening || vision.loadingModel}
            className="text-xs text-muted transition hover:text-ink disabled:opacity-40 cursor-pointer"
          >
            {vision.loadingModel
              ? 'กำลังโหลดกล้อง...'
              : vision.cameraActive
                ? 'ปิดกล้อง'
                : 'เปิดกล้องเช็กสายตา'}
          </button>
          <button
            onClick={onFinish}
            className="text-sm text-muted underline-offset-4 hover:text-ink hover:underline cursor-pointer"
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
        <div className="mt-8 rounded-xl border border-line bg-white p-8 text-center">
          <p className="text-sm text-muted">กำลังเตรียมคำถามจากสไลด์ของคุณ...</p>
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
          <div className="rounded-xl border border-line bg-white p-6">
            <div className="flex items-center justify-between text-xs text-muted">
              <span className="font-mono">
                คำถาม {currentIdx + 1} / {questions.length}
              </span>
              <button
                type="button"
                onClick={() => {
                  if (useGeminiTts) setAudioLoading(true);
                  void speakQuestion(currentQ.question, { useGemini: useGeminiTts }).finally(() =>
                    setAudioLoading(false),
                  );
                }}
                disabled={audioLoading}
                className="rounded-md border border-line px-2.5 py-1 text-ink transition hover:border-faint disabled:opacity-50 cursor-pointer"
              >
                {audioLoading ? 'กำลังโหลดเสียง...' : 'ฟังซ้ำ'}
              </button>
            </div>

            <p className="mt-4 text-lg font-medium leading-relaxed text-ink">{currentQ.question}</p>
            {currentQ.intent && (
              <p className="mt-2 text-xs text-muted">จุดประสงค์: {currentQ.intent}</p>
            )}
          </div>

          {/* ช่องตอบคำถาม */}
          <div className="rounded-xl border border-line bg-white p-6 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-ink">คำตอบของคุณ</span>
              {speech.supported && (
                <button
                  type="button"
                  onClick={toggleMic}
                  disabled={evaluating}
                  className={`rounded-lg px-3.5 py-1.5 text-xs font-medium transition disabled:opacity-40 cursor-pointer ${
                    speech.listening
                      ? 'bg-accent text-white'
                      : 'border border-line bg-paper text-ink hover:border-faint'
                  }`}
                >
                  {speech.listening ? 'หยุดอัดเสียง' : 'กดเพื่อตอบด้วยเสียง'}
                </button>
              )}
            </div>

            {(speech.listening || elapsed > 0) && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-paper px-3.5 py-2 text-xs">
                <div className="flex items-center gap-3">
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
                {vision.cameraActive && (
                  <span className="text-[11px] text-muted">
                    {vision.isLooking ? 'มองกล้องอยู่' : 'สายตาหลุดจากกล้อง'}
                  </span>
                )}
              </div>
            )}

            <textarea
              rows={4}
              value={answerText}
              onChange={(e) => setAnswerText(e.target.value)}
              disabled={evaluating}
              placeholder="กดปุ่มด้านบนเพื่อพูดตอบ หรือพิมพ์คำตอบที่นี่..."
              className="w-full rounded-lg border border-line bg-paper p-3.5 text-sm leading-relaxed focus:border-ink focus:outline-none disabled:opacity-60"
            />

            {error && <p className="text-xs text-accent">{error}</p>}

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <p className="text-[11px] text-muted">
                คำตอบจะถูกบันทึกไว้ก่อน (เลือกให้ AI ตรวจคำแนะนำทีหลังได้ในหน้าสรุปผล)
              </p>
              <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={handleSkip}
                disabled={evaluating}
                className="rounded-lg border border-line px-4 py-2.5 text-sm text-muted transition hover:border-faint hover:text-ink disabled:opacity-40 cursor-pointer"
              >
                {isLast || qaOvertime ? 'ข้ามและดูสรุปผล' : 'ข้ามข้อนี้'}
              </button>
              <button
                type="button"
                onClick={handleSubmitAnswer}
                disabled={!answerText.trim() || evaluating}
                className="rounded-lg bg-ink px-5 py-2.5 text-sm font-medium text-paper transition hover:bg-ink/85 disabled:opacity-40 cursor-pointer"
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
