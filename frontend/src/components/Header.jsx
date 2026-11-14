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
  onSignIn,
  onSignOut,
  onOpenWallet,
  onOpenHistory,
}) {
  const current = STEPS.findIndex((s) => s.key === step);

  return (
    <header className="border-b border-line">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-6">
        <div className="flex items-center gap-2">
          <span className="size-2.5 rounded-full bg-accent" />
          <span className="font-semibold tracking-tight">Test SWK</span>
        </div>

        <ol className="hidden items-center gap-1 text-sm sm:flex">
          {STEPS.map((s, i) => (
            <li key={s.key} className="flex items-center gap-1">
              {i > 0 && <span className="mx-1 h-px w-5 bg-line" />}
              <span
                className={
                  i === current
                    ? 'font-medium text-ink'
                    : i < current
                      ? 'text-muted'
                      : 'text-faint'
                }
              >
                <span className="mr-1.5 font-mono text-xs">{i + 1}</span>
                {s.label}
              </span>
            </li>
          ))}
        </ol>

        <div className="flex items-center gap-2">
          {authLoading ? (
            <span className="text-xs text-muted">กำลังตรวจสอบ...</span>
          ) : user ? (
            <>
              <button
                type="button"
                onClick={onOpenHistory}
                className="rounded-lg border border-line px-2.5 py-1 text-xs text-ink transition hover:border-faint cursor-pointer"
              >
                ประวัติ
              </button>
              <button
                type="button"
                onClick={onOpenWallet}
                className="rounded-full border border-line bg-paper px-2.5 py-1 font-mono text-xs font-medium text-ink transition hover:border-ink cursor-pointer"
                title="เปิดกระเป๋า Token และชวนเพื่อน"
              >
                Tokens: {user.tokenBalance ?? 0}
              </button>
              <div className="flex items-center gap-2">
                {user.avatarUrl ? (
                  <img
                    src={user.avatarUrl}
                    alt={user.name || user.email}
                    className="size-7 rounded-full border border-line object-cover"
                  />
                ) : (
                  <span className="flex size-7 items-center justify-center rounded-full bg-ink text-xs font-medium text-paper">
                    {(user.name || user.email || 'U').slice(0, 1).toUpperCase()}
                  </span>
                )}
                <span className="hidden max-w-[120px] truncate text-xs font-medium text-ink md:inline">
                  {user.name || user.email}
                </span>
              </div>
              <button
                type="button"
                onClick={onSignOut}
                className="rounded-lg border border-line px-2.5 py-1 text-xs text-muted transition hover:border-faint hover:text-ink cursor-pointer"
              >
                ออก
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={onSignIn}
              className="rounded-lg bg-ink px-3 py-1.5 text-xs font-medium text-paper transition hover:bg-ink/85 cursor-pointer"
            >
              เข้าสู่ระบบด้วย Google
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
