import { useEffect } from 'react';

function SampleSlide({ slide, index }) {
  return (
    <div className="flex h-full flex-col justify-center bg-white px-[8%]">
      <p className="font-mono text-xs text-faint">{String(index + 1).padStart(2, '0')}</p>
      <h3 className="mt-3 text-2xl font-semibold tracking-tight md:text-3xl">{slide.title}</h3>
      <ul className="mt-6 space-y-2.5 text-[15px] text-muted md:text-base">
        {slide.points.map((p) => (
          <li key={p} className="flex gap-3">
            <span className="mt-[0.7em] h-px w-3 shrink-0 bg-ink/40" />
            {p}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Arrow({ dir }) {
  return (
    <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d={dir === 'prev' ? 'M10 3 5 8l5 5' : 'm6 3 5 5-5 5'} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function SlideViewer({ slides, index, onIndexChange, locked = false }) {
  const total = slides?.length ?? 0;
  const slide = slides?.[index];
  const go = (i) => !locked && i >= 0 && i < total && onIndexChange(i);

  useEffect(() => {
    const onKey = (e) => {
      if (e.target.closest('input, textarea')) return;
      if (e.key === 'ArrowRight') go(index + 1);
      if (e.key === 'ArrowLeft') go(index - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div>
      <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-line bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_32px_-16px_rgba(0,0,0,0.18)]">
        {!slide && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-faint">
            <svg viewBox="0 0 24 24" className="size-7" fill="none" stroke="currentColor" strokeWidth="1.25">
              <rect x="3" y="4.5" width="18" height="12" rx="1.5" />
              <path d="M12 16.5V20M8.5 20h7" strokeLinecap="round" />
            </svg>
            <p className="text-sm">ตัวอย่างสไลด์จะแสดงที่นี่</p>
          </div>
        )}
        {slide?.src && (
          <img src={slide.src} alt={`สไลด์หน้า ${index + 1}`} className="h-full w-full object-contain" />
        )}
        {slide && !slide.src && <SampleSlide slide={slide} index={index} />}
      </div>

      {total > 0 && (
        <div className="mt-4 flex items-center justify-between">
          <button
            onClick={() => go(index - 1)}
            disabled={locked || index === 0}
            className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-muted transition hover:bg-black/[0.04] hover:text-ink disabled:pointer-events-none disabled:opacity-30"
          >
            <Arrow dir="prev" /> ก่อนหน้า
          </button>
          <span className="font-mono text-sm tabular-nums text-muted">
            {index + 1} <span className="text-faint">/ {total}</span>
          </span>
          <button
            onClick={() => go(index + 1)}
            disabled={locked || index === total - 1}
            className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-muted transition hover:bg-black/[0.04] hover:text-ink disabled:pointer-events-none disabled:opacity-30"
          >
            ถัดไป <Arrow dir="next" />
          </button>
        </div>
      )}
    </div>
  );
}
