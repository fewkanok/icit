import { useCallback, useEffect, useRef, useState } from 'react';
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

let landmarkerPromise = null;

// โหลดโมเดล MediaPipe FaceLandmarker แบบ Singleton (โหลดครั้งเดียวใช้ซ้ำได้ตลอด)
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
 * - เปิด/ปิดเว็บแคม และวิเคราะห์ใบหน้าด้วย Google MediaPipe 100% บนเบราว์เซอร์
 * - วัดเปอร์เซ็นต์ Eye Contact (สบตากับผู้ฟัง/กล้อง)
 * - วัด Head Pose (องศาก้ม/เงย และ หันซ้าย/ขวา)
 * - ตรวจจับพฤติกรรมก้มอ่านโพย / หันมองสไลด์ตลอดเวลา
 */
export function useFaceLandmarker() {
  const [cameraActive, setCameraActive] = useState(false);
  const [modelLoading, setModelLoading] = useState(false);
  const [modelReady, setModelReady] = useState(false);
  const [cameraError, setCameraError] = useState(null);

  // สถิติสด
  const [currentStatus, setCurrentStatus] = useState('off'); // 'eye_contact' | 'looking_down' | 'looking_away' | 'no_face' | 'off'
  const [eyeContactPct, setEyeContactPct] = useState(100);
  const [poseAngles, setPoseAngles] = useState({ pitch: 0, yaw: 0 });

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const animFrameRef = useRef(null);
  const landmarkerRef = useRef(null);

  // ตัวนับสถิติสะสม
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

      // เริ่มสตรีมกล้อง
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
        audio: false,
      });
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      // โหลดโมเดล MediaPipe
      const landmarker = await getFaceLandmarker();
      landmarkerRef.current = landmarker;
      setModelReady(true);
      setModelLoading(false);
      setCameraActive(true);
      setCurrentStatus('no_face');
    } catch (err) {
      console.error('[FaceLandmarker] startCamera error:', err);
      setCameraError(err.name === 'NotAllowedError' ? 'โปรดอนุญาตให้เข้าถึงกล้อง' : err.message);
      setModelLoading(false);
      setCameraActive(false);
    }
  }, []);

  // 2. ปิดกล้องเว็บแคม
  const stopCamera = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
    setCurrentStatus('off');
  }, []);

  // 3. เริ่มวิเคราะห์ลูปเฟรม (เรียกเมื่อเริ่มซ้อมพูด)
  const startTracking = useCallback(() => {
    totalFramesRef.current = 0;
    eyeContactFramesRef.current = 0;
    lookingDownFramesRef.current = 0;
    inLookDownRef.current = false;
    lookDownCountRef.current = 0;
    lookDownStartTimeRef.current = null;
    lookDownTotalSecRef.current = 0;
    setEyeContactPct(100);

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

          totalFramesRef.current += 1;
          const deltaSec = (now - lastCheckTime) / 1000;
          lastCheckTime = now;

          if (results && results.faceLandmarks && results.faceLandmarks.length > 0) {
            // ดึง Blendshapes (การมองของสายตา)
            const blendshapes = results.faceBlendshapes?.[0]?.categories || [];
            const getScore = (name) => blendshapes.find((c) => c.categoryName === name)?.score || 0;

            const lookDownScore = (getScore('eyeLookDownLeft') + getScore('eyeLookDownRight')) / 2;
            const lookOutScore = Math.max(
              getScore('eyeLookOutLeft'),
              getScore('eyeLookOutRight'),
              getScore('eyeLookInLeft'),
              getScore('eyeLookInRight')
            );

            // คำนวณ Head Pose จาก Facial Transformation Matrix (ถ้ามี)
            let pitch = 0;
            let yaw = 0;
            if (results.facialTransformationMatrixes?.[0]?.data) {
              const m = results.facialTransformationMatrixes[0].data;
              // Pitch (ก้ม/เงย)
              pitch = Math.atan2(m[6], m[10]) * (180 / Math.PI);
              // Yaw (หันซ้าย/ขวา)
              yaw = Math.atan2(-m[2], Math.sqrt(m[0] * m[0] + m[1] * m[1])) * (180 / Math.PI);
              setPoseAngles({ pitch: Math.round(pitch), yaw: Math.round(yaw) });
            }

            // กติกาการตัดสิน:
            // 1. ก้มอ่านโพย: ก้มหน้า pitch < -10 องศา หรือ สายตามองต่ำ lookDownScore > 0.35
            const isLookingDown = pitch < -10 || lookDownScore > 0.35;
            // 2. หันมองสไลด์/มองออกข้างนอก: หันหน้า |yaw| > 18 องศา หรือ ตากลอกออกข้าง lookOutScore > 0.4
            const isLookingAway = Math.abs(yaw) > 18 || lookOutScore > 0.4;

            if (isLookingDown) {
              setCurrentStatus('looking_down');
              lookingDownFramesRef.current += 1;

              if (!inLookDownRef.current) {
                inLookDownRef.current = true;
                lookDownStartTimeRef.current = now;
              } else {
                const dur = (now - lookDownStartTimeRef.current) / 1000;
                // ถ้าก้มค้างเกิน 1.5 วินาที นับเป็น 1 ครั้งที่ก้มอ่านโพย
                if (dur >= 1.5 && lookDownStartTimeRef.current !== null) {
                  lookDownCountRef.current += 1;
                  lookDownStartTimeRef.current = null; // นับครั้งแล้ว
                }
              }
              lookDownTotalSecRef.current += deltaSec;
            } else if (isLookingAway) {
              setCurrentStatus('looking_away');
              inLookDownRef.current = false;
              lookDownStartTimeRef.current = null;
            } else {
              // กำลังสบตาผู้ฟัง/มองกล้องตรงๆ
              setCurrentStatus('eye_contact');
              eyeContactFramesRef.current += 1;
              inLookDownRef.current = false;
              lookDownStartTimeRef.current = null;
            }

            // คำนวณ Eye Contact % สะสม
            const pct = Math.round((eyeContactFramesRef.current / totalFramesRef.current) * 100);
            setEyeContactPct(pct);
          } else {
            setCurrentStatus('no_face');
          }
        }
      }

      animFrameRef.current = requestAnimationFrame(loop);
    };

    animFrameRef.current = requestAnimationFrame(loop);
  }, []);

  // 4. สรุปผลการวิเคราะห์เมื่อหยุดซ้อม
  const stopTracking = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }

    const total = totalFramesRef.current || 1;
    const finalEyeContact = Math.round((eyeContactFramesRef.current / total) * 100);

    return {
      cameraUsed: cameraActive,
      eyeContactPct: cameraActive ? finalEyeContact : null,
      lookingDownCount: cameraActive ? lookDownCountRef.current : 0,
      lookingDownSec: cameraActive ? Math.round(lookDownTotalSecRef.current * 10) / 10 : 0,
    };
  }, [cameraActive]);

  // คลีนอัพเมื่อปิด Component
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
