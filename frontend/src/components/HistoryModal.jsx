import { useEffect, useMemo, useState } from 'react';
import {
  deleteCloudVideo,
  deleteSessions,
  fetchCloudVideoUrl,
  fetchSessionDetail,
  fetchSessions,
} from '../lib/api';
import { formatTime } from '../lib/metrics';
import {
  clearAllLocalVideos,
  deleteLocalSessionVideo,
  getLocalSessionVideo,
  getLocalVideosStats,
} from '../lib/videoStore';
import { askConfirm } from './ConfirmModal';
import SummaryCharts from './SummaryCharts';
import Pagination from './Pagination';
import RoundComparisonCard from './RoundComparisonCard';
import QaResultCard from './QaResultCard';
import ShareSessionModal from './ShareSessionModal';
import { SkeletonDetailView, SkeletonHistoryList } from './ui/Skeleton';
import { EmptyState, ErrorState, NoSearchResults } from './ui/StateViews';

export default function HistoryModal({ open, onClose, user = null, onTokensChange }) {
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
  const [searchQuery, setSearchQuery] = useState('');
  const [modeFilter, setModeFilter] = useState('all'); // 'all' | 'solo' | 'group'
  const [videoInfo, setVideoInfo] = useState(null); // { url, source: 'local' | 'cloud' }
  const [videoLoading, setVideoLoading] = useState(false);
  const [localStats, setLocalStats] = useState({ count: 0, totalBytes: 0 });
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [deleting, setDeleting] = useState(false);
  const [shareModalOpen, setShareModalOpen] = useState(false);

  const refreshLocalStats = () => {
    void getLocalVideosStats().then((stats) => setLocalStats(stats));
  };

  const loadHistoryList = () => {
    setLoading(true);
    setError(null);
    fetchSessions()
      .then((list) => {
        setSessions(Array.isArray(list) ? list : []);
      })
      .catch((err) => {
        setError(err.message || 'โหลดประวัติการซ้อมไม่สำเร็จ');
      })
      .finally(() => {
        setLoading(false);
      });
  };

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setSelected(null);
    setSelectMode(false);
    setSelectedIds([]);
    setError(null);
    refreshLocalStats();
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

  useEffect(() => {
    if (!selected?.id) {
      setVideoInfo(null);
      return;
    }
    let active = true;
    let localUrlToRevoke = null;
    setVideoLoading(true);
    setVideoInfo(null);

    (async () => {
      const local = await getLocalSessionVideo(selected.id);
      if (!active) {
        if (local?.url) URL.revokeObjectURL(local.url);
        return;
      }
      if (local?.url) {
        localUrlToRevoke = local.url;
        setVideoInfo({ url: local.url, source: 'local', size: local.size });
        setVideoLoading(false);
        return;
      }
      if (selected.videoPath) {
        const cloud = await fetchCloudVideoUrl(selected.id).catch(() => null);
        if (active && cloud?.url) {
          setVideoInfo({ url: cloud.url, source: 'cloud' });
        }
      }
      if (active) setVideoLoading(false);
    })();

    return () => {
      active = false;
      if (localUrlToRevoke) URL.revokeObjectURL(localUrlToRevoke);
    };
  }, [selected?.id, selected?.videoPath]);

  const seriesComparison = useMemo(() => {
    if (!selected?.seriesId) return { prevRounds: [], currentRound: null };
    const sameSeries = sessions
      .filter((s) => s.seriesId === selected.seriesId)
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    const idx = sameSeries.findIndex((s) => s.id === selected.id);
    if (idx <= 0) return { prevRounds: [], currentRound: null };
    const toSnapshot = (s, i) => ({
      roundNumber: s.roundNumber || i + 1,
      slideCount: s.slideCount || 1,
      avgWpm: s.avgWpm || 0,
      fillersCount: 0,
      deadAirCount: 0,
      totalDurationSec: s.totalDurationSec || 0,
      eyeContactPct: s.avgEyeContactPct ?? null,
      members: Array.isArray(s.participants)
        ? s.participants.map((p) => ({
            name: p.displayName,
            avgWpm: p.avgWpm || 0,
            fillersCount: 0,
            eyeContactPct: p.avgEyeContactPct ?? null,
          }))
        : [],
    });
    return {
      prevRounds: sameSeries.slice(0, idx).map((s, i) => toSnapshot(s, i)),
      currentRound: toSnapshot(selected, idx),
    };
  }, [selected, sessions]);

  const filteredSessions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return sessions.filter((s) => {
      if (modeFilter === 'solo' && s.isGroup) return false;
      if (modeFilter === 'group' && !s.isGroup) return false;
      if (q && !(s.deckName || '').toLowerCase().includes(q) && !(s.roomCode || '').toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [sessions, searchQuery, modeFilter]);

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
    <div className="mx-auto w-full max-w-5xl px-3 py-6 sm:px-6 sm:py-10 space-y-6">
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

      {/* หมายเหตุเรื่องไฟล์วิดีโอ/เสียง + จัดการคลิปในเครื่อง */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-paper px-4 py-3 text-xs text-muted">
        <span>
          รองรับทั้งโหมดเดี่ยวและโหมดกลุ่ม · คลิปในเครื่องนี้:{' '}
          <strong className="font-medium text-ink">
            {localStats.count} คลิป ({(localStats.totalBytes / (1024 * 1024)).toFixed(1)} MB)
          </strong>
        </span>
        {localStats.count > 0 && !selected && (
          <button
            type="button"
            disabled={deleting}
            onClick={async () => {
              const ok = await askConfirm({
                key: 'clear-all-local-videos',
                allowDontShowAgain: false,
                danger: true,
                title: 'ล้างคลิปวิดีโอในเครื่องทั้งหมด?',
                message: `จะลบไฟล์คลิปที่บันทึกค้างอยู่ในเบราว์เซอร์เครื่องนี้ทั้งหมด ${localStats.count} คลิป (${(localStats.totalBytes / (1024 * 1024)).toFixed(1)} MB) เพื่อคืนพื้นที่ทันที (ไม่กระทบประวัติบนคลาวด์)`,
                confirmText: 'ล้างคลิปในเครื่องทั้งหมด',
              });
              if (!ok) return;
              setDeleting(true);
              await clearAllLocalVideos();
              setVideoInfo((prev) => (prev?.source === 'local' ? null : prev));
              refreshLocalStats();
              setDeleting(false);
            }}
            className="rounded-lg border border-accent/30 bg-white px-3 py-1.5 font-medium text-accent transition hover:bg-accent/5 disabled:opacity-50 cursor-pointer"
          >
            ล้างคลิปในเครื่องทั้งหมด
          </button>
        )}
      </div>

      {error && (
        <ErrorState
          title="ไม่สามารถโหลดข้อมูลได้"
          message={error}
          onRetry={selected ? () => handleSelect(selected.id) : loadHistoryList}
        />
      )}

      {loading ? (
        <SkeletonHistoryList rows={6} />
      ) : detailLoading ? (
        <SkeletonDetailView />
      ) : selected ? (
        <div className="space-y-5">
          {/* แถบแท็บสลับหมวด ไม่ให้หน้ายาวลงล่าง */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
            <div className="flex flex-wrap gap-2">
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
            <button
              type="button"
              onClick={() => setShareModalOpen(true)}
              className="rounded-lg bg-accent px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-accent/90 cursor-pointer"
            >
              แชร์ผลการซ้อม (LINE / X / ลิงก์)
            </button>
          </div>

          {detailTab === 'overview' && (
            <div className="space-y-6">
              {/* การ์ดสรุปรวม */}
              <div className="rounded-xl border border-line bg-white p-5 space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold text-ink">{selected.deckName}</h2>
                  {selected.isGroup && (
                    <span className="rounded-full border border-ink/20 bg-paper px-2 py-0.5 text-[10px] font-medium text-ink">
                      ซ้อมกลุ่ม{selected.roomCode ? ` · ${selected.roomCode}` : ''}
                    </span>
                  )}
                  {selected.roundNumber > 1 && (
                    <span className="rounded-full bg-paper px-2 py-0.5 font-mono text-[10px] text-muted border border-line">
                      รอบที่ {selected.roundNumber}
                    </span>
                  )}
                </div>
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

          {/* วิดีโอย้อนหลัง (IndexedDB ในเครื่อง หรือ Supabase Storage) */}
          {(videoLoading || videoInfo?.url) && (
            <div className="rounded-xl border border-line bg-white p-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-ink">คลิปวิดีโอย้อนหลัง</p>
                  {videoInfo?.source && (
                    <span className="rounded-full border border-line bg-paper px-2 py-0.5 text-[10px] text-muted">
                      {videoInfo.source === 'local'
                        ? `บันทึกในเครื่องนี้ (ฟรี${videoInfo.size ? ` · ${(videoInfo.size / (1024 * 1024)).toFixed(1)} MB` : ''})`
                        : 'จากคลาวด์'}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {videoInfo?.source === 'local' && (
                    <button
                      type="button"
                      onClick={async () => {
                        await deleteLocalSessionVideo(selected.id);
                        if (videoInfo.url) URL.revokeObjectURL(videoInfo.url);
                        if (selected.videoPath) {
                          const cloud = await fetchCloudVideoUrl(selected.id).catch(() => null);
                          setVideoInfo(cloud?.url ? { url: cloud.url, source: 'cloud' } : null);
                        } else {
                          setVideoInfo(null);
                        }
                      }}
                      className="rounded-md border border-line px-2.5 py-1 text-[11px] text-muted hover:text-accent cursor-pointer"
                    >
                      ลบคลิปออกจากเครื่อง
                    </button>
                  )}
                  {selected.videoPath && (
                    <button
                      type="button"
                      onClick={async () => {
                        await deleteCloudVideo(selected.id).catch(() => {});
                        setSelected((prev) => (prev ? { ...prev, videoPath: null } : prev));
                        setSessions((prev) =>
                          prev.map((x) => (x.id === selected.id ? { ...x, videoPath: null } : x)),
                        );
                        if (videoInfo?.source === 'cloud') setVideoInfo(null);
                      }}
                      className="rounded-md border border-line px-2.5 py-1 text-[11px] text-muted hover:text-accent cursor-pointer"
                    >
                      ลบคลิปจากคลาวด์
                    </button>
                  )}
                </div>
              </div>
              {videoLoading ? (
                <p className="text-xs text-muted">กำลังโหลดคลิปวิดีโอ...</p>
              ) : videoInfo?.url ? (
                <video
                  src={videoInfo.url}
                  controls
                  playsInline
                  className="w-full max-h-[380px] rounded-lg border border-line bg-black"
                />
              ) : null}
            </div>
          )}

          {/* สถิติรายสมาชิก (สำหรับโหมดกลุ่ม) */}
          {selected.isGroup && Array.isArray(selected.participants) && selected.participants.length > 0 && (
            <div className="rounded-xl border border-line bg-white p-5 space-y-3">
              <p className="text-sm font-semibold text-ink">สมาชิกในห้อง ({selected.participants.length} คน)</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {selected.participants.map((p) => (
                  <div
                    key={p.id || p.displayName}
                    className="flex items-center justify-between gap-2 rounded-lg border border-line bg-paper/40 px-3 py-2 text-xs"
                  >
                    <span className="font-medium text-ink">
                      {p.displayName}
                      {p.role === 'host' ? ' (หัวหน้ากลุ่ม)' : ''}
                    </span>
                    <span className="font-mono text-[11px] text-muted">
                      {formatTime(p.durationSec || 0)} · {p.avgWpm || 0} WPM
                      {p.avgEyeContactPct != null ? ` · ตา ${p.avgEyeContactPct}%` : ''}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* เทียบกับรอบก่อนในชุดซ้อมเดียวกัน */}
          {seriesComparison.prevRounds.length > 0 && seriesComparison.currentRound && (
            <RoundComparisonCard
              roundsHistory={seriesComparison.prevRounds}
              currentRound={seriesComparison.currentRound}
              deckName={selected.deckName}
              audience={selected.audience || 'general'}
              mode={selected.isGroup ? 'group' : 'solo'}
            />
          )}

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
            <div className="rounded-2xl bg-white p-6 shadow-[0_1px_4px_rgba(27,27,26,0.06)] space-y-4">
              <p className="text-lg sm:text-xl font-semibold text-stone-900">สรุปความเข้าใจจาก AI</p>
              <p className="text-base leading-relaxed text-stone-900">
                {selected.summaryJson.listenerSummary}
              </p>
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
                          <span className="text-lg font-semibold text-stone-900">
                            สไลด์ {slideIndex + 1}
                            {s.title ? ` · ${s.title}` : ''}
                          </span>
                          {hasMissed ? (
                            <span className="rounded-full bg-accent/10 px-2.5 py-0.5 text-sm font-medium text-accent">
                              มีประเด็นแนะนำ
                            </span>
                          ) : (
                            <span className="rounded-full bg-ok/10 px-2.5 py-0.5 text-sm font-medium text-ok">
                              ครบถ้วน
                            </span>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
                          <span className="rounded-md bg-paper px-2.5 py-1 text-stone-900">{formatTime(s.duration || 0)}</span>
                          <span className="rounded-md bg-paper px-2.5 py-1 text-muted">{s.wpm || 0} คำ/นาที</span>
                          <span className={`rounded-md bg-paper px-2.5 py-1 ${(s.fillersCount ?? 0) > 0 ? 'text-accent font-medium' : 'text-muted'}`}>
                            คำติดปาก {s.fillersCount ?? 0}
                          </span>
                          {s.eyeContactPct != null && (
                            <span className={`rounded-md bg-paper px-2.5 py-1 ${s.eyeContactPct >= 70 ? 'text-ok' : 'text-slow'}`}>
                              สบตา {s.eyeContactPct}%
                            </span>
                          )}
                          <span className="ml-1 font-sans text-sm text-muted">{isOpen ? 'ซ่อน' : 'ดูเพิ่ม'}</span>
                        </div>
                      </button>

                      {isOpen && (
                        <div className="border-t border-line/60 px-5 py-5 bg-paper/40">
                          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                            <div className="rounded-xl border-l-4 border-ink/30 bg-white p-4 sm:p-5 shadow-2xs space-y-2">
                              <p className="text-sm font-medium text-muted">คำพูดของคุณ</p>
                              {s.transcript ? (
                                <p className="text-base leading-relaxed text-stone-900">
                                  &ldquo;{s.transcript}&rdquo;
                                </p>
                              ) : (
                                <p className="text-base italic text-faint">ไม่มีข้อความถอดเสียงในสไลด์นี้</p>
                              )}
                            </div>

                            {aiSlide && (aiSlide.missed?.length > 0 || aiSlide.polishedScript) ? (
                              <div className="space-y-3">
                                {aiSlide.missed?.length > 0 && (
                                  <div className="rounded-xl bg-accent/5 p-4 sm:p-5 space-y-1.5">
                                    <p className="text-sm font-medium text-accent">ประเด็นที่ยังไม่ได้พูด</p>
                                    <p className="text-base leading-relaxed text-stone-900">
                                      {aiSlide.missed.join(' · ')}
                                    </p>
                                  </div>
                                )}
                                {aiSlide.polishedScript && (
                                  <div className="rounded-xl bg-ok/10 p-4 sm:p-5 space-y-1.5">
                                    <p className="text-sm font-medium text-ok">ตัวอย่างประโยคที่กระชับขึ้น</p>
                                    <p className="text-base leading-relaxed text-stone-900">
                                      {aiSlide.polishedScript}
                                    </p>
                                  </div>
                                )}
                              </div>
                            ) : (
                              <div className="flex items-center justify-center rounded-xl bg-white/70 p-4 text-sm text-muted">
                                ไม่มีประเด็นเพิ่มเติมจาก AI ในหน้านี้
                              </div>
                            )}
                          </div>
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
            <div className="space-y-4">
              <div>
                <h3 className="text-lg sm:text-xl font-semibold text-stone-900">
                  ผลช่วงถาม-ตอบ ({qaList.length} ข้อ)
                </h3>
              </div>
              <div className="space-y-4">
                {qaList.slice((qaPage - 1) * 5, qaPage * 5).map((q, idx) => {
                  const realIdx = (qaPage - 1) * 5 + idx;
                  return (
                    <QaResultCard
                      key={realIdx}
                      index={realIdx}
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
                  );
                })}
              </div>
              <Pagination page={qaPage} totalItems={qaList.length} pageSize={5} onPageChange={setQaPage} />
            </div>
          )}
        </div>
      ) : sessions.length === 0 ? (
        <EmptyState
          title="ยังไม่มีประวัติการซ้อมที่บันทึกไว้"
          description="เมื่อซ้อมเสร็จในโหมดเดี่ยวหรือโหมดกลุ่ม ประวัติ สถิติ และคลิปวิดีโอจะมาแสดงที่นี่โดยไม่เสีย Token ซ้ำ"
          actionLabel="กลับไปเริ่มซ้อมเลย"
          onAction={onClose}
        />
      ) : (
        <div className="space-y-3">
          {/* ช่องค้นหาและตัวกรองโหมด */}
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setSessionPage(1);
              }}
              placeholder="ค้นหาชื่อสไลด์ หรือรหัสห้อง..."
              className="w-full sm:w-64 rounded-lg border border-line bg-white px-3 py-1.5 text-xs text-ink placeholder:text-faint focus:border-ink focus:outline-none"
            />
            <div className="flex flex-wrap items-center gap-1.5">
              {[
                { key: 'all', label: `ทั้งหมด (${sessions.length})` },
                { key: 'solo', label: 'เดี่ยว' },
                { key: 'group', label: 'กลุ่ม' },
              ].map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => {
                    setModeFilter(opt.key);
                    setSessionPage(1);
                  }}
                  className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition cursor-pointer ${
                    modeFilter === opt.key
                      ? 'bg-ink text-paper'
                      : 'border border-line bg-white text-muted hover:text-ink'
                  }`}
                >
                  {opt.label}
                </button>
              ))}

              <span className="mx-1 h-4 w-px bg-line hidden sm:inline-block" />

              <button
                type="button"
                disabled={deleting}
                onClick={() => {
                  setSelectMode((v) => !v);
                  setSelectedIds([]);
                }}
                className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition cursor-pointer ${
                  selectMode
                    ? 'bg-ink text-paper'
                    : 'border border-line bg-white text-ink hover:border-faint'
                }`}
              >
                {selectMode ? 'ยกเลิกเลือก' : 'เลือกเพื่อลบ'}
              </button>

              {selectMode && selectedIds.length > 0 && (
                <button
                  type="button"
                  disabled={deleting}
                  onClick={async () => {
                    const ok = await askConfirm({
                      key: 'delete-selected-history',
                      allowDontShowAgain: false,
                      danger: true,
                      title: `ลบประวัติที่เลือก ${selectedIds.length} รายการ?`,
                      message:
                        'จะลบประวัติการซ้อม คลิปบนคลาวด์ และคลิปในเครื่องของรายการที่เลือกออกถาวร',
                      confirmText: `ลบ ${selectedIds.length} รายการ`,
                    });
                    if (!ok) return;
                    setDeleting(true);
                    setError(null);
                    try {
                      await deleteSessions(selectedIds);
                      await Promise.all(selectedIds.map((id) => deleteLocalSessionVideo(id)));
                      setSessions((prev) => prev.filter((item) => !selectedIds.includes(item.id)));
                      setSelectedIds([]);
                      setSelectMode(false);
                      refreshLocalStats();
                    } catch (err) {
                      setError(err.message || 'ลบประวัติที่เลือกไม่สำเร็จ');
                    } finally {
                      setDeleting(false);
                    }
                  }}
                  className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-accent/90 disabled:opacity-50 cursor-pointer"
                >
                  ลบที่เลือก ({selectedIds.length})
                </button>
              )}

              {!selectMode && (
                <button
                  type="button"
                  disabled={deleting}
                  onClick={async () => {
                    const ok = await askConfirm({
                      key: 'delete-all-history',
                      allowDontShowAgain: false,
                      danger: true,
                      title: 'ลบประวัติการซ้อมทั้งหมด?',
                      message:
                        'จะลบประวัติการซ้อมของคุณทั้งหมด คลิปบนคลาวด์ และคลิปในเครื่องทั้งหมดออกถาวร ไม่สามารถกู้คืนได้',
                      confirmText: 'ลบประวัติทั้งหมด',
                    });
                    if (!ok) return;
                    setDeleting(true);
                    setError(null);
                    try {
                      await deleteSessions();
                      await clearAllLocalVideos();
                      setSessions([]);
                      setSelectedIds([]);
                      refreshLocalStats();
                    } catch (err) {
                      setError(err.message || 'ลบประวัติทั้งหมดไม่สำเร็จ');
                    } finally {
                      setDeleting(false);
                    }
                  }}
                  className="rounded-lg border border-accent/30 bg-white px-2.5 py-1.5 text-xs font-medium text-accent transition hover:bg-accent/5 disabled:opacity-50 cursor-pointer"
                >
                  ลบประวัติทั้งหมด
                </button>
              )}
            </div>
          </div>

          {filteredSessions.length === 0 ? (
            <NoSearchResults
              query={searchQuery}
              onClear={() => {
                setSearchQuery('');
                setModeFilter('all');
                setSessionPage(1);
              }}
            />
          ) : (
            <>
              <div className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-white">
                {filteredSessions.slice((sessionPage - 1) * 6, sessionPage * 6).map((s) => {
                  const isChecked = selectedIds.includes(s.id);
                  return (
              <button
                key={s.id}
                type="button"
                onClick={() => {
                  if (selectMode) {
                    setSelectedIds((prev) =>
                      prev.includes(s.id) ? prev.filter((id) => id !== s.id) : [...prev, s.id],
                    );
                    return;
                  }
                  setDetailTab('overview');
                  setSlidePage(1);
                  setQaPage(1);
                  handleSelect(s.id);
                }}
                className={`flex w-full flex-wrap sm:flex-nowrap items-center justify-between gap-2.5 sm:gap-3 px-3.5 py-3.5 sm:px-5 sm:py-4 text-left transition hover:bg-paper cursor-pointer ${
                  isChecked ? 'bg-accent/5' : ''
                }`}
              >
                <div className="flex min-w-0 items-center gap-3">
                  {selectMode && (
                    <input
                      type="checkbox"
                      checked={isChecked}
                      readOnly
                      className="size-4 shrink-0 accent-accent pointer-events-none"
                    />
                  )}
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="truncate text-sm font-medium text-ink">{s.deckName}</p>
                      {s.isGroup && (
                        <span className="rounded-full border border-ink/20 bg-paper px-2 py-0.5 text-[10px] font-medium text-ink">
                          กลุ่ม
                        </span>
                      )}
                      {s.roundNumber > 1 && (
                        <span className="rounded-full border border-line bg-paper px-2 py-0.5 font-mono text-[10px] text-muted">
                          รอบ {s.roundNumber}
                        </span>
                      )}
                      {s.videoPath && (
                        <span className="rounded-full border border-line bg-paper px-2 py-0.5 text-[10px] text-muted">
                          คลิปคลาวด์
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-muted">
                      {new Date(s.createdAt).toLocaleString('th-TH')} · {s.slideCount} หน้า ·{' '}
                      {formatTime(s.totalDurationSec)} · {s.avgWpm} คำ/นาที
                    </p>
                  </div>
                </div>
                {!selectMode && (
                  <span className="shrink-0 rounded-md border border-line bg-paper px-3 py-1 font-mono text-xs text-ink">
                    ดูรายละเอียด
                  </span>
                )}
              </button>
                  );
                })}
              </div>
              <Pagination
                page={sessionPage}
                totalItems={filteredSessions.length}
                pageSize={6}
                onPageChange={setSessionPage}
              />
            </>
          )}
        </div>
      )}

      <ShareSessionModal
        open={shareModalOpen && Boolean(selected)}
        onClose={() => setShareModalOpen(false)}
        sessionId={selected?.id}
        initialShareId={selected?.shareId || ''}
        initialIsPublic={Boolean(selected?.isPublic)}
        deckName={selected?.deckName || ''}
        isGroup={Boolean(selected?.isGroup)}
        totalDurationSec={selected?.totalDurationSec || 0}
        avgWpm={selected?.avgWpm || 0}
        avgEyeContactPct={selected?.avgEyeContactPct ?? null}
        referralCode={user?.referralCode || ''}
        onShareUpdated={(res) => {
          setSelected((prev) =>
            prev ? { ...prev, shareId: res.shareId, isPublic: Boolean(res.isPublic) } : prev,
          );
          setSessions((prev) =>
            prev.map((item) =>
              item.id === selected?.id
                ? { ...item, shareId: res.shareId, isPublic: Boolean(res.isPublic) }
                : item,
            ),
          );
          if (typeof res.tokens === 'number') {
            onTokensChange?.(res.tokens);
          }
        }}
      />
    </div>
  );
}
