import { useEffect, useRef, useState } from 'react';

export const DEFAULT_VIDEO_LAYOUT = {
  slide: { x: 0.01, y: 0.03, w: 0.73, h: 0.94 },
  camera: { x: 0.76, y: 0.04, w: 0.225, h: 0.3 },
  qa: { x: 0.755, y: 0.37, w: 0.23, h: 0.56 },
};

const PRESETS = [
  {
    id: 'side-right',
    label: 'วางข้างกัน (กล้องขวา)',
    layout: {
      slide: { x: 0.01, y: 0.03, w: 0.73, h: 0.94 },
      camera: { x: 0.76, y: 0.04, w: 0.225, h: 0.3 },
      qa: { x: 0.755, y: 0.37, w: 0.23, h: 0.56 },
    },
  },
  {
    id: 'side-left',
    label: 'วางข้างกัน (กล้องซ้าย)',
    layout: {
      slide: { x: 0.26, y: 0.03, w: 0.73, h: 0.94 },
      camera: { x: 0.015, y: 0.04, w: 0.225, h: 0.3 },
      qa: { x: 0.015, y: 0.37, w: 0.23, h: 0.56 },
    },
  },
  {
    id: 'pip-br',
    label: 'สไลด์เต็ม + มุมขวาล่าง',
    layout: {
      slide: { x: 0, y: 0, w: 1, h: 1 },
      camera: { x: 0.75, y: 0.65, w: 0.23, h: 0.3 },
      qa: { x: 0.03, y: 0.04, w: 0.56, h: 0.18 },
    },
  },
  {
    id: 'pip-tr',
    label: 'สไลด์เต็ม + มุมขวาบน',
    layout: {
      slide: { x: 0, y: 0, w: 1, h: 1 },
      camera: { x: 0.75, y: 0.03, w: 0.23, h: 0.3 },
      qa: { x: 0.03, y: 0.04, w: 0.56, h: 0.18 },
    },
  },
];

function clampBox(box) {
  const w = Math.max(0.14, Math.min(1, box.w));
  const h = Math.max(0.14, Math.min(1, box.h));
  const x = Math.max(0, Math.min(1 - w, box.x));
  const y = Math.max(0, Math.min(1 - h, box.y));
  return { x, y, w, h };
}

export default function VideoLayoutModal({
  open,
  initialLayout,
  previewSlide,
  previewVideoUrl,
  onCancel,
  onConfirm,
}) {
  const [layout, setLayout] = useState(() => ({
    ...DEFAULT_VIDEO_LAYOUT,
    ...(initialLayout || {}),
    qa: initialLayout?.qa || DEFAULT_VIDEO_LAYOUT.qa,
  }));
  const stageRef = useRef(null);
  const dragRef = useRef(null);

  useEffect(() => {
    if (open) {
      setLayout({
        ...DEFAULT_VIDEO_LAYOUT,
        ...(initialLayout || {}),
        qa: initialLayout?.qa || DEFAULT_VIDEO_LAYOUT.qa,
      });
    }
  }, [open, initialLayout]);

  useEffect(() => {
    if (!open) return;
    const onMove = (e) => {
      const drag = dragRef.current;
      const stage = stageRef.current;
      if (!drag || !stage) return;
      const rect = stage.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const dx = (e.clientX - drag.startX) / rect.width;
      const dy = (e.clientY - drag.startY) / rect.height;
      setLayout((prev) => ({
        ...prev,
        [drag.target]: clampBox({
          ...drag.origin,
          x: drag.origin.x + dx,
          y: drag.origin.y + dy,
        }),
      }));
    };
    const onUp = () => {
      dragRef.current = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [open]);

  if (!open) return null;

  const startDrag = (target, e) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = {
      target,
      startX: e.clientX,
      startY: e.clientY,
      origin: { ...layout[target] },
    };
  };

  const updateWidth = (target, pct) => {
    const newW = Math.max(0.14, Math.min(1, pct / 100));
    setLayout((prev) => {
      const cur = prev[target] || DEFAULT_VIDEO_LAYOUT[target];
      const ratio = cur.w > 0 ? cur.h / cur.w : 1;
      let newH = cur.h;
      if (target === 'slide') {
        newH = newW >= 0.98 ? 1 : Math.min(1, newW * (ratio > 1.1 ? 1.28 : 1));
      } else if (target === 'camera') {
        newH = Math.min(0.65, newW * 1.33);
      } else if (target === 'qa') {
        newH = Math.max(0.16, Math.min(0.7, newW >= 0.45 ? 0.2 : 0.45));
      }
      return {
        ...prev,
        [target]: clampBox({ ...cur, w: newW, h: newH }),
      };
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
      <div className="w-full max-w-2xl rounded-2xl border border-line bg-white p-5 shadow-xl space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-ink">จัดวางตำแหน่งสไลด์และกล้องก่อนสร้างวิดีโอ</h3>
            <p className="mt-0.5 text-xs text-muted">
              ลากกล่อง &ldquo;สไลด์&rdquo; หรือ &ldquo;กล้องผู้พูด&rdquo; ในกรอบตัวอย่างด้านล่าง หรือเลือกแบบสำเร็จรูปได้เลย
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg px-2 py-1 text-xs text-muted hover:bg-paper hover:text-ink cursor-pointer"
          >
            ปิด
          </button>
        </div>

        {/* แบบสำเร็จรูป */}
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setLayout(p.layout)}
              className="rounded-lg border border-line bg-paper px-3 py-1.5 text-xs font-medium text-ink transition hover:border-ink/40 hover:bg-white cursor-pointer"
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* พื้นที่พรีวิว 16:9 แบบลากวาง */}
        <div
          ref={stageRef}
          className="relative aspect-video w-full overflow-hidden rounded-xl border border-line bg-zinc-100 select-none"
        >
          {/* กล่องสไลด์ */}
          <div
            onPointerDown={(e) => startDrag('slide', e)}
            style={{
              left: `${layout.slide.x * 100}%`,
              top: `${layout.slide.y * 100}%`,
              width: `${layout.slide.w * 100}%`,
              height: `${layout.slide.h * 100}%`,
            }}
            className="absolute z-10 overflow-hidden rounded-lg border-2 border-dashed border-ink/50 bg-white shadow-xs cursor-move"
          >
            {previewSlide?.src || previewSlide?.url ? (
              <img
                src={previewSlide.src || previewSlide.url}
                alt="ตัวอย่างสไลด์"
                draggable={false}
                className="h-full w-full object-contain pointer-events-none"
              />
            ) : (
              <div className="flex h-full w-full flex-col justify-center px-4">
                <p className="text-xs font-semibold text-ink truncate">{previewSlide?.title || 'หน้าสไลด์'}</p>
                <p className="mt-1 text-[10px] text-muted">ลากเพื่อย้ายตำแหน่งสไลด์</p>
              </div>
            )}
            <span className="pointer-events-none absolute top-1.5 left-1.5 rounded bg-ink/80 px-1.5 py-0.5 text-[10px] font-medium text-white">
              สไลด์ (ลากได้)
            </span>
          </div>

          {/* กล่องกล้องผู้พูด */}
          <div
            onPointerDown={(e) => startDrag('camera', e)}
            style={{
              left: `${layout.camera.x * 100}%`,
              top: `${layout.camera.y * 100}%`,
              width: `${layout.camera.w * 100}%`,
              height: `${layout.camera.h * 100}%`,
            }}
            className="absolute z-20 overflow-hidden rounded-lg border-2 border-accent bg-zinc-900 shadow-md cursor-move"
          >
            {previewVideoUrl ? (
              <video
                src={previewVideoUrl}
                muted
                playsInline
                className="h-full w-full object-cover -scale-x-100 pointer-events-none"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-[11px] text-white/80">
                กล้องผู้พูด
              </div>
            )}
            <span className="pointer-events-none absolute top-1.5 left-1.5 rounded bg-accent px-1.5 py-0.5 text-[10px] font-medium text-white">
              กล้อง (ลากได้)
            </span>
          </div>

          {/* กล่องคำถาม Q&A (แสดงเฉพาะช่วง Q&A) */}
          {layout.qa && (
            <div
              onPointerDown={(e) => startDrag('qa', e)}
              style={{
                left: `${layout.qa.x * 100}%`,
                top: `${layout.qa.y * 100}%`,
                width: `${layout.qa.w * 100}%`,
                height: `${layout.qa.h * 100}%`,
              }}
              className="absolute z-30 overflow-hidden rounded-lg border-2 border-dashed border-ok bg-white/95 p-2 shadow-sm cursor-move"
            >
              <span className="inline-block rounded bg-ok px-1.5 py-0.5 text-[9px] font-semibold text-white">
                คำถาม Q&A (ลากได้)
              </span>
              <p className="mt-1 text-[10px] leading-snug text-ink/80 line-clamp-3">
                ตัวอย่างข้อความคำถามกรรมการจะแสดงในกรอบนี้ช่วงถาม-ตอบ
              </p>
            </div>
          )}
        </div>

        {/* แถบปรับขนาด */}
        <div className="grid gap-4 sm:grid-cols-3 rounded-xl border border-line bg-paper/60 p-3.5">
          <div>
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-ink">ขนาดสไลด์</span>
              <span className="font-mono text-muted">{Math.round(layout.slide.w * 100)}%</span>
            </div>
            <input
              type="range"
              min={45}
              max={100}
              value={Math.round(layout.slide.w * 100)}
              onChange={(e) => updateWidth('slide', Number(e.target.value))}
              className="mt-1.5 w-full accent-ink cursor-pointer"
            />
          </div>
          <div>
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-ink">ขนาดกล้องผู้พูด</span>
              <span className="font-mono text-muted">{Math.round(layout.camera.w * 100)}%</span>
            </div>
            <input
              type="range"
              min={15}
              max={42}
              value={Math.round(layout.camera.w * 100)}
              onChange={(e) => updateWidth('camera', Number(e.target.value))}
              className="mt-1.5 w-full accent-accent cursor-pointer"
            />
          </div>
          <div>
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-ink">ขนาดกล่อง Q&A</span>
              <span className="font-mono text-muted">{Math.round((layout.qa?.w || 0.23) * 100)}%</span>
            </div>
            <input
              type="range"
              min={18}
              max={80}
              value={Math.round((layout.qa?.w || 0.23) * 100)}
              onChange={(e) => updateWidth('qa', Number(e.target.value))}
              className="mt-1.5 w-full accent-ok cursor-pointer"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2.5 pt-1">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-line bg-white px-4 py-2 text-xs font-medium text-ink hover:border-faint cursor-pointer"
          >
            ยกเลิก
          </button>
          <button
            type="button"
            onClick={() => onConfirm(layout)}
            className="rounded-lg bg-accent px-4 py-2 text-xs font-medium text-white transition hover:bg-accent/90 cursor-pointer"
          >
            เริ่มสร้างวิดีโอตามเลย์เอาต์นี้
          </button>
        </div>
      </div>
    </div>
  );
}
