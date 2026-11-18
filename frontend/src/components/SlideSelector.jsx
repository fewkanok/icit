export default function SlideSelector({
  slides,
  selectedIndices = null,
  onChange,
  activeIndex = null,
  onSelectPreview = null,
  label = 'เลือกสไลด์ที่จะซ้อม',
}) {
  if (!Array.isArray(slides) || slides.length <= 1) return null;

  const normalizedSelected =
    selectedIndices === null
      ? slides.map((_, i) => i)
      : selectedIndices.filter((i) => Number.isInteger(i) && i >= 0 && i < slides.length);

  const selectedSet = new Set(normalizedSelected.length > 0 ? normalizedSelected : [0]);
  const selectedCount = selectedSet.size;
  const allSelected = selectedCount === slides.length;

  const toggleIndex = (idx) => {
    const next = new Set(selectedSet);
    const willSelect = !next.has(idx);
    if (next.has(idx)) {
      if (next.size <= 1) return; // อย่างน้อยต้องเหลือ 1 หน้าเสมอ
      next.delete(idx);
    } else {
      next.add(idx);
    }
    const sorted = Array.from(next).sort((a, b) => a - b);
    onChange(sorted);
    if (willSelect) {
      onSelectPreview?.(idx);
    }
  };

  const selectAll = () => {
    onChange(slides.map((_, i) => i));
  };

  const selectOnlyActive = () => {
    if (activeIndex === null || activeIndex < 0 || activeIndex >= slides.length) return;
    onChange([activeIndex]);
  };

  return (
    <div className="mt-4 rounded-xl border border-line bg-white p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-ink">{label}</span>
          <span className="rounded-full bg-paper px-2 py-0.5 font-mono text-[11px] text-muted tabular-nums">
            {selectedCount}/{slides.length} หน้า
          </span>
        </div>

        <div className="flex items-center gap-2">
          {activeIndex !== null && (selectedCount > 1 || !selectedSet.has(activeIndex)) && (
            <button
              type="button"
              onClick={selectOnlyActive}
              className="rounded-md border border-line px-2 py-1 text-[11px] font-medium text-muted transition hover:border-faint hover:text-ink cursor-pointer"
            >
              เฉพาะหน้า {activeIndex + 1}
            </button>
          )}
          {!allSelected && (
            <button
              type="button"
              onClick={selectAll}
              className="rounded-md border border-line px-2 py-1 text-[11px] font-medium text-ink transition hover:border-faint cursor-pointer"
            >
              เลือกทั้งหมด
            </button>
          )}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3">
        {slides.map((s, idx) => {
          const checked = selectedSet.has(idx);
          const isPreviewing = activeIndex === idx;
          return (
            <button
              key={s.id ?? idx}
              type="button"
              onClick={() => toggleIndex(idx)}
              aria-pressed={checked}
              className={`group flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition cursor-pointer ${
                checked
                  ? isPreviewing
                    ? 'border-ink bg-paper/70 text-ink'
                    : 'border-ink/50 bg-white text-ink hover:border-ink'
                  : 'border-line bg-paper/30 text-muted opacity-65 hover:opacity-100'
              }`}
            >
              {s.imageDataUrl || s.src ? (
                <img
                  src={s.imageDataUrl || s.src}
                  alt={`หน้า ${idx + 1}`}
                  className="h-7 w-10 shrink-0 rounded border border-line/70 object-cover bg-white"
                />
              ) : (
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-line bg-paper font-mono text-[11px] font-medium text-ink">
                  {idx + 1}
                </span>
              )}

              <div className="min-w-0 flex-1">
                <p className="font-mono text-[10px] text-faint">หน้า {idx + 1}</p>
                <p className="truncate text-xs font-medium">
                  {s.title || `สไลด์ ${idx + 1}`}
                </p>
              </div>

              <span
                className={`flex size-4 shrink-0 items-center justify-center rounded border transition ${
                  checked
                    ? 'border-ink bg-ink text-white'
                    : 'border-faint/70 bg-white text-transparent'
                }`}
              >
                <svg viewBox="0 0 12 12" className="size-3" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M2.5 6.2 5 8.7 9.5 3.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
