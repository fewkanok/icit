import { useEffect, useRef, useState } from 'react';
import { createSocket } from '../lib/socket';
import { useSpeechRecognition } from '../lib/useSpeechRecognition';
import { speakThai, stopSpeaking } from '../lib/speech';
import { formatTime } from '../lib/metrics';
import { ToggleSwitch } from './ui/StateViews';

export default function RemotePage({ code }) {
  const [status, setStatus] = useState('connecting'); // connecting | connected | error
  const [errorMsg, setErrorMsg] = useState('');
  const [state, setState] = useState({
    slideIndex: 0,
    totalSlides: 0,
    live: false,
    continuous: false,
    elapsedSec: 0,
    targetSec: 0,
    slide: null,
  });
  const [laserPos, setLaserPos] = useState(null);
  const [audioOnMobile, setAudioOnMobile] = useState(true);
  const [micEnabled, setMicEnabled] = useState(false);

  const socketRef = useRef(null);
  const audioRef = useRef(audioOnMobile);
  audioRef.current = audioOnMobile;

  const speech = useSpeechRecognition('th-TH');
  const isSecure = typeof window !== 'undefined' && window.isSecureContext;

  useEffect(() => {
    const socket = createSocket();
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('join_remote', { code }, (res) => {
        if (res?.ok) {
          setStatus('connected');
          setErrorMsg('');
        } else {
          setStatus('error');
          setErrorMsg(res?.message || 'เชื่อมต่อห้องไม่สำเร็จ');
        }
      });
    });

    socket.on('connect_error', () => {
      setStatus('error');
      setErrorMsg('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้');
    });

    socket.on('remote_state', (next) => {
      setState((prev) => ({ ...prev, ...next }));
    });

    socket.on('remote_speak', ({ text }) => {
      if (audioRef.current && text) {
        speakThai(text);
      }
    });

    socket.on('remote_vibrate', ({ pattern }) => {
      if (navigator.vibrate) {
        navigator.vibrate(pattern || 200);
      }
    });

    return () => {
      stopSpeaking();
      socket.disconnect();
    };
  }, [code]);

  // ส่งข้อความเสียงจากไมค์มือถือเข้าคอมแบบสดๆ
  useEffect(() => {
    if (!micEnabled || !socketRef.current) return;
    socketRef.current.emit('remote_transcript', {
      code,
      finalText: speech.finalText,
      interim: speech.interim,
      listening: speech.listening,
    });
  }, [code, micEnabled, speech.finalText, speech.interim, speech.listening]);

  // ซิงก์การเปิด/ปิดไมค์มือถือตามสถานะ live ของสไลด์
  useEffect(() => {
    if (!micEnabled || !isSecure || !speech.supported) return;
    if (state.live && !speech.listening) {
      speech.start();
    } else if (!state.live && speech.listening) {
      speech.stop();
    }
  }, [state.live, micEnabled, isSecure, speech]);

  function sendCommand(action) {
    socketRef.current?.emit('remote_command', { code, action });
    if (navigator.vibrate) navigator.vibrate(30);
  }

  function handleLaserMove(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const touch = e.touches?.[0] || e;
    const x = Math.min(1, Math.max(0, (touch.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (touch.clientY - rect.top) / rect.height));
    setLaserPos({ x, y });
    socketRef.current?.emit('remote_laser', { code, x, y, active: true });
  }

  function handleLaserEnd() {
    setLaserPos(null);
    socketRef.current?.emit('remote_laser', { code, x: 0.5, y: 0.5, active: false });
  }

  const remaining = state.targetSec > 0 ? state.targetSec - state.elapsedSec : null;
  const isOvertime = remaining !== null && remaining < 0;
  const isFirst = state.slideIndex <= 0;
  const isLast = state.totalSlides > 0 && state.slideIndex >= state.totalSlides - 1;

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-between bg-paper px-4 py-4 pb-8">
      <div className="space-y-3">
        {/* แถบสถานะ */}
        <div className="flex items-center justify-between rounded-xl border border-line bg-white px-3.5 py-2.5">
          <div>
            <p className="text-[11px] text-muted">รีโมตควบคุมสไลด์</p>
            <p className="font-mono text-sm font-semibold text-ink">ห้อง {code}</p>
          </div>
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-medium ${
              status === 'connected'
                ? 'bg-ok/15 text-ok'
                : status === 'error'
                  ? 'bg-accent/15 text-accent'
                  : 'bg-line text-muted'
            }`}
          >
            {status === 'connected' ? 'เชื่อมต่อแล้ว' : status === 'error' ? 'ไม่พบห้อง' : 'กำลังเชื่อม...'}
          </span>
        </div>

        {errorMsg && (
          <p className="rounded-lg border border-accent/30 bg-white px-3.5 py-2.5 text-xs text-accent">
            {errorMsg}
          </p>
        )}

        {/* สถานะหน้าสไลด์ & เวลา */}
        <div className="flex items-center justify-between rounded-xl border border-line bg-white px-4 py-3">
          <div>
            <p className="text-xs text-muted">สไลด์หน้า</p>
            <p className="font-mono text-lg font-semibold text-ink">
              {state.totalSlides ? `${state.slideIndex + 1} / ${state.totalSlides}` : '-'}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-muted">
              {remaining !== null ? (isOvertime ? 'เกินเวลา' : 'เวลาที่เหลือ') : 'เวลาที่ใช้ไป'}
            </p>
            <p className={`font-mono text-2xl tabular-nums tracking-tight ${isOvertime ? 'text-accent' : 'text-ink'}`}>
              {remaining !== null
                ? `${isOvertime ? '+' : ''}${formatTime(Math.abs(remaining))}`
                : formatTime(state.elapsedSec)}
            </p>
          </div>
        </div>

        {/* ภาพสไลด์ปัจจุบัน + แตะลากชี้เลเซอร์ */}
        <div className="space-y-1">
          <div
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture?.(e.pointerId);
              handleLaserMove(e);
            }}
            onPointerMove={(e) => {
              if (e.buttons > 0 || e.pointerType === 'touch') handleLaserMove(e);
            }}
            onPointerUp={handleLaserEnd}
            onPointerCancel={handleLaserEnd}
            className="relative aspect-video w-full touch-none select-none overflow-hidden rounded-xl border border-line bg-white shadow-xs"
          >
            {state.slide?.src ? (
              <img
                src={state.slide.src}
                alt={`สไลด์หน้า ${state.slideIndex + 1}`}
                draggable={false}
                className="h-full w-full object-contain pointer-events-none"
              />
            ) : state.slide?.title ? (
              <div className="flex h-full flex-col justify-center px-5 pointer-events-none">
                <p className="font-mono text-[10px] text-faint">
                  {String(state.slideIndex + 1).padStart(2, '0')}
                </p>
                <p className="mt-1 text-sm font-semibold text-ink line-clamp-2">{state.slide.title}</p>
                {state.slide.points?.length > 0 && (
                  <ul className="mt-2 space-y-1 text-[11px] text-muted">
                    {state.slide.points.slice(0, 3).map((pt) => (
                      <li key={pt} className="truncate">- {pt}</li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-muted">
                รอรับภาพสไลด์จากหน้าจอคอม...
              </div>
            )}

            {laserPos && (
              <span
                className="pointer-events-none absolute z-20 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-red-500 shadow-[0_0_10px_3px_rgba(239,68,68,0.75)] ring-2 ring-white"
                style={{ left: `${laserPos.x * 100}%`, top: `${laserPos.y * 100}%` }}
              />
            )}
          </div>
          <p className="text-center text-[11px] text-muted">แตะแล้วลากนิ้วบนสไลด์เพื่อชี้เลเซอร์บนจอใหญ่</p>
        </div>

        {/* ปุ่มเปลี่ยนสไลด์ */}
        <div className="grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={() => sendCommand('prev')}
            disabled={status !== 'connected' || state.live || isFirst}
            className="rounded-xl border border-line bg-white py-3.5 text-sm font-medium text-ink transition active:scale-[0.98] disabled:opacity-40 cursor-pointer"
          >
            ก่อนหน้า
          </button>
          <button
            type="button"
            onClick={() => sendCommand(isLast ? 'finish' : 'next')}
            disabled={status !== 'connected' || (state.live && !state.continuous)}
            className="rounded-xl border border-line bg-white py-3.5 text-sm font-medium text-ink transition active:scale-[0.98] disabled:opacity-40 cursor-pointer"
          >
            {isLast ? 'ไปช่วงถาม-ตอบ' : 'ถัดไป'}
          </button>
        </div>

        {/* ปุ่มเริ่ม / หยุดพูด */}
        <button
          type="button"
          onClick={() => sendCommand(state.live ? 'stop' : 'start')}
          disabled={status !== 'connected'}
          className={`min-h-[48px] w-full rounded-xl py-3.5 text-sm font-semibold transition active:scale-[0.985] disabled:opacity-40 cursor-pointer ${
            state.live ? 'bg-accent text-white' : 'bg-ink text-paper'
          }`}
        >
          {state.live ? 'หยุดและดูผลหน้านี้' : 'เริ่มพูดหน้านี้'}
        </button>
      </div>

      {/* ตัวเลือกเสียงและไมค์มือถือ */}
      <div className="mt-4 space-y-2.5 rounded-2xl bg-white p-4 text-xs shadow-xs">
        <div className="flex min-h-[44px] items-center justify-between gap-2">
          <span className="text-ink font-medium">เสียงคำถามออกลำโพงมือถือ</span>
          <ToggleSwitch
            checked={audioOnMobile}
            onChange={(val) => setAudioOnMobile(val)}
            labelOn="เปิด"
            labelOff="ปิด"
            ariaLabel="เสียงคำถามออกลำโพงมือถือ"
          />
        </div>

        <div className="flex min-h-[44px] items-center justify-between gap-2 border-t border-line/60 pt-2.5">
          <div>
            <span className="text-ink font-medium">ใช้ไมค์มือถือรับเสียงพูด</span>
            {!isSecure && (
              <p className="text-[11px] text-accent">ต้องเปิดผ่าน HTTPS ถึงจะใช้ไมค์มือถือได้</p>
            )}
          </div>
          <div className={!isSecure || !speech.supported ? 'opacity-40 pointer-events-none' : ''}>
            <ToggleSwitch
              checked={micEnabled}
              onChange={(val) => setMicEnabled(val)}
              labelOn="เปิด"
              labelOff="ปิด"
              ariaLabel="ใช้ไมค์มือถือรับเสียงพูด"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
