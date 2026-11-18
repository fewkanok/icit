import MiniAudioPlayer from './ui/MiniAudioPlayer';

export default function QaResultCard({
  index,
  question,
  isInterrupt = false,
  slideIndex = 0,
  responderName = '',
  answerText = '',
  directness = '',
  feedback = '',
  timelineNote = '',
  betterAnswer = '',
  audioUrl = '',
  audioDownloadName = '',
  actionSlot = null,
  replaySlot = null,
}) {
  const isGood = typeof directness === 'string' && directness.includes('ตรง');

  return (
    <article className="rounded-2xl bg-white p-5 sm:p-6 shadow-[0_1px_4px_rgba(27,27,26,0.06)] space-y-5">
      {/* หัวข้อคำถาม */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-lg bg-paper px-2.5 py-1 font-mono text-sm font-medium text-stone-900">
              ข้อ {index + 1}
            </span>
            {isInterrupt && (
              <span className="rounded-lg bg-accent/10 px-2.5 py-1 text-sm font-medium text-accent">
                ถามแทรกหน้า {(slideIndex ?? 0) + 1}
              </span>
            )}
            {responderName && (
              <span className="rounded-full bg-paper px-3 py-1 text-sm font-medium text-stone-900">
                ผู้ตอบ: {responderName}
              </span>
            )}
            {directness && (
              <span
                className={`rounded-full px-3 py-1 text-sm font-medium ${
                  isGood ? 'bg-ok/10 text-ok' : 'bg-accent/10 text-accent'
                }`}
              >
                {directness}
              </span>
            )}
          </div>
          <h4 className="text-lg sm:text-xl font-semibold leading-snug text-stone-900">
            {question}
          </h4>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {audioUrl && <MiniAudioPlayer src={audioUrl} downloadName={audioDownloadName} />}
          {actionSlot}
        </div>
      </div>

      {/* Layout 2 คอลัมน์: ซ้าย = คำตอบของคุณ, ขวา = ความเห็นกรรมการ + แนวทางตอบ */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* ฝั่งซ้าย: คำตอบของคุณ */}
        <div className="flex flex-col justify-between rounded-xl border-l-4 border-ink/30 bg-paper/70 p-4 sm:p-5 space-y-3">
          <div>
            <p className="text-sm font-medium text-muted">คำตอบของคุณ</p>
            {answerText ? (
              <p className="mt-2 text-base leading-relaxed text-stone-900">
                &ldquo;{answerText}&rdquo;
              </p>
            ) : (
              <p className="mt-2 text-base italic text-faint">ยังไม่มีข้อความคำตอบในข้อนี้</p>
            )}
          </div>
          {replaySlot}
        </div>

        {/* ฝั่งขวา: ความเห็นกรรมการ + แนวทางตอบที่แนะนำ */}
        <div className="space-y-3">
          {(feedback || timelineNote) && (
            <div className="rounded-xl bg-paper/70 p-4 sm:p-5 space-y-2">
              <p className="text-sm font-medium text-muted">ความเห็นกรรมการ</p>
              {feedback && (
                <p className="text-base leading-relaxed text-stone-900">{feedback}</p>
              )}
              {timelineNote && (
                <p className="text-base leading-relaxed text-accent">
                  <span className="font-medium text-stone-900">จังหวะระหว่างตอบ: </span>
                  {timelineNote}
                </p>
              )}
            </div>
          )}

          {betterAnswer && (
            <div className="rounded-xl bg-ok/10 p-4 sm:p-5 space-y-1.5">
              <p className="text-sm font-medium text-ok">แนวทางตอบที่แนะนำ</p>
              <p className="text-base leading-relaxed text-stone-900">{betterAnswer}</p>
            </div>
          )}

          {!feedback && !timelineNote && !betterAnswer && (
            <div className="flex h-full min-h-[96px] items-center justify-center rounded-xl bg-paper/45 p-4 text-center text-sm text-muted">
              ยังไม่ได้ประเมินคำตอบข้อนี้ด้วย AI
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
