import { useEffect, useState } from 'react';
import { useSpeechRecognition } from '../lib/useSpeechRecognition';
import { evaluateQaAnswer, generateInterruptQuestion } from '../lib/api';
import { speakQuestion, stopSpeaking } from '../lib/speech';

export default function InterruptModal({
  slideNumber,
  slideTitle,
  slideText,
  slideImageBase64,
  transcript,
  audience,
  useGeminiTts = false,
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

  const speech = useSpeechRecognition('th-TH');

  useEffect(() => {
    if (speech.listening) {
      setAnswerText(`${speech.finalText} ${speech.interim}`.trim());
    }
  }, [speech.listening, speech.finalText, speech.interim]);

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
        if (active) {
          setQuestion(data);
          if (data?.question) {
            void speakQuestion(data.question, { useGemini: useGeminiTts });
            onSpeakQuestion?.(data.question);
          }
        }
      } catch (err) {
        if (active) {
          setError(err.message || 'ไม่สามารถสร้างคำถามแทรกได้');
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
  }, [slideNumber, slideTitle, slideText, slideImageBase64, transcript, audience]);

  function toggleMic() {
    if (speech.listening) {
      speech.stop();
    } else {
      stopSpeaking();
      setAnswerText('');
      speech.start();
    }
  }

  async function handleSubmit() {
    if (!question?.question || evaluating) return;
    if (speech.listening) speech.stop();
    setEvaluating(true);
    setError(null);
    try {
      const result = await evaluateQaAnswer({
        question: question.question,
        slideContext: slideText,
        answerTranscript: answerText.trim(),
        audience,
      });
      const saved = {
        slideIndex: slideNumber - 1,
        question: question.question,
        answerTranscript: answerText.trim(),
        isInterrupt: true,
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

  function handleClose() {
    stopSpeaking();
    if (speech.listening) speech.stop();
    onClose();
  }

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
              onClick={() => void speakQuestion(question.question, { useGemini: useGeminiTts })}
              className="rounded-md border border-line px-2.5 py-1 text-xs text-ink transition hover:border-faint cursor-pointer"
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
          <div className="space-y-4">
            <p className="text-base font-medium leading-relaxed text-ink">{question.question}</p>

            {speech.supported && (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={toggleMic}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition cursor-pointer ${
                    speech.listening
                      ? 'bg-accent text-white'
                      : 'border border-line bg-paper text-ink hover:border-faint'
                  }`}
                >
                  {speech.listening ? 'หยุดอัดเสียง' : 'กดเพื่อตอบด้วยเสียง'}
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
                className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-paper hover:bg-ink/85 disabled:opacity-40 cursor-pointer"
              >
                {evaluating ? 'กำลังตรวจ...' : 'ส่งคำตอบ'}
              </button>
            </div>
          </div>
        )}

        {evaluation && (
          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-lg bg-paper px-3.5 py-2.5">
              <span className="text-sm font-medium text-ink">{evaluation.directness}</span>
              <span className="font-mono text-base font-semibold text-ink">{evaluation.score} / 10</span>
            </div>
            <p className="text-sm text-muted">{evaluation.feedback}</p>
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
