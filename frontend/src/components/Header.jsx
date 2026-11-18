import { useState } from 'react';
import { ModeBadge } from './ui/StateViews';
import { CoinsIcon, HistoryIcon, HomeIcon, MenuIcon, XIcon } from './ui/Icons';

const STEPS = [
  { key: 'upload', label: 'สไลด์' },
  { key: 'rehearsal', label: 'ซ้อมพูด' },
  { key: 'qa', label: 'ถาม-ตอบ' },
  { key: 'summary', label: 'สรุปผล' },
];

export default function Header({
  step,
  user,
  authLoading,
  signingIn = false,
  authRetryNeeded = false,
  onRetryAuth,
  onSignIn,
  onSignOut,
  onOpenWallet,
  onOpenHistory,
  onGoHome,
}) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const current = STEPS.findIndex((s) => s.key === step);

  return (
    <header className="sticky top-0 z-40 border-b border-line/80 bg-white/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-2.5">
          <button
            type="button"
            onClick={() => {
              setMobileMenuOpen(false);
              onGoHome?.();
            }}
            className="flex min-h-[44px] items-center gap-2 text-left transition hover:opacity-80 cursor-pointer"
            title="กลับหน้าแรก"
          >
            <span className="size-2.5 rounded-full bg-accent" />
            <span className="text-base font-semibold tracking-tight text-ink">Test SWK</span>
          </button>
          {step === 'group' && <ModeBadge mode="group" />}
          {step !== 'mode' && step !== 'group' && <ModeBadge mode="solo" />}
          {step !== 'mode' && onGoHome && (
            <button
              type="button"
              onClick={onGoHome}
              className="hidden sm:inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-paper px-3 py-1.5 text-xs font-medium text-ink transition hover:bg-line/70 cursor-pointer"
            >
              <HomeIcon className="size-3.5 text-muted" />
              หน้าแรก
            </button>
          )}
        </div>

        {/* Desktop Stepper */}
        <ol className="hidden items-center gap-1.5 text-sm md:flex">
          {STEPS.map((s, i) => (
            <li key={s.key} className="flex items-center gap-1.5">
              {i > 0 && <span className="mx-1 h-px w-4 bg-line" />}
              <span
                className={
                  i === current
                    ? 'rounded-full bg-ink/8 px-3 py-1 font-semibold text-ink'
                    : i < current
                      ? 'px-2 py-1 text-muted'
                      : 'px-2 py-1 text-faint'
                }
              >
                <span className="mr-1.5 font-mono text-xs">{i + 1}</span>
                {s.label}
              </span>
            </li>
          ))}
        </ol>

        {/* Compact Mobile Stepper */}
        {current >= 0 && (
          <span className="rounded-full bg-paper px-2.5 py-1 font-mono text-xs font-medium text-ink md:hidden">
            {current + 1}/{STEPS.length} · {STEPS[current].label}
          </span>
        )}

        {/* Desktop Actions */}
        <div className="hidden items-center gap-2 sm:flex">
          {authLoading || signingIn ? (
            <div className="inline-flex min-h-[38px] items-center gap-2 rounded-xl border border-line bg-paper px-3.5 py-1.5 text-xs font-medium text-ink">
              <span className="size-2 rounded-full bg-accent animate-pulse" aria-hidden="true" />
              <span>กำลังเข้าสู่ระบบ...</span>
            </div>
          ) : user ? (
            <>
              <button
                type="button"
                onClick={onOpenHistory}
                className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-paper px-3 py-1.5 text-xs font-medium text-ink transition hover:bg-line/70 cursor-pointer"
              >
                <HistoryIcon className="size-3.5 text-muted" />
                ประวัติ
              </button>
              <button
                type="button"
                onClick={onOpenWallet}
                className="inline-flex min-h-[38px] items-center gap-1.5 rounded-full bg-paper px-3 py-1.5 font-mono text-xs font-medium text-ink transition hover:bg-line/70 cursor-pointer"
                title="เปิดกระเป๋า Token และชวนเพื่อน"
              >
                <CoinsIcon className="size-3.5 text-accent" />
                {user.tokenBalance ?? 0}
              </button>
              <div className="flex items-center gap-2 pl-1">
                {user.avatarUrl ? (
                  <img
                    src={user.avatarUrl}
                    alt={user.name || user.email}
                    className="size-7 rounded-full object-cover shadow-xs"
                  />
                ) : (
                  <span className="flex size-7 items-center justify-center rounded-full bg-ink text-xs font-medium text-paper">
                    {(user.name || user.email || 'U').slice(0, 1).toUpperCase()}
                  </span>
                )}
                <span className="hidden max-w-[120px] truncate text-xs font-medium text-ink lg:inline">
                  {user.name || user.email}
                </span>
              </div>
              <button
                type="button"
                onClick={onSignOut}
                className="min-h-[38px] rounded-lg px-2.5 py-1.5 text-xs text-muted transition hover:bg-paper hover:text-ink cursor-pointer"
              >
                ออกจากระบบ
              </button>
            </>
          ) : authRetryNeeded ? (
            <button
              type="button"
              onClick={onRetryAuth}
              className="min-h-[40px] rounded-xl border border-accent/40 bg-accent/10 px-4 py-2 text-xs font-semibold text-accent transition hover:bg-accent/15 cursor-pointer"
            >
              เชื่อมต่อบัญชีอีกครั้ง
            </button>
          ) : (
            <button
              type="button"
              onClick={onSignIn}
              className="min-h-[40px] rounded-xl bg-ink px-4 py-2 text-xs font-semibold text-paper shadow-xs transition hover:bg-ink/85 cursor-pointer"
            >
              เข้าสู่ระบบด้วย Google
            </button>
          )}
        </div>

        {/* Mobile Menu Toggle */}
        <button
          type="button"
          onClick={() => setMobileMenuOpen((v) => !v)}
          aria-label="เปิดเมนู"
          className="inline-flex size-11 items-center justify-center rounded-xl bg-paper text-ink transition hover:bg-line/70 sm:hidden cursor-pointer"
        >
          {mobileMenuOpen ? <XIcon className="size-5" /> : <MenuIcon className="size-5" />}
        </button>
      </div>

      {/* Mobile Dropdown Drawer */}
      {mobileMenuOpen && (
        <div className="animate-fade-up border-t border-line bg-white px-4 py-3 space-y-2 sm:hidden">
          {step !== 'mode' && onGoHome && (
            <button
              type="button"
              onClick={() => {
                setMobileMenuOpen(false);
                onGoHome();
              }}
              className="flex min-h-[44px] w-full items-center gap-2.5 rounded-xl bg-paper px-4 text-sm font-medium text-ink cursor-pointer"
            >
              <HomeIcon className="size-4 text-muted" />
              กลับหน้าแรก
            </button>
          )}

          {authLoading || signingIn ? (
            <div className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border border-line bg-paper px-4 text-sm font-medium text-ink">
              <span className="size-2 rounded-full bg-accent animate-pulse" aria-hidden="true" />
              <span>กำลังเข้าสู่ระบบ...</span>
            </div>
          ) : user ? (
            <>
              <div className="flex items-center justify-between rounded-xl bg-paper px-4 py-2.5">
                <span className="truncate text-sm font-medium text-ink">
                  {user.name || user.email}
                </span>
                <span className="font-mono text-xs font-semibold text-accent">
                  {user.tokenBalance ?? 0} Tokens
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    onOpenHistory();
                  }}
                  className="flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-paper text-sm font-medium text-ink cursor-pointer"
                >
                  <HistoryIcon className="size-4 text-muted" />
                  ประวัติ
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    onOpenWallet();
                  }}
                  className="flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-paper text-sm font-medium text-ink cursor-pointer"
                >
                  <CoinsIcon className="size-4 text-accent" />
                  กระเป๋า Token
                </button>
              </div>
              <button
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  onSignOut();
                }}
                className="flex min-h-[44px] w-full items-center justify-center rounded-xl text-sm text-muted hover:bg-paper hover:text-ink cursor-pointer"
              >
                ออกจากระบบ
              </button>
            </>
          ) : authRetryNeeded ? (
            <button
              type="button"
              onClick={() => {
                setMobileMenuOpen(false);
                onRetryAuth?.();
              }}
              className="flex min-h-[48px] w-full items-center justify-center rounded-xl border border-accent/40 bg-accent/10 text-sm font-semibold text-accent cursor-pointer"
            >
              เชื่อมต่อบัญชีอีกครั้ง
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setMobileMenuOpen(false);
                onSignIn();
              }}
              className="flex min-h-[48px] w-full items-center justify-center rounded-xl bg-ink text-sm font-semibold text-paper cursor-pointer"
            >
              เข้าสู่ระบบด้วย Google
            </button>
          )}
        </div>
      )}
    </header>
  );
}
