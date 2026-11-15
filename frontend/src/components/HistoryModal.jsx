import { useEffect, useState } from 'react';
import { fetchSessionDetail, fetchSessions } from '../lib/api';
import { formatTime } from '../lib/metrics';
import SummaryCharts from './SummaryCharts';
import Pagination from './Pagination';

export default function HistoryModal({ open, onClose }) {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState(null);
  const [slideFilter, setSlideFilter] = useState('all');
  const [expandedSlides, setExpandedSlides] = useState({});
  const [detailTab, setDetailTab] = useState('overview');
  const [slidePage, setSlidePage] = useState(1);
  const [qaPage, setQaPage] = useState(1);
  const [sessionPage, setSessionPage] = useState(1);

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
        <div className="space-y-5">
          {/* แถบแท็บสลับหมวด ไม่ให้หน้ายาวลงล่าง */}
          <div className="flex flex-wrap gap-2 border-b border-line pb-3">
            <button
              type="button"
              onClick={() => setDetailTab('overview')}
              className={`rounded-lg px-3.5 py-2 text-xs font-medium transition cursor-pointer ${
                detailTab === 'overview'
                  ? 'bg-ink text-paper'
                  : 'border border-line bg-white text-muted hover:text-ink'
              }`}
            >
              ภาพรวม & คำแนะนำ
            </button>
            {slides.length > 0 && (
              <button
                type="button"
                onClick={() => setDetailTab('slides')}
                className={`rounded-lg px-3.5 py-2 text-xs font-medium transition cursor-pointer ${
                  detailTab === 'slides'
                    ? 'bg-ink text-paper'
                    : 'border border-line bg-white text-muted hover:text-ink'
                }`}
              >
                รายสไลด์ ({slides.length})
              </button>
            )}
            {qaList.length > 0 && (
              <button
                type="button"
                onClick={() => setDetailTab('qa')}
                className={`rounded-lg px-3.5 py-2 text-xs font-medium transition cursor-pointer ${
                  detailTab === 'qa'
                    ? 'bg-ink text-paper'
                    : 'border border-line bg-white text-muted hover:text-ink'
                }`}
              >
                ถาม-ตอบ ({qaList.length})
              </button>
            )}
          </div>

          {detailTab === 'overview' && (
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

          {slides.length > 0 && (
            <SummaryCharts
              avgWpm={selected.avgWpm || 0}
              avgEyeContact={selected.avgEyeContactPct ?? null}
              items={slides.map((s, idx) => {
                const slideIndex = s.index ?? idx;
                const aiSlide = aiSlides.find((x) => x.index === slideIndex);
                const missedCount = aiSlide?.missed?.length || 0;
                const fillerCount = s.fillersCount ?? 0;
                const hints = [];
                if (missedCount > 0) hints.push(`ลืม ${missedCount} ประเด็น`);
                if (fillerCount > 0) hints.push(`ติดปาก ${fillerCount}`);
                return {
                  index: slideIndex,
                  label: `สไลด์ ${slideIndex + 1}`,
                  wpm: s.wpm || 0,
                  eyeContactPct: s.eyeContactPct ?? null,
                  hasIssue: hints.length > 0,
                  issueHint: hints[0] || '',
                };
              })}
              onSelectSlide={(idx) => {
                const targetPos = slides.findIndex((s, i) => (s.index ?? i) === idx);
                setSlideFilter('all');
                setDetailTab('slides');
                setSlidePage(targetPos >= 0 ? Math.floor(targetPos / 5) + 1 : 1);
                setExpandedSlides((prev) => ({ ...prev, [idx]: true }));
              }}
            />
          )}

          {/* สรุปความเข้าใจจาก AI */}
          {selected.summaryJson?.listenerSummary && (
            <div className="rounded-xl border border-line bg-white p-6 space-y-4">
              <p className="text-base font-semibold text-ink">สรุปความเข้าใจจาก AI</p>
              <p className="text-sm text-muted leading-relaxed">{selected.summaryJson.listenerSummary}</p>
              <div className="grid gap-3 sm:grid-cols-2 pt-1">
                {selected.summaryJson.topStrengths?.length > 0 && (
                  <div className="rounded-lg border border-ok/20 bg-ok/5 p-4">
                    <p className="text-xs font-semibold text-ok">จุดเด่น</p>
                    <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-ink">
                      {selected.summaryJson.topStrengths.map((item, i) => (
                        <li key={i} className="flex gap-2">
                          <span className="text-ok">•</span>
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {selected.summaryJson.topImprovements?.length > 0 && (
                  <div className="rounded-lg border border-accent/20 bg-accent/5 p-4">
                    <p className="text-xs font-semibold text-accent">ควรปรับปรุง</p>
                    <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-ink">
                      {selected.summaryJson.topImprovements.map((item, i) => (
                        <li key={i} className="flex gap-2">
                          <span className="text-accent">•</span>
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          )}
            </div>
          )}

          {/* รายละเอียดรายสไลด์ (แบ่งหน้าละ 5) */}
          {detailTab === 'slides' && slides.length > 0 && (() => {
            const needFixCount = slides.filter((s, idx) => {
              const slideIndex = s.index ?? idx;
              const aiSlide = aiSlides.find((x) => x.index === slideIndex);
              return (aiSlide?.missed?.length || 0) > 0 || (s.fillersCount ?? 0) > 0;
            }).length;

            const filteredSlides = slides.filter((s, idx) => {
              if (slideFilter === 'all') return true;
              const slideIndex = s.index ?? idx;
              const aiSlide = aiSlides.find((x) => x.index === slideIndex);
              return (aiSlide?.missed?.length || 0) > 0 || (s.fillersCount ?? 0) > 0;
            });

            const totalSlidePages = Math.max(1, Math.ceil(filteredSlides.length / 5));
            const safeSlidePage = Math.min(slidePage, totalSlidePages);
            const pagedSlides = filteredSlides.slice((safeSlidePage - 1) * 5, safeSlidePage * 5);

            const allExpanded =
              pagedSlides.length > 0 &&
              pagedSlides.every((s, idx) => {
                const key = s.index ?? idx;
                return expandedSlides[key];
              });

            return (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-ink">รายละเอียดรายสไลด์ ({filteredSlides.length} หน้า)</h3>
                  <div className="flex flex-wrap items-center gap-2">
                    {needFixCount > 0 && (
                      <div className="flex rounded-lg border border-line bg-white p-0.5 text-xs">
                        <button
                          type="button"
                          onClick={() => {
                            setSlideFilter('all');
                            setSlidePage(1);
                          }}
                          className={`rounded-md px-2.5 py-1 transition cursor-pointer ${
                            slideFilter === 'all' ? 'bg-ink text-paper font-medium' : 'text-muted hover:text-ink'
                          }`}
                        >
                          ทั้งหมด ({slides.length})
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setSlideFilter('issues');
                            setSlidePage(1);
                          }}
                          className={`rounded-md px-2.5 py-1 transition cursor-pointer ${
                            slideFilter === 'issues' ? 'bg-accent text-white font-medium' : 'text-muted hover:text-ink'
                          }`}
                        >
                          ควรปรับ ({needFixCount})
                        </button>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        const next = { ...expandedSlides };
                        pagedSlides.forEach((s, idx) => {
                          next[s.index ?? idx] = !allExpanded;
                        });
                        setExpandedSlides(next);
                      }}
                      className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-xs text-muted hover:border-faint hover:text-ink cursor-pointer"
                    >
                      {allExpanded ? 'ย่อหน้านี้' : 'เปิดดูหน้านี้'}
                    </button>
                  </div>
                </div>

                {pagedSlides.map((s, idx) => {
                  const slideIndex = s.index ?? idx;
                  const aiSlide = aiSlides.find((x) => x.index === slideIndex);
                  const hasMissed = (aiSlide?.missed?.length || 0) > 0;
                  const isOpen = expandedSlides[slideIndex] ?? hasMissed;

                  return (
                    <div id={`history-slide-${slideIndex}`} key={slideIndex} className="rounded-xl border border-line bg-white overflow-hidden">
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedSlides((prev) => ({
                            ...prev,
                            [slideIndex]: !isOpen,
                          }))
                        }
                        className="flex w-full flex-wrap items-center justify-between gap-2 px-5 py-3.5 text-left transition hover:bg-paper/50 cursor-pointer"
                      >
                        <div className="flex flex-wrap items-center gap-2 min-w-0">
                          <span className="text-sm font-semibold text-ink">
                            สไลด์ {slideIndex + 1}
                            {s.title ? ` · ${s.title}` : ''}
                          </span>
                          {hasMissed ? (
                            <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent">
                              มีประเด็นแนะนำ
                            </span>
                          ) : (
                            <span className="rounded-full bg-ok/10 px-2 py-0.5 text-[11px] font-medium text-ok">
                              ครบถ้วน
                            </span>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-2 font-mono text-[11px]">
                          <span className="rounded-md bg-paper px-2 py-0.5 text-ink">{formatTime(s.duration || 0)}</span>
                          <span className="rounded-md bg-paper px-2 py-0.5 text-muted">{s.wpm || 0} คำ/นาที</span>
                          <span className={`rounded-md bg-paper px-2 py-0.5 ${(s.fillersCount ?? 0) > 0 ? 'text-accent font-medium' : 'text-muted'}`}>
                            คำติดปาก {s.fillersCount ?? 0}
                          </span>
                          {s.eyeContactPct != null && (
                            <span className={`rounded-md bg-paper px-2 py-0.5 ${s.eyeContactPct >= 70 ? 'text-ok' : 'text-slow'}`}>
                              สบตา {s.eyeContactPct}%
                            </span>
                          )}
                          <span className="ml-1 font-sans text-xs text-faint">{isOpen ? 'ซ่อน' : 'ดูเพิ่ม'}</span>
                        </div>
                      </button>

                      {isOpen && (
                        <div className="border-t border-line px-5 py-4 space-y-3 bg-paper/30">
                          <div>
                            <p className="mb-1 text-[11px] font-semibold text-muted">คำพูดของคุณ</p>
                            <div className="rounded-lg border border-line bg-white p-3 text-sm leading-relaxed text-ink/90">
                              {s.transcript ? (
                                <p>"{s.transcript}"</p>
                              ) : (
                                <p className="text-xs italic text-faint">ไม่มีข้อความถอดเสียงในสไลด์นี้</p>
                              )}
                            </div>
                          </div>

                          {aiSlide && (aiSlide.missed?.length > 0 || aiSlide.polishedScript) && (
                            <div className="rounded-lg border border-line bg-white p-3.5 text-xs space-y-2">
                              {aiSlide.missed?.length > 0 && (
                                <div>
                                  <p className="font-semibold text-accent">ประเด็นที่ยังไม่ได้พูด</p>
                                  <p className="mt-0.5 text-muted leading-relaxed">{aiSlide.missed.join(' · ')}</p>
                                </div>
                              )}
                              {aiSlide.polishedScript && (
                                <div>
                                  <p className="font-semibold text-ink">ตัวอย่างประโยคที่กระชับขึ้น</p>
                                  <p className="mt-0.5 text-ink/90 leading-relaxed">{aiSlide.polishedScript}</p>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
                <Pagination
                  page={safeSlidePage}
                  totalItems={filteredSlides.length}
                  pageSize={5}
                  onPageChange={setSlidePage}
                />
              </div>
            );
          })()}

          {/* ผลช่วงถาม-ตอบ (แบ่งหน้าละ 5) */}
          {detailTab === 'qa' && qaList.length > 0 && (
            <div className="rounded-xl border border-line bg-white p-5 space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-ink">ผลช่วงถาม-ตอบ ({qaList.length} ข้อ)</h3>
              </div>
              <div className="space-y-4">
                {qaList.slice((qaPage - 1) * 5, qaPage * 5).map((q, idx) => {
                  const realIdx = (qaPage - 1) * 5 + idx;
                  const isGood = typeof q.directness === 'string' && q.directness.includes('ตรง');
                  return (
                    <div key={idx} className="rounded-xl border border-line bg-paper/40 p-5 space-y-3.5 text-sm">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="space-y-1.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-md bg-white border border-line px-2 py-0.5 font-mono text-[11px] font-semibold text-ink">
                              ข้อ {(qaPage - 1) * 5 + idx + 1}
                            </span>
                            {q.isInterrupt && (
                              <span className="rounded-md border border-accent/25 bg-accent/5 px-2 py-0.5 text-[11px] font-medium text-accent">
                                ถามแทรกหน้า {(q.slideIndex ?? 0) + 1}
                              </span>
                            )}
                          </div>
                          <p className="text-base font-semibold leading-snug text-ink">{q.question}</p>
                        </div>
                        {q.directness && (
                          <span
                            className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
                              isGood ? 'bg-ok/10 text-ok' : 'bg-accent/10 text-accent'
                            }`}
                          >
                            {q.directness}
                          </span>
                        )}
                      </div>

                      {(q.answerTranscript || q.answer) && (
                        <div className="rounded-lg border border-line bg-white p-3.5">
                          <p className="text-[11px] font-semibold text-muted">คำตอบของคุณ</p>
                          <p className="mt-1 text-sm leading-relaxed text-ink/90">
                            "{q.answerTranscript || q.answer}"
                          </p>
                        </div>
                      )}

                      {q.feedback && (
                        <div className="rounded-lg border border-line bg-white/70 p-3.5">
                          <p className="text-[11px] font-semibold text-muted">ความเห็นกรรมการ</p>
                          <p className="mt-1 text-xs leading-relaxed text-ink/85">{q.feedback}</p>
                        </div>
                      )}

                      {q.betterAnswer && (
                        <div className="rounded-lg border border-ok/25 bg-ok/5 p-3.5">
                          <p className="text-[11px] font-semibold text-ok">แนวทางตอบที่แนะนำ</p>
                          <p className="mt-1 text-xs leading-relaxed text-ink">{q.betterAnswer}</p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <Pagination page={qaPage} totalItems={qaList.length} pageSize={5} onPageChange={setQaPage} />
            </div>
          )}
        </div>
      ) : sessions.length === 0 ? (
        <div className="rounded-xl border border-line bg-white p-8 text-center text-sm text-muted">
          ยังไม่มีประวัติการซ้อมที่บันทึกไว้
        </div>
      ) : (
        <div className="space-y-3">
          <div className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-white">
            {sessions.slice((sessionPage - 1) * 6, sessionPage * 6).map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => {
                  setDetailTab('overview');
                  setSlidePage(1);
                  setQaPage(1);
                  handleSelect(s.id);
                }}
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
          <Pagination
            page={sessionPage}
            totalItems={sessions.length}
            pageSize={6}
            onPageChange={setSessionPage}
          />
        </div>
      )}
    </div>
  );
}
