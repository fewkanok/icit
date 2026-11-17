import { useMemo, useState } from 'react';
import { compareRoundsWithAi } from '../lib/api';
import { formatTime } from '../lib/metrics';
import { askConfirm } from './ConfirmModal';

function formatDeltaBadge(diff, betterWhen) {
  if (diff === 0 || !Number.isFinite(diff)) {
    return { text: 'เท่าเดิม', cls: 'bg-paper text-muted' };
  }
  const improved = betterWhen === 'lower' ? diff < 0 : diff > 0;
  const sign = diff > 0 ? '+' : '';
  return {
    text: `${sign}${diff} ${improved ? 'ดีขึ้น' : 'ควรปรับ'}`,
    cls: improved ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-800 border-amber-200',
  };
}

function wpmStatusBadge(prevWpm, currWpm) {
  const ideal = 145;
  const inGoodRange = (w) => w >= 90 && w <= 205;
  const prevDist = Math.abs((prevWpm || 0) - ideal);
  const currDist = Math.abs((currWpm || 0) - ideal);
  const diff = Math.round(currWpm - prevWpm);
  if (diff === 0) return { text: 'เท่าเดิม', cls: 'bg-paper text-muted border-line' };
  const improved = (inGoodRange(currWpm) && !inGoodRange(prevWpm)) || currDist < prevDist;
  return {
    text: `${diff > 0 ? '+' : ''}${diff} ${improved ? 'เข้าใกล้เกณฑ์' : 'ห่างเกณฑ์'}`,
    cls: improved ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-paper text-muted border-line',
  };
}

export default function RoundComparisonCard({
  roundsHistory = [],
  currentRound,
  deckName,
  audience = 'general',
  mode = 'solo',
  aiCache: controlledAiCache = null,
  onAiCacheChange = null,
  onClearHistory = null,
}) {
  const [selectedIdx, setSelectedIdx] = useState(() => Math.max(0, roundsHistory.length - 1));
  const [localAiCache, setLocalAiCache] = useState({});
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const aiCache = controlledAiCache || localAiCache;

  const safeIdx = Math.min(selectedIdx, Math.max(0, roundsHistory.length - 1));
  const prevRound = roundsHistory[safeIdx];

  const memberComparisons = useMemo(() => {
    if (mode !== 'group' || !prevRound?.members?.length || !currentRound?.members?.length) {
      return [];
    }
    const prevMap = new Map(prevRound.members.map((m) => [m.name, m]));
    return currentRound.members
      .map((curr) => {
        const prev = prevMap.get(curr.name);
        if (!prev) return null;
        return { name: curr.name, prev, curr };
      })
      .filter(Boolean);
  }, [mode, prevRound, currentRound]);

  if (!roundsHistory || roundsHistory.length === 0 || !prevRound || !currentRound) {
    return null;
  }

  const cacheKey = `${prevRound.roundNumber}->${currentRound.roundNumber}`;
  const aiResult = aiCache[cacheKey] || null;

  const handleAnalyzeCompare = async () => {
    if (aiLoading) return;
    const ok = await askConfirm({
      key: 'token-spend',
      title: 'ยืนยันการใช้ 1 Token',
      message: `ระบบจะใช้ 1 Token เพื่อวิเคราะห์พัฒนาการระหว่างรอบที่ ${prevRound.roundNumber} กับรอบที่ ${currentRound.roundNumber}`,
      confirmText: 'ใช้ 1 Token',
    });
    if (!ok) return;
    setAiLoading(true);
    setAiError('');
    try {
      const res = await compareRoundsWithAi({
        deckName: deckName || 'ชุดสไลด์นำเสนอ',
        audience,
        mode,
        previousRound: {
          roundNumber: prevRound.roundNumber,
          ...(prevRound.slideCount ? { slideCount: prevRound.slideCount } : {}),
          avgWpm: Math.round(prevRound.avgWpm || 0),
          fillersCount: Math.round(prevRound.fillersCount || 0),
          deadAirCount: Math.round(prevRound.deadAirCount || 0),
          totalDurationSec: Math.round(prevRound.totalDurationSec || 0),
          eyeContactPct: prevRound.eyeContactPct ?? null,
          qaAnsweredCount: prevRound.qaAnsweredCount || 0,
          qaDirectCount: prevRound.qaDirectCount || 0,
          transcriptExcerpt: (prevRound.transcriptExcerpt || '').slice(0, 5500),
        },
        currentRound: {
          roundNumber: currentRound.roundNumber,
          ...(currentRound.slideCount ? { slideCount: currentRound.slideCount } : {}),
          avgWpm: Math.round(currentRound.avgWpm || 0),
          fillersCount: Math.round(currentRound.fillersCount || 0),
          deadAirCount: Math.round(currentRound.deadAirCount || 0),
          totalDurationSec: Math.round(currentRound.totalDurationSec || 0),
          eyeContactPct: currentRound.eyeContactPct ?? null,
          qaAnsweredCount: currentRound.qaAnsweredCount || 0,
          qaDirectCount: currentRound.qaDirectCount || 0,
          transcriptExcerpt: (currentRound.transcriptExcerpt || '').slice(0, 5500),
        },
      });
      if (onAiCacheChange) {
        onAiCacheChange(cacheKey, res);
      } else {
        setLocalAiCache((prev) => ({ ...prev, [cacheKey]: res }));
      }
    } catch (err) {
      setAiError(err?.message || 'ไม่สามารถวิเคราะห์เปรียบเทียบด้วย AI ได้');
    } finally {
      setAiLoading(false);
    }
  };

  const wpmBadge = wpmStatusBadge(prevRound.avgWpm || 0, currentRound.avgWpm || 0);
  const fillerBadge = formatDeltaBadge(
    (currentRound.fillersCount || 0) - (prevRound.fillersCount || 0),
    'lower',
  );
  const deadAirBadge = formatDeltaBadge(
    (currentRound.deadAirCount || 0) - (prevRound.deadAirCount || 0),
    'lower',
  );
  const eyeBadge =
    prevRound.eyeContactPct !== null &&
    prevRound.eyeContactPct !== undefined &&
    currentRound.eyeContactPct !== null &&
    currentRound.eyeContactPct !== undefined
      ? formatDeltaBadge(
          Math.round(currentRound.eyeContactPct - prevRound.eyeContactPct),
          'higher',
        )
      : null;

  return (
    <div className="rounded-2xl border border-line bg-white p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-ink">
            เปรียบเทียบพัฒนาการ (รอบที่ {currentRound.roundNumber} เทียบกับรอบที่ {prevRound.roundNumber})
          </h2>
          <p className="mt-0.5 text-xs text-muted">
            ดูความเปลี่ยนแปลงของจังหวะพูด คำติดปาก และการสบตากล้องจากรอบก่อนหน้า
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {roundsHistory.length > 1 && (
            <select
              value={safeIdx}
              onChange={(e) => setSelectedIdx(Number(e.target.value))}
              className="rounded-lg border border-line bg-paper px-2.5 py-1.5 text-xs text-ink"
            >
              {roundsHistory.map((r, i) => (
                <option key={r.roundNumber || i} value={i}>
                  เทียบกับรอบที่ {r.roundNumber}
                </option>
              ))}
            </select>
          )}
          {onClearHistory && (
            <button
              type="button"
              onClick={onClearHistory}
              className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-[11px] text-muted transition hover:text-ink cursor-pointer"
            >
              ล้างประวัติรอบ
            </button>
          )}
        </div>
      </div>

      {/* ตารางตัวเลขเปรียบเทียบ */}
      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-5">
        <div className="rounded-xl border border-line bg-paper/40 p-3">
          <p className="text-[11px] text-muted">ความเร็วพูด (WPM)</p>
          <p className="mt-1 font-mono text-sm font-semibold text-ink">
            {Math.round(prevRound.avgWpm || 0)} → {Math.round(currentRound.avgWpm || 0)}
          </p>
          <span className={`mt-1.5 inline-block rounded-full border px-2 py-0.5 text-[10px] font-medium ${wpmBadge.cls}`}>
            {wpmBadge.text}
          </span>
        </div>

        <div className="rounded-xl border border-line bg-paper/40 p-3">
          <p className="text-[11px] text-muted">คำติดปาก (ครั้ง)</p>
          <p className="mt-1 font-mono text-sm font-semibold text-ink">
            {prevRound.fillersCount || 0} → {currentRound.fillersCount || 0}
          </p>
          <span className={`mt-1.5 inline-block rounded-full border px-2 py-0.5 text-[10px] font-medium ${fillerBadge.cls}`}>
            {fillerBadge.text}
          </span>
        </div>

        <div className="rounded-xl border border-line bg-paper/40 p-3">
          <p className="text-[11px] text-muted">เงียบค้าง (ครั้ง)</p>
          <p className="mt-1 font-mono text-sm font-semibold text-ink">
            {prevRound.deadAirCount || 0} → {currentRound.deadAirCount || 0}
          </p>
          <span className={`mt-1.5 inline-block rounded-full border px-2 py-0.5 text-[10px] font-medium ${deadAirBadge.cls}`}>
            {deadAirBadge.text}
          </span>
        </div>

        <div className="rounded-xl border border-line bg-paper/40 p-3">
          <p className="text-[11px] text-muted">สบตากล้อง</p>
          <p className="mt-1 font-mono text-sm font-semibold text-ink">
            {prevRound.eyeContactPct != null ? `${prevRound.eyeContactPct}%` : '—'} →{' '}
            {currentRound.eyeContactPct != null ? `${currentRound.eyeContactPct}%` : '—'}
          </p>
          {eyeBadge ? (
            <span className={`mt-1.5 inline-block rounded-full border px-2 py-0.5 text-[10px] font-medium ${eyeBadge.cls}`}>
              {eyeBadge.text}
            </span>
          ) : (
            <span className="mt-1.5 inline-block text-[10px] text-faint">ไม่ได้เปิดกล้อง</span>
          )}
        </div>

        <div className="rounded-xl border border-line bg-paper/40 p-3">
          <p className="text-[11px] text-muted">เวลารวม</p>
          <p className="mt-1 font-mono text-sm font-semibold text-ink">
            {formatTime(prevRound.totalDurationSec || 0)} → {formatTime(currentRound.totalDurationSec || 0)}
          </p>
          {(prevRound.qaAnsweredCount > 0 || currentRound.qaAnsweredCount > 0) && (
            <p className="mt-1.5 text-[10px] text-muted">
              Q&A ตรงประเด็น: {prevRound.qaDirectCount || 0}/{prevRound.qaAnsweredCount || 0} →{' '}
              {currentRound.qaDirectCount || 0}/{currentRound.qaAnsweredCount || 0}
            </p>
          )}
        </div>
      </div>

      {/* เทียบรายบุคคลสำหรับโหมดกลุ่ม */}
      {memberComparisons.length > 0 && (
        <div className="rounded-xl border border-line bg-paper/30 p-3.5 space-y-2">
          <p className="text-xs font-semibold text-ink">พัฒนาการรายบุคคล</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {memberComparisons.map(({ name, prev, curr }) => (
              <div
                key={name}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-white px-3 py-2 text-xs"
              >
                <span className="font-medium text-ink">{name}</span>
                <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-muted">
                  <span>WPM {Math.round(prev.avgWpm || 0)}→{Math.round(curr.avgWpm || 0)}</span>
                  <span>ติดปาก {prev.fillersCount || 0}→{curr.fillersCount || 0}</span>
                  {prev.eyeContactPct != null && curr.eyeContactPct != null && (
                    <span>ตา {prev.eyeContactPct}%→{curr.eyeContactPct}%</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ส่วนวิเคราะห์ด้วย AI (1 Token) */}
      <div className="border-t border-line pt-3">
        {!aiResult ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted">
              ต้องการให้ AI อ่านคำพูดทั้ง 2 รอบแล้วสรุปจุดที่ดีขึ้นให้ไหม?
            </p>
            <button
              type="button"
              disabled={aiLoading}
              onClick={handleAnalyzeCompare}
              className="rounded-xl border border-ink bg-ink px-4 py-2 text-xs font-semibold text-white transition hover:bg-ink/90 disabled:opacity-50 cursor-pointer"
            >
              {aiLoading ? 'กำลังวิเคราะห์พัฒนาการ...' : 'ให้ AI วิเคราะห์พัฒนาการ (1 Token)'}
            </button>
          </div>
        ) : (
          <div className="space-y-2.5 rounded-xl border border-line bg-paper/50 p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-ink">สรุปพัฒนาการโดย AI</span>
              <span className="rounded-full bg-white px-2 py-0.5 font-mono text-[10px] text-muted border border-line">
                รอบ {prevRound.roundNumber} → รอบ {currentRound.roundNumber}
              </span>
            </div>
            <p className="text-sm font-medium text-ink">{aiResult.headline}</p>
            {Array.isArray(aiResult.improved) && aiResult.improved.length > 0 && (
              <div>
                <p className="text-[11px] font-semibold text-emerald-700">จุดที่ดีขึ้น</p>
                <ul className="mt-1 space-y-1 text-xs text-ink/90">
                  {aiResult.improved.map((item, i) => (
                    <li key={i}>• {item}</li>
                  ))}
                </ul>
              </div>
            )}
            {Array.isArray(aiResult.stillToFix) && aiResult.stillToFix.length > 0 && (
              <div>
                <p className="text-[11px] font-semibold text-amber-800">จุดที่ควรปรับต่อ</p>
                <ul className="mt-1 space-y-1 text-xs text-ink/90">
                  {aiResult.stillToFix.map((item, i) => (
                    <li key={i}>• {item}</li>
                  ))}
                </ul>
              </div>
            )}
            {aiResult.nextTip && (
              <p className="text-xs text-muted">คำแนะนำรอบถัดไป: {aiResult.nextTip}</p>
            )}
          </div>
        )}
        {aiError && <p className="mt-2 text-xs text-accent">{aiError}</p>}
      </div>
    </div>
  );
}
