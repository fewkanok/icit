export function SkeletonBox({ className = '' }) {
  return <div aria-hidden="true" className={`skeleton-shimmer rounded-md ${className}`} />;
}

export function SkeletonAvatar({ sizeClass = 'size-8' }) {
  return <div aria-hidden="true" className={`skeleton-shimmer shrink-0 rounded-full ${sizeClass}`} />;
}

export function SkeletonHistoryList({ rows = 6 }) {
  return (
    <div className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-white">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center justify-between gap-3 px-5 py-4">
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex items-center gap-2">
              <SkeletonBox className="h-4 w-44 max-w-[60%]" />
              <SkeletonBox className="h-4 w-12 rounded-full" />
            </div>
            <SkeletonBox className="h-3 w-64 max-w-[85%]" />
          </div>
          <SkeletonBox className="h-7 w-24 shrink-0 rounded-md" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonDetailView() {
  return (
    <div className="space-y-5">
      <div className="flex gap-2 border-b border-line pb-3">
        <SkeletonBox className="h-8 w-28 rounded-lg" />
        <SkeletonBox className="h-8 w-24 rounded-lg" />
        <SkeletonBox className="h-8 w-24 rounded-lg" />
      </div>
      <div className="rounded-xl border border-line bg-white p-5 space-y-4">
        <div className="space-y-2">
          <SkeletonBox className="h-5 w-56" />
          <SkeletonBox className="h-3 w-40" />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-lg border border-line bg-paper/60 p-3 space-y-2">
              <SkeletonBox className="h-3 w-16" />
              <SkeletonBox className="h-5 w-20" />
            </div>
          ))}
        </div>
      </div>
      <div className="rounded-xl border border-line bg-white p-5 space-y-3">
        <SkeletonBox className="h-4 w-36" />
        <SkeletonBox className="h-32 w-full rounded-lg" />
      </div>
    </div>
  );
}

export function SkeletonSummaryOverview() {
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-line bg-white p-4 space-y-2">
            <SkeletonBox className="h-3 w-20" />
            <SkeletonBox className="h-7 w-24" />
          </div>
        ))}
      </div>
      <div className="rounded-xl border border-line bg-white p-5 space-y-3">
        <div className="flex items-center gap-3">
          <SkeletonAvatar sizeClass="size-8" />
          <SkeletonBox className="h-4 w-48" />
        </div>
        <SkeletonBox className="h-24 w-full rounded-lg" />
      </div>
    </div>
  );
}

export function SkeletonSlideGrid() {
  return (
    <div className="flex h-full flex-col justify-center space-y-4">
      <SkeletonBox className="h-3 w-12" />
      <SkeletonBox className="h-7 w-2/3" />
      <div className="space-y-2.5 pt-2">
        <SkeletonBox className="h-4 w-full" />
        <SkeletonBox className="h-4 w-5/6" />
        <SkeletonBox className="h-4 w-4/6" />
      </div>
    </div>
  );
}

export function SkeletonQaCard({
  message = 'กำลังเตรียมคำถามจากสไลด์ของคุณ...',
  subMessage = 'AI กำลังวิเคราะห์เนื้อหาและสร้างคำถามที่เหมาะสม รอสักครู่',
}) {
  return (
    <div className="space-y-5">
      {/* การ์ดคำถาม Skeleton */}
      <div className="rounded-2xl border border-line bg-white p-7 shadow-sm space-y-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="h-2.5 w-2.5 rounded-full bg-accent animate-pulse" aria-hidden="true" />
            <p className="text-sm font-medium text-ink">{message}</p>
          </div>
          <SkeletonBox className="h-7 w-28 rounded-lg" />
        </div>
        {subMessage && <p className="text-xs text-muted">{subMessage}</p>}
        <div className="space-y-2.5 pt-1">
          <SkeletonBox className="h-6 w-11/12" />
          <SkeletonBox className="h-6 w-3/4" />
        </div>
        <SkeletonBox className="h-3.5 w-2/3" />
      </div>

      {/* การ์ดคำตอบ Skeleton */}
      <div className="rounded-xl border border-line bg-white p-6 space-y-4">
        <div className="flex items-center justify-between">
          <SkeletonBox className="h-4 w-28" />
          <SkeletonBox className="h-6 w-20 rounded-full" />
        </div>
        <SkeletonBox className="h-28 w-full rounded-xl" />
        <div className="flex justify-end gap-2">
          <SkeletonBox className="h-10 w-32 rounded-xl" />
        </div>
      </div>
    </div>
  );
}

export function SkeletonVideoMerge({
  label = 'กำลังสร้างวิดีโอใหม่ตามเลย์เอาต์ที่เลือก...',
  progressText = '0%',
  percent = 4,
}) {
  return (
    <div className="rounded-xl border border-accent/25 bg-accent/5 p-4 space-y-3">
      <div className="flex items-center justify-between text-xs font-medium text-accent">
        <span className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-accent animate-pulse" aria-hidden="true" />
          {label}
        </span>
        <span className="font-mono tabular-nums">{progressText}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white">
        <div
          className="h-full bg-accent transition-all duration-300"
          style={{ width: `${Math.max(4, percent)}%` }}
        />
      </div>
      <div className="overflow-hidden rounded-xl border border-line/70 bg-white p-3 space-y-2.5">
        <SkeletonBox className="aspect-video w-full rounded-lg" />
        <div className="flex items-center justify-between gap-3">
          <SkeletonBox className="h-3.5 w-40" />
          <SkeletonBox className="h-3.5 w-16" />
        </div>
      </div>
    </div>
  );
}
