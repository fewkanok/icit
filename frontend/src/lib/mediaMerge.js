import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

let ffmpegInstance = null;
let ffmpegLoadPromise = null;

async function getFfmpeg() {
  if (!ffmpegInstance) {
    ffmpegInstance = new FFmpeg();
  }
  if (!ffmpegInstance.loaded) {
    if (!ffmpegLoadPromise) {
      ffmpegLoadPromise = Promise.all([
        toBlobURL('/ffmpeg/ffmpeg-core.js', 'text/javascript'),
        toBlobURL('/ffmpeg/ffmpeg-core.wasm', 'application/wasm'),
      ])
        .then(([coreURL, wasmURL]) => ffmpegInstance.load({ coreURL, wasmURL }))
        .catch((err) => {
          ffmpegLoadPromise = null;
          throw err;
        });
    }
    await ffmpegLoadPromise;
  }
  return ffmpegInstance;
}

function encodeWavFromAudioBuffer(buffer) {
  const numChannels = Math.min(2, buffer.numberOfChannels || 1);
  const sampleRate = buffer.sampleRate;
  const length = buffer.length;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = length * blockAlign;
  const arrayBuffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(arrayBuffer);

  const writeString = (offset, str) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  const channels = [];
  for (let c = 0; c < numChannels; c++) {
    channels.push(buffer.getChannelData(c));
  }

  let offset = 44;
  for (let i = 0; i < length; i++) {
    for (let c = 0; c < numChannels; c++) {
      const sample = Math.max(-1, Math.min(1, channels[c][i] || 0));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

export async function mergeAudioTracks(audioUrls) {
  const validUrls = (audioUrls || []).filter(Boolean);
  if (validUrls.length === 0) return null;

  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) {
    throw new Error('เบราว์เซอร์ไม่รองรับการรวมไฟล์เสียง');
  }

  const ctx = new AudioCtx();
  try {
    const decoded = [];
    for (const url of validUrls) {
      const res = await fetch(url);
      const arr = await res.arrayBuffer();
      const buf = await ctx.decodeAudioData(arr);
      decoded.push(buf);
    }

    const sampleRate = decoded[0].sampleRate;
    const numChannels = Math.max(...decoded.map((b) => Math.min(2, b.numberOfChannels || 1)));
    const totalLength = decoded.reduce((sum, b) => sum + b.length, 0);

    const output = ctx.createBuffer(numChannels, totalLength, sampleRate);
    let offset = 0;
    for (const buf of decoded) {
      for (let c = 0; c < numChannels; c++) {
        const srcChannel = buf.getChannelData(Math.min(c, buf.numberOfChannels - 1));
        output.getChannelData(c).set(srcChannel, offset);
      }
      offset += buf.length;
    }

    const blob = encodeWavFromAudioBuffer(output);
    return {
      url: URL.createObjectURL(blob),
      ext: 'wav',
      duration: output.duration,
    };
  } finally {
    await ctx.close().catch(() => {});
  }
}

const DEFAULT_LAYOUT = {
  slide: { x: 0.01, y: 0.03, w: 0.73, h: 0.94 },
  camera: { x: 0.76, y: 0.04, w: 0.225, h: 0.3 },
  qa: { x: 0.755, y: 0.37, w: 0.23, h: 0.56 },
};

const thSegmenter =
  typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('th', { granularity: 'word' }) : null;

function wrapCanvasLines(ctx, text, maxWidth, maxLines = 10) {
  const clean = String(text || '').trim();
  if (!clean) return [];
  const units = thSegmenter ? Array.from(thSegmenter.segment(clean), (s) => s.segment) : Array.from(clean);
  const lines = [];
  let current = '';

  for (const unit of units) {
    const next = current + unit;
    if (ctx.measureText(next).width > maxWidth && current.length > 0) {
      lines.push(current.trimEnd());
      current = unit.trimStart();
      if (lines.length >= maxLines) break;
    } else {
      current = next;
    }
  }
  if (lines.length < maxLines && current.trim()) {
    lines.push(current.trimEnd());
  }
  return lines;
}

function toEvenPx(val, min = 32) {
  const n = Math.max(min, Math.round(val));
  return n % 2 === 0 ? n : n - 1;
}

async function renderSlidePngBytes(slide, qaQuestion = '', layout = DEFAULT_LAYOUT) {
  // Layout แบบกำหนดเองบนเฟรม 960x540
  const W = 960;
  const H = 540;
  const sBox = layout?.slide || DEFAULT_LAYOUT.slide;
  const cBox = layout?.camera || DEFAULT_LAYOUT.camera;

  const sx = Math.round(sBox.x * W);
  const sy = Math.round(sBox.y * H);
  const sw = Math.max(120, Math.round(sBox.w * W));
  const sh = Math.max(90, Math.round(sBox.h * H));

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  // พื้นหลังเฟรมหลัก
  ctx.fillStyle = '#f4f4f5';
  ctx.fillRect(0, 0, W, H);

  // กล่องพื้นหลังสไลด์
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(sx, sy, sw, sh);

  const src = slide?.src || slide?.url;
  if (src) {
    await new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        if (img.naturalWidth > 0 && img.naturalHeight > 0) {
          const pad = 8;
          const maxW = Math.max(40, sw - pad * 2);
          const maxH = Math.max(40, sh - pad * 2);
          const scale = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight);
          const dw = img.naturalWidth * scale;
          const dh = img.naturalHeight * scale;
          ctx.drawImage(img, sx + (sw - dw) / 2, sy + (sh - dh) / 2, dw, dh);
        }
        resolve();
      };
      img.onerror = () => resolve();
      img.src = src;
    });
  } else if (slide?.title) {
    const padX = sw < 520 ? 22 : 36;
    const textMaxW = Math.max(120, sw - padX * 2);
    ctx.fillStyle = '#18181b';
    ctx.font = sw < 520 ? '600 20px sans-serif' : '600 24px sans-serif';
    const titleLines = wrapCanvasLines(ctx, slide.title, textMaxW, 4);
    let cursorY = sy + 64;
    titleLines.forEach((line) => {
      ctx.fillText(line, sx + padX, cursorY);
      cursorY += 28;
    });

    cursorY += 14;
    ctx.fillStyle = '#52525b';
    ctx.font = sw < 520 ? '400 15px sans-serif' : '400 17px sans-serif';
    const points = Array.isArray(slide.points) ? slide.points : [];
    for (const pt of points) {
      if (cursorY > sy + sh - 24) break;
      const ptLines = wrapCanvasLines(ctx, `• ${String(pt)}`, textMaxW, 8);
      for (const line of ptLines) {
        if (cursorY > sy + sh - 20) break;
        ctx.fillText(line, sx + padX, cursorY);
        cursorY += 23;
      }
      cursorY += 8;
    }
  }

  // วาดการ์ดคำถาม Q&A แบบ Auto-fit ความสูงตามเนื้อหา (ไม่เหลือพื้นที่ขาวโล่งๆ)
  if (qaQuestion) {
    const qBox = layout?.qa || DEFAULT_LAYOUT.qa;
    const qx = Math.round(qBox.x * W);
    const qy = Math.round(qBox.y * H);
    const qw = Math.max(180, Math.round(qBox.w * W));
    const maxQh = Math.max(84, Math.round(qBox.h * H));

    const padX = 16;
    const padTop = 14;
    const padBottom = 14;
    const headerH = 22;
    const lineH = 22;

    ctx.font = '500 15px sans-serif';
    const maxLines = Math.max(2, Math.floor((maxQh - padTop - headerH - padBottom) / lineH));
    const lines = wrapCanvasLines(ctx, String(qaQuestion).trim(), qw - padX * 2 - 4, maxLines);
    const actualH = Math.min(maxQh, padTop + headerH + lines.length * lineH + padBottom);

    ctx.save();
    ctx.shadowColor = 'rgba(24, 24, 27, 0.08)';
    ctx.shadowBlur = 14;
    ctx.shadowOffsetY = 4;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.roundRect(qx, qy, qw, actualH, 12);
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = '#e4e4e7';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(qx, qy, qw, actualH, 12);
    ctx.stroke();

    // แถบสีเน้นด้านซ้าย
    ctx.fillStyle = '#c2410c';
    ctx.beginPath();
    ctx.roundRect(qx, qy + 10, 4, actualH - 20, 2);
    ctx.fill();

    // หัวข้อเล็ก
    ctx.fillStyle = '#c2410c';
    ctx.font = '600 12px sans-serif';
    ctx.fillText('คำถาม Q&A', qx + padX, qy + padTop + 11);

    // เนื้อหาคำถาม
    ctx.fillStyle = '#18181b';
    ctx.font = '500 15px sans-serif';
    lines.forEach((line, idx) => {
      ctx.fillText(line, qx + padX, qy + padTop + headerH + 16 + idx * lineH);
    });
  }

  // กรอบรอบกล้องผู้พูด (เงา + ขอบขาวให้แยกชัดแม้ซ้อนบนสไลด์)
  const camW = toEvenPx(cBox.w * W, 120);
  const camH = toEvenPx(cBox.h * H, 90);
  const camX = Math.max(0, Math.min(W - camW, Math.round(cBox.x * W)));
  const camY = Math.max(0, Math.min(H - camH, Math.round(cBox.y * H)));
  const framePad = 4;

  ctx.save();
  ctx.shadowColor = 'rgba(24, 24, 27, 0.16)';
  ctx.shadowBlur = 16;
  ctx.shadowOffsetY = 4;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.roundRect(camX - framePad, camY - framePad, camW + framePad * 2, camH + framePad * 2, 10);
  ctx.fill();
  ctx.restore();

  ctx.strokeStyle = '#d4d4d8';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(camX - framePad, camY - framePad, camW + framePad * 2, camH + framePad * 2, 10);
  ctx.stroke();

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  const buf = await blob.arrayBuffer();
  return new Uint8Array(buf);
}

export async function mergeVideoTracks(videoItems, onProgress, { forceCompose = false, layout = DEFAULT_LAYOUT } = {}) {
  const items = (videoItems || []).filter((item) => item?.videoUrl);
  if (items.length === 0) return null;

  if (items.length === 1 && !forceCompose) {
    return {
      url: items[0].videoUrl,
      ext: items[0].videoExt || 'mp4',
      isDirect: true,
    };
  }

  onProgress?.(0, items.length);
  const ffmpeg = await getFfmpeg();

  const inputFiles = [];
  const inputArgs = [];
  const itemMeta = [];
  let nextInputIdx = 0;

  try {
    for (let idx = 0; idx < items.length; idx++) {
      onProgress?.({ stage: 'loading', current: idx + 1, total: items.length, pct: 0 });
      const itemExt = items[idx].videoExt || 'webm';
      const filename = `input_${idx}.${itemExt}`;
      inputFiles.push(filename);
      inputArgs.push('-i', filename);
      await ffmpeg.writeFile(filename, await fetchFile(items[idx].videoUrl));
      const vidIdx = nextInputIdx++;

      const changes =
        Array.isArray(items[idx].slideChanges) && items[idx].slideChanges.length > 0
          ? items[idx].slideChanges
          : items[idx].slide
            ? [{ t: 0, slide: items[idx].slide }]
            : [];

      const bgEntries = [];
      for (let cIdx = 0; cIdx < changes.length; cIdx++) {
        const ch = changes[cIdx];
        if (!ch?.slide) continue;
        const pngName = `slide_${idx}_${cIdx}.png`;
        const pngBytes = await renderSlidePngBytes(ch.slide, items[idx].qaQuestion || '', layout || DEFAULT_LAYOUT);
        inputFiles.push(pngName);
        inputArgs.push('-loop', '1', '-i', pngName);
        await ffmpeg.writeFile(pngName, pngBytes);
        bgEntries.push({ t: Number(ch.t || 0), bgIdx: nextInputIdx++ });
      }

      itemMeta.push({ vidIdx, bgEntries });
    }

    const outputName = 'merged.mp4';
    const handleProgress = ({ progress }) => {
      if (typeof progress === 'number' && Number.isFinite(progress)) {
        const pct = Math.max(0, Math.min(99, Math.round(progress * 100)));
        onProgress?.({ stage: 'encoding', current: items.length, total: items.length, pct });
      }
    };
    ffmpeg.on('progress', handleProgress);

    const camBox = layout?.camera || DEFAULT_LAYOUT.camera;
    const camW = toEvenPx(camBox.w * 960, 120);
    const camH = toEvenPx(camBox.h * 540, 90);
    const camX = Math.max(0, Math.min(960 - camW, Math.round(camBox.x * 960)));
    const camY = Math.max(0, Math.min(540 - camH, Math.round(camBox.y * 540)));

    const runConcat = async (withAudio) => {
      const vPrep = itemMeta
        .map(({ vidIdx, bgEntries }, i) => {
          if (bgEntries.length === 1) {
            const { bgIdx } = bgEntries[0];
            return (
              `[${vidIdx}:v:0]scale=${camW}:${camH}:force_original_aspect_ratio=increase,crop=${camW}:${camH},hflip,setsar=1,fps=15,format=yuv420p,setpts=PTS-STARTPTS[cam${i}];` +
              `[${bgIdx}:v]setsar=1,fps=15,format=yuv420p[bg${i}];` +
              `[bg${i}][cam${i}]overlay=${camX}:${camY}:shortest=1[v${i}]`
            );
          }
          if (bgEntries.length > 1) {
            const parts = [];
            parts.push(
              `[${vidIdx}:v:0]scale=${camW}:${camH}:force_original_aspect_ratio=increase,crop=${camW}:${camH},hflip,setsar=1,fps=15,format=yuv420p,setpts=PTS-STARTPTS[cam${i}]`,
            );
            bgEntries.forEach(({ bgIdx }, j) => {
              parts.push(`[${bgIdx}:v]setsar=1,fps=15,format=yuv420p[s${i}_${j}]`);
            });
            let prevLabel = `s${i}_0`;
            for (let j = 1; j < bgEntries.length; j++) {
              const outLabel = j === bgEntries.length - 1 ? `bg${i}` : `m${i}_${j}`;
              const tSec = Math.max(0, bgEntries[j].t).toFixed(2);
              parts.push(`[${prevLabel}][s${i}_${j}]overlay=0:0:enable='gte(t,${tSec})'[${outLabel}]`);
              prevLabel = outLabel;
            }
            parts.push(`[bg${i}][cam${i}]overlay=${camX}:${camY}:shortest=1[v${i}]`);
            return parts.join(';');
          }
          return `[${vidIdx}:v:0]scale=960:540:force_original_aspect_ratio=decrease,pad=960:540:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=15,format=yuv420p,setpts=PTS-STARTPTS[v${i}]`;
        })
        .join(';');

      const aPrep = withAudio
        ? itemMeta
            .map(({ vidIdx }, i) => `[${vidIdx}:a:0]aresample=async=1:first_pts=0,asetpts=PTS-STARTPTS[a${i}]`)
            .join(';')
        : '';

      let filter;
      let mapArgs;
      if (items.length === 1) {
        filter = withAudio ? `${vPrep};${aPrep}` : vPrep;
        mapArgs = withAudio ? ['-map', '[v0]', '-map', '[a0]'] : ['-map', '[v0]'];
      } else {
        const streams = items.map((_, i) => (withAudio ? `[v${i}][a${i}]` : `[v${i}]`)).join('');
        filter = withAudio
          ? `${vPrep};${aPrep};${streams}concat=n=${items.length}:v=1:a=1[outv][outa]`
          : `${vPrep};${streams}concat=n=${items.length}:v=1:a=0[outv]`;
        mapArgs = withAudio ? ['-map', '[outv]', '-map', '[outa]'] : ['-map', '[outv]'];
      }

      const args = [
        ...inputArgs,
        '-filter_complex',
        filter,
        ...mapArgs,
        ...(withAudio ? ['-c:a', 'aac', '-b:a', '128k'] : []),
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-tune',
        'stillimage',
        '-crf',
        '26',
        '-pix_fmt',
        'yuv420p',
        '-vsync',
        'cfr',
        '-movflags',
        '+faststart',
        outputName,
      ];
      return ffmpeg.exec(args);
    };

    try {
      let exitCode = await runConcat(true);
      if (exitCode !== 0) {
        await ffmpeg.deleteFile(outputName).catch(() => {});
        exitCode = await runConcat(false);
      }

      if (exitCode !== 0) {
        throw new Error('ไม่สามารถรวมไฟล์วิดีโอได้');
      }

      const data = await ffmpeg.readFile(outputName);
      await ffmpeg.deleteFile(outputName).catch(() => {});

      const blob = new Blob([data.buffer], { type: 'video/mp4' });
      return {
        url: URL.createObjectURL(blob),
        ext: 'mp4',
        isDirect: false,
      };
    } finally {
      ffmpeg.off('progress', handleProgress);
    }
  } finally {
    for (const file of inputFiles) {
      await ffmpeg.deleteFile(file).catch(() => {});
    }
  }
}
