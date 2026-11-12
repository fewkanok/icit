import { useRef, useState } from 'react';
import { formatTime, pace, PACE_TEXT } from '../lib/metrics';

export default function SummaryStep({
  deck,
  results,
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
            </div>
          );
        })}
      </div>

      {/* กล่องเฟสถัดไป (Q&A) */}
      <div className="mt-10 rounded-xl border border-dashed border-faint/70 px-5 py-4">
        <p className="text-sm font-medium">ช่วงถาม-ตอบ (AI Q&A Inquest)</p>
        <p className="mt-1 text-sm leading-6 text-muted">
          เมื่อเชื่อมกับ Gemini AI แล้ว AI จะอ่านสไลด์และข้อความที่คุณเพิ่งตรวจสอบทั้งหมดนี้ เพื่อตั้งคำถามสด 2–3 ข้อให้คุณฝึกตอบ
        </p>
      </div>

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
