import { useEffect, useRef, useState } from 'react';

export default function FloatingCamera({ vision, live }) {
  // ตำแหน่งเริ่มต้น: ขวาบนของจอ
  const [position, setPosition] = useState({ x: 0, y: 90 });
  const [width, setWidth] = useState(320); // ความกว้างเริ่มต้น 320px (ปรับได้ 220px - 520px)
  const [minimized, setMinimized] = useState(false);
  const [hasInitPos, setHasInitPos] = useState(false);

  const dragRef = useRef({
    isDragging: false,
    startX: 0,
    startY: 0,
    startPosX: 0,
    startPosY: 0,
  });

  const resizeRef = useRef({
    isResizing: false,
    startX: 0,
    startWidth: 320,
  });

  // ตั้งค่าตำแหน่งเริ่มต้นให้อยู่ชิดขวาบนของจอ
  useEffect(() => {
    if (!hasInitPos && typeof window !== 'undefined') {
      const initX = Math.max(20, window.innerWidth - 350);
      setPosition({ x: initX, y: 90 });
      setHasInitPos(true);
    }
  }, [hasInitPos]);

  // ระบบลากย้ายหน้าต่าง (Drag to Move)
  const handleStartDrag = (clientX, clientY) => {
    dragRef.current = {
      isDragging: true,
      startX: clientX,
      startY: clientY,
      startPosX: position.x,
      startPosY: position.y,
    };

    const handleMove = (e) => {
      if (!dragRef.current.isDragging) return;
      const curX = e.clientX ?? e.touches?.[0]?.clientX;
      const curY = e.clientY ?? e.touches?.[0]?.clientY;
      if (curX === undefined || curY === undefined) return;

      const deltaX = curX - dragRef.current.startX;
      const deltaY = curY - dragRef.current.startY;

      const newX = Math.max(10, Math.min(window.innerWidth - width - 10, dragRef.current.startPosX + deltaX));
      const newY = Math.max(10, Math.min(window.innerHeight - 80, dragRef.current.startPosY + deltaY));

      setPosition({ x: newX, y: newY });
    };

    const handleEnd = () => {
      dragRef.current.isDragging = false;
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleEnd);
      window.removeEventListener('touchmove', handleMove);
      window.removeEventListener('touchend', handleEnd);
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleEnd);
    window.addEventListener('touchmove', handleMove);
    window.addEventListener('touchend', handleEnd);
  };

  // ระบบลากขอบเพื่อย่อ/ขยายขนาด (Drag to Resize)
  const handleStartResize = (clientX, e) => {
    e.stopPropagation();
    resizeRef.current = {
      isResizing: true,
      startX: clientX,
      startWidth: width,
    };

    const handleMove = (ev) => {
      if (!resizeRef.current.isResizing) return;
      const curX = ev.clientX ?? ev.touches?.[0]?.clientX;
      if (curX === undefined) return;

      const deltaX = curX - resizeRef.current.startX;
      const newW = Math.max(220, Math.min(520, resizeRef.current.startWidth + deltaX));
      setWidth(newW);
    };

    const handleEnd = () => {
      resizeRef.current.isResizing = false;
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleEnd);
      window.removeEventListener('touchmove', handleMove);
      window.removeEventListener('touchend', handleEnd);
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleEnd);
    window.addEventListener('touchmove', handleMove);
    window.addEventListener('touchend', handleEnd);
  };

  if (!vision.cameraActive) return null;

  return (
    <div
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        width: minimized ? 'auto' : `${width}px`,
      }}
      className={`fixed z-50 rounded-xl border border-line bg-white/95 shadow-2xl backdrop-blur-md select-none transition-shadow ${
        dragRef.current.isDragging ? 'cursor-grabbing shadow-3xl ring-2 ring-ink/20' : ''
      }`}
    >
      {/* แถบหัวหน้าต่าง (คลิกลากได้) */}
      <div
        onMouseDown={(e) => handleStartDrag(e.clientX, e.clientY)}
        onTouchStart={(e) => handleStartDrag(e.touches[0].clientX, e.touches[0].clientY)}
        className="flex items-center justify-between border-b border-line/70 px-3 py-2 bg-paper/80 rounded-t-xl cursor-grab active:cursor-grabbing"
      >
        <div className="flex items-center gap-1.5 text-xs font-medium text-ink">
          {/* ไอคอนจับลาก (Drag Handle) */}
          <svg viewBox="0 0 16 16" className="size-3.5 text-muted" fill="currentColor">
            <circle cx="5" cy="4" r="1.2" />
            <circle cx="11" cy="4" r="1.2" />
            <circle cx="5" cy="8" r="1.2" />
            <circle cx="11" cy="8" r="1.2" />
            <circle cx="5" cy="12" r="1.2" />
            <circle cx="11" cy="12" r="1.2" />
          </svg>
          <span className="font-sans">กล้องลอย</span>
        </div>

        <div className="flex items-center gap-1.5" onMouseDown={(e) => e.stopPropagation()}>
          {/* ปุ่มลัดปรับขนาด 3 ระดับ: S (240px), M (320px), L (440px) */}
          {!minimized && (
            <div className="flex items-center rounded-md border border-line/80 bg-white p-0.5 text-[10px] font-mono text-muted">
              <button
                onClick={() => setWidth(240)}
                className={`px-1.5 py-0.5 rounded transition cursor-pointer ${
                  width <= 260 ? 'bg-ink text-paper font-semibold' : 'hover:text-ink'
                }`}
                title="ขนาดกะทัดรัด (240px)"
              >
                S
              </button>
              <button
                onClick={() => setWidth(320)}
                className={`px-1.5 py-0.5 rounded transition cursor-pointer ${
                  width > 260 && width <= 360 ? 'bg-ink text-paper font-semibold' : 'hover:text-ink'
                }`}
                title="ขนาดมาตรฐาน (320px)"
              >
                M
              </button>
              <button
                onClick={() => setWidth(440)}
                className={`px-1.5 py-0.5 rounded transition cursor-pointer ${
                  width > 360 ? 'bg-ink text-paper font-semibold' : 'hover:text-ink'
                }`}
                title="ขนาดใหญ่ (440px)"
              >
                L
              </button>
            </div>
          )}

          {/* ปุ่มย่อ/ขยายหน้าต่าง */}
          <button
            onClick={() => setMinimized(!minimized)}
            className="flex size-5 items-center justify-center rounded text-muted hover:bg-line/60 hover:text-ink cursor-pointer text-xs"
            title={minimized ? 'ขยายหน้าต่าง' : 'ย่อหน้าต่าง'}
          >
            {minimized ? '▢' : '–'}
          </button>
          {/* ปุ่มปิดกล้อง */}
          <button
            onClick={vision.stopCamera}
            disabled={live}
            className="flex size-5 items-center justify-center rounded text-muted hover:bg-line/60 hover:text-accent cursor-pointer text-xs disabled:opacity-30"
            title="ปิดกล้อง"
          >
            ✕
          </button>
        </div>
      </div>

      {/* เมื่อไม่ถูกย่อ: แสดงภาพกล้อง + เครื่องมือวัด + มุมลากปรับขนาด */}
      {!minimized ? (
        <div className="relative p-3 space-y-2.5">
          <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-black">
            <video
              ref={vision.setVideoRef}
              playsInline
              muted
              autoPlay
              className="h-full w-full object-cover -scale-x-100"
            />

            {/* ป้ายเตือนสถานะมุมบนขวา */}
            <div className="absolute top-2 right-2 flex items-center gap-1.5 rounded-full bg-ink/80 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur-xs">
              {vision.currentStatus === 'eye_contact' && (
                <>
                  <span className="size-1.5 rounded-full bg-ok animate-pulse" />
                  <span>สบตาคนฟัง</span>
                </>
              )}
              {vision.currentStatus === 'looking_down' && (
                <>
                  <span className="size-1.5 rounded-full bg-slow animate-pulse" />
                  <span>ก้มอ่านโพย!</span>
                </>
              )}
              {vision.currentStatus === 'looking_away' && (
                <>
                  <span className="size-1.5 rounded-full bg-white/70" />
                  <span>หันมองสไลด์</span>
                </>
              )}
              {vision.currentStatus === 'no_face' && (
                <>
                  <span className="size-1.5 rounded-full bg-accent" />
                  <span>ไม่พบใบหน้า</span>
                </>
              )}
            </div>
          </div>

          {/* แถบเปอร์เซ็นต์ Eye Contact สด */}
          <div className="space-y-1">
            <div className="flex justify-between text-[11px]">
              <span className="text-muted">Eye Contact (การสบตา)</span>
              <span className="font-mono font-medium text-ink">{vision.eyeContactPct}%</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-line">
              <div
                className={`h-full transition-all duration-200 ${
                  vision.eyeContactPct >= 70 ? 'bg-ok' : vision.eyeContactPct >= 45 ? 'bg-slow' : 'bg-accent'
                }`}
                style={{ width: `${vision.eyeContactPct}%` }}
              />
            </div>
            <div className="flex justify-between text-[10px] text-faint font-mono pt-0.5">
              <span>ก้ม/เงย: {vision.poseAngles.pitch}°</span>
              <span>หันซ้าย/ขวา: {vision.poseAngles.yaw}°</span>
            </div>
          </div>

          {/* มุมขวาล่างสำหรับคลิกลากย่อ/ขยายขนาดได้อย่างอิสระ (Resize Handle) */}
          <div
            onMouseDown={(e) => handleStartResize(e.clientX, e)}
            onTouchStart={(e) => handleStartResize(e.touches[0].clientX, e)}
            className="absolute bottom-1 right-1 flex size-4 items-end justify-end p-0.5 cursor-nwse-resize text-faint hover:text-ink transition"
            title="คลิกลากเพื่อปรับขนาดจอกล้องได้อย่างอิสระ"
          >
            <svg viewBox="0 0 10 10" className="size-2.5" fill="currentColor">
              <path d="M9 1v8H1l8-8zm-4 8h4V5l-4 4z" />
            </svg>
          </div>
        </div>
      ) : (
        /* เมื่อย่อหน้าต่าง: แสดงแถบสรุปขนาดกะทัดรัด */
        <div className="flex items-center justify-between px-3 py-2 text-xs">
          <div className="flex items-center gap-2">
            <span className="font-mono font-semibold text-ink">{vision.eyeContactPct}%</span>
            {vision.currentStatus === 'eye_contact' && (
              <span className="text-ok text-[11px]">สบตาดี</span>
            )}
            {vision.currentStatus === 'looking_down' && (
              <span className="text-slow font-medium text-[11px] animate-pulse">ก้มอ่าน!</span>
            )}
            {vision.currentStatus === 'looking_away' && (
              <span className="text-muted text-[11px]">หันข้าง</span>
            )}
          </div>
          <span className="text-[10px] text-faint font-mono">ลากย้ายได้</span>
        </div>
      )}
    </div>
  );
}
