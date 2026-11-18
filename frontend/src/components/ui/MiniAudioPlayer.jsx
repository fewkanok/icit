import { useEffect, useRef, useState } from 'react';
import { formatTime } from '../../lib/metrics';
import { DownloadIcon } from './Icons';

export default function MiniAudioPlayer({ src, downloadName = '' }) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
  }, [src]);

  if (!src) return null;

  const togglePlay = async () => {
    const el = audioRef.current;
    if (!el) return;
    if (playing) {
      el.pause();
      setPlaying(false);
    } else {
      try {
        await el.play();
        setPlaying(true);
      } catch {
        setPlaying(false);
      }
    }
  };

  const pct = duration > 0 ? Math.min(100, Math.round((currentTime / duration) * 100)) : 0;

  return (
    <div className="inline-flex flex-wrap items-center gap-2 rounded-full bg-paper px-3 py-1.5 shadow-2xs">
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d)) setDuration(d);
        }}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime || 0)}
        onEnded={() => {
          setPlaying(false);
          setCurrentTime(0);
        }}
        className="hidden"
      />
      <button
        type="button"
        onClick={togglePlay}
        aria-label={playing ? 'หยุดเล่นเสียง' : 'เล่นเสียง'}
        className="flex size-7 shrink-0 items-center justify-center rounded-full bg-ink text-paper transition hover:bg-ink/85 cursor-pointer"
      >
        {playing ? (
          <svg viewBox="0 0 12 12" className="size-3" fill="currentColor">
            <rect x="2" y="2" width="3" height="8" rx="0.5" />
            <rect x="7" y="2" width="3" height="8" rx="0.5" />
          </svg>
        ) : (
          <svg viewBox="0 0 12 12" className="size-3 translate-x-[0.5px]" fill="currentColor">
            <path d="M3 2.2v7.6a.4.4 0 0 0 .6.35l6.4-3.8a.4.4 0 0 0 0-.7L3.6 1.85A.4.4 0 0 0 3 2.2Z" />
          </svg>
        )}
      </button>

      <div
        onClick={(e) => {
          const el = audioRef.current;
          if (!el || !duration) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
          el.currentTime = ratio * duration;
          setCurrentTime(el.currentTime);
        }}
        className="h-1.5 w-24 sm:w-28 cursor-pointer overflow-hidden rounded-full bg-line"
        title="คลิกเพื่อกรอเสียง"
      >
        <div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} />
      </div>

      <span className="font-mono text-xs tabular-nums text-muted">
        {formatTime(currentTime)}
        {duration > 0 ? ` / ${formatTime(duration)}` : ''}
      </span>

      {downloadName && (
        <a
          href={src}
          download={downloadName}
          className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-xs font-medium text-ink shadow-2xs transition hover:bg-line/50"
          title="ดาวน์โหลดเสียง"
        >
          <DownloadIcon className="size-3.5" />
          โหลด
        </a>
      )}
    </div>
  );
}
