import { useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { createSocket } from '../lib/socket';
import { filesToSlides, SAMPLE_DECK } from '../lib/slides';
import DeviceTestCard from './DeviceTestCard';
import GroupStageView from './GroupStageView';
import GroupSummaryView from './GroupSummaryView';
import GroupAssignModal, { getMemberColor } from './GroupAssignModal';

async function compressSlideForSocket(slide) {
  const src = slide?.src;
  if (!src || !src.startsWith('data:image/') || src.startsWith('data:image/svg')) {
    return slide;
  }
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const maxW = 960;
      const scale = img.width > maxW ? maxW / img.width : 1;
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      resolve({
        ...slide,
        src: canvas.toDataURL('image/jpeg', 0.8),
      });
    };
    img.onerror = () => resolve(slide);
    img.src = src;
  });
}

function formatSlideNumbers(indices) {
  if (!indices || indices.length === 0) return 'ยังไม่ได้รับคิว';
  return `หน้า ${indices.map((n) => n + 1).join(', ')}`;
}

export default function GroupLobbyStep({ initialCode = '', user, onBack }) {
  const defaultName = user?.name || user?.email?.split('@')[0] || '';
  const [tab, setTab] = useState(initialCode ? 'join' : 'create'); // 'create' | 'join'
  const [displayName, setDisplayName] = useState(defaultName);
  const [roomCodeInput, setRoomCodeInput] = useState(initialCode);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [room, setRoom] = useState(null);
  const [selfId, setSelfId] = useState('');
  const [copiedType, setCopiedType] = useState('');
  const [assignOpen, setAssignOpen] = useState(false);
  const [slideProgress, setSlideProgress] = useState(null);

  const socketRef = useRef(null);
  const fileInputRef = useRef(null);
  const stopTestRef = useRef(null);

  useEffect(() => {
    const socket = createSocket();
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      setError('');
    });

    socket.on('disconnect', () => {
      setConnected(false);
    });

    socket.on('connect_error', () => {
      setConnected(false);
      setError('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ห้องซ้อมได้ กรุณาลองใหม่อีกครั้ง');
    });

    socket.on('group:state', (nextRoom) => {
      if (nextRoom?.started) {
        stopTestRef.current?.();
      }
      setRoom(nextRoom);
    });

    return () => {
      socket.emit('group:leave');
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!displayName && defaultName) {
      setDisplayName(defaultName);
    }
  }, [defaultName, displayName]);

  const handleCreate = (e) => {
    e.preventDefault();
    const socket = socketRef.current;
    if (!socket || !connected) {
      setError('กำลังเชื่อมต่อเซิร์ฟเวอร์ กรุณารอสักครู่');
      return;
    }
    const cleanName = displayName.trim();
    if (!cleanName) {
      setError('กรุณากรอกชื่อของคุณก่อนสร้างห้อง');
      return;
    }

    setBusy(true);
    setError('');
    socket.emit('group:create', { name: cleanName }, (res) => {
      setBusy(false);
      if (!res?.ok) {
        setError(res?.message || 'สร้างห้องไม่สำเร็จ');
        return;
      }
      setSelfId(res.selfId || socket.id || '');
      setRoom(res.room);
    });
  };

  const handleJoin = (e) => {
    e.preventDefault();
    const socket = socketRef.current;
    if (!socket || !connected) {
      setError('กำลังเชื่อมต่อเซิร์ฟเวอร์ กรุณารอสักครู่');
      return;
    }
    const cleanName = displayName.trim();
    const cleanCode = roomCodeInput.trim().toUpperCase();
    if (!cleanName) {
      setError('กรุณากรอกชื่อของคุณก่อนเข้าห้อง');
      return;
    }
    if (cleanCode.length < 4) {
      setError('กรุณากรอกรหัสห้องให้ครบถ้วน');
      return;
    }

    setBusy(true);
    setError('');
    socket.emit('group:join', { code: cleanCode, name: cleanName }, (res) => {
      setBusy(false);
      if (!res?.ok) {
        setError(res?.message || 'เข้าร่วมห้องไม่สำเร็จ');
        return;
      }
      setSelfId(res.selfId || socket.id || '');
      setRoom(res.room);
    });
  };

  const handleToggleReady = () => {
    const socket = socketRef.current;
    if (!socket || !room) return;
    const me = room.members.find((m) => m.id === selfId);
    socket.emit('group:ready', { ready: !me?.ready });
  };

  const handleLeaveRoom = () => {
    const socket = socketRef.current;
    if (socket) {
      socket.emit('group:leave');
    }
    setRoom(null);
    setSelfId('');
    setAssignOpen(false);
    setError('');
  };

  const handleUploadSlides = async (fileList) => {
    const files = Array.from(fileList ?? []);
    const socket = socketRef.current;
    if (!files.length || !socket) return;

    setError('');
    setSlideProgress({ done: 0, total: 0 });
    try {
      const rawSlides = await filesToSlides(files, (done, total) =>
        setSlideProgress({ done, total }),
      );
      const compressed = await Promise.all(rawSlides.map(compressSlideForSocket));
      const deckName =
        files.length === 1 ? files[0].name : `รูปภาพ ${files.length} ไฟล์`;
      socket.emit('group:set_deck', { deckName, slides: compressed }, (res) => {
        if (!res?.ok) {
          setError(res?.message || 'อัปโหลดสไลด์เข้าห้องไม่สำเร็จ');
        }
      });
    } catch (e) {
      setError(e?.message || 'อ่านไฟล์สไลด์ไม่สำเร็จ');
    } finally {
      setSlideProgress(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleUseSampleDeck = () => {
    const socket = socketRef.current;
    if (!socket) return;
    setError('');
    socket.emit(
      'group:set_deck',
      { deckName: SAMPLE_DECK.name, slides: SAMPLE_DECK.slides },
      (res) => {
        if (!res?.ok) {
          setError(res?.message || 'โหลดสไลด์ตัวอย่างไม่สำเร็จ');
        }
      },
    );
  };

  const handleSaveAssignments = (nextAssignments) => {
    const socket = socketRef.current;
    if (!socket) return;
    socket.emit('group:set_assignments', { assignments: nextAssignments }, (res) => {
      if (res?.ok) {
        setAssignOpen(false);
      } else {
        setError(res?.message || 'บันทึกการจัดคิวไม่สำเร็จ');
      }
    });
  };

  const handleStartRehearsal = () => {
    const socket = socketRef.current;
    if (!socket) return;
    stopTestRef.current?.();
    setError('');
    socket.emit('group:start', {}, (res) => {
      if (!res?.ok) {
        setError(res?.message || 'เริ่มซ้อมกลุ่มไม่สำเร็จ');
      }
    });
  };

  const handleChangeSlide = (nextIdx) => {
    const socket = socketRef.current;
    if (!socket) return;
    socket.emit('group:slide_change', { index: nextIdx });
  };

  const handleStopRehearsal = () => {
    const socket = socketRef.current;
    if (!socket) return;
    socket.emit('group:stop');
  };

  const handleFinishRehearsal = () => {
    const socket = socketRef.current;
    if (!socket) return;
    socket.emit('group:finish');
  };

  const copyText = async (text, type) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedType(type);
      setTimeout(() => setCopiedType(''), 1800);
    } catch {
      // ignore clipboard failures
    }
  };

  // ยังไม่ได้เข้าห้อง: หน้าสร้าง/เข้าร่วมห้อง
  if (!room) {
    return (
      <div className="mx-auto max-w-lg px-6 py-14">
        <button
          type="button"
          onClick={onBack}
          className="text-xs text-muted underline-offset-4 hover:text-ink hover:underline cursor-pointer"
        >
          ← กลับหน้าเลือกรูปแบบการซ้อม
        </button>

        <div className="mt-5 rounded-2xl border border-line bg-white p-6 shadow-xs">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h1 className="text-xl font-semibold text-ink">ซ้อมกลุ่ม (Lobby)</h1>
              <p className="mt-1 text-xs text-muted">
                สร้างห้องแชร์ลิงก์ให้เพื่อน หรือใส่รหัสเพื่อเข้าห้องเดียวกัน
              </p>
            </div>
            <span
              className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                connected ? 'bg-ok/10 text-ok' : 'bg-paper text-muted'
              }`}
            >
              {connected ? 'ออนไลน์' : 'กำลังเชื่อมต่อ...'}
            </span>
          </div>

          <div className="mt-5 grid grid-cols-2 rounded-xl border border-line bg-paper p-1 text-xs font-medium">
            <button
              type="button"
              onClick={() => {
                setTab('create');
                setError('');
              }}
              className={`rounded-lg py-2 transition cursor-pointer ${
                tab === 'create' ? 'bg-white text-ink shadow-xs' : 'text-muted hover:text-ink'
              }`}
            >
              สร้างห้องใหม่
            </button>
            <button
              type="button"
              onClick={() => {
                setTab('join');
                setError('');
              }}
              className={`rounded-lg py-2 transition cursor-pointer ${
                tab === 'join' ? 'bg-white text-ink shadow-xs' : 'text-muted hover:text-ink'
              }`}
            >
              เข้าร่วมห้อง
            </button>
          </div>

          <form onSubmit={tab === 'create' ? handleCreate : handleJoin} className="mt-5 space-y-4">
            <div>
              <label className="block text-xs font-medium text-ink">
                ชื่อของคุณ (แสดงให้เพื่อนเห็น)
              </label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={30}
                placeholder="เช่น ฟิวส์, เอิร์ธ, มิน"
                className="mt-1.5 w-full rounded-xl border border-line bg-paper/40 px-3.5 py-2.5 text-sm text-ink focus:border-ink focus:bg-white focus:outline-none"
              />
            </div>

            {tab === 'join' && (
              <div>
                <label className="block text-xs font-medium text-ink">รหัสห้อง 6 หลัก</label>
                <input
                  type="text"
                  value={roomCodeInput}
                  onChange={(e) => setRoomCodeInput(e.target.value.toUpperCase())}
                  maxLength={6}
                  placeholder="เช่น G4K9P2"
                  className="mt-1.5 w-full rounded-xl border border-line bg-paper/40 px-3.5 py-2.5 font-mono text-base uppercase tracking-widest text-ink focus:border-ink focus:bg-white focus:outline-none"
                />
              </div>
            )}

            {error && (
              <p className="rounded-lg bg-accent/10 px-3 py-2 text-xs text-accent">{error}</p>
            )}

            <button
              type="submit"
              disabled={busy || !connected}
              className="w-full rounded-xl bg-accent py-3 text-sm font-semibold text-white shadow-xs transition hover:bg-accent/90 disabled:cursor-not-allowed disabled:bg-line disabled:text-faint cursor-pointer"
            >
              {busy
                ? 'กำลังดำเนินการ...'
                : tab === 'create'
                  ? 'สร้างห้องซ้อมกลุ่ม'
                  : 'เข้าร่วมห้อง'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  const inviteUrl =
    typeof window !== 'undefined' ? `${window.location.origin}/?group=${room.code}` : '';
  const me = room.members.find((m) => m.id === selfId);
  const isHost = room.hostId === selfId;
  const readyCount = room.members.filter((m) => m.ready).length;
  const slides = room.slides || [];
  const assignments = room.assignments || {};
  const memberMap = new Map(room.members.map((m) => [m.id, m]));

  // กำลังซ้อมกลุ่ม (ซิงก์สไลด์ + กล้องผู้พูดปัจจุบัน + เสียง WebRTC)
  if (room.started && slides.length > 0) {
    return (
      <GroupStageView
        socket={socketRef.current}
        room={room}
        selfId={selfId}
        onChangeSlide={handleChangeSlide}
        onFinishRehearsal={handleFinishRehearsal}
        onStopRehearsal={handleStopRehearsal}
        onLeaveRoom={handleLeaveRoom}
      />
    );
  }

  // สรุปผลการซ้อมกลุ่ม + รวมคลิป .mp4
  if (room.finished && slides.length > 0) {
    return (
      <GroupSummaryView
        room={room}
        selfId={selfId}
        onBackToLobby={handleStopRehearsal}
        onLeaveRoom={handleLeaveRoom}
      />
    );
  }

  // หน้า Lobby: แชร์ห้อง + สมาชิก + อัปโหลดสไลด์ + จัดคิวสไลด์
  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-accent">ห้องซ้อมกลุ่ม (Lobby)</p>
          <h1 className="mt-0.5 text-2xl font-semibold text-ink">รอสมาชิกและจัดคิวสไลด์</h1>
        </div>
        <button
          type="button"
          onClick={handleLeaveRoom}
          className="rounded-lg border border-line bg-white px-3.5 py-2 text-xs font-medium text-ink transition hover:border-faint cursor-pointer"
        >
          ออกจากห้อง
        </button>
      </div>

      {error && (
        <p className="mt-4 rounded-xl bg-accent/10 px-4 py-2.5 text-xs text-accent">{error}</p>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[320px_1fr]">
        {/* ซ้าย: รหัสห้อง + ลิงก์เชิญ + QR */}
        <section className="rounded-2xl border border-line bg-white p-5 space-y-4 h-fit">
          <div>
            <p className="text-xs text-muted">รหัสห้อง</p>
            <div className="mt-1.5 flex items-center justify-between gap-2 rounded-xl border border-line bg-paper/60 px-4 py-3">
              <span className="font-mono text-2xl font-bold tracking-[0.2em] text-ink">
                {room.code}
              </span>
              <button
                type="button"
                onClick={() => copyText(room.code, 'code')}
                className="rounded-md border border-line bg-white px-2.5 py-1 text-xs font-medium text-ink hover:border-faint cursor-pointer"
              >
                {copiedType === 'code' ? 'คัดลอกแล้ว' : 'คัดลอก'}
              </button>
            </div>
          </div>

          <div>
            <p className="text-xs text-muted">ลิงก์เชิญเพื่อน</p>
            <div className="mt-1.5 flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={inviteUrl}
                className="w-full rounded-lg border border-line bg-paper/50 px-2.5 py-1.5 text-xs text-muted focus:outline-none"
              />
              <button
                type="button"
                onClick={() => copyText(inviteUrl, 'link')}
                className="shrink-0 rounded-lg bg-ink px-3 py-1.5 text-xs font-medium text-paper hover:opacity-90 cursor-pointer"
              >
                {copiedType === 'link' ? 'คัดลอกแล้ว' : 'คัดลอกลิงก์'}
              </button>
            </div>
          </div>

          {inviteUrl && (
            <div className="flex flex-col items-center rounded-xl border border-line bg-paper/40 p-4">
              <div className="rounded-lg bg-white p-2.5 shadow-xs">
                <QRCodeSVG value={inviteUrl} size={136} />
              </div>
              <p className="mt-2.5 text-[11px] text-muted text-center">
                ให้เพื่อนสแกน QR นี้เพื่อเข้าห้องทันที
              </p>
            </div>
          )}
        </section>

        {/* ขวา: สมาชิกในห้อง + อัปโหลดสไลด์ + จัดคิว */}
        <section className="space-y-5">
          {/* กล่องรายชื่อสมาชิก */}
          <div className="rounded-2xl border border-line bg-white p-5">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
              <h2 className="text-sm font-semibold text-ink">
                สมาชิกในห้อง ({room.members.length} คน)
              </h2>
              <span className="rounded-full bg-paper px-2.5 py-0.5 text-xs text-muted">
                พร้อมแล้ว {readyCount}/{room.members.length}
              </span>
            </div>

            <div className="mt-4 space-y-2.5">
              {room.members.map((m) => {
                const isMe = m.id === selfId;
                const mySlideIndices = slides
                  .map((_, idx) => (assignments[idx] === m.id ? idx : -1))
                  .filter((idx) => idx >= 0);

                return (
                  <div
                    key={m.id}
                    className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 ${
                      isMe ? 'border-ink/30 bg-paper/40' : 'border-line bg-white'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-semibold text-paper">
                        {m.name.slice(0, 1).toUpperCase()}
                      </span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="truncate text-sm font-medium text-ink">{m.name}</span>
                          {isMe && (
                            <span className="rounded bg-paper px-1.5 py-0.5 text-[10px] text-muted">
                              คุณ
                            </span>
                          )}
                          <span className="text-[11px] text-muted">
                            · {m.role === 'host' ? 'หัวหน้ากลุ่ม' : 'สมาชิก'}
                          </span>
                        </div>
                        {slides.length > 0 && (
                          <p className="mt-0.5 text-[11px] text-muted">
                            คิวสไลด์: {formatSlideNumbers(mySlideIndices)}
                          </p>
                        )}
                      </div>
                    </div>

                    <span
                      className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium ${
                        m.ready
                          ? 'bg-ok/10 text-ok'
                          : 'border border-line bg-paper text-muted'
                      }`}
                    >
                      {m.ready ? 'พร้อมแล้ว' : 'รอสักครู่'}
                    </span>
                  </div>
                );
              })}
            </div>

            <div className="mt-4">
              <DeviceTestCard cameraEnabled stopRef={stopTestRef} />
            </div>

            {!isHost && me && (
              <button
                type="button"
                onClick={handleToggleReady}
                className={`mt-4 w-full rounded-xl py-2.5 text-sm font-semibold transition cursor-pointer ${
                  me.ready
                    ? 'border border-line bg-paper text-ink hover:border-faint'
                    : 'bg-accent text-white hover:bg-accent/90'
                }`}
              >
                {me.ready ? 'ยกเลิกสถานะพร้อม' : 'กดพร้อมแล้ว'}
              </button>
            )}
          </div>

          {/* กล่องสไลด์และการจัดคิว */}
          <div className="rounded-2xl border border-line bg-white p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-ink">สไลด์และคิวคนพูด</h2>
                <p className="mt-0.5 text-xs text-muted">
                  {slides.length > 0
                    ? `${room.deckName || 'ชุดสไลด์'} · ${slides.length} หน้า`
                    : isHost
                      ? 'อัปโหลดสไลด์เพื่อให้ทุกคนในห้องเห็นพร้อมกันและแบ่งคิวคนพูด'
                      : 'รอหัวหน้ากลุ่มอัปโหลดสไลด์และจัดคิวคนพูด'}
                </p>
              </div>

              {isHost && slides.length > 0 && (
                <button
                  type="button"
                  onClick={() => setAssignOpen(true)}
                  className="rounded-lg border border-ink bg-white px-3.5 py-1.5 text-xs font-semibold text-ink transition hover:bg-paper cursor-pointer"
                >
                  จัดคิวสไลด์
                </button>
              )}
            </div>

            {isHost && (
              <div className="flex flex-wrap items-center gap-2">
                <label className="rounded-lg border border-line bg-paper px-3.5 py-2 text-xs font-medium text-ink hover:border-faint cursor-pointer">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,image/png,image/jpeg"
                    multiple
                    className="sr-only"
                    onChange={(e) => handleUploadSlides(e.target.files)}
                  />
                  {slides.length > 0 ? 'เปลี่ยนไฟล์สไลด์ (PDF/รูป)' : 'อัปโหลดสไลด์ (PDF/รูป)'}
                </label>

                <button
                  type="button"
                  onClick={handleUseSampleDeck}
                  className="rounded-lg border border-line bg-white px-3.5 py-2 text-xs text-muted hover:text-ink hover:border-faint cursor-pointer"
                >
                  ใช้สไลด์แนะนำตัว (2 หน้า)
                </button>
              </div>
            )}

            {slideProgress !== null && (
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs text-muted">
                  <span>กำลังเตรียมสไลด์และส่งให้เพื่อนในห้อง...</span>
                  {slideProgress.total > 0 && (
                    <span className="font-mono">
                      {slideProgress.done}/{slideProgress.total}
                    </span>
                  )}
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-line">
                  <div
                    className="h-full bg-ink transition-all"
                    style={{
                      width: slideProgress.total
                        ? `${(slideProgress.done / slideProgress.total) * 100}%`
                        : '20%',
                    }}
                  />
                </div>
              </div>
            )}

            {slides.length > 0 && (
              <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3">
                {slides.map((s, idx) => {
                  const ownerId = assignments[idx];
                  const owner = ownerId ? memberMap.get(ownerId) : null;
                  return (
                    <div
                      key={s.id || idx}
                      className="flex items-center justify-between gap-2 rounded-xl border border-line bg-paper/40 px-3 py-2 text-xs"
                    >
                      <span className="truncate font-medium text-ink">
                        หน้า {idx + 1}: {s.title || `สไลด์ ${idx + 1}`}
                      </span>
                      {owner ? (
                        <span
                          className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${getMemberColor(
                            room.members,
                            owner.id,
                          )}`}
                        >
                          {owner.name}
                        </span>
                      ) : (
                        <span className="shrink-0 text-[10px] text-faint">ยังไม่ระบุ</span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {isHost && slides.length > 0 && (() => {
              const allReady = room.members.length > 0 && readyCount === room.members.length;
              return (
                <button
                  type="button"
                  disabled={!allReady}
                  onClick={handleStartRehearsal}
                  className="w-full rounded-xl bg-accent py-3 text-sm font-semibold text-white shadow-xs transition hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-45 cursor-pointer"
                >
                  {allReady
                    ? 'เริ่มซ้อมกลุ่ม (ซิงก์สไลด์ทั้งห้อง)'
                    : `รอสมาชิกกดพร้อม (${readyCount}/${room.members.length})`}
                </button>
              );
            })()}
          </div>
        </section>
      </div>

      {assignOpen && (
        <GroupAssignModal
          slides={slides}
          members={room.members}
          assignments={assignments}
          onSave={handleSaveAssignments}
          onClose={() => setAssignOpen(false)}
        />
      )}
    </div>
  );
}
