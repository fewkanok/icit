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
 * - ปรับปรุงอัลกอริทึม: แยกแยะการ "กะพริบตา" (Blink) ออกจากการ "ก้มอ่านโพย" (Looking Down) อย่างแม่นยำ
 * - ใช้ Hysteresis / Temporal Smoothing: ต้องก้มต่อเนื่องเกิน 0.6 วินาทีถึงจะแจ้งเตือน ไม่กระตุกตามจังหวะกะพริบตา
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

  // ตัวจับเวลาสำหรับ Debounce / Temporal Smoothing
  const lookDownStartTimestampRef = useRef(null);
  const lookAwayStartTimestampRef = useRef(null);

  // โหมดบันทึกสถิติ (ทำงานเมื่อกดเริ่มซ้อมพูด)
  const isTrackingRef = useRef(false);
  const totalFramesRef = useRef(0);
  const eyeContactFramesRef = useRef(0);
  const lookingDownFramesRef = useRef(0);
  const inLookDownInstanceRef = useRef(false);
  const lookDownCountRef = useRef(0);
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

  // Callback ref สำหรับเชื่อมต่อสัญญาณวิดีโอทันทีที่แท็ก <video> ปรากฏใน DOM
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

  // ลูปตรวจจับใบหน้าแบบ Real-time พร้อมตัวกรอง Blink และ Debounce
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

            // ตรวจจับการกะพริบตา (Blink)
            const blinkLeft = getScore('eyeBlinkLeft');
            const blinkRight = getScore('eyeBlinkRight');
            const isBlinking = blinkLeft > 0.4 || blinkRight > 0.4;

            // สายตามองต่ำ / มองออกข้าง
            const lookDownScore = (getScore('eyeLookDownLeft') + getScore('eyeLookDownRight')) / 2;
            const lookOutScore = Math.max(
              getScore('eyeLookOutLeft'),
              getScore('eyeLookOutRight'),
              getScore('eyeLookInLeft'),
              getScore('eyeLookInRight')
            );

            // คำนวณองศาใบหน้า 3D (Pitch = ก้ม/เงย, Yaw = หันซ้าย/ขวา)
            let pitch = 0;
            let yaw = 0;
            if (results.facialTransformationMatrixes?.[0]?.data) {
              const m = results.facialTransformationMatrixes[0].data;
              pitch = Math.atan2(m[6], m[10]) * (180 / Math.PI);
              yaw = Math.atan2(-m[2], Math.sqrt(m[0] * m[0] + m[1] * m[1])) * (180 / Math.PI);
              setPoseAngles({ pitch: Math.round(pitch), yaw: Math.round(yaw) });
            }

            // *** กฎการแยกแยะ: ถ้ากำลังกะพริบตา จะไม่ถือว่าก้มอ่านโพยเด็ดขาด ***
            // ก้มอ่านโพยจริง = หัวก้มต่ำจริง (pitch < -14) หรือ (หัวก้มปานกลาง + สายตามองต่ำชัดเจนโดยไม่ได้หลับตา)
            const isGenuinelyLookingDown =
              !isBlinking && (pitch < -14 || (pitch < -7 && lookDownScore > 0.48) || lookDownScore > 0.65);

            // หันมองสไลด์ = หันหน้า |yaw| > 22 องศา หรือ กลอกตาออกด้านข้างชัดเจน
            const isGenuinelyLookingAway =
              !isBlinking && (Math.abs(yaw) > 22 || lookOutScore > 0.48);

            // *** Debounce & Hysteresis Smoothing ***
            // ต้องก้มต่อเนื่องเกิน 0.6 วินาทีถึงจะเปลี่ยนสถานะเป็น 'looking_down'
            if (isGenuinelyLookingDown) {
              lookAwayStartTimestampRef.current = null;
              if (!lookDownStartTimestampRef.current) {
                lookDownStartTimestampRef.current = now;
              } else {
                const sustainedSec = (now - lookDownStartTimestampRef.current) / 1000;
                if (sustainedSec >= 0.6) {
                  setCurrentStatus('looking_down');
                  if (isTrackingRef.current) {
                    lookingDownFramesRef.current += 1;
                    lookDownTotalSecRef.current += deltaSec;
                    if (!inLookDownInstanceRef.current && sustainedSec >= 1.5) {
                      inLookDownInstanceRef.current = true;
                      lookDownCountRef.current += 1;
                    }
                  }
                }
              }
            } else if (isGenuinelyLookingAway) {
              lookDownStartTimestampRef.current = null;
              inLookDownInstanceRef.current = false;
              if (!lookAwayStartTimestampRef.current) {
                lookAwayStartTimestampRef.current = now;
              } else {
                const sustainedSec = (now - lookAwayStartTimestampRef.current) / 1000;
                if (sustainedSec >= 0.5) {
                  setCurrentStatus('looking_away');
                }
              }
            } else {
              // สายตาปกติ หรือ กะพริบตาตามธรรมชาติ -> สบตาคนฟัง
              lookDownStartTimestampRef.current = null;
              lookAwayStartTimestampRef.current = null;
              inLookDownInstanceRef.current = false;
              setCurrentStatus('eye_contact');
              if (isTrackingRef.current) {
                eyeContactFramesRef.current += 1;
              }
            }

            if (isTrackingRef.current) {
              totalFramesRef.current += 1;
              const pct = Math.round((eyeContactFramesRef.current / totalFramesRef.current) * 100);
              setEyeContactPct(pct);
            }
          } else {
            lookDownStartTimestampRef.current = null;
            lookAwayStartTimestampRef.current = null;
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
    inLookDownInstanceRef.current = false;
    lookDownCountRef.current = 0;
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
