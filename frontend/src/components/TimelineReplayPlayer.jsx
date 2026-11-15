import { useMemo, useRef, useState } from 'react';
import { formatTime } from '../lib/metrics';

const EVENT_STYLE = {
  slide: {
    dot: 'bg-ink border-white',
    badge: 'border-line bg-white text-ink',
    tag: 'สไลด์',
    group: 'flow',
  },
  qa: {
    dot: 'bg-emerald-600 border-white',
    badge: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    tag: 'Q&A',
    group: 'flow',
  },
  eye: {
    dot: 'bg-accent border-white',
    badge: 'border-accent/30 bg-accent/10 text-accent',
    tag: 'สายตา',
    group: 'eye',
  },
  pace_fast: {
    dot: 'bg-amber-500 border-white',
    badge: 'border-amber-200 bg-amber-50 text-amber-800',
    tag: 'ความเร็ว',
    group: 'pace',
  },
  pace_slow: {
    dot: 'bg-amber-500 border-white',
    badge: 'border-amber-200 bg-amber-50 text-amber-800',
    tag: 'ความเร็ว',
    group: 'pace',
  },
  deadair: {
    dot: 'bg-orange-500 border-white',
    badge: 'border-orange-200 bg-orange-50 text-orange-800',
    tag: 'เงียบค้าง',
    group: 'speech',
  },
  filler: {
    dot: 'bg-slate-600 border-white',
    badge: 'border-slate-200 bg-slate-100 text-slate-700',
    tag: 'คำติดปาก',
    group: 'speech',
  },
};

const FILTER_TABS = [
  { id: 'all', label: 'ทั้งหมด' },
  { id: 'flow', label: 'สไลด์ / Q&A' },
  { id: 'eye', label: 'สายตา' },
  { id: 'pace', label: 'ความเร็ว' },
  { id: 'speech', label: 'เงียบ / คำติดปาก' },
];

function resolveSlideIndexFromEvents(sortedEvents, currentTime, fallbackIndex = 0) {
  let active = fallbackIndex;
  for (const ev of sortedEvents) {
    if (ev.t > currentTime + 0.15) break;
    if (typeof ev.slideIndex === 'number' && ev.slideIndex >= 0) {
      active = ev.slideIndex;
      continue;
    }
    if (ev.type === 'slide' && typeof ev.label === 'string') {
      const m = ev.label.match(/เริ่มสไลด์\s*(\d+)/);
      if (m) active = Math.max(0, Number(m[1]) - 1);
    }
  }
  return active;
}

export default function TimelineReplayPlayer({
  videoUrl,
  audioUrl,
  duration = 0,
  initialTime = 0,
  endTime = null,
  events = [],
  slides = null,
  slideIndex = null,
  qaQuestion = '',
  isMergedExport = false,
}) {
  const mediaRef = useRef(null);
  const didInitSeekRef = useRef(false);
  const [currentTime, setCurrentTime] = useState(initialTime || 0);
  const [mediaDuration, setMediaDuration] = useState(duration || 0);
  const [playing, setPlaying] = useState(false);
  const [viewMode, setViewMode] = useState('slide'); // 'slide' | 'camera'
  const [activeFilter, setActiveFilter] = useState('all');

  const hasEndBound = typeof endTime === 'number' && endTime > initialTime;
  const hasSegment = hasEndBound || initialTime > 0;
  const segStart = hasSegment ? initialTime : 0;
  const effectiveDuration = Math.max(mediaDuration || duration || 1, currentTime, 1);
  const segEnd = hasEndBound ? endTime : effectiveDuration;
  const segDuration = Math.max(segEnd - segStart, 1);
  const segElapsed = Math.max(0, Math.min(currentTime - segStart, segDuration));

  const sortedEvents = useMemo(() => {
    const all = [...events].sort((a, b) => a.t - b.t);
    if (!hasSegment) return all;
    return all.filter((ev) => ev.t >= segStart && (!hasEndBound || ev.t < endTime));
  }, [events, hasSegment, hasEndBound, segStart, endTime]);

  const countsByGroup = useMemo(() => {
    const counts = { all: sortedEvents.length, flow: 0, eye: 0, pace: 0, speech: 0 };
    for (const ev of sortedEvents) {
      const grp = (EVENT_STYLE[ev.type] || EVENT_STYLE.slide).group;
      counts[grp] = (counts[grp] || 0) + 1;
    }
    return counts;
  }, [sortedEvents]);

  const visibleEvents = useMemo(() => {
    if (activeFilter === 'all') return sortedEvents;
    return sortedEvents.filter((ev) => (EVENT_STYLE[ev.type] || EVENT_STYLE.slide).group === activeFilter);
  }, [sortedEvents, activeFilter]);

  const activeSlide = useMemo(() => {
    if (!Array.isArray(slides) || slides.length === 0) return null;
    if (typeof slideIndex === 'number' && slides[slideIndex]) {
      return slides[slideIndex];
    }
    const idx = resolveSlideIndexFromEvents(sortedEvents, currentTime, 0);
    return slides[idx] || slides[0];
  }, [slides, slideIndex, sortedEvents, currentTime]);

  const showSlideStage = Boolean(videoUrl && activeSlide && viewMode === 'slide' && !isMergedExport);

  const togglePlay = () => {
    const el = mediaRef.current;
    if (!el) return;
    if (el.paused) {
      if (hasEndBound && el.currentTime >= endTime - 0.05) {
        el.currentTime = segStart;
        setCurrentTime(segStart);
      } else if (hasSegment && el.currentTime < segStart) {
        el.currentTime = segStart;
        setCurrentTime(segStart);
      }
      void el.play().catch(() => {});
    } else {
      el.pause();
    }
  };

  const jumpTo = (t) => {
    const el = mediaRef.current;
    if (!el) return;
    const minT = hasSegment ? segStart : 0;
    const maxT = hasEndBound ? Math.max(minT, endTime - 0.05) : effectiveDuration;
    const target = Math.max(minT, Math.min(t, maxT));
    el.currentTime = target;
    setCurrentTime(target);
    void el.play().catch(() => {});
  };

  const handleBarClick = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    jumpTo(segStart + ratio * segDuration);
  };

  const handleTimeUpdate = (e) => {
    const t = e.currentTarget.currentTime;
    if (hasEndBound && t >= endTime) {
      e.currentTarget.pause();
      e.currentTarget.currentTime = endTime;
      setCurrentTime(endTime);
      setPlaying(false);
      return;
    }
    setCurrentTime(t);
  };

  const handleLoadedMetadata = (e) => {
    if (Number.isFinite(e.currentTarget.duration) && e.currentTarget.duration > 0) {
      setMediaDuration(e.currentTarget.duration);
    }
    if (!didInitSeekRef.current && initialTime > 0) {
      didInitSeekRef.current = true;
      e.currentTarget.currentTime = initialTime;
      setCurrentTime(initialTime);
    }
  };

  if (!videoUrl && !audioUrl) return null;

  return (
    <div className="mt-4 rounded-xl border border-line bg-paper/70 p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-ink">Timeline Replay</p>
          <p className="text-[11px] text-muted">คลิกจุดบนเส้นเวลาหรือหมุดด้านล่างเพื่อกระโดดไปยังวินาทีนั้น</p>
        </div>
        <div className="flex items-center gap-2">
          {videoUrl && activeSlide && !isMergedExport && (
            <button
              type="button"
              onClick={() => setViewMode((v) => (v === 'slide' ? 'camera' : 'slide'))}
              className="rounded-lg border border-line bg-white px-2.5 py-1 text-[11px] font-medium text-ink hover:border-faint cursor-pointer"
            >
              {viewMode === 'slide' ? 'สลับดูกล้องเต็มจอ' : 'สลับดูสไลด์ + กล้อง'}
            </button>
          )}
          <span className="rounded-md bg-white border border-line px-2 py-1 font-mono text-[11px] tabular-nums text-ink">
            {formatTime(segElapsed)} / {formatTime(segDuration)}
          </span>
        </div>
      </div>

      {videoUrl ? (
        showSlideStage ? (
          <div className="grid gap-3 md:grid-cols-[1fr_230px] items-start">
            {/* ฝั่งซ้าย: สไลด์เต็มแผ่น ไม่มีกล้องบัง */}
            <div
              onClick={togglePlay}
              className="relative aspect-video w-full overflow-hidden rounded-lg border border-line bg-white cursor-pointer select-none"
            >
              {activeSlide.src ? (
                <img
                  src={activeSlide.src}
                  alt={activeSlide.title || 'สไลด์'}
                  className="h-full w-full object-contain"
                />
              ) : (
                <div className="flex h-full flex-col justify-center px-[8%]">
                  <h4 className="text-lg font-semibold text-ink md:text-xl">{activeSlide.title}</h4>
                  {Array.isArray(activeSlide.points) && activeSlide.points.length > 0 && (
                    <ul className="mt-3 space-y-1.5 text-xs text-muted md:text-sm">
                      {activeSlide.points.slice(0, 5).map((pt) => (
                        <li key={pt}>• {pt}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>

            {/* ฝั่งขวา: กล้องผู้พูด + คำถาม Q&A + ปุ่มเล่น */}
            <div className="flex flex-col gap-2.5">
              <div className="overflow-hidden rounded-lg border border-line bg-black shadow-xs">
                <video
                  ref={mediaRef}
                  src={videoUrl}
                  playsInline
                  onClick={togglePlay}
                  onPlay={() => setPlaying(true)}
                  onPause={() => setPlaying(false)}
                  onEnded={() => setPlaying(false)}
                  onTimeUpdate={handleTimeUpdate}
                  onLoadedMetadata={handleLoadedMetadata}
                  className="aspect-video w-full object-cover -scale-x-100 cursor-pointer"
                />
              </div>

              <button
                type="button"
                onClick={togglePlay}
                className="w-full rounded-lg bg-ink py-2 text-xs font-medium text-paper transition hover:bg-ink/85 cursor-pointer"
              >
                {playing ? 'หยุดชั่วคราว' : 'เล่นคลิป'}
              </button>

              {qaQuestion && (
                <div className="rounded-lg border border-line bg-white p-2.5 text-[11px] leading-relaxed text-ink">
                  <span className="font-semibold text-accent">คำถาม: </span>
                  {qaQuestion}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-line bg-black">
            <video
              ref={mediaRef}
              controls
              src={videoUrl}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onEnded={() => setPlaying(false)}
              onTimeUpdate={handleTimeUpdate}
              onLoadedMetadata={handleLoadedMetadata}
              className="aspect-video w-full"
            />
          </div>
        )
      ) : (
        <audio
          ref={mediaRef}
          controls
          src={audioUrl}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={handleLoadedMetadata}
          className="h-9 w-full"
        />
      )}

      {/* แถบเส้นเวลา + ตัวกรองหมุดเหตุการณ์ */}
      <div className="space-y-3 pt-1">
        <div
          onClick={handleBarClick}
          className="relative h-6 flex items-center cursor-pointer"
          title="คลิกเพื่อกระโดดไปยังช่วงเวลานี้"
        >
          <div className="h-1.5 w-full rounded-full bg-line overflow-hidden">
            <div
              className="h-full bg-ink/45 transition-all duration-150"
              style={{ width: `${Math.min(100, (segElapsed / segDuration) * 100)}%` }}
            />
          </div>
          {visibleEvents.map((ev, idx) => {
            const pct = Math.max(0, Math.min(100, ((ev.t - segStart) / segDuration) * 100));
            const style = EVENT_STYLE[ev.type] || EVENT_STYLE.slide;
            return (
              <button
                key={`${ev.t}-${ev.type}-${idx}`}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  jumpTo(ev.t);
                }}
                title={`${formatTime(Math.max(0, ev.t - segStart))} · ${ev.label}`}
                style={{ left: `${pct}%` }}
                className={`absolute -translate-x-1/2 size-3 rounded-full border-2 shadow-xs transition hover:scale-125 cursor-pointer ${style.dot}`}
              />
            );
          })}
        </div>

        {sortedEvents.length > 0 ? (
          <div className="space-y-2.5">
            <div className="flex flex-wrap gap-1.5">
              {FILTER_TABS.filter((tab) => tab.id === 'all' || countsByGroup[tab.id] > 0).map((tab) => {
                const active = activeFilter === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveFilter(tab.id)}
                    className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition cursor-pointer ${
                      active
                        ? 'bg-ink text-paper'
                        : 'border border-line bg-white text-muted hover:text-ink'
                    }`}
                  >
                    {tab.label} ({countsByGroup[tab.id] || 0})
                  </button>
                );
              })}
            </div>

            <div className="max-h-32 overflow-y-auto rounded-lg border border-line/70 bg-white/70 p-2">
              <div className="flex flex-wrap gap-1.5">
                {visibleEvents.map((ev, idx) => {
                  const style = EVENT_STYLE[ev.type] || EVENT_STYLE.slide;
                  const isNear = Math.abs(currentTime - ev.t) <= 1.2;
                  return (
                    <button
                      key={`${ev.t}-${ev.type}-chip-${idx}`}
                      type="button"
                      onClick={() => jumpTo(ev.t)}
                      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition cursor-pointer ${
                        style.badge
                      } ${isNear ? 'ring-2 ring-ink/30' : 'hover:opacity-85'}`}
                    >
                      <span className="font-mono tabular-nums">{formatTime(Math.max(0, ev.t - segStart))}</span>
                      <span>{ev.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          <p className="text-[11px] text-muted">ไม่พบจุดผิดพลาดระหว่างช่วงนี้</p>
        )}
      </div>
    </div>
  );
}
