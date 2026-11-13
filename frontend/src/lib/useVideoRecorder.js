import { useCallback, useRef } from 'react';

function getSupportedVideoMime() {
  if (typeof window === 'undefined' || typeof MediaRecorder === 'undefined') return '';
  const types = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4',
  ];
  for (const t of types) {
    if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) {
      return t;
    }
  }
  return '';
}

export function useVideoRecorder() {
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const mimeRef = useRef('video/webm');

  const start = useCallback((videoStream, audioStream) => {
    if (!videoStream || typeof MediaRecorder === 'undefined') return;
    const tracks = [
      ...videoStream.getVideoTracks(),
      ...(audioStream ? audioStream.getAudioTracks() : []),
    ];
    if (tracks.length === 0) return;

    const combined = new MediaStream(tracks);
    const mimeType = getSupportedVideoMime();
    mimeRef.current = mimeType || 'video/webm';

    const options = {
      videoBitsPerSecond: 900_000,
      ...(mimeType ? { mimeType } : {}),
    };

    try {
      const recorder = new MediaRecorder(combined, options);
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.start(500);
    } catch (err) {
      console.warn('[useVideoRecorder] Could not start video recording:', err);
      recorderRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    return new Promise((resolve) => {
      const recorder = recorderRef.current;
      if (!recorder || recorder.state === 'inactive') {
        recorderRef.current = null;
        resolve({ videoUrl: null, videoExt: 'webm' });
        return;
      }

      recorder.onstop = () => {
        recorderRef.current = null;
        if (chunksRef.current.length === 0) {
          resolve({ videoUrl: null, videoExt: 'webm' });
          return;
        }
        const mime = recorder.mimeType || mimeRef.current || 'video/webm';
        const blob = new Blob(chunksRef.current, { type: mime });
        const videoUrl = URL.createObjectURL(blob);
        const videoExt = mime.includes('mp4') ? 'mp4' : 'webm';
        chunksRef.current = [];
        resolve({ videoUrl, videoExt });
      };

      try {
        recorder.stop();
      } catch {
        recorderRef.current = null;
        resolve({ videoUrl: null, videoExt: 'webm' });
      }
    });
  }, []);

  return { start, stop };
}
