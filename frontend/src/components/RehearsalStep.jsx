import { useEffect, useRef, useState } from 'react';
import SlideViewer from './SlideViewer';
import { useSpeechRecognition } from '../lib/useSpeechRecognition';
import { useAudioRecorder } from '../lib/useAudioRecorder';
import { useFaceLandmarker } from '../lib/useFaceLandmarker';
import { analyze, countFillers, countWords, formatTime, pace, PACE_PILL, PACE_TEXT } from '../lib/metrics';

const WINDOW_SEC = 10; // คำนวณความเร็วจากช่วง 10 วินาทีล่าสุด
const WARMUP_SEC = 5; // ช่วงแรกเวลาน้อยเกินไป ตัวเลขยังไม่นิ่ง

function MicIcon() {
  return (
    <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="5.5" y="1.75" width="5" height="8" rx="2.5" />
      <path d="M3 7.5a5 5 0 0 0 10 0M8 12.5v2" strokeLinecap="round" />
    </svg>
  );
}

function Stat({ label, value, note, noteClass }) {
  return (
    <div>
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 font-mono text-xl tabular-nums tracking-tight">{value}</p>
      {note && <p className={`mt-0.5 text-xs ${noteClass}`}>{note}</p>}
    </div>
  );
}

function LivePace({ wpm, fillers }) {
  const p = pace(wpm);
  return (
    <div className="flex items-end justify-between gap-4 rounded-lg border border-line px-4 py-3">
      <div>
        <div className="flex items-center gap-2">
          <p className="text-xs text-muted">ความเร็วตอนนี้</p>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium transition-colors ${
              p ? PACE_PILL[p.tone] : 'bg-line/60 text-faint'
            }`}
          >
            {p ? p.label : 'กำลังวัด…'}
          </span>
        </div>
        <p className={`mt-1 font-mono text-3xl tabular-nums tracking-tight transition-colors ${p ? PACE_TEXT[p.tone] : 'text-faint'}`}>
          {wpm || '–'}
          <span className="ml-1.5 font-sans text-xs text-muted">คำ/นาที</span>
        </p>
      </div>

      {fillers > 0 && (
        <div className="text-right">
          <p className="text-xs text-accent">พบคำติดปาก</p>
          <p className="mt-1 font-mono text-3xl tabular-nums tracking-tight text-accent">{fillers}</p>
        </div>
      )}
    </div>
  );
}

// แถบคลื่นเสียงเคลื่อนไหวสด + เตือนเดดแอร์
function LiveWaveform({ volume, isDeadAir }) {
  const bars = [0.4, 0.7, 1.0, 0.6, 0.9, 0.5, 0.8, 1.0, 0.6, 0.7, 0.5, 0.8];
  return (
    <div className="flex h-8 items-center justify-between rounded-lg border border-line bg-paper px-3">
      <div className="flex h-4 items-center gap-1">
        {bars.map((mult, i) => {
          const heightPct = Math.min(100, Math.max(15, volume * mult * 320));
          return (
            <span
              key={i}
              className={`w-1 rounded-full transition-all duration-75 ${
                isDeadAir ? 'bg-slow' : 'bg-ink'
              }`}
              style={{ height: `${heightPct}%` }}
            />
          );
        })}
      </div>
      {isDeadAir ? (
        <span className="flex items-center gap-1.5 text-xs font-medium text-slow animate-pulse">
          <span className="size-1.5 rounded-full bg-slow" />
          เดดแอร์ (เงียบเกิน 2.5 วิ)
        </span>
      ) : (
        <span className="text-[11px] text-faint font-mono">LIVE AUDIO</span>
      )}
    </div>
  );
}

export default function RehearsalStep({ deck, results, onResult, onBack, onFinish, initialIndex = 0 }) {
  const [index, setIndex] = useState(initialIndex);
  const [elapsed, setElapsed] = useState(0);
  const [liveWpm, setLiveWpm] = useState(0);
  const startedAt = useRef(0);
  const samples = useRef([]);
  const textRef = useRef('');

  // 1. ตัวถอดเสียงเป็นข้อความ
  const speech = useSpeechRecognition('th-TH');

  // 2. ตัวอัดเสียงลง RAM + จับคลื่นเสียง + เดดแอร์ (ไม่ขึ้น Cloud)
  const recorder = useAudioRecorder({ silenceThreshold: 0.02, deadAirLimitSec: 2.5 });

  // 3. ตัวตรวจจับสายตา & บุคลิกภาพ ด้วย Google MediaPipe Vision (Client-side 100%)
  const vision = useFaceLandmarker();

  const total = deck.slides.length;
  const live = speech.listening || recorder.recording;
  const result = results[index];
  const isLast = index === total - 1;
  const doneCount = Object.keys(results).length;
  const liveText = `${speech.finalText} ${speech.interim}`;
  textRef.current = liveText;

  // ทุก 0.25 วิ: อัปเดตเวลา + เก็บจำนวนคำ แล้วคำนวณความเร็วจากช่วง 10 วิล่าสุด
  useEffect(() => {
    if (!live) return;
    samples.current = [{ t: 0, w: 0 }];
    setLiveWpm(0);
    const id = setInterval(() => {
      const t = (Date.now() - startedAt.current) / 1000;
      const w = countWords(textRef.current);
      setElapsed(t);

      const s = samples.current;
      s.push({ t, w });
      while (s.length > 1 && s[1].t <= t - WINDOW_SEC) s.shift();
      const span = t - s[0].t;
      setLiveWpm(t >= WARMUP_SEC && span > 0 ? Math.max(0, Math.round((w - s[0].w) / (span / 60))) : 0);
    }, 250);
    return () => clearInterval(id);
  }, [live]);

  async function start() {
    startedAt.current = Date.now();
    setElapsed(0);
    speech.start();
    await recorder.start();
    if (vision.cameraActive) {
      vision.startTracking();
    }
  }

  async function stop() {
    const transcript = `${speech.finalText} ${speech.interim}`.trim();
    const duration = (Date.now() - startedAt.current) / 1000;
    speech.stop();
    const recResult = await recorder.stop();
    const visionStats = vision.stopTracking();
    console.log('[RehearsalStep] recorded audioUrl:', recResult.audioUrl, 'vision:', visionStats);

    onResult(index, {
      ...analyze(transcript, duration),
      audioUrl: recResult.audioUrl,
      deadAir: recResult.deadAir,
      vision: visionStats,
    });
  }

  const p = result ? pace(result.wpm) : null;

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      {/* แถบบน */}
      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          disabled={live}
          className="text-sm text-muted transition hover:text-ink disabled:opacity-30"
        >
          ← เปลี่ยนสไลด์
        </button>
        <p className="text-sm text-muted">
          ซ้อมแล้ว <span className="font-mono tabular-nums text-ink">{doneCount}</span> จาก {total} หน้า
        </p>
      </div>

      <div className="mt-4 flex gap-1">
        {deck.slides.map((s, i) => (
          <button
            key={s.id}
            onClick={() => !live && setIndex(i)}
            aria-label={`ไปหน้า ${i + 1}`}
            className={`h-1 flex-1 rounded-full transition ${
              i === index ? 'bg-accent' : results[i] ? 'bg-ink' : 'bg-line hover:bg-faint'
            }`}
          />
        ))}
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_360px]">
        <SlideViewer slides={deck.slides} index={index} onIndexChange={setIndex} locked={live} />

        <aside className="flex flex-col rounded-xl border border-line bg-white">
          <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
            <span className="text-sm font-medium">หน้า {index + 1}</span>
            {live ? (
              <span className="flex items-center gap-2 text-xs text-accent">
                <span className="size-1.5 animate-pulse rounded-full bg-accent" />
                กำลังฟัง & บันทึกเสียง
              </span>
            ) : (
              <span className="text-xs text-faint">{result ? 'ซ้อมแล้ว' : 'ยังไม่ได้ซ้อม'}</span>
            )}
          </div>

          <div className="flex flex-1 flex-col gap-5 px-5 py-5">
            <p className="font-mono text-4xl tabular-nums tracking-tight">
              {formatTime(live ? elapsed : result?.duration)}
            </p>

            {/* คลื่นเสียงเต้นสด + เตือนเดดแอร์ ระหว่างพูด */}
            {live && (
              <div className="space-y-3">
                <LivePace wpm={liveWpm} fillers={countFillers(liveText).total} />
                <LiveWaveform volume={recorder.volume} isDeadAir={recorder.isDeadAir} />
              </div>
            )}

            {/* กล่องเว็บแคม + Google MediaPipe Vision */}
            <div className="rounded-lg border border-line bg-paper p-3">
              <div className="flex items-center justify-between text-xs mb-2">
                <div className="flex items-center gap-1.5 font-medium text-ink">
                  <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M2.5 4.5h2l1-1.5h5l1 1.5h2a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-10a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1z" />
                    <circle cx="8" cy="8" r="2.5" />
                  </svg>
                  <span>Google MediaPipe Vision</span>
                </div>

                {vision.cameraActive ? (
                  <button
                    onClick={vision.stopCamera}
                    disabled={live}
                    className="text-[11px] text-accent hover:underline disabled:opacity-40 cursor-pointer"
                  >
                    ปิดกล้อง
                  </button>
                ) : (
                  <button
                    onClick={vision.startCamera}
                    disabled={vision.modelLoading || live}
                    className="flex items-center gap-1 text-[11px] font-medium text-ink bg-white border border-line rounded px-2 py-0.5 hover:border-faint transition cursor-pointer disabled:opacity-40"
                  >
                    {vision.modelLoading ? 'กำลังโหลดโมเดล…' : 'เปิดกล้องวัดสายตา'}
                  </button>
                )}
              </div>

              {vision.cameraActive ? (
                <div className="space-y-2">
                  <div className="relative aspect-video w-full overflow-hidden rounded-md bg-black">
                    <video
                      ref={vision.videoRef}
                      playsInline
                      muted
                      autoPlay
                      className="h-full w-full object-cover -scale-x-100"
                    />

                    {/* ป้ายเตือนสถานะมุมขวาบนของกล้อง */}
                    <div className="absolute top-2 right-2 flex items-center gap-1 rounded-full bg-ink/75 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur-xs">
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

                  {/* แถบวัด Eye Contact และ องศาใบหน้า */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px]">
                      <span className="text-muted">Eye Contact (การสบตา)</span>
                      <span className="font-mono font-medium text-ink">{vision.eyeContactPct}%</span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-line">
                      <div
                        className={`h-full transition-all duration-300 ${
                          vision.eyeContactPct >= 70 ? 'bg-ok' : vision.eyeContactPct >= 45 ? 'bg-slow' : 'bg-accent'
                        }`}
                        style={{ width: `${vision.eyeContactPct}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-[10px] text-faint font-mono pt-0.5">
                      <span>ก้ม/เงย: {vision.poseAngles.pitch}°</span>
                      <span>หัน: {vision.poseAngles.yaw}°</span>
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-[11px] text-faint leading-relaxed">
                  เปิดกล้องเพื่อวัด Eye Contact สบตาคนฟัง และเตือนเมื่อเผลอก้มอ่านสไลด์ (รันในเครื่อง 100% ไม่ส่งภาพออกนอกเครื่อง)
                </p>
              )}

              {vision.cameraError && (
                <p className="mt-1 text-[11px] text-accent">{vision.cameraError}</p>
              )}
            </div>

            {/* กล่องแสดงข้อความที่พูด */}
            <div className="min-h-36 flex-1 rounded-lg bg-paper px-4 py-3 text-[15px] leading-7">
              {live ? (
                speech.finalText || speech.interim ? (
                  <p>
                    {speech.finalText}
                    <span className="text-faint">{speech.interim}</span>
                  </p>
                ) : (
                  <p className="text-faint">เริ่มพูดได้เลย…</p>
                )
              ) : result ? (
                <p>{result.transcript || <span className="text-faint">ไม่ได้ยินเสียงพูด ลองอัดใหม่อีกครั้ง</span>}</p>
              ) : (
                <p className="text-faint">กด “เริ่มพูด” แล้วนำเสนอสไลด์หน้านี้ ข้อความที่พูดจะแสดงที่นี่</p>
              )}
            </div>

            {/* แถบกดฟังเสียงย้อนหลัง (ถ้าอัดเสร็จแล้ว) */}
            {result?.audioUrl && !live && (
              <div className="rounded-lg border border-line bg-paper px-3 py-2.5">
                <div className="flex items-center justify-between text-xs text-muted mb-1.5">
                  <span>🎧 ฟังเสียงที่เพิ่งอัด</span>
                  <span className="font-mono">{formatTime(result.duration)}</span>
                </div>
                <audio controls src={result.audioUrl} className="w-full h-8" />
              </div>
            )}

            {/* สรุปสถิติหลังพูดเสร็จ */}
            {result && !live && (
              <div className="grid grid-cols-2 gap-4 border-t border-line pt-5 sm:grid-cols-3">
                <Stat label="เวลา" value={formatTime(result.duration)} />
                <Stat label="คำ/นาที" value={result.wpm || '–'} note={p?.label} noteClass={p ? PACE_TEXT[p.tone] : ''} />
                {result.deadAir?.count > 0 && (
                  <Stat
                    label="เดดแอร์"
                    value={`${result.deadAir.count} ครั้ง`}
                    note={`${result.deadAir.totalSeconds} วิ`}
                    noteClass="text-slow"
                  />
                )}
                {result.fillers?.total > 0 && (
                  <Stat
                    label="คำติดปากที่พบ"
                    value={result.fillers.total}
                    note={result.fillers.found.map((f) => `${f.label} ×${f.count}`).join(', ')}
                    noteClass="text-accent"
                  />
                )}
                {result.vision?.cameraUsed && (
                  <>
                    <Stat
                      label="Eye Contact"
                      value={`${result.vision.eyeContactPct}%`}
                      note={result.vision.eyeContactPct >= 70 ? 'สบตาดีมาก' : 'ควรมองกล้องเพิ่ม'}
                      noteClass={result.vision.eyeContactPct >= 70 ? 'text-ok' : 'text-slow'}
                    />
                    {result.vision.lookingDownCount > 0 && (
                      <Stat
                        label="ก้มอ่านโพย"
                        value={`${result.vision.lookingDownCount} ครั้ง`}
                        note={`${result.vision.lookingDownSec} วิ`}
                        noteClass="text-accent"
                      />
                    )}
                  </>
                )}
              </div>
            )}

            {!speech.supported && (
              <p className="text-sm text-accent">เบราว์เซอร์นี้ไม่รองรับการถอดเสียง แนะนำให้ใช้ Chrome หรือ Edge</p>
            )}
            {speech.error && <p className="text-sm text-accent">{speech.error}</p>}

            {live ? (
              <button
                onClick={stop}
                className="flex items-center justify-center gap-2 rounded-lg bg-accent py-3 text-sm font-medium text-white transition hover:bg-accent/90 cursor-pointer"
              >
                <span className="size-2.5 rounded-[2px] bg-white" />
                หยุดและดูผล
              </button>
            ) : result ? (
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={start}
                  disabled={!speech.supported}
                  className="rounded-lg border border-line py-3 text-sm transition hover:border-faint disabled:opacity-40 cursor-pointer"
                >
                  อัดใหม่
                </button>
                <button
                  onClick={() => (isLast ? onFinish() : setIndex(index + 1))}
                  className="rounded-lg bg-ink py-3 text-sm font-medium text-paper transition hover:bg-ink/85 cursor-pointer"
                >
                  {isLast ? 'ดูสรุปผล' : 'หน้าถัดไป'}
                </button>
              </div>
            ) : (
              <button
                onClick={start}
                disabled={!speech.supported}
                className="flex items-center justify-center gap-2 rounded-lg bg-ink py-3 text-sm font-medium text-paper transition hover:bg-ink/85 disabled:opacity-40 cursor-pointer"
              >
                <MicIcon />
                เริ่มพูด
              </button>
            )}
          </div>

          <div className="border-t border-line px-5 py-3.5 text-xs leading-5 text-faint">
            ไฟล์เสียงถูกบันทึกชั่วคราวในเครื่องเพื่อใช้ฟังซ้ำ ไม่มีการส่งออกนอกเบราว์เซอร์
          </div>
        </aside>
      </div>
    </div>
  );
}
