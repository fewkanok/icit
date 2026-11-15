import { PACE_MAX, PACE_MIN } from '../lib/metrics';

function RingGauge({ value, label, sublabel, colorClass = 'text-ok' }) {
  const pct = Math.max(0, Math.min(100, Number(value) || 0));
  const r = 26;
  const c = 2 * Math.PI * r;
  const dash = (pct / 100) * c;

  return (
    <div className="flex items-center gap-3.5 rounded-xl border border-line bg-paper/40 p-3.5">
      <div className="relative size-16 shrink-0">
        <svg viewBox="0 0 64 64" className="size-full -rotate-90">
          <circle cx="32" cy="32" r={r} fill="none" stroke="currentColor" strokeWidth="6" className="text-line" />
          <circle
            cx="32"
            cy="32"
            r={r}
            fill="none"
            stroke="currentColor"
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={`${dash} ${c}`}
            className={colorClass}
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center font-mono text-xs font-semibold text-ink">
          {pct}%
        </span>
      </div>
      <div className="min-w-0">
        <p className="text-xs font-semibold text-ink">{label}</p>
        <p className="mt-0.5 text-[11px] text-muted">{sublabel}</p>
      </div>
    </div>
  );
}

function PaceRangeBar({ wpm }) {
  const minScale = 60;
  const maxScale = 260;
  const clamped = Math.max(minScale, Math.min(maxScale, Number(wpm) || 0));
  const pct = ((clamped - minScale) / (maxScale - minScale)) * 100;
  const goodStart = ((PACE_MIN - minScale) / (maxScale - minScale)) * 100;
  const goodWidth = ((PACE_MAX - PACE_MIN) / (maxScale - minScale)) * 100;

  const status =
    !wpm ? 'ไม่มีข้อมูล' : wpm < PACE_MIN ? 'ค่อนข้างช้า' : wpm > PACE_MAX ? 'ค่อนข้างเร็ว' : 'จังหวะกำลังดี';
  const statusColor = !wpm ? 'text-muted' : wpm < PACE_MIN ? 'text-slow' : wpm > PACE_MAX ? 'text-accent' : 'text-ok';

  return (
    <div className="flex flex-col justify-center rounded-xl border border-line bg-paper/40 p-3.5">
      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold text-ink">จังหวะความเร็วการพูด</span>
        <span className={`font-medium ${statusColor}`}>
          {wpm ? `${wpm} คำ/นาที · ${status}` : status}
        </span>
      </div>

      <div className="relative mt-3 h-2.5 w-full rounded-full bg-line overflow-visible">
        <div
          style={{ left: `${goodStart}%`, width: `${goodWidth}%` }}
          className="absolute inset-y-0 rounded-full bg-ok/30"
          title={`โซนกำลังดี (${PACE_MIN}–${PACE_MAX} คำ/นาที)`}
        />
        {wpm > 0 && (
          <div
            style={{ left: `calc(${pct}% - 6px)` }}
            className="absolute -top-1 size-4.5 rounded-full border-2 border-white bg-ink shadow-xs"
          />
        )}
      </div>

      <div className="mt-1.5 flex justify-between font-mono text-[10px] text-faint">
        <span>ช้า (&lt;{PACE_MIN})</span>
        <span>พอดี ({PACE_MIN}–{PACE_MAX})</span>
        <span>เร็ว (&gt;{PACE_MAX})</span>
      </div>
    </div>
  );
}

/**
 * แสดงเกจภาพรวม + ทางลัดไปยังสไลด์ที่ควรซ้อมเพิ่ม (สำหรับนักศึกษาดูผลใน 5 วินาที)
 * items: [{ index, label, wpm, eyeContactPct, hasIssue, issueHint }]
 */
export default function SummaryCharts({ avgWpm = 0, avgEyeContact = null, items = [], onSelectSlide }) {
  if (!items || items.length === 0) return null;

  const issueItems = items.filter((x) => x.hasIssue);

  return (
    <div className="rounded-xl border border-line bg-white p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-ink">สรุปความพร้อมก่อนขึ้นพูด</h3>
          <p className="text-[11px] text-muted">เช็กจังหวะพูด สายตา และหน้าสไลด์ที่ควรซ้อมเพิ่มได้ทันที</p>
        </div>
      </div>

      {/* เกจ 2 ช่อง: ความเร็ว & สบตากล้อง */}
      <div className={`grid gap-3 ${avgEyeContact != null ? 'sm:grid-cols-2' : 'grid-cols-1'}`}>
        <PaceRangeBar wpm={avgWpm} />
        {avgEyeContact != null && (
          <RingGauge
            value={avgEyeContact}
            label="สบตากล้องเฉลี่ย"
            sublabel={avgEyeContact >= 70 ? 'มองกล้องสม่ำเสมอ ดูมั่นใจมาก' : 'ลองมองกล้องให้มากขึ้นอีกนิด'}
            colorClass={avgEyeContact >= 70 ? 'text-ok' : 'text-slow'}
          />
        )}
      </div>

      {/* ทางลัดไปยังสไลด์ที่ควรซ้อมเพิ่ม */}
      {issueItems.length > 0 ? (
        <div className="rounded-xl border border-accent/25 bg-accent/5 p-3.5">
          <p className="text-xs font-semibold text-accent">
            ควรซ้อมเพิ่ม ({issueItems.length} หน้า) — กดเพื่อกระโดดไปดูคำแนะนำ:
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {issueItems.map((item, idx) => (
              <button
                key={item.index ?? idx}
                type="button"
                onClick={() => onSelectSlide?.(item.index ?? idx)}
                className="rounded-lg border border-accent/30 bg-white px-3 py-1.5 text-xs font-medium text-ink transition hover:border-accent hover:text-accent cursor-pointer"
              >
                {item.label}
                {item.issueHint ? ` · ${item.issueHint}` : ''}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-ok/25 bg-ok/5 px-4 py-3 text-xs font-medium text-ok">
          พูดครบประเด็นและจังหวะดีทุกหน้าแล้ว
        </div>
      )}
    </div>
  );
}
