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

export async function mergeVideoTracks(videoItems, onProgress) {
  const items = (videoItems || []).filter((item) => item?.videoUrl);
  if (items.length === 0) return null;

  if (items.length === 1) {
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

  try {
    for (let idx = 0; idx < items.length; idx++) {
      onProgress?.({ stage: 'loading', current: idx + 1, total: items.length, pct: 0 });
      const itemExt = items[idx].videoExt || 'webm';
      const filename = `input_${idx}.${itemExt}`;
      inputFiles.push(filename);
      inputArgs.push('-i', filename);
      await ffmpeg.writeFile(filename, await fetchFile(items[idx].videoUrl));
    }

    const outputName = 'merged.mp4';
    const handleProgress = ({ progress }) => {
      if (typeof progress === 'number' && Number.isFinite(progress)) {
        const pct = Math.max(0, Math.min(99, Math.round(progress * 100)));
        onProgress?.({ stage: 'encoding', current: items.length, total: items.length, pct });
      }
    };
    ffmpeg.on('progress', handleProgress);

    const runConcat = async (withAudio) => {
      const vPrep = items
        .map(
          (_, i) =>
            `[${i}:v:0]scale=640:360:force_original_aspect_ratio=decrease,pad=640:360:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24,format=yuv420p,setpts=PTS-STARTPTS[v${i}]`,
        )
        .join(';');
      const aPrep = withAudio
        ? items.map((_, i) => `[${i}:a:0]aresample=async=1:first_pts=0,asetpts=PTS-STARTPTS[a${i}]`).join(';')
        : '';
      const streams = items.map((_, i) => (withAudio ? `[v${i}][a${i}]` : `[v${i}]`)).join('');
      const filter = withAudio
        ? `${vPrep};${aPrep};${streams}concat=n=${items.length}:v=1:a=1[outv][outa]`
        : `${vPrep};${streams}concat=n=${items.length}:v=1:a=0[outv]`;

      const args = [
        ...inputArgs,
        '-filter_complex',
        filter,
        '-map',
        '[outv]',
        ...(withAudio ? ['-map', '[outa]', '-c:a', 'aac', '-b:a', '128k'] : []),
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-crf',
        '28',
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
