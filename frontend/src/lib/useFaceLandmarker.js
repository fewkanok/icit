import { useCallback, useEffect, useRef, useState } from 'react';
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

let landmarkerPromise = null;

// โหลดโมเดล MediaPipe FaceLandmarker แบบ Singleton
async function getFaceLandmarker() {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      try {
        const fileset = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
        );
        return await FaceLandmarker.createFromOptions(fileset, {
          baseOptions: {
            modelAssetPath:
              'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
            delegate: 'GPU',
          },
          outputFaceBlendshapes: true,
          outputFacialTransformationMatrixes: true,
          runningMode: 'VIDEO',
          numFaces: 1,
        });
      } catch (err) {
        console.error('[FaceLandmarker] Failed to load model:', err);
        landmarkerPromise = null;
        throw err;
      }
    })();
  }
  return landmarkerPromise;
}

/**
 * useFaceLandmarker Hook:
 * - จัดการกล้องเว็บแคมและประมวลผล Face Mesh + Eye Contact สด 100% ในเบราว์เซอร์
 */
export function useFaceLandmarker() {
  const [cameraActive, setCameraActive] = useState(false);
  const [modelLoading, setModelLoading] = useState(false);
  const [modelReady, setModelReady] = useState(false);
  const [cameraError, setCameraError] = useState(null);

  // สถานะการตรวจจับสด
  const [currentStatus, setCurrentStatus] = useState('off'); // 'eye_contact' | 'looking_down' | 'looking_away' | 'no_face' | 'off'
  const [eyeContactPct, setEyeContactPct] = useState(100);
  const [poseAngles, setPoseAngles] = useState({ pitch: 0, yaw: 0 });

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const animFrameRef = useRef(null);
  const landmarkerRef = useRef(null);

  // โหมดบันทึกสถิติ (ทำงานเมื่อกดเริ่มซ้อมพูด)
  const isTrackingRef = useRef(false);
  const totalFramesRef = useRef(0);
  const eyeContactFramesRef = useRef(0);
  const lookingDownFramesRef = useRef(0);
  const inLookDownRef = useRef(false);
  const lookDownCountRef = useRef(0);
  const lookDownStartTimeRef = useRef(null);
  const lookDownTotalSecRef = useRef(0);

  // 1. เปิดกล้องเว็บแคม
  const startCamera = useCallback(async () => {
    try {
      setCameraError(null);
      setModelLoading(true);

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
        audio: false,
      });
      streamRef.current = stream;

      // โหลดโมเดล MediaPipe
      const landmarker = await getFaceLandmarker();
      landmarkerRef.current = landmarker;
      setModelReady(true);
      setModelLoading(false);
      setCameraActive(true);
    } catch (err) {
      console.error('[FaceLandmarker] startCamera error:', err);
      setCameraError(err.name === 'NotAllowedError' ? 'โปรดอนุญาตให้เข้าถึงกล้อง' : err.message);
      setModelLoading(false);
      setCameraActive(false);
    }
  }, []);

  // 2. ปิดกล้องเว็บแคม
  const stopCamera = useCallback(() => {
    isTrackingRef.current = false;
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (streamRef.current) {
      try {
        streamRef.current.getTracks().forEach((track) => track.stop());
      } catch (_) {}
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
    setCurrentStatus('off');
  }, []);

  // เชื่อมต่อ Stream เข้ากับ <video> ทันทีที่ Element ถูก Mount ใน DOM
  const setVideoRef = useCallback((node) => {
    videoRef.current = node;
    if (node && streamRef.current) {
      node.srcObject = streamRef.current;
      node.onloadedmetadata = () => {
        node.play().catch((e) => console.log('[FaceLandmarker] Play err:', e));
      };
      node.play().catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (cameraActive && videoRef.current && streamRef.current) {
      const video = videoRef.current;
      if (video.srcObject !== streamRef.current) {
        video.srcObject = streamRef.current;
        video.play().catch(() => {});
      }
    }
  }, [cameraActive]);

  // ลูปตรวจจับใบหน้าแบบ Real-time ทำงานตลอดเวลาที่เปิดกล้อง
  useEffect(() => {
    if (!cameraActive || !modelReady) return;

    let lastVideoTime = -1;
    let lastCheckTime = performance.now();

    const loop = () => {
      const video = videoRef.current;
      const landmarker = landmarkerRef.current;

      if (video && landmarker && video.readyState >= 2) {
        if (video.currentTime !== lastVideoTime) {
          lastVideoTime = video.currentTime;
          const now = performance.now();
          const results = landmarker.detectForVideo(video, now);

          const deltaSec = (now - lastCheckTime) / 1000;
          lastCheckTime = now;

          if (results && results.faceLandmarks && results.faceLandmarks.length > 0) {
            const blendshapes = results.faceBlendshapes?.[0]?.categories || [];
            const getScore = (name) => blendshapes.find((c) => c.categoryName === name)?.score || 0;

            const lookDownScore = (getScore('eyeLookDownLeft') + getScore('eyeLookDownRight')) / 2;
            const lookOutScore = Math.max(
              getScore('eyeLookOutLeft'),
              getScore('eyeLookOutRight'),
              getScore('eyeLookInLeft'),
              getScore('eyeLookInRight')
            );

            let pitch = 0;
            let yaw = 0;
            if (results.facialTransformationMatrixes?.[0]?.data) {
              const m = results.facialTransformationMatrixes[0].data;
              pitch = Math.atan2(m[6], m[10]) * (180 / Math.PI);
              yaw = Math.atan2(-m[2], Math.sqrt(m[0] * m[0] + m[1] * m[1])) * (180 / Math.PI);
              setPoseAngles({ pitch: Math.round(pitch), yaw: Math.round(yaw) });
            }

            const isLookingDown = pitch < -10 || lookDownScore > 0.35;
            const isLookingAway = Math.abs(yaw) > 18 || lookOutScore > 0.4;

            if (isLookingDown) {
              setCurrentStatus('looking_down');
              if (isTrackingRef.current) {
                lookingDownFramesRef.current += 1;
                totalFramesRef.current += 1;
                if (!inLookDownRef.current) {
                  inLookDownRef.current = true;
                  lookDownStartTimeRef.current = now;
                } else {
                  const dur = (now - lookDownStartTimeRef.current) / 1000;
                  if (dur >= 1.5 && lookDownStartTimeRef.current !== null) {
                    lookDownCountRef.current += 1;
                    lookDownStartTimeRef.current = null;
                  }
                }
                lookDownTotalSecRef.current += deltaSec;
              }
            } else if (isLookingAway) {
              setCurrentStatus('looking_away');
              if (isTrackingRef.current) {
                totalFramesRef.current += 1;
                inLookDownRef.current = false;
                lookDownStartTimeRef.current = null;
              }
            } else {
              setCurrentStatus('eye_contact');
              if (isTrackingRef.current) {
                eyeContactFramesRef.current += 1;
                totalFramesRef.current += 1;
                inLookDownRef.current = false;
                lookDownStartTimeRef.current = null;
              }
            }

            if (isTrackingRef.current && totalFramesRef.current > 0) {
              const pct = Math.round((eyeContactFramesRef.current / totalFramesRef.current) * 100);
              setEyeContactPct(pct);
            }
          } else {
            setCurrentStatus('no_face');
            if (isTrackingRef.current) {
              totalFramesRef.current += 1;
            }
          }
        }
      }

      animFrameRef.current = requestAnimationFrame(loop);
    };

    animFrameRef.current = requestAnimationFrame(loop);

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [cameraActive, modelReady]);

  // 3. เริ่มสะสมสถิติจริง (เรียกเมื่อผู้ใช้กด "เริ่มพูด")
  const startTracking = useCallback(() => {
    isTrackingRef.current = true;
    totalFramesRef.current = 0;
    eyeContactFramesRef.current = 0;
    lookingDownFramesRef.current = 0;
    inLookDownRef.current = false;
    lookDownCountRef.current = 0;
    lookDownStartTimeRef.current = null;
    lookDownTotalSecRef.current = 0;
    setEyeContactPct(100);
  }, []);

  // 4. สรุปผลการวิเคราะห์เมื่อหยุดพูด
  const stopTracking = useCallback(() => {
    isTrackingRef.current = false;
    const total = totalFramesRef.current || 1;
    const finalEyeContact = Math.round((eyeContactFramesRef.current / total) * 100);

    return {
      cameraUsed: cameraActive,
      eyeContactPct: cameraActive ? finalEyeContact : null,
      lookingDownCount: cameraActive ? lookDownCountRef.current : 0,
      lookingDownSec: cameraActive ? Math.round(lookDownTotalSecRef.current * 10) / 10 : 0,
    };
  }, [cameraActive]);

  // คลีนอัพเมื่อ Unmount
  useEffect(() => {
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  return {
    videoRef,
    setVideoRef,
    cameraActive,
    modelLoading,
    modelReady,
    cameraError,
    currentStatus,
    eyeContactPct,
    poseAngles,
    startCamera,
    stopCamera,
    startTracking,
    stopTracking,
  };
}
