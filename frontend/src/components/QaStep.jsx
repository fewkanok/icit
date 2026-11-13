import { useEffect, useRef, useState } from 'react';
import FloatingCamera from './FloatingCamera';
import { useSpeechRecognition } from '../lib/useSpeechRecognition';
import { useFaceLandmarker } from '../lib/useFaceLandmarker';
import { evaluateQaAnswer, generateQaQuestions } from '../lib/api';
import { speakQuestion, stopSpeaking } from '../lib/speech';
import { countWords, formatTime, pace, PACE_PILL, PACE_TEXT } from '../lib/metrics';

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
  const [evaluating, setEvaluating] = useState(false);

  const [elapsed, setElapsed] = useState(0);
  const [qaTotalSec, setQaTotalSec] = useState(0);
  const [liveWpm, setLiveWpm] = useState(0);
  const startedAt = useRef(0);
  const samples = useRef([]);
  const textRef = useRef('');

  const speech = useSpeechRecognition('th-TH');
  const vision = useFaceLandmarker();

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

  // นับเวลารวมช่วงถาม-ตอบเทียบกับเวลาเป้าหมาย
  useEffect(() => {
    const qaTargetSec = (timeBudget?.qaMinutes || 0) * 60;
    if (qaTargetSec <= 0) return;
    const id = setInterval(() => setQaTotalSec((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [timeBudget?.qaMinutes]);

  const qaTargetSec = (timeBudget?.qaMinutes || 0) * 60;
  const qaRemaining = qaTargetSec > 0 ? qaTargetSec - qaTotalSec : null;
  const qaOvertime = qaRemaining !== null && qaRemaining < 0;

  // สร้างคำถาม Q&A ทันทีเมื่อเข้ามาหน้านี้
  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const slidesPayload = deck.slides.map((s, i) => ({
          index: i,
          title: s.title || `หน้า ${i + 1}`,
          text: getSlideText(s),
          transcript: results[i]?.transcript || '',
        }));
        const data = await generateQaQuestions({
          deckName: deck.name,
          audience,
          slides: slidesPayload,
        });
        if (active) {
          setQuestions(Array.isArray(data.questions) ? data.questions : []);
        }
      } catch (err) {
        if (active) {
          setError(err.message || 'ไม่สามารถสร้างคำถามได้');
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => {
      active = false;
      stopSpeaking();
    };
  }, [deck, audience, results]);

  const currentQ = questions[currentIdx];
  const currentEval = qaResults[currentIdx];
  const isLast = currentIdx === questions.length - 1;

  // เล่นเสียงคำถามอัตโนมัติทุกครั้งที่ขึ้นคำถามใหม่
  useEffect(() => {
    if (!loading && currentQ?.question && !currentEval) {
      void speakQuestion(currentQ.question, { useGemini: useGeminiTts });
    }
  }, [loading, currentIdx, currentQ?.question, currentEval, useGeminiTts]);

  function toggleMic() {
    if (speech.listening) {
      speech.stop();
      vision.stopTracking();
    } else {
      stopSpeaking();
      startedAt.current = Date.now();
      setElapsed(0);
      setAnswerText('');
      textRef.current = '';
      speech.start();
      if (vision.cameraActive) {
        vision.startTracking();
      }
    }
  }

  async function handleSubmitAnswer() {
    if (!currentQ || evaluating) return;
    if (speech.listening) {
      speech.stop();
      vision.stopTracking();
    }

    setEvaluating(true);
    setError(null);
    try {
      const slide = deck.slides[currentQ.slideIndex ?? 0];
      const evaluation = await evaluateQaAnswer({
        question: currentQ.question,
        slideContext: getSlideText(slide),
        answerTranscript: answerText.trim(),
        audience,
      });
      const updated = [...qaResults];
      updated[currentIdx] = {
        question: currentQ.question,
        slideIndex: currentQ.slideIndex,
        answerTranscript: answerText.trim(),
        ...evaluation,
      };
      onQaResultsChange(updated);
    } catch (err) {
      setError(err.message || 'ไม่สามารถตรวจคำตอบได้');
    } finally {
      setEvaluating(false);
    }
  }

  function handleNext() {
    stopSpeaking();
    if (speech.listening) {
      speech.stop();
      vision.stopTracking();
    }
    if (isLast) {
      onFinish();
    } else {
      setCurrentIdx((prev) => prev + 1);
      setAnswerText('');
      setElapsed(0);
      setLiveWpm(0);
    }
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
              เสียง Gemini: {useGeminiTts ? 'เปิด' : 'ปิด'}
            </button>
          )}
          <button
            type="button"
            onClick={vision.cameraActive ? vision.stopCamera : vision.startCamera}
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
          <button
            onClick={onFinish}
            className="rounded-lg bg-ink px-5 py-2.5 text-sm font-medium text-paper transition hover:bg-ink/85 cursor-pointer"
          >
            ไปหน้าสรุปผล
          </button>
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
                onClick={() => void speakQuestion(currentQ.question, { useGemini: useGeminiTts })}
                className="rounded-md border border-line px-2.5 py-1 text-ink transition hover:border-faint cursor-pointer"
              >
                ฟังซ้ำ
              </button>
            </div>

            <p className="mt-4 text-lg font-medium leading-relaxed text-ink">{currentQ.question}</p>
            {currentQ.intent && (
              <p className="mt-2 text-xs text-muted">จุดประสงค์: {currentQ.intent}</p>
            )}
          </div>

          {/* ช่องตอบคำถาม */}
          {!currentEval ? (
            <div className="rounded-xl border border-line bg-white p-6 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-ink">คำตอบของคุณ</span>
                {speech.supported && (
                  <button
                    type="button"
                    onClick={toggleMic}
                    className={`rounded-lg px-3.5 py-1.5 text-xs font-medium transition cursor-pointer ${
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
                placeholder="กดปุ่มด้านบนเพื่อพูดตอบ หรือพิมพ์คำตอบที่นี่..."
                className="w-full rounded-lg border border-line bg-paper p-3.5 text-sm leading-relaxed focus:border-ink focus:outline-none"
              />

              {error && <p className="text-xs text-accent">{error}</p>}

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={handleNext}
                  className="rounded-lg border border-line px-4 py-2.5 text-sm text-muted transition hover:border-faint hover:text-ink cursor-pointer"
                >
                  ข้ามข้อนี้
                </button>
                <button
                  type="button"
                  onClick={handleSubmitAnswer}
                  disabled={!answerText.trim() || evaluating}
                  className="rounded-lg bg-ink px-5 py-2.5 text-sm font-medium text-paper transition hover:bg-ink/85 disabled:opacity-40 cursor-pointer"
                >
                  {evaluating ? 'กำลังตรวจคำตอบ...' : 'ส่งคำตอบ'}
                </button>
              </div>
            </div>
          ) : (
            /* ผลประเมินคำตอบข้อนี้ */
            <div className="rounded-xl border border-line bg-white p-6 space-y-4">
              <div className="flex items-center justify-between border-b border-line pb-3">
                <span className="text-sm font-medium text-ink">{currentEval.directness}</span>
                <span className="font-mono text-lg font-semibold text-ink">
                  {currentEval.score} / 10
                </span>
              </div>

              <div>
                <p className="text-xs text-muted">คำตอบของคุณ</p>
                <p className="mt-1 rounded-lg bg-paper p-3 text-sm text-ink/90">{currentEval.answerTranscript}</p>
              </div>

              <div>
                <p className="text-xs text-muted">ความเห็น</p>
                <p className="mt-1 text-sm leading-relaxed text-ink">{currentEval.feedback}</p>
              </div>

              {currentEval.betterAnswer && (
                <div>
                  <p className="text-xs text-muted">แนวทางตอบให้กระชับขึ้น</p>
                  <p className="mt-1 rounded-lg border border-line bg-paper p-3 text-sm leading-relaxed text-ink">
                    {currentEval.betterAnswer}
                  </p>
                </div>
              )}

              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={handleNext}
                  className="rounded-lg bg-ink px-5 py-2.5 text-sm font-medium text-paper transition hover:bg-ink/85 cursor-pointer"
                >
                  {isLast ? 'ดูสรุปผลทั้งหมด' : 'ข้อถัดไป'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
