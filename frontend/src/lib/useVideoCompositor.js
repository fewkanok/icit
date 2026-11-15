import { useCallback, useEffect, useRef } from 'react';
import { FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision';

const CANVAS_W = 800;
const CANVAS_H = 450;
const MASK_W = 160;
const MASK_H = 120;
const PERSON_W = 240;
const PERSON_H = 180;
const FPS = 20;

let segmenterPromise = null;

async function getImageSegmenter() {
  if (!segmenterPromise) {
    segmenterPromise = (async () => {
      try {
        const fileset = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm',
        );
        return await ImageSegmenter.createFromOptions(fileset, {
          baseOptions: {
            modelAssetPath:
              'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite',
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          outputCategoryMask: false,
          outputConfidenceMasks: true,
        });
      } catch (err) {
        console.warn('[useVideoCompositor] ImageSegmenter load failed, fallback to PiP:', err);
        segmenterPromise = null;
        return null;
      }
    })();
  }
  return segmenterPromise;
}

function drawRoundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function wrapTextLines(ctx, text, maxWidth, maxLines = 2) {
  const clean = String(text || '').trim();
  if (!clean) return [];
  const lines = [];
  let current = '';
  for (const ch of clean) {
    const next = current + ch;
    if (ctx.measureText(next).width > maxWidth && current.length > 0) {
      lines.push(current);
      current = ch;
      if (lines.length >= maxLines) break;
    } else {
      current = next;
    }
  }
  if (lines.length < maxLines && current) {
    lines.push(current);
  } else if (lines.length === maxLines && current) {
    lines[maxLines - 1] = `${lines[maxLines - 1].slice(0, -1)}…`;
  }
  return lines;
}

function drawSlideBackground(ctx, slide, imgCache) {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  const src = slide?.src || slide?.url;
  if (src) {
    let entry = imgCache.get(src);
    if (!entry) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      entry = { img, loaded: false };
      img.onload = () => {
        entry.loaded = true;
      };
      img.src = src;
      imgCache.set(src, entry);
    }
    if (entry.loaded && entry.img.naturalWidth > 0 && entry.img.naturalHeight > 0) {
      const scale = Math.min(CANVAS_W / entry.img.naturalWidth, CANVAS_H / entry.img.naturalHeight);
      const dw = entry.img.naturalWidth * scale;
      const dh = entry.img.naturalHeight * scale;
      const dx = (CANVAS_W - dw) / 2;
      const dy = (CANVAS_H - dh) / 2;
      ctx.drawImage(entry.img, dx, dy, dw, dh);
      return;
    }
  }

  if (slide?.title) {
    ctx.fillStyle = '#18181b';
    ctx.font = '600 26px sans-serif';
    const titleLines = wrapTextLines(ctx, slide.title, CANVAS_W - 110, 2);
    titleLines.forEach((line, i) => {
      ctx.fillText(line, 56, 115 + i * 34);
    });

    const points = Array.isArray(slide.points) ? slide.points.slice(0, 5) : [];
    ctx.fillStyle = '#52525b';
    ctx.font = '400 17px sans-serif';
    points.forEach((pt, idx) => {
      const lines = wrapTextLines(ctx, `• ${pt}`, CANVAS_W - 130, 1);
      if (lines[0]) {
        ctx.fillText(lines[0], 64, 205 + idx * 32);
      }
    });
  }
}

function drawQaBadge(ctx, qaQuestion) {
  if (!qaQuestion) return;
  ctx.save();
  ctx.font = '500 14px sans-serif';
  const lines = wrapTextLines(ctx, `Q&A: ${qaQuestion}`, CANVAS_W - 280, 2);
  if (lines.length === 0) {
    ctx.restore();
    return;
  }
  const boxW = Math.min(
    CANVAS_W - 260,
    Math.max(...lines.map((l) => ctx.measureText(l).width)) + 24,
  );
  const boxH = lines.length * 19 + 14;
  drawRoundedRect(ctx, 14, 14, boxW, boxH, 8);
  ctx.fillStyle = 'rgba(24, 24, 27, 0.82)';
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  lines.forEach((line, idx) => {
    ctx.fillText(line, 26, 33 + idx * 19);
  });
  ctx.restore();
}

/**
 * รวมสไลด์เป็นพื้นหลัง + กล้องผู้พูด (ปกติ / กรอบมุมจอ PiP / ตัดฉากหลังแบบ Meet)
 * ออกแบบให้เบาเครื่อง (ไม่ใช้ getImageData, pre-load โมเดลล่วงหน้า, เริ่มอัดทันทีไม่ดีเลย์)
 */
export function useVideoCompositor({ mode = 'pip', slide = null, qaQuestion = '', cameraActive = false }) {
  const modeRef = useRef(mode);
  const slideRef = useRef(slide);
  const qaQuestionRef = useRef(qaQuestion);

  modeRef.current = mode;
  slideRef.current = slide;
  qaQuestionRef.current = qaQuestion;

  const timerRef = useRef(null);
  const canvasRef = useRef(null);
  const outStreamRef = useRef(null);
  const maskCanvasRef = useRef(null);
  const maskImageDataRef = useRef(null);
  const personCanvasRef = useRef(null);
  const imgCacheRef = useRef(new Map());
  const segmenterRef = useRef(null);
  const lastSegTimeRef = useRef(0);
  const frameTickRef = useRef(0);

  // Preload โมเดลตัดฉากหลังไว้ล่วงหน้าเมื่อเปิดกล้องและเลือกโหมด cutout เพื่อไม่ให้ช่วงต้นคลิปหายตอนกดเริ่มพูด
  useEffect(() => {
    if (cameraActive && mode === 'cutout' && !segmenterRef.current) {
      void getImageSegmenter().then((seg) => {
        if (seg) segmenterRef.current = seg;
      });
    }
  }, [cameraActive, mode]);

  const stopCompositing = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (outStreamRef.current) {
      outStreamRef.current.getVideoTracks().forEach((t) => t.stop());
      outStreamRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => stopCompositing();
  }, [stopCompositing]);

  const startCompositing = useCallback(
    (videoEl, rawStream) => {
      stopCompositing();
      if (!rawStream) return null;

      const activeMode = modeRef.current;
      if (activeMode === 'normal' || !videoEl) {
        return rawStream;
      }

      if (!canvasRef.current) {
        const c = document.createElement('canvas');
        c.width = CANVAS_W;
        c.height = CANVAS_H;
        canvasRef.current = c;
      }
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (!ctx) return rawStream;

      if (activeMode === 'cutout') {
        if (!maskCanvasRef.current) {
          const mc = document.createElement('canvas');
          mc.width = MASK_W;
          mc.height = MASK_H;
          maskCanvasRef.current = mc;
          maskImageDataRef.current = mc.getContext('2d').createImageData(MASK_W, MASK_H);
        }
        if (!personCanvasRef.current) {
          const pc = document.createElement('canvas');
          pc.width = PERSON_W;
          pc.height = PERSON_H;
          personCanvasRef.current = pc;
        }
        if (!segmenterRef.current) {
          void getImageSegmenter().then((seg) => {
            if (seg) segmenterRef.current = seg;
          });
        }
      }

      frameTickRef.current = 0;

      const drawFrame = () => {
        drawSlideBackground(ctx, slideRef.current, imgCacheRef.current);
        drawQaBadge(ctx, qaQuestionRef.current);

        if (videoEl.readyState < 2 || videoEl.videoWidth <= 0) return;

        const useCutout =
          modeRef.current === 'cutout' &&
          segmenterRef.current &&
          maskCanvasRef.current &&
          maskImageDataRef.current &&
          personCanvasRef.current;

        if (useCutout) {
          try {
            const tick = frameTickRef.current++;
            const mCtx = maskCanvasRef.current.getContext('2d');
            const pCtx = personCanvasRef.current.getContext('2d');

            // รัน segmentation ทุกๆ 2 เฟรม (~10 fps) เพื่อลดภาระ CPU/GPU แต่ยังวาดกล้องลื่นที่ 20 fps
            if (tick % 2 === 0) {
              const now = performance.now();
              const ts = now > lastSegTimeRef.current ? now : lastSegTimeRef.current + 1;
              lastSegTimeRef.current = ts;

              // วาดภาพย่อลง maskCanvas ชั่วคราวหรือส่ง videoEl ตรงๆ ให้ MediaPipe (GPU resize อัตโนมัติ)
              const segResult = segmenterRef.current.segmentForVideo(videoEl, ts);
              const mask = segResult?.confidenceMasks?.[0];
              if (mask) {
                const probs = mask.getAsFloat32Array();
                const mw = mask.width;
                const mh = mask.height;
                const data = maskImageDataRef.current.data;
                // Sample จาก mask ขนาดเต็มมาลง MASK_W x MASK_H (ไม่ใช้ getImageData เลย!)
                for (let y = 0; y < MASK_H; y++) {
                  const sy = Math.min(mh - 1, Math.floor((y * mh) / MASK_H));
                  for (let x = 0; x < MASK_W; x++) {
                    // กลับด้านซ้าย-ขวา (mirror) ให้ตรงกับภาพกล้อง
                    const sx = Math.min(mw - 1, Math.floor(((MASK_W - 1 - x) * mw) / MASK_W));
                    const conf = probs[sy * mw + sx] || 0;
                    const alpha = Math.max(0, Math.min(1, (conf - 0.35) / 0.35));
                    const idx = (y * MASK_W + x) * 4;
                    data[idx] = 255;
                    data[idx + 1] = 255;
                    data[idx + 2] = 255;
                    data[idx + 3] = Math.round(alpha * 255);
                  }
                }
                mCtx.putImageData(maskImageDataRef.current, 0, 0);
              }
              segResult?.close?.();
            }

            // Composite บน GPU ล้วนด้วย destination-in
            pCtx.save();
            pCtx.globalCompositeOperation = 'source-over';
            pCtx.clearRect(0, 0, PERSON_W, PERSON_H);
            pCtx.translate(PERSON_W, 0);
            pCtx.scale(-1, 1);
            pCtx.drawImage(videoEl, 0, 0, PERSON_W, PERSON_H);
            pCtx.restore();

            pCtx.save();
            pCtx.globalCompositeOperation = 'destination-in';
            pCtx.imageSmoothingEnabled = true;
            pCtx.drawImage(maskCanvasRef.current, 0, 0, PERSON_W, PERSON_H);
            pCtx.restore();

            ctx.drawImage(
              personCanvasRef.current,
              CANVAS_W - PERSON_W - 10,
              CANVAS_H - PERSON_H,
              PERSON_W,
              PERSON_H,
            );
            return;
          } catch {
            // หากเกิดข้อผิดพลาดระหว่าง segment ให้ตกกลับไปวาดแบบ PiP อัตโนมัติ
          }
        }

        // โหมด PiP (สไลด์ + กรอบกล้องมุมขวาล่าง)
        const pw = 216;
        const ph = 162;
        const px = CANVAS_W - pw - 14;
        const py = CANVAS_H - ph - 12;

        ctx.save();
        drawRoundedRect(ctx, px, py, pw, ph, 10);
        ctx.clip();
        ctx.translate(px + pw, py);
        ctx.scale(-1, 1);
        ctx.drawImage(videoEl, 0, 0, pw, ph);
        ctx.restore();

        ctx.save();
        drawRoundedRect(ctx, px, py, pw, ph, 10);
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgba(24, 24, 27, 0.35)';
        ctx.stroke();
        ctx.restore();
      };

      drawFrame();
      timerRef.current = setInterval(drawFrame, Math.round(1000 / FPS));

      const canvasStream = canvas.captureStream(FPS);
      outStreamRef.current = canvasStream;
      return canvasStream;
    },
    [stopCompositing],
  );

  return { startCompositing, stopCompositing };
}
