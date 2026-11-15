import { useState } from 'react';

const MEMBER_COLORS = [
  'bg-orange-50 text-orange-800 border-orange-200',
  'bg-sky-50 text-sky-800 border-sky-200',
  'bg-emerald-50 text-emerald-800 border-emerald-200',
  'bg-violet-50 text-violet-800 border-violet-200',
  'bg-amber-50 text-amber-800 border-amber-200',
  'bg-rose-50 text-rose-800 border-rose-200',
];

export function getMemberColor(members, memberId) {
  const idx = members.findIndex((m) => m.id === memberId);
  if (idx < 0) return 'bg-paper text-muted border-line';
  return MEMBER_COLORS[idx % MEMBER_COLORS.length];
}

export default function GroupAssignModal({
  slides,
  members,
  assignments,
  onSave,
  onClose,
}) {
  const [draft, setDraft] = useState(() => ({ ...(assignments || {}) }));
  const [activeMemberId, setActiveMemberId] = useState(members[0]?.id || '');
  const [rangeMemberId, setRangeMemberId] = useState(members[0]?.id || '');
  const [fromPage, setFromPage] = useState(1);
  const [toPage, setToPage] = useState(slides.length || 1);
  const [dragOverIdx, setDragOverIdx] = useState(null);

  const memberMap = new Map(members.map((m) => [m.id, m]));

  const assignSlide = (slideIdx, memberId) => {
    if (!memberId) return;
    setDraft((prev) => ({ ...prev, [slideIdx]: memberId }));
  };

  const unassignSlide = (slideIdx) => {
    setDraft((prev) => {
      const next = { ...prev };
      delete next[slideIdx];
      return next;
    });
  };

  const handleApplyRange = (e) => {
    e.preventDefault();
    if (!rangeMemberId || slides.length === 0) return;
    const start = Math.max(1, Math.min(slides.length, Number(fromPage) || 1));
    const end = Math.max(start, Math.min(slides.length, Number(toPage) || start));
    setDraft((prev) => {
      const next = { ...prev };
      for (let idx = start - 1; idx <= end - 1; idx++) {
        next[idx] = rangeMemberId;
      }
      return next;
    });
  };

  const handleAutoSplit = () => {
    if (members.length === 0 || slides.length === 0) return;
    const next = {};
    const perMember = Math.ceil(slides.length / members.length);
    slides.forEach((_, idx) => {
      const ownerIdx = Math.min(members.length - 1, Math.floor(idx / perMember));
      next[idx] = members[ownerIdx].id;
    });
    setDraft(next);
  };

  const assignedCount = slides.filter((_, idx) => Boolean(draft[idx])).length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-line bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-ink">จัดคิวสไลด์ให้สมาชิก</h2>
            <p className="mt-0.5 text-xs text-muted">
              ลากชื่อเพื่อนไปวางบนสไลด์, คลิกเลือกชื่อแล้วจิ้มสไลด์, หรือกำหนดช่วงหน้าแบบเร็วได้เลย
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-line px-2.5 py-1 text-xs text-muted hover:text-ink cursor-pointer"
          >
            ปิด
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {/* แถบกำหนดช่วงหน้าแบบเร็ว */}
          <form
            onSubmit={handleApplyRange}
            className="flex flex-wrap items-end gap-2.5 rounded-xl border border-line bg-paper/60 p-3.5"
          >
            <div className="min-w-[140px] flex-1">
              <label className="block text-[11px] font-medium text-muted">สมาชิก</label>
              <select
                value={rangeMemberId}
                onChange={(e) => setRangeMemberId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-line bg-white px-2.5 py-1.5 text-xs text-ink focus:border-ink focus:outline-none"
              >
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} {m.role === 'host' ? '(หัวหน้า)' : ''}
                  </option>
                ))}
              </select>
            </div>

            <div className="w-20">
              <label className="block text-[11px] font-medium text-muted">ตั้งแต่หน้า</label>
              <input
                type="number"
                min={1}
                max={slides.length}
                value={fromPage}
                onChange={(e) => setFromPage(e.target.value)}
                className="mt-1 w-full rounded-lg border border-line bg-white px-2.5 py-1.5 font-mono text-xs text-ink focus:border-ink focus:outline-none"
              />
            </div>

            <div className="w-20">
              <label className="block text-[11px] font-medium text-muted">ถึงหน้า</label>
              <input
                type="number"
                min={1}
                max={slides.length}
                value={toPage}
                onChange={(e) => setToPage(e.target.value)}
                className="mt-1 w-full rounded-lg border border-line bg-white px-2.5 py-1.5 font-mono text-xs text-ink focus:border-ink focus:outline-none"
              />
            </div>

            <button
              type="submit"
              className="rounded-lg bg-ink px-3.5 py-1.5 text-xs font-medium text-paper hover:opacity-90 cursor-pointer"
            >
              กำหนดช่วงนี้
            </button>

            <button
              type="button"
              onClick={handleAutoSplit}
              className="rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-medium text-ink hover:border-faint cursor-pointer"
            >
              แบ่งเท่าๆ กันอัตโนมัติ
            </button>

            <button
              type="button"
              onClick={() => setDraft({})}
              className="rounded-lg border border-line bg-white px-3 py-1.5 text-xs text-muted hover:text-ink cursor-pointer"
            >
              ล้างทั้งหมด
            </button>
          </form>

          {/* ป้ายชื่อสมาชิกสำหรับลากวาง หรือคลิกเลือกแล้วจิ้มสไลด์ */}
          <div>
            <p className="text-xs font-medium text-ink">
              ลากชื่อเพื่อนไปวางบนสไลด์ (หรือคลิกเลือกชื่อ แล้วจิ้มที่สไลด์)
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {members.map((m) => {
                const isSelected = activeMemberId === m.id;
                const count = slides.filter((_, idx) => draft[idx] === m.id).length;
                return (
                  <button
                    key={m.id}
                    type="button"
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/plain', m.id);
                      setActiveMemberId(m.id);
                    }}
                    onClick={() => setActiveMemberId(m.id)}
                    className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition cursor-grab active:cursor-grabbing ${getMemberColor(
                      members,
                      m.id,
                    )} ${isSelected ? 'ring-2 ring-ink/30' : 'opacity-90 hover:opacity-100'}`}
                  >
                    <span>{m.name}</span>
                    <span className="rounded-full bg-white/80 px-1.5 py-0.2 font-mono text-[10px]">
                      {count} หน้า
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* กริดสไลด์ */}
          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
            {slides.map((s, idx) => {
              const ownerId = draft[idx];
              const owner = ownerId ? memberMap.get(ownerId) : null;
              const isOver = dragOverIdx === idx;

              return (
                <div
                  key={s.id || idx}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOverIdx(idx);
                  }}
                  onDragLeave={() => setDragOverIdx(null)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOverIdx(null);
                    const droppedId = e.dataTransfer.getData('text/plain') || activeMemberId;
                    assignSlide(idx, droppedId);
                  }}
                  onClick={() => {
                    if (activeMemberId) assignSlide(idx, activeMemberId);
                  }}
                  className={`flex flex-col justify-between rounded-xl border p-3 transition cursor-pointer ${
                    isOver
                      ? 'border-accent bg-accent/5 ring-2 ring-accent/30'
                      : 'border-line bg-white hover:border-faint'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="rounded bg-paper px-1.5 py-0.5 font-mono text-[11px] font-semibold text-ink">
                        หน้า {idx + 1}
                      </span>
                      {owner && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            unassignSlide(idx);
                          }}
                          className="text-[11px] text-faint hover:text-accent cursor-pointer"
                          title="นำชื่อออก"
                        >
                          ล้าง
                        </button>
                      )}
                    </div>

                    {s.src ? (
                      <div className="mt-2 overflow-hidden rounded-lg border border-line bg-paper/40">
                        <img
                          src={s.src}
                          alt={s.title || `หน้า ${idx + 1}`}
                          className="aspect-video w-full object-contain pointer-events-none"
                        />
                      </div>
                    ) : (
                      <p className="mt-2 line-clamp-2 text-xs font-medium text-ink min-h-[32px]">
                        {s.title || `สไลด์หน้า ${idx + 1}`}
                      </p>
                    )}
                  </div>

                  <div className="mt-2.5 pt-2 border-t border-line/60">
                    {owner ? (
                      <span
                        className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${getMemberColor(
                          members,
                          owner.id,
                        )}`}
                      >
                        {owner.name}
                      </span>
                    ) : (
                      <span className="text-[11px] text-faint italic">ยังไม่ได้กำหนดคนพูด</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-6 py-4 bg-paper/40">
          <p className="text-xs text-muted">
            กำหนดคนพูดแล้ว {assignedCount}/{slides.length} หน้า
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-line bg-white px-4 py-2 text-xs font-medium text-ink hover:border-faint cursor-pointer"
            >
              ยกเลิก
            </button>
            <button
              type="button"
              onClick={() => onSave(draft)}
              className="rounded-lg bg-accent px-5 py-2 text-xs font-semibold text-white hover:bg-accent/90 cursor-pointer"
            >
              บันทึกการจัดคิว
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
