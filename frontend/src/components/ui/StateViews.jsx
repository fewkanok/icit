export function ModeBadge({ mode = 'solo', roomCode = '' }) {
  const isGroup = mode === 'group';
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${
        isGroup
          ? 'border-accent/30 bg-accent/10 text-accent'
          : 'border-ink/15 bg-paper text-ink'
      }`}
    >
      <span className={`size-1.5 rounded-full ${isGroup ? 'bg-accent' : 'bg-ink'}`} />
      {isGroup ? `โหมดกลุ่ม${roomCode ? ` · ${roomCode}` : ''}` : 'โหมดเดี่ยว'}
    </span>
  );
}

export function ToggleSwitch({
  checked = false,
  onChange,
  labelOn = 'เปิดอยู่',
  labelOff = 'ปิดอยู่',
  ariaLabel = 'สลับสถานะ',
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onChange?.(!checked)}
      className="inline-flex shrink-0 items-center gap-2.5 cursor-pointer"
    >
      <span
        className={`text-xs font-medium ${
          checked ? 'text-ok' : 'text-muted'
        }`}
      >
        {checked ? labelOn : labelOff}
      </span>
      <span
        className={`relative inline-flex h-6 w-11 items-center rounded-full border transition-colors ${
          checked
            ? 'border-ok bg-ok'
            : 'border-faint/60 bg-line'
        }`}
      >
        <span
          className={`inline-block size-4 rounded-full bg-white shadow-xs transition-transform ${
            checked ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </span>
    </button>
  );
}

export function OfflineBanner({ onRetry }) {
  return (
    <div
      role="status"
      className="border-b border-slow/30 bg-slow/10 px-6 py-2 text-xs text-ink"
    >
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2">
        <span>
          ไม่มีการเชื่อมต่ออินเทอร์เน็ต — คลิปและประวัติที่บันทึกไว้ในเครื่อง (IndexedDB) ยังเปิดดูได้ตามปกติ
        </span>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="rounded-md border border-slow/40 bg-white px-2.5 py-1 text-[11px] font-medium text-ink hover:bg-paper cursor-pointer"
          >
            ตรวจสอบการเชื่อมต่อ
          </button>
        )}
      </div>
    </div>
  );
}

export function SessionExpiredNotice({ onSignIn, onDismiss }) {
  return (
    <div
      role="alert"
      className="border-b border-accent/30 bg-accent/10 px-6 py-2.5 text-xs text-ink"
    >
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2">
        <span>
          เซสชันหมดอายุแล้ว — ระบบบันทึกข้อมูลที่ทำค้างไว้ลงในเครื่องชั่วคราวให้เรียบร้อย กรุณาเข้าสู่ระบบใหม่เพื่อซิงก์ต่อ
        </span>
        <div className="flex items-center gap-2">
          {onSignIn && (
            <button
              type="button"
              onClick={onSignIn}
              className="rounded-md bg-ink px-3 py-1 text-[11px] font-medium text-paper hover:bg-ink/85 cursor-pointer"
            >
              เข้าสู่ระบบใหม่
            </button>
          )}
          {onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              className="rounded-md px-2 py-1 text-[11px] text-muted hover:text-ink cursor-pointer"
            >
              ปิด
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  actionLabel = '',
  onAction = null,
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line bg-white px-6 py-10 text-center">
      <div className="flex size-11 items-center justify-center rounded-full border border-line bg-paper text-muted">
        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M4 7.5A1.5 1.5 0 0 1 5.5 6h13A1.5 1.5 0 0 1 20 7.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 16.5v-9Z" />
          <path d="M8 11h8M8 14h5" strokeLinecap="round" />
        </svg>
      </div>
      <p className="mt-3 text-sm font-semibold text-ink">{title}</p>
      {description && <p className="mt-1 max-w-md text-xs leading-relaxed text-muted">{description}</p>}
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="mt-4 rounded-xl bg-accent px-4 py-2 text-xs font-semibold text-white transition hover:bg-accent/90 cursor-pointer"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}

export function ErrorState({
  title = 'เกิดข้อผิดพลาด',
  message,
  onRetry = null,
  retryLabel = 'ลองใหม่อีกครั้ง',
}) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-accent/30 bg-accent/5 px-4 py-3 text-xs"
    >
      <div className="min-w-0">
        <p className="font-semibold text-accent">{title}</p>
        {message && <p className="mt-0.5 text-ink/85">{message}</p>}
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="shrink-0 rounded-lg border border-accent/40 bg-white px-3 py-1.5 font-medium text-accent transition hover:bg-accent hover:text-white cursor-pointer"
        >
          {retryLabel}
        </button>
      )}
    </div>
  );
}

export function NoSearchResults({ query = '', onClear }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-line bg-white px-6 py-8 text-center">
      <p className="text-sm font-semibold text-ink">
        ไม่พบรายการที่ตรงกับ {query ? `"${query}"` : 'ตัวกรองที่เลือก'}
      </p>
      <p className="mt-1 text-xs text-muted">
        ลองเปลี่ยนคำค้นหา หรือล้างตัวกรองเพื่อดูประวัติทั้งหมด
      </p>
      {onClear && (
        <button
          type="button"
          onClick={onClear}
          className="mt-3 rounded-lg border border-line bg-paper px-3.5 py-1.5 text-xs font-medium text-ink transition hover:border-ink cursor-pointer"
        >
          ล้างตัวกรอง
        </button>
      )}
    </div>
  );
}

export function PermissionDeniedState({
  title = 'ยังไม่ได้รับสิทธิ์เข้าถึงไมโครโฟนหรือกล้อง',
  reason = 'เบราว์เซอร์บล็อกการเข้าถึงอุปกรณ์ กรุณากดไอคอนรูปแม่กุญแจ/กล้องข้างช่อง URL แล้วเลือก "อนุญาต (Allow)" จากนั้นกดลองใหม่',
  onRetry = null,
  onBack = null,
}) {
  return (
    <div
      role="alert"
      className="rounded-xl border border-slow/40 bg-slow/10 p-4 space-y-2.5 text-xs"
    >
      <p className="font-semibold text-ink">{title}</p>
      <p className="leading-relaxed text-ink/80">{reason}</p>
      <div className="flex flex-wrap gap-2 pt-1">
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="rounded-lg bg-ink px-3 py-1.5 font-medium text-paper hover:bg-ink/85 cursor-pointer"
          >
            ลองขอสิทธิ์ใหม่
          </button>
        )}
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="rounded-lg border border-line bg-white px-3 py-1.5 font-medium text-ink hover:border-faint cursor-pointer"
          >
            ย้อนกลับ
          </button>
        )}
      </div>
    </div>
  );
}

export function SlowOperationBar({ visible = false, label = 'กำลังดำเนินการ ใช้เวลานานกว่าปกติเล็กน้อย...', progress = null }) {
  if (!visible) return null;
  const pct = typeof progress === 'number' && Number.isFinite(progress) ? Math.max(5, Math.min(100, progress)) : null;
  return (
    <div className="rounded-xl border border-line bg-paper px-4 py-3 space-y-2">
      <div className="flex items-center justify-between gap-2 text-xs text-muted">
        <span>{label}</span>
        {pct !== null && <span className="font-mono tabular-nums text-ink">{pct}%</span>}
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-line">
        <div
          className={`h-full bg-accent transition-all duration-300 ${pct === null ? 'w-2/3 animate-pulse' : ''}`}
          style={pct !== null ? { width: `${pct}%` } : undefined}
        />
      </div>
    </div>
  );
}

export function FieldError({ message }) {
  if (!message) return null;
  return (
    <p role="alert" className="mt-1 text-xs font-medium text-accent">
      {message}
    </p>
  );
}

export function SuccessBanner({
  message,
  nextLabel = '',
  onNext = null,
}) {
  if (!message) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-ok/30 bg-ok/10 px-4 py-2.5 text-xs text-ink">
      <span className="font-medium text-ok">{message}</span>
      {nextLabel && onNext && (
        <button
          type="button"
          onClick={onNext}
          className="rounded-lg bg-ok px-3 py-1 text-[11px] font-semibold text-white hover:bg-ok/90 cursor-pointer"
        >
          {nextLabel}
        </button>
      )}
    </div>
  );
}
