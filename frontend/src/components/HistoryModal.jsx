import { useEffect, useState } from 'react';
import { fetchSessionDetail, fetchSessions } from '../lib/api';
import { formatTime } from '../lib/metrics';

export default function HistoryModal({ open, onClose }) {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setSelected(null);
    setError(null);
    fetchSessions()
      .then((list) => {
        if (active) setSessions(Array.isArray(list) ? list : []);
      })
      .catch((err) => {
        if (active) setError(err.message || 'โหลดประวัติการซ้อมไม่สำเร็จ');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open]);

  if (!open) return null;

  const handleSelect = async (id) => {
    setDetailLoading(true);
    setError(null);
    try {
      const detail = await fetchSessionDetail(id);
      setSelected(detail);
    } catch (err) {
      setError(err.message || 'โหลดรายละเอียดไม่สำเร็จ');
    } finally {
      setDetailLoading(false);
    }
  };

  const slides = Array.isArray(selected?.slidesJson) ? selected.slidesJson : [];
  const qaList = Array.isArray(selected?.qaJson) ? selected.qaJson : [];
  const aiSlides = Array.isArray(selected?.summaryJson?.slides) ? selected.summaryJson.slides : [];

  return (
    <div className="mx-auto max-w-3xl px-6 py-12 space-y-6">
      {/* แถบหัวข้อ */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <button
            type="button"
            onClick={() => (selected ? setSelected(null) : onClose())}
            className="mb-3 text-sm text-muted transition hover:text-ink cursor-pointer"
          >
            {selected ? '← กลับไปหน้ารายการประวัติ' : '← กลับหน้าซ้อม'}
          </button>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">ประวัติการซ้อมย้อนหลัง</h1>
          <p className="mt-1 text-sm text-muted">
            ดูคะแนน สถิติรายสไลด์ ผลถาม-ตอบ และคำแนะนำ AI จากรอบซ้อมที่ผ่านมาได้ทันทีโดยไม่เสีย Token ซ้ำ
          </p>
        </div>
      </div>

      {/* หมายเหตุเรื่องไฟล์วิดีโอ/เสียง */}
      <div className="rounded-xl border border-line bg-paper px-4 py-3 text-xs text-muted">
        หมายเหตุ: หน้าประวัติบันทึกเฉพาะสถิติ ข้อความถอดเสียง และคำแนะนำ AI (ไม่ได้บันทึกไฟล์วิดีโอและเสียง)
      </div>

      {error && <p className="text-xs text-accent">{error}</p>}

      {loading ? (
        <div className="rounded-xl border border-line bg-white p-8 text-center text-sm text-muted">
          กำลังโหลดประวัติ...
        </div>
      ) : detailLoading ? (
        <div className="rounded-xl border border-line bg-white p-8 text-center text-sm text-muted">
          กำลังโหลดรายละเอียด...
        </div>
      ) : selected ? (
        <div className="space-y-6">
          {/* การ์ดสรุปรวม */}
          <div className="rounded-xl border border-line bg-white p-5 space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-ink">{selected.deckName}</h2>
                <p className="mt-0.5 text-xs text-muted">
                  {new Date(selected.createdAt).toLocaleString('th-TH')}
                  {selected.audience ? ` · กลุ่มผู้ฟัง: ${selected.audience}` : ''}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-2 sm:grid-cols-4">
              <div className="rounded-lg border border-line bg-paper/60 p-3">
                <p className="text-[11px] text-muted">จำนวนสไลด์</p>
                <p className="mt-0.5 font-mono text-base font-medium text-ink">{selected.slideCount} หน้า</p>
              </div>
              <div className="rounded-lg border border-line bg-paper/60 p-3">
                <p className="text-[11px] text-muted">เวลารวม</p>
                <p className="mt-0.5 font-mono text-base font-medium text-ink">
                  {formatTime(selected.totalDurationSec)}
                </p>
              </div>
              <div className="rounded-lg border border-line bg-paper/60 p-3">
                <p className="text-[11px] text-muted">ความเร็วเฉลี่ย</p>
                <p className="mt-0.5 font-mono text-base font-medium text-ink">{selected.avgWpm} คำ/นาที</p>
              </div>
              <div className="rounded-lg border border-line bg-paper/60 p-3">
                <p className="text-[11px] text-muted">สบตากล้องเฉลี่ย</p>
                <p className="mt-0.5 font-mono text-base font-medium text-ink">
                  {selected.avgEyeContactPct != null ? `${selected.avgEyeContactPct}%` : '-'}
                </p>
              </div>
            </div>
          </div>

          {/* สรุปความเข้าใจจาก AI */}
          {selected.summaryJson?.listenerSummary && (
            <div className="rounded-xl border border-line bg-white p-5 space-y-3 text-sm">
              <p className="font-semibold text-ink">สรุปความเข้าใจจาก AI</p>
              <p className="text-muted leading-relaxed">{selected.summaryJson.listenerSummary}</p>
              {selected.summaryJson.topStrengths?.length > 0 && (
                <p className="text-ink">
                  <span className="font-medium">จุดเด่น: </span>
                  {selected.summaryJson.topStrengths.join(', ')}
                </p>
              )}
              {selected.summaryJson.topImprovements?.length > 0 && (
                <p className="text-ink">
                  <span className="font-medium">ควรปรับปรุง: </span>
                  {selected.summaryJson.topImprovements.join(', ')}
                </p>
              )}
            </div>
          )}

          {/* รายละเอียดรายสไลด์ */}
          {slides.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-ink">รายละเอียดรายสไลด์ ({slides.length} หน้า)</h3>
              {slides.map((s, idx) => {
                const slideIndex = s.index ?? idx;
                const aiSlide = aiSlides.find((x) => x.index === slideIndex);
                return (
                  <div key={idx} className="rounded-xl border border-line bg-white p-5 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2.5">
                      <p className="text-sm font-medium text-ink">
                        สไลด์ {slideIndex + 1}
                        {s.title ? ` · ${s.title}` : ''}
                      </p>
                      <div className="flex flex-wrap items-center gap-3 font-mono text-xs text-muted">
                        <span>เวลา {formatTime(s.duration || 0)}</span>
                        <span>{s.wpm || 0} คำ/นาที</span>
                        <span>คำติดปาก {s.fillersCount ?? 0}</span>
                        {s.eyeContactPct != null && <span>สบตา {s.eyeContactPct}%</span>}
                      </div>
                    </div>

                    <div className="rounded-lg bg-paper p-3 text-sm leading-relaxed text-ink/90">
                      {s.transcript ? (
                        <p>"{s.transcript}"</p>
                      ) : (
                        <p className="text-xs italic text-faint">ไม่มีข้อความถอดเสียงในสไลด์นี้</p>
                      )}
                    </div>

                    {aiSlide && (
                      <div className="rounded-lg border border-line bg-paper/60 p-3 text-xs space-y-1.5">
                        {aiSlide.missed?.length > 0 && (
                          <div>
                            <span className="font-medium text-accent">ประเด็นที่ยังไม่ได้พูด: </span>
                            <span className="text-muted">{aiSlide.missed.join(' · ')}</span>
                          </div>
                        )}
                        {aiSlide.polishedScript && (
                          <div>
                            <span className="font-medium text-ink">ตัวอย่างประโยคที่กระชับขึ้น: </span>
                            <span className="text-ink/90">{aiSlide.polishedScript}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* ผลช่วงถาม-ตอบ */}
          {qaList.length > 0 && (
            <div className="rounded-xl border border-line bg-white p-5 space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-ink">ผลช่วงถาม-ตอบ ({qaList.length} ข้อ)</h3>
              </div>
              <div className="space-y-3">
                {qaList.map((q, idx) => (
                  <div key={idx} className="rounded-lg border border-line bg-paper/50 p-4 space-y-2 text-sm">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="space-y-1">
                        {q.isInterrupt && (
                          <span className="inline-block rounded border border-line bg-paper px-2 py-0.5 text-[11px] font-medium text-accent">
                            ถามแทรกหน้า {(q.slideIndex ?? 0) + 1}
                          </span>
                        )}
                        <p className="font-medium text-ink">
                          คำถาม {idx + 1}. {q.question}
                        </p>
                      </div>
                      {q.directness && (
                        <span className="rounded-md bg-ink px-2 py-0.5 text-xs text-paper">
                          {q.directness}
                        </span>
                      )}
                    </div>
                    {(q.answerTranscript || q.answer) && (
                      <p className="text-xs text-muted">
                        คำตอบของคุณ: "{q.answerTranscript || q.answer}"
                      </p>
                    )}
                    {q.feedback && <p className="text-xs text-muted">{q.feedback}</p>}
                    {q.betterAnswer && (
                      <p className="text-xs text-ink/90">
                        <span className="font-medium">แนวทางตอบที่กระชับขึ้น: </span>
                        {q.betterAnswer}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : sessions.length === 0 ? (
        <div className="rounded-xl border border-line bg-white p-8 text-center text-sm text-muted">
          ยังไม่มีประวัติการซ้อมที่บันทึกไว้
        </div>
      ) : (
        <div className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-white">
          {sessions.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => handleSelect(s.id)}
              className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition hover:bg-paper cursor-pointer"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink">{s.deckName}</p>
                <p className="mt-0.5 text-xs text-muted">
                  {new Date(s.createdAt).toLocaleString('th-TH')} · {s.slideCount} หน้า ·{' '}
                  {formatTime(s.totalDurationSec)} · {s.avgWpm} คำ/นาที
                </p>
              </div>
              <span className="shrink-0 rounded-md border border-line bg-paper px-3 py-1 font-mono text-xs text-ink">
                ดูรายละเอียด
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
