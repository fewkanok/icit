import { useEffect, useState } from 'react';
import { fetchPublicSession } from '../lib/api';
import { formatTime } from '../lib/metrics';
import SummaryCharts from './SummaryCharts';
import QaResultCard from './QaResultCard';
import { SkeletonDetailView } from './ui/Skeleton';

export default function PublicSharePage({ shareId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('overview');

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const ref = new URLSearchParams(window.location.search).get('ref');
      if (ref?.trim()) {
        localStorage.setItem('sq_ref', ref.trim().toUpperCase());
      }
    }
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    fetchPublicSession(shareId)
      .then((res) => {
        if (active) setData(res);
      })
      .catch((err) => {
        if (active) setError(err?.message || 'ไม่พบลิงก์สรุปผลนี้ หรือเจ้าของปิดการแชร์แล้ว');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [shareId]);

  const homeUrl = data?.referralCode
    ? `/?ref=${encodeURIComponent(data.referralCode)}`
    : '/';

  const slides = Array.isArray(data?.slidesJson) ? data.slidesJson : [];
  const qaList = Array.isArray(data?.qaJson) ? data.qaJson : [];
  const aiSlides = Array.isArray(data?.summaryJson?.slides) ? data.summaryJson.slides : [];
  const participants = Array.isArray(data?.participants) ? data.participants : [];

  return (
    <div className="min-h-screen bg-paper text-ink">
      <header className="border-b border-line bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3.5 sm:px-6">
          <a href={homeUrl} className="inline-flex items-center gap-2 text-base font-semibold tracking-tight text-stone-900">
            <span className="size-2.5 shrink-0 rounded-full bg-accent" />
            <span>Zomgon</span>
          </a>
          <a
            href={homeUrl}
            className="rounded-xl bg-accent px-4 py-2 text-xs font-semibold text-white transition hover:bg-accent/90"
          >
            ลองซ้อมพรีเซนต์ฟรี
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10 space-y-6">
        {loading ? (
          <SkeletonDetailView />
        ) : error || !data ? (
          <div className="rounded-2xl border border-line bg-white p-8 text-center space-y-4">
            <h1 className="text-xl font-semibold text-stone-900">ไม่พบสรุปผลการซ้อมนี้</h1>
            <p className="text-sm text-muted">
              {error || 'ลิงก์อาจไม่ถูกต้อง หรือเจ้าของได้ปิดการแชร์สาธารณะแล้ว'}
            </p>
            <a
              href="/"
              className="inline-flex rounded-xl bg-ink px-5 py-2.5 text-sm font-medium text-paper transition hover:bg-ink/90"
            >
              ไปหน้าแรก
            </a>
          </div>
        ) : (
          <>
            {/* หัวข้อสรุปผล */}
            <div className="rounded-2xl bg-white p-6 shadow-[0_1px_4px_rgba(27,27,26,0.06)] space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-paper px-3 py-1 text-xs font-medium text-ink">
                      {data.isGroup ? 'ซ้อมกลุ่ม' : 'ซ้อมเดี่ยว'}
                    </span>
                    <span className="text-xs text-muted">
                      โดย {data.ownerName || 'ผู้ซ้อม'} · {new Date(data.createdAt).toLocaleString('th-TH')}
                    </span>
                  </div>
                  <h1 className="mt-2 text-2xl font-semibold tracking-tight text-stone-900">
                    {data.deckName}
                  </h1>
                </div>
              </div>

              {/* การ์ดสถิติหลัก */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-xl bg-paper/70 p-4">
                  <p className="text-xs font-medium text-muted">เวลารวม</p>
                  <p className="mt-1 font-mono text-2xl font-semibold text-stone-900">
                    {formatTime(data.totalDurationSec || 0)}
                  </p>
                </div>
                <div className="rounded-xl bg-paper/70 p-4">
                  <p className="text-xs font-medium text-muted">ความเร็วเฉลี่ย</p>
                  <p className="mt-1 font-mono text-2xl font-semibold text-stone-900">
                    {data.avgWpm || 0} <span className="text-sm font-normal text-muted">คำ/นาที</span>
                  </p>
                </div>
                <div className="rounded-xl bg-paper/70 p-4">
                  <p className="text-xs font-medium text-muted">จำนวนสไลด์</p>
                  <p className="mt-1 font-mono text-2xl font-semibold text-stone-900">
                    {data.slideCount || slides.length || 0} <span className="text-sm font-normal text-muted">หน้า</span>
                  </p>
                </div>
                <div className="rounded-xl bg-paper/70 p-4">
                  <p className="text-xs font-medium text-muted">สบตากล้อง</p>
                  <p className="mt-1 font-mono text-2xl font-semibold text-stone-900">
                    {data.avgEyeContactPct != null ? `${data.avgEyeContactPct}%` : '—'}
                  </p>
                </div>
              </div>
            </div>

            {/* แท็บสลับหมวด */}
            <div className="flex flex-wrap gap-2 border-b border-line pb-3">
              <button
                type="button"
                onClick={() => setTab('overview')}
                className={`rounded-lg px-4 py-2 text-sm font-medium transition cursor-pointer ${
                  tab === 'overview'
                    ? 'bg-ink text-paper'
                    : 'border border-line bg-white text-muted hover:text-ink'
                }`}
              >
                ภาพรวม &amp; คำแนะนำ
              </button>
              {slides.length > 0 && (
                <button
                  type="button"
                  onClick={() => setTab('slides')}
                  className={`rounded-lg px-4 py-2 text-sm font-medium transition cursor-pointer ${
                    tab === 'slides'
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
                  onClick={() => setTab('qa')}
                  className={`rounded-lg px-4 py-2 text-sm font-medium transition cursor-pointer ${
                    tab === 'qa'
                      ? 'bg-ink text-paper'
                      : 'border border-line bg-white text-muted hover:text-ink'
                  }`}
                >
                  ถาม-ตอบ ({qaList.length})
                </button>
              )}
            </div>

            {tab === 'overview' && (
              <div className="space-y-6">
                {data.videoUrl && (
                  <div className="rounded-2xl bg-white p-5 shadow-[0_1px_4px_rgba(27,27,26,0.06)] space-y-3">
                    <p className="text-base font-semibold text-stone-900">คลิปวิดีโอการซ้อม</p>
                    <video
                      controls
                      src={data.videoUrl}
                      className="aspect-video w-full rounded-xl bg-black"
                    />
                  </div>
                )}

                {participants.length > 0 && (
                  <div className="rounded-2xl bg-white p-5 shadow-[0_1px_4px_rgba(27,27,26,0.06)] space-y-3">
                    <p className="text-base font-semibold text-stone-900">
                      ผู้ร่วมซ้อมในห้อง ({participants.length} คน)
                    </p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {participants.map((p) => (
                        <div key={p.id} className="rounded-xl bg-paper/70 p-4 space-y-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-semibold text-stone-900">
                              {p.displayName}
                            </span>
                            <span className="font-mono text-xs text-muted">
                              {formatTime(p.durationSec || 0)} · {p.avgWpm || 0} คำ/นาที
                            </span>
                          </div>
                          {p.transcript && (
                            <p className="text-sm leading-relaxed text-muted line-clamp-3">
                              &ldquo;{p.transcript}&rdquo;
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {slides.length > 0 && (
                  <SummaryCharts
                    avgWpm={data.avgWpm || 0}
                    avgEyeContact={data.avgEyeContactPct ?? null}
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
                  />
                )}

                {data.summaryJson && (
                  <div className="rounded-2xl bg-white p-6 shadow-[0_1px_4px_rgba(27,27,26,0.06)] space-y-4">
                    <h2 className="text-lg font-semibold text-stone-900">ความเห็นภาพรวมจาก AI</h2>
                    {data.summaryJson.overallImpression && (
                      <p className="text-base leading-relaxed text-stone-900">
                        {data.summaryJson.overallImpression}
                      </p>
                    )}
                    {Array.isArray(data.summaryJson.strengths) &&
                      data.summaryJson.strengths.length > 0 && (
                        <div className="rounded-xl bg-ok/10 p-4 space-y-1.5">
                          <p className="text-sm font-medium text-ok">จุดแข็ง</p>
                          <ul className="list-disc pl-5 text-base leading-relaxed text-stone-900 space-y-1">
                            {data.summaryJson.strengths.map((st, idx) => (
                              <li key={idx}>{st}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    {Array.isArray(data.summaryJson.improvements) &&
                      data.summaryJson.improvements.length > 0 && (
                        <div className="rounded-xl bg-accent/5 p-4 space-y-1.5">
                          <p className="text-sm font-medium text-accent">จุดที่ควรพัฒนา</p>
                          <ul className="list-disc pl-5 text-base leading-relaxed text-stone-900 space-y-1">
                            {data.summaryJson.improvements.map((imp, idx) => (
                              <li key={idx}>{imp}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                  </div>
                )}
              </div>
            )}

            {tab === 'slides' && (
              <div className="space-y-4">
                {slides.map((s, idx) => {
                  const aiSlide = aiSlides[idx];
                  return (
                    <article
                      key={idx}
                      className="rounded-2xl bg-white p-5 sm:p-6 shadow-[0_1px_4px_rgba(27,27,26,0.06)] space-y-4"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="text-lg font-semibold text-stone-900">
                          สไลด์ {idx + 1} · {s.title || `หน้า ${idx + 1}`}
                        </h3>
                        <div className="flex flex-wrap items-center gap-2 font-mono text-xs text-muted">
                          <span className="rounded-md bg-paper px-2.5 py-1 text-ink">
                            {formatTime(s.duration || 0)}
                          </span>
                          <span className="rounded-md bg-paper px-2.5 py-1 text-ink">
                            {s.wpm || 0} คำ/นาที
                          </span>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                        <div className="rounded-xl border-l-4 border-ink/30 bg-paper/70 p-4 space-y-1.5">
                          <p className="text-sm font-medium text-muted">คำพูดที่บันทึกได้</p>
                          {s.transcript ? (
                            <p className="text-base leading-relaxed text-stone-900">
                              &ldquo;{s.transcript}&rdquo;
                            </p>
                          ) : (
                            <p className="text-base italic text-faint">ไม่มีข้อความเสียงในสไลด์นี้</p>
                          )}
                        </div>

                        {aiSlide && (aiSlide.missed?.length > 0 || aiSlide.polishedScript) && (
                          <div className="space-y-2.5">
                            {aiSlide.missed?.length > 0 && (
                              <div className="rounded-xl bg-accent/5 p-4 space-y-1">
                                <p className="text-sm font-medium text-accent">ประเด็นที่ยังไม่ได้พูด</p>
                                <p className="text-base leading-relaxed text-stone-900">
                                  {aiSlide.missed.join(' · ')}
                                </p>
                              </div>
                            )}
                            {aiSlide.polishedScript && (
                              <div className="rounded-xl bg-ok/10 p-4 space-y-1">
                                <p className="text-sm font-medium text-ok">ตัวอย่างประโยคที่กระชับขึ้น</p>
                                <p className="text-base leading-relaxed text-stone-900">
                                  {aiSlide.polishedScript}
                                </p>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}

            {tab === 'qa' && (
              <div className="space-y-4">
                {qaList.map((q, idx) => (
                  <QaResultCard
                    key={idx}
                    index={idx}
                    question={q.question}
                    isInterrupt={Boolean(q.isInterrupt)}
                    slideIndex={q.slideIndex ?? 0}
                    responderName={q.responderName || ''}
                    answerText={q.answerTranscript || q.answer || ''}
                    directness={q.directness || ''}
                    feedback={q.feedback || ''}
                    timelineNote={q.timelineNote || ''}
                    betterAnswer={q.betterAnswer || ''}
                  />
                ))}
              </div>
            )}

            {/* CTA ท้ายหน้า */}
            <div className="rounded-2xl bg-white p-6 text-center shadow-[0_1px_4px_rgba(27,27,26,0.06)] space-y-3">
              <p className="text-base font-semibold text-stone-900">
                อยากลองซ้อมพรีเซนต์พร้อม AI วิเคราะห์แบบนี้บ้างไหม?
              </p>
              <a
                href={homeUrl}
                className="inline-flex rounded-xl bg-accent px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-accent/90"
              >
                ลองซ้อมพรีเซนต์ฟรีเลย
              </a>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
