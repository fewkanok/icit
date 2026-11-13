import { useEffect, useRef, useState } from 'react';
import { formatTime, pace, PACE_TEXT } from '../lib/metrics';
import { analyzeSummaryWithAi } from '../lib/api';

function getSlideText(slide) {
  if (!slide) return '';
  if (slide.text) return slide.text;
  if (slide.bullets?.length) return `${slide.title || ''} - ${slide.bullets.join(', ')}`;
  return slide.title || '';
}

export default function SummaryStep({
  deck,
  audience,
  timeBudget,
  results,
  qaResults = [],
  aiSummary,
  onAiSummaryChange,
  onBack,
  onReRecordSlide,
  onUpdateTranscript,
  onRestart,
}) {
  const rows = deck.slides.map((s, i) => ({ s, i, r: results[i] }));
  const done = rows.filter((x) => x.r);
  const totalTime = done.reduce((a, x) => a + (x.r?.duration || 0), 0);
  const totalFillers = done.reduce((a, x) => a + (x.r?.fillers?.total || 0), 0);
  const avgWpm = done.length
    ? Math.round(done.reduce((a, x) => a + (x.r?.wpm || 0), 0) / done.length)
    : 0;

  // สถิติจาก Google MediaPipe Vision
  const visionList = done.filter((x) => x.r?.vision?.cameraUsed);
  const avgEyeContact = visionList.length
    ? Math.round(visionList.reduce((a, x) => a + (x.r.vision.eyeContactPct || 0), 0) / visionList.length)
    : null;
  const totalLookingDown = visionList.reduce((a, x) => a + (x.r.vision.lookingDownCount || 0), 0);

  // สำหรับการฟังเสียง
  const audioRef = useRef(null);
  const [playingIndex, setPlayingIndex] = useState(null); // หน้าที่กำลังเล่นเสียงอยู่
  const [isPlayAll, setIsPlayAll] = useState(false); // โหมดเล่นต่อเนื่องทั้งหมด
  const [volume, setVolume] = useState(1.0); // ระดับเสียง 0.0 - 1.0

  const handleVolumeChange = (newVol) => {
    const clamped = Math.max(0, Math.min(1, newVol));
    setVolume(clamped);
    if (audioRef.current) {
      audioRef.current.volume = clamped;
    }
  };

  const handleNativeVolumeChange = () => {
    if (audioRef.current) {
      setVolume(audioRef.current.volume);
    }
  };

  // สำหรับการแก้ไขข้อความ
  const [editingIndex, setEditingIndex] = useState(null);
  const [editText, setEditText] = useState('');
  const [openVideoIndex, setOpenVideoIndex] = useState(null);

  // สำหรับวิเคราะห์ผลด้วย Gemini AI
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState(null);

  const runAiAnalysis = async () => {
    if (done.length === 0 || aiLoading) return;
    setAiLoading(true);
    setAiError(null);
    try {
      const payload = {
        deckName: deck.name,
        audience,
        slides: deck.slides.map((s, i) => ({
          index: i,
          title: s.title || `หน้า ${i + 1}`,
          text: getSlideText(s),
          transcript: results[i]?.transcript || '',
          wpm: results[i]?.wpm || 0,
          fillersCount: results[i]?.fillers?.total || 0,
          deadAirCount: results[i]?.deadAir?.count || 0,
          eyeContactPct: results[i]?.vision?.cameraUsed ? results[i].vision.eyeContactPct : null,
        })),
        qaResults: qaResults.map((q) => ({
          question: q.question,
          answerTranscript: q.answerTranscript,
          score: q.score,
        })),
      };
      const data = await analyzeSummaryWithAi(payload);
      onAiSummaryChange?.(data);
    } catch (err) {
      setAiError(err.message || 'ไม่สามารถวิเคราะห์ผลได้');
    } finally {
      setAiLoading(false);
    }
  };

  useEffect(() => {
    if (!aiSummary && done.length > 0) {
      runAiAnalysis();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ฟังก์ชันเล่นเสียงของสไลด์หน้านั้น
  const playSlide = (idx) => {
    const url = results[idx]?.audioUrl;
    if (!url) {
      console.warn('[SummaryStep] No audioUrl for slide', idx);
      return;
    }

    if (playingIndex === idx && audioRef.current && !audioRef.current.paused) {
      audioRef.current.pause();
      setPlayingIndex(null);
      setIsPlayAll(false);
      return;
    }

    setIsPlayAll(false);
    setPlayingIndex(idx);
    if (audioRef.current) {
      audioRef.current.volume = volume;
      audioRef.current.pause();
      audioRef.current.src = url;
      audioRef.current.load();
      audioRef.current.play().catch((err) => {
        console.error('[SummaryStep] Play slide error:', err);
        setPlayingIndex(null);
      });
    }
  };

  // ฟังก์ชันเล่นเสียงทุกหน้าต่อกัน
  const handlePlayAll = () => {
    if (isPlayAll && playingIndex !== null) {
      audioRef.current?.pause();
      setIsPlayAll(false);
      setPlayingIndex(null);
      return;
    }

    // หาหน้าแรกสุดที่มีไฟล์เสียง
    const firstIndex = deck.slides.findIndex((_, i) => results[i]?.audioUrl);
    if (firstIndex !== -1) {
      setIsPlayAll(true);
      setPlayingIndex(firstIndex);
      if (audioRef.current) {
        audioRef.current.volume = volume;
        audioRef.current.pause();
        audioRef.current.src = results[firstIndex].audioUrl;
        audioRef.current.load();
        audioRef.current.play().catch((err) => {
          console.error('[SummaryStep] Play all error:', err);
          setIsPlayAll(false);
          setPlayingIndex(null);
        });
      }
    }
  };

  // เมื่อเสียงของสไลด์หน้านั้นเล่นจบ
  const handleAudioEnded = () => {
    if (isPlayAll && playingIndex !== null) {
      // หาหน้าถัดไปที่มีไฟล์เสียง
      let nextIndex = -1;
      for (let i = playingIndex + 1; i < deck.slides.length; i++) {
        if (results[i]?.audioUrl) {
          nextIndex = i;
          break;
        }
      }

      if (nextIndex !== -1) {
        setPlayingIndex(nextIndex);
        if (audioRef.current) {
          audioRef.current.volume = volume;
          audioRef.current.pause();
          audioRef.current.src = results[nextIndex].audioUrl;
          audioRef.current.load();
          audioRef.current.play().catch((err) => {
            console.error('[SummaryStep] Next slide play error:', err);
            setIsPlayAll(false);
            setPlayingIndex(null);
          });
        }
      } else {
        // เล่นครบทุกหน้าแล้ว
        setIsPlayAll(false);
        setPlayingIndex(null);
      }
    } else {
      setPlayingIndex(null);
    }
  };

  // เริ่มแก้ไขข้อความ
  const handleStartEdit = (idx, currentTranscript) => {
    setEditingIndex(idx);
    setEditText(currentTranscript || '');
  };

  // บันทึกข้อความที่แก้ไข
  const handleSaveEdit = (idx) => {
    onUpdateTranscript(idx, editText);
    setEditingIndex(null);
  };

  const hasAnyAudio = rows.some((x) => x.r?.audioUrl);

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      {/* หัวข้อสรุปผล */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">สรุปการซ้อม</h1>
        <p className="mt-1 text-sm text-muted">{deck.name}</p>
      </div>

      {/* แถบควบคุมการฟังเสียงทั้งหมดแบบต่อเนื่อง พร้อมปรับลด-เพิ่มเสียง */}
      {hasAnyAudio && (
        <div className="mt-6 flex flex-col md:flex-row md:items-center justify-between gap-4 rounded-xl border border-line bg-white p-4 shadow-xs">
          {/* ฝั่งซ้าย: ปุ่มเริ่ม/หยุดเล่นต่อเนื่อง + สถานะ */}
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={handlePlayAll}
              className={`flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition cursor-pointer ${
                isPlayAll
                  ? 'bg-accent text-white shadow-xs hover:bg-accent/90'
                  : 'bg-ink text-paper hover:bg-ink/85'
              }`}
            >
              {isPlayAll ? (
                <>
                  <span className="size-2 rounded-[1px] bg-white animate-pulse" />
                  <span>หยุดเล่นต่อเนื่อง</span>
                </>
              ) : (
                <>
                  <svg viewBox="0 0 16 16" className="size-4" fill="currentColor">
                    <path d="M4.5 3.5v9l8-4.5-8-4.5z" />
                  </svg>
                  <span>ฟังทั้งหมดแบบต่อกัน</span>
                </>
              )}
            </button>

            {playingIndex !== null && (
              <span className="flex items-center gap-1.5 text-xs font-mono text-muted">
                <span className="size-1.5 rounded-full bg-accent animate-ping" />
                กำลังเล่นหน้า <span className="font-semibold text-ink">{playingIndex + 1}</span> / {deck.slides.length}
              </span>
            )}
          </div>

          {/* ฝั่งขวา: เครื่องเล่นเสียงแบบเห็นตัวควบคุม + แถบปรับระดับเสียง (Volume Slider) */}
          <div className="flex flex-wrap items-center gap-3">
            <audio
              ref={audioRef}
              controls
              onEnded={handleAudioEnded}
              onVolumeChange={handleNativeVolumeChange}
              className="h-8 max-w-[210px] sm:max-w-[240px]"
            />

            {/* แถบเลื่อนปรับลด/เพิ่มเสียง พร้อมตัวเลข % */}
            <div className="flex items-center gap-2 rounded-lg border border-line/80 bg-paper px-3 py-1.5 text-xs">
              <button
                onClick={() => handleVolumeChange(volume === 0 ? 0.8 : 0)}
                className="text-muted hover:text-ink transition cursor-pointer"
                title={volume === 0 ? "เปิดเสียง" : "ปิดเสียง (Mute)"}
              >
                {volume === 0 ? (
                  <svg viewBox="0 0 16 16" className="size-4 text-accent" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M2 2l12 12M7.5 4.5L5 6.5H2.5v3H5l2.5 2V4.5z" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : volume < 0.5 ? (
                  <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M7.5 4L4.5 6.5H2v3h2.5L7.5 12V4zM10 6.5a2.5 2.5 0 0 1 0 3" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M7.5 4L4.5 6.5H2v3h2.5L7.5 12V4zM10.5 5a4.5 4.5 0 0 1 0 6M12.5 3a7.5 7.5 0 0 1 0 10" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>

              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={volume}
                onChange={(e) => handleVolumeChange(Number(e.target.value))}
                className="w-16 sm:w-20 accent-ink cursor-pointer h-1.5"
                title={`ระดับเสียง: ${Math.round(volume * 100)}%`}
              />

              <span className="w-7 font-mono text-[11px] tabular-nums text-muted text-right">
                {Math.round(volume * 100)}%
              </span>
            </div>
          </div>
        </div>
      )}

      {/* เทียบเวลาเป้าหมาย (ถ้าตั้งไว้) */}
      {(timeBudget?.presentMinutes || 0) > 0 && (() => {
        const targetSec = timeBudget.presentMinutes * 60;
        const diff = Math.round(totalTime - targetSec);
        const onTime = diff <= 0;
        return (
          <div className="mt-6 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-white px-5 py-3.5 text-sm">
            <span className="text-muted">เวลาพรีเซนต์เทียบกับเป้าหมาย ({timeBudget.presentMinutes} นาที)</span>
            <span className={`font-mono font-medium ${onTime ? 'text-ok' : 'text-accent'}`}>
              {formatTime(totalTime)} / {formatTime(targetSec)}{' '}
              ({onTime ? `ทันเวลา เหลือ ${formatTime(Math.abs(diff))}` : `เกินเวลา +${formatTime(diff)}`})
            </span>
          </div>
        );
      })()}

      {/* สถิติรวม 3 ช่อง */}
      <div className="mt-8 grid grid-cols-3 divide-x divide-line rounded-xl border border-line bg-white">
        {[
          ['เวลารวม', formatTime(totalTime)],
          ['คำ/นาที เฉลี่ย', avgWpm || '–'],
          ['คำติดปากรวม', totalFillers > 0 ? totalFillers : 'ไม่พบ'],
        ].map(([label, value]) => (
          <div key={label} className="px-5 py-4">
            <p className="text-xs text-muted">{label}</p>
            <p className="mt-1 font-mono text-2xl tabular-nums tracking-tight">{value}</p>
          </div>
        ))}
      </div>

      {/* สรุปคะแนนสายตาและบุคลิกภาพ (Google MediaPipe Vision) ถ้ามีการเปิดใช้กล้อง */}
      {avgEyeContact !== null && (
        <div className="mt-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-line bg-white px-5 py-4">
          <div>
            <p className="text-xs font-medium text-muted">การสบตาเฉลี่ย (กล้องวัดสายตา)</p>
            <p className="mt-0.5 font-mono text-xl font-semibold tabular-nums text-ink">
              {avgEyeContact}%{' '}
              <span className={`font-sans text-xs font-medium ${avgEyeContact >= 70 ? 'text-ok' : 'text-slow'}`}>
                {avgEyeContact >= 70 ? 'สบตากับผู้ฟังได้ดีมาก' : 'ควรมองกล้องเพิ่มขึ้น'}
              </span>
            </p>
          </div>
          {totalLookingDown > 0 && (
            <div className="sm:text-right border-t sm:border-t-0 border-line/60 pt-2 sm:pt-0">
              <p className="text-xs text-muted">ก้มอ่านโพยรวม</p>
              <p className="font-mono text-base font-semibold text-accent">{totalLookingDown} ครั้ง</p>
            </div>
          )}
        </div>
      )}

      {/* ผลวิเคราะห์ความตรงสไลด์ และมุมมองคนฟัง จาก Gemini AI */}
      {aiLoading && (
        <div className="mt-4 rounded-xl border border-line bg-white px-5 py-5 text-sm text-muted">
          กำลังวิเคราะห์เนื้อหาสไลด์และความเข้าใจของผู้ฟัง...
        </div>
      )}

      {!aiLoading && aiError && (
        <div className="mt-4 flex items-center justify-between gap-4 rounded-xl border border-line bg-white px-5 py-4">
          <p className="text-xs text-accent">{aiError}</p>
          <button
            type="button"
            onClick={runAiAnalysis}
            className="shrink-0 rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink hover:border-faint cursor-pointer"
          >
            ลองวิเคราะห์อีกครั้ง
          </button>
        </div>
      )}

      {!aiLoading && aiSummary && (
        <div className="mt-4 rounded-xl border border-line bg-white p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
            <div>
              <p className="text-sm font-semibold text-ink">มุมมองคนฟังและความตรงตามสไลด์</p>
              <p className="text-xs text-muted">ประเมินจากการเทียบเนื้อหาสไลด์กับคำพูดทั้งหมด</p>
            </div>
            <div className="flex items-center gap-4 text-xs font-mono">
              <span>
                ตรงสไลด์ <strong className="text-sm text-ink">{aiSummary.alignmentScore ?? '-'}%</strong>
              </span>
              <span>
                เข้าใจง่าย <strong className="text-sm text-ink">{aiSummary.clarityScore ?? '-'}%</strong>
              </span>
              <button
                type="button"
                onClick={runAiAnalysis}
                className="font-sans rounded-md border border-line px-2.5 py-1 text-muted hover:text-ink hover:border-faint cursor-pointer"
              >
                วิเคราะห์ใหม่
              </button>
            </div>
          </div>

          {aiSummary.listenerSummary && (
            <div className="rounded-lg bg-paper p-3.5 text-sm leading-relaxed text-ink">
              <p className="text-xs font-medium text-muted mb-1">สิ่งที่คนฟังจับใจความได้</p>
              <p>{aiSummary.listenerSummary}</p>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2 text-xs">
            {aiSummary.topStrengths?.length > 0 && (
              <div className="space-y-1.5">
                <p className="font-medium text-ok">จุดเด่น</p>
                <ul className="space-y-1 text-ink/90 list-disc pl-4">
                  {aiSummary.topStrengths.map((item, idx) => (
                    <li key={idx}>{item}</li>
                  ))}
                </ul>
              </div>
            )}
            {aiSummary.topImprovements?.length > 0 && (
              <div className="space-y-1.5">
                <p className="font-medium text-accent">สิ่งที่ควรปรับ</p>
                <ul className="space-y-1 text-ink/90 list-disc pl-4">
                  {aiSummary.topImprovements.map((item, idx) => (
                    <li key={idx}>{item}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      {/* รายการสไลด์แต่ละหน้า พร้อมเครื่องเล่นเสียงและปุ่มแก้ไข */}
      <div className="mt-8 space-y-4">
        <div className="flex items-center justify-between text-xs text-muted font-medium">
          <span>รายละเอียดแต่ละหน้า ({deck.slides.length} สไลด์)</span>
          <span>คลิกที่หน้าเพื่อฟังคลิปหรือแก้ข้อความ</span>
        </div>

        {rows.map(({ s, i, r }) => {
          const p = r ? pace(r.wpm) : null;
          const isPlayingThis = playingIndex === i;
          const isEditingThis = editingIndex === i;

          return (
            <div
              key={s.id}
              className={`rounded-xl border transition-all bg-white p-5 ${
                isPlayingThis ? 'border-accent ring-1 ring-accent/30' : 'border-line'
              }`}
            >
              {/* แถวบน: ข้อมูลหน้า และ สถิติ */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <span className="flex size-6 items-center justify-center rounded-md bg-paper font-mono text-xs font-semibold text-ink">
                    {i + 1}
                  </span>
                  <span className="text-sm font-semibold text-ink truncate max-w-xs sm:max-w-md">
                    {s.title || `สไลด์หน้า ${i + 1}`}
                  </span>
                </div>

                {r ? (
                  <div className="flex items-center gap-3 text-xs font-mono tabular-nums text-muted">
                    <span>{formatTime(r.duration)}</span>
                    <span className="text-faint">•</span>
                    <span className={p ? PACE_TEXT[p.tone] : ''}>
                      {r.wpm} คำ/นาที {p && `(${p.label})`}
                    </span>
                    {r.fillers?.total > 0 && (
                      <>
                        <span className="text-faint">•</span>
                        <span className="text-accent font-sans">
                          ติดปาก: {r.fillers.found.map((f) => `${f.label}×${f.count}`).join(' ')}
                        </span>
                      </>
                    )}
                    {r.deadAir?.count > 0 && (
                      <>
                        <span className="text-faint">•</span>
                        <span className="text-slow font-sans">
                          เดดแอร์: {r.deadAir.count} ครั้ง
                        </span>
                      </>
                    )}
                    {r.vision?.cameraUsed && (
                      <>
                        <span className="text-faint">•</span>
                        <span className={r.vision.eyeContactPct >= 70 ? 'text-ok font-sans' : 'text-slow font-sans'}>
                          สบตา {r.vision.eyeContactPct}%
                        </span>
                        {r.vision.lookingDownCount > 0 && (
                          <>
                            <span className="text-faint">•</span>
                            <span className="text-accent font-sans">
                              ก้มอ่าน {r.vision.lookingDownCount} ครั้ง
                            </span>
                          </>
                        )}
                      </>
                    )}
                  </div>
                ) : (
                  <span className="text-xs text-faint">ยังไม่ได้ซ้อม</span>
                )}
              </div>

              {/* ข้อความที่พูด (โหมดแสดงผล หรือ โหมดแก้ไข) */}
              <div className="mt-4">
                {isEditingThis ? (
                  <div className="space-y-2">
                    <textarea
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      rows={3}
                      className="w-full rounded-lg border border-ink/30 bg-paper p-3 text-sm focus:border-ink focus:outline-none"
                      placeholder="พิมพ์แก้ไขข้อความที่ถอดเสียง..."
                    />
                    <div className="flex justify-end gap-2 text-xs">
                      <button
                        onClick={() => setEditingIndex(null)}
                        className="rounded-md border border-line px-3 py-1.5 transition hover:bg-paper cursor-pointer"
                      >
                        ยกเลิก
                      </button>
                      <button
                        onClick={() => handleSaveEdit(i)}
                        className="rounded-md bg-ink px-3 py-1.5 font-medium text-paper transition hover:bg-ink/85 cursor-pointer"
                      >
                        บันทึกข้อความ
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-lg bg-paper p-3.5 text-sm leading-relaxed text-ink/90">
                    {r?.transcript ? (
                      <p>"{r.transcript}"</p>
                    ) : (
                      <p className="text-faint italic">ยังไม่มีข้อความเสียงในสไลด์นี้</p>
                    )}
                  </div>
                )}

                {(() => {
                  const aiSlide = aiSummary?.slides?.find((x) => x.index === i);
                  if (!aiSlide) return null;
                  return (
                    <div className="mt-2.5 rounded-lg border border-line bg-paper/60 p-3 text-xs space-y-1.5">
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
                  );
                })()}
              </div>

              {/* แถบปุ่ม Action ด้านล่างของสไลด์นี้ */}
              <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-line/60 pt-3 text-xs">
                {/* ฝั่งซ้าย: ปุ่มฟังเสียงคลิปหน้านี้ และ Audio Player */}
                <div className="flex flex-wrap items-center gap-2">
                  {r?.audioUrl ? (
                    <>
                      <button
                        onClick={() => playSlide(i)}
                        className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition cursor-pointer ${
                          isPlayingThis
                            ? 'bg-accent text-white shadow-xs'
                            : 'border border-line bg-white hover:border-faint text-ink'
                        }`}
                      >
                        {isPlayingThis ? (
                          <>
                            <span className="size-2 rounded-[1px] bg-white animate-pulse" />
                            <span>หยุดฟัง</span>
                          </>
                        ) : (
                          <>
                            <svg viewBox="0 0 16 16" className="size-3.5" fill="currentColor">
                              <path d="M4 3.5v9l8-4.5-8-4.5z" />
                            </svg>
                            <span>ฟังคลิปหน้านี้</span>
                          </>
                        )}
                      </button>
                      <audio controls src={r.audioUrl} className="h-7 w-48 sm:w-56" />
                    </>
                  ) : (
                    <span className="text-faint italic text-[11px]">ไม่มีไฟล์เสียง</span>
                  )}
                  {r?.videoUrl && (
                    <>
                      <button
                        type="button"
                        onClick={() => setOpenVideoIndex(openVideoIndex === i ? null : i)}
                        className="rounded-md border border-line bg-white px-2.5 py-1.5 font-medium text-ink hover:border-faint cursor-pointer"
                      >
                        {openVideoIndex === i ? 'ซ่อนวิดีโอ' : 'ดูวิดีโอ'}
                      </button>
                      <a
                        href={r.videoUrl}
                        download={`slide-${i + 1}.${r.videoExt || 'webm'}`}
                        className="rounded-md border border-line bg-paper px-2.5 py-1.5 font-medium text-ink hover:border-faint"
                      >
                        ดาวน์โหลดคลิป
                      </a>
                    </>
                  )}
                </div>

                {/* ฝั่งขวา: ปุ่มแก้ไขข้อความ & อัดใหม่ */}
                <div className="flex items-center gap-2">
                  {r && !isEditingThis && (
                    <button
                      onClick={() => handleStartEdit(i, r.transcript)}
                      className="flex items-center gap-1 rounded-md px-2.5 py-1.5 text-muted hover:text-ink hover:bg-paper transition cursor-pointer"
                    >
                      <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M11.5 2.5a1.414 1.414 0 0 1 2 2L4.5 13.5l-3 1 1-3L11.5 2.5z" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      <span>แก้ข้อความ</span>
                    </button>
                  )}

                  <button
                    onClick={() => onReRecordSlide(i)}
                    className="flex items-center gap-1 rounded-md border border-line px-2.5 py-1.5 text-ink hover:border-faint hover:bg-paper transition cursor-pointer"
                  >
                    <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M2.5 8a5.5 5.5 0 0 1 9.5-3.88L14 6m-1.5 2a5.5 5.5 0 0 1-9.5 3.88L1 10" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <span>อัดใหม่หน้านี้</span>
                  </button>
                </div>
              </div>

              {r?.videoUrl && openVideoIndex === i && (
                <div className="mt-3 overflow-hidden rounded-lg border border-line bg-black">
                  <video controls src={r.videoUrl} className="max-h-72 w-full" />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ผลช่วงถาม-ตอบ */}
      {qaResults.length > 0 && (
        <div className="mt-8 rounded-xl border border-line bg-white p-5 space-y-4">
          <div>
            <h3 className="text-sm font-medium text-ink">ผลช่วงถาม-ตอบ</h3>
            <p className="mt-0.5 text-xs text-muted">
              คำถามที่ฝึกตอบ {qaResults.length} ข้อ
            </p>
          </div>

          <div className="space-y-3">
            {qaResults.map((q, idx) => (
              <div key={idx} className="rounded-lg border border-line bg-paper/50 p-4 space-y-2 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="space-y-1">
                    {q.isInterrupt && (
                      <span className="inline-block rounded bg-paper px-2 py-0.5 text-[11px] font-medium text-accent border border-line">
                        ถามแทรกหน้า {(q.slideIndex ?? 0) + 1}
                      </span>
                    )}
                    <p className="font-medium text-ink">
                      {idx + 1}. {q.question}
                    </p>
                  </div>
                  {q.score != null && (
                    <span className="rounded-md bg-ink px-2 py-0.5 font-mono text-xs text-paper">
                      {q.score}/10
                    </span>
                  )}
                </div>
                {(q.answerTranscript || q.answer) && (
                  <p className="text-xs text-muted">คำตอบของคุณ: "{q.answerTranscript || q.answer}"</p>
                )}
                {q.directness && (
                  <p className="text-xs font-medium text-ink">{q.directness}</p>
                )}
                {q.feedback && (
                  <p className="text-xs text-muted">{q.feedback}</p>
                )}
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

      {/* ปุ่มด้านล่าง */}
      <div className="mt-8 flex gap-2">
        <button
          onClick={onBack}
          className="rounded-lg border border-line px-5 py-2.5 text-sm transition hover:border-faint cursor-pointer"
        >
          กลับไปหน้าซ้อม
        </button>
        <button
          onClick={onRestart}
          className="rounded-lg bg-ink px-5 py-2.5 text-sm font-medium text-paper transition hover:bg-ink/85 cursor-pointer"
        >
          ซ้อมใหม่ทั้งหมด
        </button>
      </div>
    </div>
  );
}
