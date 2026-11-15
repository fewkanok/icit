import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchGroupClips, deleteGroupClips } from '../lib/api';
import { analyze, formatTime, pace, PACE_PILL, PACE_TEXT } from '../lib/metrics';
import { mergeAudioTracks, mergeVideoTracks } from '../lib/mediaMerge';
import SummaryCharts from './SummaryCharts';
import TimelineReplayPlayer from './TimelineReplayPlayer';
import VideoLayoutModal from './VideoLayoutModal';

export default function GroupSummaryView({
  room,
  selfId,
  onBackToLobby,
  onLeaveRoom,
}) {
  const isHost = room.hostId === selfId;
  const slides = room.slides || [];
  const uploadedKey = (room.uploadedSlides || []).join(',');

  const [clips, setClips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedMember, setSelectedMember] = useState('all'); // 'all' | memberName
  const [expandedSlides, setExpandedSlides] = useState({});
  const [openReplayIdx, setOpenReplayIdx] = useState(null);
  const [showMoreMap, setShowMoreMap] = useState({});
  const [editingIdx, setEditingIdx] = useState(null);
  const [editText, setEditText] = useState('');
  const [downloadingAudioIdx, setDownloadingAudioIdx] = useState(null);
  const audioRefs = useRef({});

  const [layoutModalOpen, setLayoutModalOpen] = useState(false);
  const [merging, setMerging] = useState(false);
  const [mergeProgress, setMergeProgress] = useState(0);
  const [mergedVideoUrl, setMergedVideoUrl] = useState(null);
  const [mergedVideoExt, setMergedVideoExt] = useState('mp4');
  const [mergedAudioUrl, setMergedAudioUrl] = useState(null);
  const [audioMerging, setAudioMerging] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchGroupClips(room.code)
      .then((data) => {
        if (active) {
          setClips(data);
          setError('');
        }
      })
      .catch((err) => {
        if (active) setError(err?.message || 'โหลดผลซ้อมกลุ่มไม่สำเร็จ');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [room.code, uploadedKey]);

  useEffect(() => {
    return () => {
      if (mergedVideoUrl) URL.revokeObjectURL(mergedVideoUrl);
    };
  }, [mergedVideoUrl]);

  const clipMap = useMemo(() => new Map(clips.map((c) => [c.slideIndex, c])), [clips]);

  // รายชื่อสมาชิกที่มีข้อมูลคลิป (สำหรับแถบสลับดูรวม/แยกคน)
  const memberTabs = useMemo(() => {
    const names = [];
    const seen = new Set();
    clips.forEach((c) => {
      const name = c.memberName || 'สมาชิก';
      if (!seen.has(name)) {
        seen.add(name);
        names.push(name);
      }
    });
    return names;
  }, [clips]);

  // กรองรายการสไลด์ตามมุมมองที่เลือก (ภาพรวมทั้งกลุ่ม หรือ แยกตามชื่อ)
  const visibleRows = useMemo(() => {
    return slides
      .map((s, idx) => ({ s, idx, clip: clipMap.get(idx) || null }))
      .filter(({ clip }) => {
        if (selectedMember === 'all') return true;
        return clip && (clip.memberName || 'สมาชิก') === selectedMember;
      });
  }, [slides, clipMap, selectedMember]);

  const visibleClips = useMemo(
    () => visibleRows.map((r) => r.clip).filter(Boolean),
    [visibleRows],
  );

  const totals = useMemo(() => {
    let duration = 0;
    let words = 0;
    let fillers = 0;
    visibleClips.forEach((c) => {
      const a = c.analysis || {};
      duration += Number(a.duration || 0);
      words += Number(a.words || 0);
      fillers += Number(a.fillers?.total || 0);
    });
    const wpm = duration > 3 ? Math.round(words / (duration / 60)) : 0;
    return { duration, words, fillers, wpm };
  }, [visibleClips]);

  const issueItems = useMemo(() => {
    const out = [];
    visibleRows.forEach(({ s, idx, clip }) => {
      if (!clip) return;
      const a = clip.analysis || {};
      const p = pace(a.wpm);
      const hints = [];
      if (p && p.tone !== 'good') hints.push(p.label);
      if ((a.fillers?.total || 0) >= 3) hints.push(`ติดปาก ${a.fillers.total}`);
      if (hints.length > 0) {
        out.push({
          index: idx,
          label: `หน้า ${idx + 1}: ${s.title || `สไลด์ ${idx + 1}`}`,
          issueHint: hints.join(' · '),
        });
      }
    });
    return out;
  }, [visibleRows]);

  const videoClips = useMemo(
    () => visibleClips.filter((c) => c.mimeType?.startsWith('video/') || !c.mimeType?.startsWith('audio/')),
    [visibleClips],
  );

  // รวมเสียงอัตโนมัติตามมุมมองที่เลือก (ทั้งกลุ่มหรือรายคน)
  useEffect(() => {
    const urls = visibleClips.map((c) => c.mediaUrl).filter(Boolean);
    if (urls.length === 0) {
      setMergedAudioUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      return;
    }

    let cancelled = false;
    setAudioMerging(true);
    mergeAudioTracks(urls)
      .then((res) => {
        if (cancelled) {
          if (res?.url) URL.revokeObjectURL(res.url);
          return;
        }
        setMergedAudioUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return res?.url || null;
        });
      })
      .catch(() => {
        // ignore audio merge error if browser blocks decode
      })
      .finally(() => {
        if (!cancelled) setAudioMerging(false);
      });

    return () => {
      cancelled = true;
    };
  }, [visibleClips]);

  const handleMergeAll = async (customLayout) => {
    if (videoClips.length === 0 || merging) return;
    setLayoutModalOpen(false);
    setMerging(true);
    setMergeProgress(0);
    setError('');
    try {
      const items = videoClips.map((c) => ({
        videoUrl: c.mediaUrl,
        slide: slides[c.slideIndex] || { title: `สไลด์หน้า ${c.slideIndex + 1}` },
        qaQuestion: '',
        duration: c.analysis?.duration || 0,
      }));
      const merged = await mergeVideoTracks(
        items,
        (info) => {
          const pct = typeof info === 'number' ? info : (info?.pct ?? 0);
          setMergeProgress(Number.isFinite(pct) ? pct : 0);
        },
        {
          forceCompose: true,
          layout: customLayout,
        },
      );
      if (merged?.url) {
        if (mergedVideoUrl) URL.revokeObjectURL(mergedVideoUrl);
        setMergedVideoUrl(merged.url);
        setMergedVideoExt(merged.ext || 'mp4');
      }
    } catch (err) {
      setError(err?.message || 'รวมวิดีโอกลุ่มไม่สำเร็จ');
    } finally {
      setMerging(false);
    }
  };

  const handleBackLobbyAndClean = async () => {
    await deleteGroupClips(room.code).catch(() => {});
    onBackToLobby();
  };

  const handleLeaveAndClean = () => {
    // ปล่อยให้ Backend ลบคลิปอัตโนมัติเมื่อสมาชิกคนสุดท้ายออกจากห้องแล้วเท่านั้น
    onLeaveRoom();
  };

  const avgPace = pace(totals.wpm);

  return (
    <div className="mx-auto max-w-4xl px-6 py-10 space-y-6">
      {/* หัวข้อ */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-accent">สรุปผลการซ้อมกลุ่ม · ห้อง {room.code}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink">
            {room.deckName || 'ชุดสไลด์พรีเซนต์กลุ่ม'}
          </h1>
          <p className="mt-1 text-xs text-muted">
            คลิปและเสียงจะถูกลบออกจาก Database อัตโนมัติเมื่อสมาชิกทุกคนออกจากห้องแล้ว
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isHost && (
            <button
              type="button"
              onClick={handleBackLobbyAndClean}
              className="rounded-xl border border-line bg-white px-3.5 py-2 text-xs font-medium text-ink hover:border-faint cursor-pointer"
            >
              ซ้อมอีกรอบ (กลับ Lobby)
            </button>
          )}
          <button
            type="button"
            onClick={handleLeaveAndClean}
            className="rounded-xl bg-ink px-4 py-2 text-xs font-semibold text-paper hover:opacity-90 cursor-pointer"
          >
            จบและออกจากห้อง
          </button>
        </div>
      </div>

      {/* แถบเลือกดู: ภาพรวมทั้งกลุ่ม / แยกรายคน */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-white p-3">
        <span className="px-2 text-xs font-medium text-muted">มุมมอง:</span>
        <button
          type="button"
          onClick={() => setSelectedMember('all')}
          className={`rounded-lg px-3.5 py-1.5 text-xs font-medium transition cursor-pointer ${
            selectedMember === 'all'
              ? 'bg-ink text-paper'
              : 'bg-paper text-ink hover:bg-line/50'
          }`}
        >
          ภาพรวมทั้งกลุ่ม ({clips.length} หน้า)
        </button>
        {memberTabs.map((name) => {
          const count = clips.filter((c) => (c.memberName || 'สมาชิก') === name).length;
          return (
            <button
              key={name}
              type="button"
              onClick={() => setSelectedMember(name)}
              className={`rounded-lg px-3.5 py-1.5 text-xs font-medium transition cursor-pointer ${
                selectedMember === name
                  ? 'bg-accent text-white'
                  : 'bg-paper text-ink hover:bg-line/50'
              }`}
            >
              {name} ({count} หน้า)
            </button>
          );
        })}
      </div>

      {error && (
        <p className="rounded-xl bg-accent/10 px-4 py-2.5 text-xs text-accent">{error}</p>
      )}

      {/* การ์ดสถิติหลัก 4 ช่อง (สไตล์เดียวกับซ้อมเดี่ยว) */}
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-line bg-white p-4">
          <p className="text-xs text-muted">เวลารวม</p>
          <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-ink">
            {formatTime(totals.duration)}
          </p>
        </div>
        <div className="rounded-xl border border-line bg-white p-4">
          <p className="text-xs text-muted">ความเร็วเฉลี่ย</p>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="font-mono text-2xl font-semibold tabular-nums text-ink">
              {totals.wpm}
            </span>
            <span className="text-xs text-muted">คำ/นาที</span>
          </div>
          {avgPace && (
            <span
              className={`mt-1.5 inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${PACE_PILL[avgPace.tone]}`}
            >
              {avgPace.label}
            </span>
          )}
        </div>
        <div className="rounded-xl border border-line bg-white p-4">
          <p className="text-xs text-muted">คำติดปาก</p>
          <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-ink">
            {totals.fillers} <span className="text-xs font-normal text-muted">ครั้ง</span>
          </p>
        </div>
        <div className="rounded-xl border border-line bg-white p-4">
          <p className="text-xs text-muted">สไลด์ที่บันทึก</p>
          <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-ink">
            {visibleClips.length}/{visibleRows.length}
          </p>
        </div>
      </div>

      {/* กราฟสรุปความพร้อมและทางลัดสไลด์ที่ควรปรับ (เหมือนซ้อมเดี่ยว) */}
      {visibleClips.length > 0 && (
        <SummaryCharts
          avgWpm={totals.wpm}
          avgEyeContact={null}
          issueItems={issueItems}
          onSelectSlide={(idx) => {
            setExpandedSlides((prev) => ({ ...prev, [idx]: true }));
            document.getElementById(`group-slide-${idx}`)?.scrollIntoView({
              behavior: 'smooth',
              block: 'center',
            });
          }}
        />
      )}

      {/* กล่องไฟล์สรุปรวมทุกสไลด์ (สไตล์เดียวกับซ้อมเดี่ยว) */}
      {visibleClips.length > 0 && (
        <div className="rounded-xl border border-line bg-white p-5 space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-ink">
              {selectedMember === 'all'
                ? 'ไฟล์สรุปรวมทุกสไลด์ (พร้อมแชร์และดาวน์โหลด)'
                : `ไฟล์สรุปรวมเฉพาะของ ${selectedMember}`}
            </h3>
            <p className="mt-0.5 text-xs text-muted">
              รวมคลิปจากการซ้อมทั้งหมดไว้ในไฟล์เดียว หรือเลื่อนลงด้านล่างเพื่อดูและโหลดแยกทีละสไลด์ได้
            </p>
          </div>

          <div className="rounded-lg border border-amber-300 bg-amber-50/80 px-4 py-2.5 text-xs leading-relaxed text-amber-900">
            หมายเหตุ: คลิปและเสียงจะเก็บไว้ชั่วคราวใน Database และจะถูกลบอัตโนมัติเมื่อสมาชิกทุกคนออกจากห้องนี้ กรุณาดาวน์โหลดเก็บไว้ก่อนออก
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {mergedAudioUrl ? (
              <a
                href={mergedAudioUrl}
                download={`group-${room.code}-${selectedMember}.wav`}
                className="rounded-lg bg-ink px-4 py-2 text-xs font-medium text-paper transition hover:opacity-90"
              >
                ดาวน์โหลดเสียงรวม (.wav)
              </a>
            ) : (
              <button
                type="button"
                disabled
                className="rounded-lg bg-ink/50 px-4 py-2 text-xs font-medium text-paper cursor-not-allowed"
              >
                {audioMerging ? 'กำลังเตรียมเสียงรวม...' : 'ดาวน์โหลดเสียงรวม (.wav)'}
              </button>
            )}

            {videoClips.length > 0 && (
              <>
                {mergedVideoUrl && !merging && (
                  <a
                    href={mergedVideoUrl}
                    download={`group-${room.code}-${selectedMember}.${mergedVideoExt}`}
                    className="rounded-lg bg-accent px-4 py-2 text-xs font-medium text-white transition hover:bg-accent/90"
                  >
                    ดาวน์โหลดวิดีโอพร้อมสไลด์ (.{mergedVideoExt})
                  </a>
                )}
                <button
                  type="button"
                  disabled={merging}
                  onClick={() => setLayoutModalOpen(true)}
                  className={`rounded-lg px-4 py-2 text-xs font-medium transition disabled:opacity-50 cursor-pointer ${
                    mergedVideoUrl
                      ? 'border border-line bg-white text-ink hover:border-faint'
                      : 'bg-accent text-white hover:bg-accent/90'
                  }`}
                >
                  {merging
                    ? `กำลังสร้างไฟล์พร้อมสไลด์ ${mergeProgress}%...`
                    : mergedVideoUrl
                      ? 'จัดวางตำแหน่งใหม่'
                      : 'สร้างไฟล์ดาวน์โหลดพร้อมสไลด์ (.mp4)'}
                </button>
              </>
            )}
          </div>

          {mergedAudioUrl && (
            <div className="space-y-1.5 pt-1">
              <p className="text-[11px] text-muted">ฟังไฟล์เสียงรวมทั้งหมด</p>
              <audio controls src={mergedAudioUrl} className="w-full" />
            </div>
          )}

          {merging && (
            <div className="space-y-1.5">
              <div className="h-2 overflow-hidden rounded-full bg-paper border border-line">
                <div
                  className="h-full bg-accent transition-all"
                  style={{ width: `${Math.max(4, mergeProgress)}%` }}
                />
              </div>
              <p className="text-[11px] text-muted">
                กำลังประมวลผลรวมวิดีโอ ({mergeProgress}%)...
              </p>
            </div>
          )}

          {mergedVideoUrl && !merging && (
            <video
              controls
              src={mergedVideoUrl}
              className="aspect-video w-full rounded-lg border border-line bg-black"
            />
          )}
        </div>
      )}

      {/* รายละเอียดรายสไลด์ (พับ-กาง + TimelineReplayPlayer เหมือนซ้อมเดี่ยว) */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">
            รายละเอียดแต่ละสไลด์ ({visibleRows.length} หน้า)
          </h2>
        </div>

        {loading && clips.length === 0 ? (
          <p className="text-xs text-muted">กำลังโหลดข้อมูลคลิป...</p>
        ) : (
          visibleRows.map(({ s, idx, clip }) => {
            const a = clip?.analysis || {};
            const p = pace(a.wpm);
            const hasIssue = Boolean(
              clip && ((p && p.tone !== 'good') || (a.fillers?.total || 0) >= 3),
            );
            const isOpen = expandedSlides[idx] ?? (hasIssue || openReplayIdx === idx || visibleRows.length <= 4);

            return (
              <div
                id={`group-slide-${idx}`}
                key={s.id || idx}
                className="rounded-xl border border-line bg-white overflow-hidden"
              >
                <button
                  type="button"
                  onClick={() =>
                    setExpandedSlides((prev) => ({ ...prev, [idx]: !isOpen }))
                  }
                  className="flex w-full flex-wrap items-center justify-between gap-2 px-5 py-3.5 text-left transition hover:bg-paper/50 cursor-pointer"
                >
                  <div className="flex flex-wrap items-center gap-2 min-w-0">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-paper font-mono text-xs font-semibold text-ink">
                      {idx + 1}
                    </span>
                    <span className="text-sm font-semibold text-ink truncate max-w-xs sm:max-w-md">
                      {s.title || `สไลด์หน้า ${idx + 1}`}
                    </span>
                    {clip && (
                      <span className="rounded-full bg-paper border border-line px-2 py-0.5 text-[11px] font-medium text-ink">
                        ผู้พูด: {clip.memberName}
                      </span>
                    )}
                    {clip ? (
                      hasIssue ? (
                        <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent">
                          มีประเด็นแนะนำ
                        </span>
                      ) : (
                        <span className="rounded-full bg-ok/10 px-2 py-0.5 text-[11px] font-medium text-ok">
                          ผ่านเกณฑ์
                        </span>
                      )
                    ) : (
                      <span className="rounded-full bg-paper px-2 py-0.5 text-[11px] text-faint">
                        ยังไม่มีคลิป
                      </span>
                    )}
                  </div>

                  {clip && (
                    <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono tabular-nums">
                      <span className="rounded-md bg-paper px-2 py-0.5 text-ink">
                        {formatTime(a.duration)}
                      </span>
                      <span
                        className={`rounded-md bg-paper px-2 py-0.5 ${
                          p ? PACE_TEXT[p.tone] : 'text-muted'
                        }`}
                      >
                        {a.wpm || 0} คำ/นาที {p && `(${p.label})`}
                      </span>
                      {a.fillers?.total > 0 && (
                        <span className="rounded-md bg-accent/10 px-2 py-0.5 text-accent font-sans font-medium">
                          ติดปาก {a.fillers.total}
                        </span>
                      )}
                      <span className="ml-1 font-sans text-xs text-faint">
                        {isOpen ? 'ซ่อน' : 'ดูเพิ่ม'}
                      </span>
                    </div>
                  )}
                </button>

                {isOpen && (
                  <div className="border-t border-line px-5 pb-5 pt-4 bg-paper/20 space-y-3">
                    <div className={s.src ? 'grid gap-3 sm:grid-cols-[150px_1fr] items-start' : ''}>
                      {s.src && (
                        <div className="overflow-hidden rounded-lg border border-line bg-white">
                          <img
                            src={s.src}
                            alt={s.title || `สไลด์ ${idx + 1}`}
                            className="aspect-video w-full object-contain"
                          />
                        </div>
                      )}
                      {editingIdx === idx && clip ? (
                        <div className="rounded-lg border border-line bg-white p-3 space-y-2.5">
                          <textarea
                            rows={3}
                            value={editText}
                            onChange={(e) => setEditText(e.target.value)}
                            className="w-full rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-ink"
                            placeholder="พิมพ์ข้อความที่พูดในสไลด์หน้านี้..."
                          />
                          <div className="flex items-center gap-2 text-xs">
                            <button
                              type="button"
                              onClick={() => {
                                const durationSec = Math.max(1, Number(clip.analysis?.duration || 1));
                                const nextAnalysis = {
                                  ...analyze(editText, durationSec),
                                  transcript: editText.trim(),
                                };
                                setClips((prev) =>
                                  prev.map((c) =>
                                    c.slideIndex === idx ? { ...c, analysis: nextAnalysis } : c,
                                  ),
                                );
                                setEditingIdx(null);
                              }}
                              className="rounded-md bg-ink px-3 py-1.5 font-medium text-paper hover:opacity-90 cursor-pointer"
                            >
                              บันทึกข้อความ
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingIdx(null)}
                              className="rounded-md border border-line bg-white px-3 py-1.5 font-medium text-muted hover:text-ink cursor-pointer"
                            >
                              ยกเลิก
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="rounded-lg border border-line bg-white p-3.5 text-sm leading-relaxed text-ink/90">
                          {a.transcript ? (
                            <p>"{a.transcript}"</p>
                          ) : (
                            <p className="text-faint italic">ยังไม่มีข้อความเสียงในสไลด์นี้</p>
                          )}
                        </div>
                      )}
                    </div>

                    {clip?.mediaUrl && (
                      <div className="space-y-2 border-t border-line/60 pt-3 text-xs">
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              const el = audioRefs.current[idx];
                              if (!el) return;
                              if (el.paused) void el.play().catch(() => {});
                              else el.pause();
                            }}
                            className="rounded-md border border-line bg-white px-3 py-1.5 font-medium text-ink hover:border-faint cursor-pointer"
                          >
                            ▶ ฟังคลิปหน้านี้
                          </button>
                          <audio
                            ref={(el) => {
                              if (el) audioRefs.current[idx] = el;
                            }}
                            controls
                            src={clip.mediaUrl}
                            className="h-8 max-w-60"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              setOpenReplayIdx(openReplayIdx === idx ? null : idx)
                            }
                            className="rounded-md bg-ink px-3 py-1.5 font-medium text-white hover:opacity-90 transition cursor-pointer"
                          >
                            {openReplayIdx === idx ? 'ซ่อน Timeline Replay' : 'ดู Timeline Replay'}
                          </button>

                          {!showMoreMap[idx] && (
                            <button
                              type="button"
                              onClick={() =>
                                setShowMoreMap((prev) => ({ ...prev, [idx]: true }))
                              }
                              className="ml-auto rounded-md border border-line bg-white px-2.5 py-1.5 font-medium text-muted hover:text-ink hover:border-faint transition cursor-pointer"
                            >
                              เพิ่มเติม
                            </button>
                          )}
                        </div>

                        {showMoreMap[idx] && (
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                setShowMoreMap((prev) => ({ ...prev, [idx]: false }))
                              }
                              className="rounded-md border border-line bg-white px-2.5 py-1.5 font-medium text-muted hover:text-ink hover:border-faint transition cursor-pointer"
                            >
                              ซ่อนตัวเลือก
                            </button>
                            <button
                              type="button"
                              disabled={downloadingAudioIdx === idx}
                              onClick={async () => {
                                setDownloadingAudioIdx(idx);
                                try {
                                  const res = await mergeAudioTracks([clip.mediaUrl]);
                                  if (res?.url) {
                                    const link = document.createElement('a');
                                    link.href = res.url;
                                    link.download = `slide-${idx + 1}-audio.wav`;
                                    link.click();
                                    setTimeout(() => URL.revokeObjectURL(res.url), 5000);
                                  }
                                } catch (err) {
                                  setError(err?.message || 'แยกไฟล์เสียงไม่สำเร็จ');
                                } finally {
                                  setDownloadingAudioIdx(null);
                                }
                              }}
                              className="rounded-md border border-line bg-paper px-2.5 py-1.5 font-medium text-ink hover:border-faint disabled:opacity-50 cursor-pointer"
                            >
                              {downloadingAudioIdx === idx ? 'กำลังแปลงเสียง...' : 'โหลดเสียง'}
                            </button>
                            <a
                              href={clip.mediaUrl}
                              download={`slide-${idx + 1}-${clip.memberName || 'clip'}.webm`}
                              className="rounded-md border border-line bg-paper px-2.5 py-1.5 font-medium text-ink hover:border-faint"
                            >
                              โหลดคลิปดิบ
                            </a>
                            {editingIdx !== idx && (
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingIdx(idx);
                                  setEditText(a.transcript || '');
                                }}
                                className="flex items-center gap-1 rounded-md border border-line bg-white px-2.5 py-1.5 text-ink hover:border-faint hover:bg-paper transition cursor-pointer"
                              >
                                <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
                                  <path d="M11.5 2.5a1.414 1.414 0 0 1 2 2L4.5 13.5l-3 1 1-3L11.5 2.5z" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                                <span>แก้ข้อความ</span>
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {clip?.mediaUrl && openReplayIdx === idx && (
                      <TimelineReplayPlayer
                        videoUrl={clip.mimeType?.startsWith('audio/') ? null : clip.mediaUrl}
                        audioUrl={clip.mediaUrl}
                        duration={a.duration || 0}
                        events={[]}
                        slides={slides}
                        slideIndex={idx}
                      />
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      <VideoLayoutModal
        open={layoutModalOpen}
        previewSlide={slides[videoClips[0]?.slideIndex ?? 0] || slides[0] || null}
        previewVideoUrl={videoClips[0]?.mediaUrl || null}
        onCancel={() => setLayoutModalOpen(false)}
        onConfirm={(chosenLayout) => {
          setLayoutModalOpen(false);
          void handleMergeAll(chosenLayout);
        }}
      />
    </div>
  );
}
