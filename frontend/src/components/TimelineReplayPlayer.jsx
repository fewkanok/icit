import { useRef, useState } from 'react';
import { formatTime } from '../lib/metrics';

const EVENT_STYLE = {
  slide: {
    dot: 'bg-ink border-white',
    badge: 'border-line bg-paper text-ink',
    tag: 'สไลด์',
  },
  qa: {
    dot: 'bg-emerald-600 border-white',
    badge: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    tag: 'Q&A',
  },
  eye: {
    dot: 'bg-accent border-white',
    badge: 'border-accent/30 bg-accent/10 text-accent',
    tag: 'สายตา',
  },
  pace_fast: {
    dot: 'bg-amber-500 border-white',
    badge: 'border-amber-200 bg-amber-50 text-amber-800',
    tag: 'ความเร็ว',
  },
  pace_slow: {
    dot: 'bg-amber-500 border-white',
    badge: 'border-amber-200 bg-amber-50 text-amber-800',
    tag: 'ความเร็ว',
  },
  deadair: {
    dot: 'bg-orange-500 border-white',
    badge: 'border-orange-200 bg-orange-50 text-orange-800',
    tag: 'เงียบค้าง',
  },
  filler: {
    dot: 'bg-slate-600 border-white',
    badge: 'border-slate-200 bg-slate-100 text-slate-700',
    tag: 'คำติดปาก',
  },
};

export default function TimelineReplayPlayer({
  videoUrl,
  audioUrl,
  duration = 0,
  events = [],
}) {
  const mediaRef = useRef(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [mediaDuration, setMediaDuration] = useState(duration || 0);

  const effectiveDuration = Math.max(mediaDuration || duration || 1, 1);
  const sortedEvents = [...events].sort((a, b) => a.t - b.t);

  const jumpTo = (t) => {
    const el = mediaRef.current;
    if (!el) return;
    const target = Math.max(0, Math.min(t, effectiveDuration));
    el.currentTime = target;
    setCurrentTime(target);
    void el.play().catch(() => {});
  };

  if (!videoUrl && !audioUrl) return null;

  return (
    <div className="mt-3 rounded-xl border border-line bg-paper/60 p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold text-ink">Timeline Replay (คลิกหมุดเพื่อกระโดดไปยังวินาทีนั้น)</p>
        <span className="font-mono text-[11px] tabular-nums text-muted">
          {formatTime(currentTime)} / {formatTime(effectiveDuration)}
        </span>
      </div>

      {videoUrl ? (
        <div className="overflow-hidden rounded-lg border border-line bg-black">
          <video
            ref={mediaRef}
            controls
            src={videoUrl}
            onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
            onLoadedMetadata={(e) => {
              if (Number.isFinite(e.currentTarget.duration) && e.currentTarget.duration > 0) {
                setMediaDuration(e.currentTarget.duration);
              }
            }}
            className="max-h-72 w-full"
          />
        </div>
      ) : (
        <audio
          ref={mediaRef}
          controls
          src={audioUrl}
          onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => {
            if (Number.isFinite(e.currentTarget.duration) && e.currentTarget.duration > 0) {
              setMediaDuration(e.currentTarget.duration);
            }
          }}
          className="h-9 w-full"
        />
      )}

      {/* แถบเส้นเวลา + หมุดเหตุการณ์ */}
      <div className="space-y-2 pt-1">
        <div className="relative h-6 flex items-center">
          <div className="h-1.5 w-full rounded-full bg-line overflow-hidden">
            <div
              className="h-full bg-ink/40 transition-all duration-150"
              style={{ width: `${Math.min(100, (currentTime / effectiveDuration) * 100)}%` }}
            />
          </div>
          {sortedEvents.map((ev, idx) => {
            const pct = Math.max(0, Math.min(100, (ev.t / effectiveDuration) * 100));
            const style = EVENT_STYLE[ev.type] || EVENT_STYLE.slide;
            return (
              <button
                key={`${ev.t}-${ev.type}-${idx}`}
                type="button"
                onClick={() => jumpTo(ev.t)}
                title={`${formatTime(ev.t)} · ${ev.label}`}
                style={{ left: `${pct}%` }}
                className={`absolute -translate-x-1/2 size-3.5 rounded-full border-2 shadow-xs transition hover:scale-125 cursor-pointer ${style.dot}`}
              />
            );
          })}
        </div>

        {sortedEvents.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {sortedEvents.map((ev, idx) => {
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
                  <span className="font-mono tabular-nums">{formatTime(ev.t)}</span>
                  <span>{ev.label}</span>
                </button>
              );
            })}
          </div>
        ) : (
          <p className="text-[11px] text-muted">ไม่พบจุดผิดพลาดระหว่างช่วงนี้</p>
        )}
      </div>
    </div>
  );
}
