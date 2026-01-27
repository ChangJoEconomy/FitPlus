/**
 * MediaPipe Pose 감지 래퍼
 */
import {
    PoseLandmarker,
    FilesetResolver
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21";

export class PoseDetector {
    constructor() {
        this.poseLandmarker = null;
        this.runningMode = "VIDEO";
        this.lastVideoTime = -1;
    }

    async init() {
        try {
            console.log('Loading MediaPipe FilesetResolver...');
            const vision = await FilesetResolver.forVisionTasks(
                "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm"
            );
            
            console.log('Creating PoseLandmarker...');
            this.poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
                baseOptions: {
                    modelAssetPath: `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task`,
                    delegate: "GPU"
                },
                runningMode: this.runningMode,
                numPoses: 1,
                minPoseDetectionConfidence: 0.5,
                minPosePresenceConfidence: 0.5,
                minTrackingConfidence: 0.5,
                outputPoseWorldLandmarks: true
            });
            
            console.log('PoseLandmarker created successfully');
        } catch (error) {
            console.error('Failed to initialize PoseLandmarker:', error);
            
            // GPU 실패 시 CPU로 재시도
            if (error.message && error.message.includes('GPU')) {
                console.log('Retrying with CPU delegate...');
                const vision = await FilesetResolver.forVisionTasks(
                    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm"
                );
                this.poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
                    baseOptions: {
                        modelAssetPath: `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task`,
                        delegate: "CPU"
                    },
                    runningMode: this.runningMode,
                    numPoses: 1,
                    minPoseDetectionConfidence: 0.5,
                    minPosePresenceConfidence: 0.5,
                    minTrackingConfidence: 0.5,
                    outputPoseWorldLandmarks: true
                });
                console.log('PoseLandmarker created with CPU delegate');
            } else {
                throw error;
            }
        }
    }

    detect(video, callback) {
        if (!this.poseLandmarker) return;
        if (video.readyState < 2) return; // 비디오가 준비되지 않음

        const startTimeMs = performance.now();
        if (this.lastVideoTime !== video.currentTime) {
            this.lastVideoTime = video.currentTime;
            try {
                const result = this.poseLandmarker.detectForVideo(video, startTimeMs);
                // result.landmarks를 반환 (poseLandmarks가 아닌 landmarks)
                callback({
                    landmarks: result.landmarks,
                    worldLandmarks: result.worldLandmarks
                });
            } catch (error) {
                console.error('Pose detection error:', error);
            }
        }
    }
}
