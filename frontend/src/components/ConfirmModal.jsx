import { useEffect, useState } from 'react';

const suppressedKeys = new Set();
let listener = null;

export function resetConfirmSuppressions() {
  suppressedKeys.clear();
}

export function askConfirm({
  key = 'default',
  title = 'ยืนยันการทำรายการ',
  message = '',
  confirmText = 'ยืนยัน',
  cancelText = 'ยกเลิก',
  danger = false,
  allowDontShowAgain = true,
}) {
  if (allowDontShowAgain && key && suppressedKeys.has(key)) {
    return Promise.resolve(true);
  }
  if (!listener) {
    return Promise.resolve(window.confirm(message || title));
  }
  return new Promise((resolve) => {
    listener({
      key,
      title,
      message,
      confirmText,
      cancelText,
      danger,
      allowDontShowAgain,
      resolve,
    });
  });
}

export function ConfirmDialogHost() {
  const [dialog, setDialog] = useState(null);
  const [dontShowAgain, setDontShowAgain] = useState(false);

  useEffect(() => {
    listener = (next) => {
      setDontShowAgain(false);
      setDialog(next);
    };
    return () => {
      listener = null;
    };
  }, []);

  if (!dialog) return null;

  const handleClose = (confirmed) => {
    if (confirmed && dialog.allowDontShowAgain && dontShowAgain && dialog.key) {
      suppressedKeys.add(dialog.key);
    }
    const resolve = dialog.resolve;
    setDialog(null);
    resolve(confirmed);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
      <div className="w-full max-w-md rounded-2xl border border-line bg-white p-6 shadow-xl space-y-4">
        <div>
          <h2 className="text-base font-semibold text-ink">{dialog.title}</h2>
          {dialog.message && (
            <p className="mt-1.5 text-sm leading-relaxed text-muted">{dialog.message}</p>
          )}
        </div>

        {dialog.allowDontShowAgain && (
          <label className="flex items-center gap-2 text-xs text-muted select-none cursor-pointer">
            <input
              type="checkbox"
              checked={dontShowAgain}
              onChange={(e) => setDontShowAgain(e.target.checked)}
              className="size-3.5 rounded border-line accent-ink cursor-pointer"
            />
            <span>ไม่ต้องแสดงหน้าต่างยืนยันอีกในรอบซ้อมนี้</span>
          </label>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={() => handleClose(false)}
            className="rounded-lg border border-line px-4 py-2 text-sm text-muted transition hover:border-faint hover:text-ink cursor-pointer"
          >
            {dialog.cancelText}
          </button>
          <button
            type="button"
            onClick={() => handleClose(true)}
            className={`rounded-lg px-4 py-2 text-sm font-medium text-white transition cursor-pointer ${
              dialog.danger ? 'bg-accent hover:bg-accent/90' : 'bg-ink hover:bg-ink/85'
            }`}
          >
            {dialog.confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
