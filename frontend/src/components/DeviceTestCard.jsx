import { useEffect, useRef, useState } from 'react';

export default function DeviceTestCard({ cameraEnabled = true, stopRef }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [micLevel, setMicLevel] = useState(0);
  const [micDetected, setMicDetected] = useState(false);
  const [devices, setDevices] = useState({ cam: '', mic: '' });
  const [monitorSelf, setMonitorSelf] = useState(false);
  const [micGain, setMicGain] = useState(() => {
    try {
      const saved = Number(localStorage.getItem('rehearse_mic_gain'));
      return Number.isFinite(saved) && saved >= 0 && saved <= 2 ? saved : 1;
    } catch {
      return 1;
    }
  });

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const audioCtxRef = useRef(null);
  const gainNodeRef = useRef(null);
  const monitorGainRef = useRef(null);
  const micGainRef = useRef(micGain);
  const monitorSelfRef = useRef(false);
  const rafRef = useRef(null);

  const stopTest = () => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    gainNodeRef.current = null;
    monitorGainRef.current = null;
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setMicLevel(0);
    setMonitorSelf(false);
    setOpen(false);
  };

  useEffect(() => {
    if (stopRef) stopRef.current = stopTest;
    return () => {
      stopTest();
    };
  }, []);

  const startTest = async () => {
    stopTest();
    setOpen(true);
    setLoading(true);
    setError('');
    setMicDetected(false);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: cameraEnabled ? { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 360 } } : false,
      });
      streamRef.current = stream;

      const audioTrack = stream.getAudioTracks()[0];
      const videoTrack = stream.getVideoTracks()[0];
      setDevices({
        cam: videoTrack?.label || '',
        mic: audioTrack?.label || '',
      });

      if (videoRef.current && videoTrack) {
        videoRef.current.srcObject = stream;
      }

      if (audioTrack) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (Ctx) {
          const ctx = new Ctx();
          audioCtxRef.current = ctx;
          const src = ctx.createMediaStreamSource(stream);
          const gainNode = ctx.createGain();
          gainNode.gain.value = micGainRef.current;
          gainNodeRef.current = gainNode;

          const analyser = ctx.createAnalyser();
          analyser.fftSize = 256;
          src.connect(gainNode);
          gainNode.connect(analyser);

          // วงจรฟังเสียงตัวเอง (Loopback Monitor) ผ่านปุ่มเปิด/ปิด
          const monGain = ctx.createGain();
          monGain.gain.value = monitorSelfRef.current ? 1 : 0;
          monitorGainRef.current = monGain;
          gainNode.connect(monGain);
          monGain.connect(ctx.destination);

          const data = new Uint8Array(analyser.frequencyBinCount);

          const tick = () => {
            if (!streamRef.current) return;
            analyser.getByteFrequencyData(data);
            let sum = 0;
            for (let i = 0; i < data.length; i++) sum += data[i];
            const avg = sum / data.length;
            const pct = Math.min(100, Math.round((avg / 70) * 100));
            setMicLevel(pct);
            if (pct >= 12) setMicDetected(true);
            rafRef.current = requestAnimationFrame(tick);
          };
          rafRef.current = requestAnimationFrame(tick);
        }
      }
    } catch (err) {
      stopTest();
      setOpen(true);
      setError(
        err?.name === 'NotAllowedError'
          ? 'ไม่ได้รับอนุญาตให้เข้าถึงกล้องหรือไมค์ กรุณากดอนุญาตในแถบ URL ของเบราว์เซอร์'
          : 'ไม่พบกล้องหรือไมโครโฟน หรืออุปกรณ์กำลังถูกใช้งานอยู่',
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    micGainRef.current = micGain;
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = micGain;
    }
    try {
      localStorage.setItem('rehearse_mic_gain', String(micGain));
    } catch {
      // ignore storage errors
    }
  }, [micGain]);

  useEffect(() => {
    monitorSelfRef.current = monitorSelf;
    if (monitorGainRef.current) {
      monitorGainRef.current.gain.value = monitorSelf ? 1 : 0;
    }
    if (monitorSelf && audioCtxRef.current?.state === 'suspended') {
      audioCtxRef.current.resume().catch(() => {});
    }
  }, [monitorSelf]);

  useEffect(() => {
    if (open && streamRef.current) {
      startTest();
    }
  }, [cameraEnabled]);

  useEffect(() => {
    if (open && videoRef.current && streamRef.current && !videoRef.current.srcObject) {
      videoRef.current.srcObject = streamRef.current;
    }
  }, [open, loading]);

  return (
    <div className="mb-3 rounded-lg border border-line bg-white px-3.5 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-medium text-ink">เช็กกล้องและไมค์</p>
          <p className="truncate text-[11px] text-muted">
            {open
              ? micDetected
                ? 'ได้ยินเสียงไมค์ปกติ'
                : 'ลองพูดเพื่อทดสอบระดับเสียง'
              : 'ทดสอบภาพและเสียงก่อนเริ่มซ้อม'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => (open ? stopTest() : startTest())}
          className={`shrink-0 rounded-md px-2.5 py-1 text-xs font-medium transition cursor-pointer ${
            open
              ? 'bg-ink text-white hover:opacity-90'
              : 'border border-line text-ink hover:border-faint'
          }`}
        >
          {open ? 'ปิด' : 'ทดสอบ'}
        </button>
      </div>

      {open && (
        <div className="mt-3 space-y-2.5 border-t border-line/70 pt-3">
          {loading && <p className="text-xs text-muted">กำลังเปิดกล้องและไมโครโฟน...</p>}
          {error && <p className="text-xs text-accent leading-relaxed">{error}</p>}

          {!error && (
            <>
              {cameraEnabled ? (
                <div className="overflow-hidden rounded-lg border border-line bg-black">
                  <video
                    ref={videoRef}
                    autoPlay
                    muted
                    playsInline
                    className="aspect-video w-full object-cover -scale-x-100"
                  />
                </div>
              ) : (
                <p className="rounded-md bg-paper px-2.5 py-1.5 text-[11px] text-muted">
                  ปิดกล้องอยู่ (กำลังทดสอบเฉพาะไมโครโฟน)
                </p>
              )}

              <div>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-muted">ระดับเสียงไมค์</span>
                  <span className={micDetected ? 'font-medium text-ok' : 'text-faint'}>
                    {micDetected ? 'ไมค์ทำงานปกติ' : 'ยังไม่ได้รับเสียง'}
                  </span>
                </div>
                <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-paper border border-line">
                  <div
                    className={`h-full transition-all duration-75 ${
                      micLevel > 75 ? 'bg-accent' : 'bg-ok'
                    }`}
                    style={{ width: `${micLevel}%` }}
                  />
                </div>
              </div>

              {/* ปรับความดังไมค์ + ปุ่มกดฟังเสียงตัวเอง */}
              <div className="rounded-lg border border-line bg-paper/70 px-3 py-2 space-y-2">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-medium text-ink">ความดังไมค์ของฉัน</span>
                  <span className="font-mono tabular-nums text-muted">
                    {Math.round(micGain * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={2}
                  step={0.05}
                  value={micGain}
                  onChange={(e) => setMicGain(Number(e.target.value))}
                  className="w-full accent-ink cursor-pointer"
                />
                <div className="flex items-center justify-between gap-2 pt-0.5">
                  <button
                    type="button"
                    onClick={() => setMonitorSelf((v) => !v)}
                    className={`rounded-md border px-2.5 py-1 text-[11px] font-medium transition cursor-pointer ${
                      monitorSelf
                        ? 'border-accent bg-accent text-white'
                        : 'border-line bg-white text-ink hover:border-faint'
                    }`}
                  >
                    {monitorSelf ? 'ปิดฟังเสียงตัวเอง' : 'กดฟังเสียงตัวเอง'}
                  </button>
                  <span className="text-[10px] text-faint">
                    {monitorSelf ? 'แนะนำใส่หูฟังเพื่อกันเสียงสะท้อน' : 'เช็กความดังก่อนเริ่มซ้อม'}
                  </span>
                </div>
              </div>

              {(devices.cam || devices.mic) && (
                <div className="space-y-0.5 text-[10px] text-faint">
                  {devices.cam && <p className="truncate">กล้อง: {devices.cam}</p>}
                  {devices.mic && <p className="truncate">ไมค์: {devices.mic}</p>}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
