const STEPS = [
  { key: 'upload', label: 'สไลด์' },
  { key: 'rehearsal', label: 'ซ้อมพูด' },
  { key: 'summary', label: 'สรุปผล' },
];

export default function Header({ step }) {
  const current = STEPS.findIndex((s) => s.key === step);

  return (
    <header className="border-b border-line">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
        <div className="flex items-center gap-2">
          <span className="size-2.5 rounded-full bg-accent" />
          <span className="font-semibold tracking-tight">SpeakQuest</span>
        </div>

        <ol className="flex items-center gap-1 text-sm">
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
      </div>
    </header>
  );
}
