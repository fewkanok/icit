import { useEffect, useState } from 'react';
import {
  GEMINI_RPM_LIMIT,
  getGeminiCooldownState,
  subscribeGeminiCooldown,
} from '../../lib/geminiRateLimit';

export function useGeminiCooldown() {
  const [state, setState] = useState(() => getGeminiCooldownState());

  useEffect(() => {
    const sync = () => setState(getGeminiCooldownState());
    const unsub = subscribeGeminiCooldown(setState);
    const id = setInterval(sync, 1000);
    return () => {
      unsub();
      clearInterval(id);
    };
  }, []);

  return state;
}

export default function GeminiCooldownButton({
  onClick,
  disabled = false,
  loading = false,
  loadingLabel = 'กำลังประมวลผล AI...',
  children,
  className = '',
  showQuotaHint = true,
}) {
  const { waitSeconds, isCoolingDown, remainingQuota } = useGeminiCooldown();
  const isDisabled = disabled || loading || isCoolingDown;

  return (
    <div className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={isDisabled}
        className={`${className} disabled:cursor-not-allowed disabled:opacity-55`}
      >
        {loading
          ? loadingLabel
          : isCoolingDown
            ? `รอโควตา AI อีก ${waitSeconds} วิ (จำกัด ${GEMINI_RPM_LIMIT}/นาที)`
            : children}
      </button>
      {showQuotaHint && !isCoolingDown && (
        <span className="text-[10px] text-faint">
          โควตา AI เหลือ {remainingQuota}/{GEMINI_RPM_LIMIT} ครั้งในนาทีนี้
        </span>
      )}
    </div>
  );
}
