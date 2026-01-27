/**
 * FitPlus Pose Engine - MediaPipe 기반 포즈 감지
 * Google MediaPipe Pose를 활용한 클라이언트 사이드 AI 처리
 */

// MediaPipe Pose 랜드마크 인덱스
const LANDMARKS = {
  NOSE: 0,
  LEFT_EYE_INNER: 1,
  LEFT_EYE: 2,
  LEFT_EYE_OUTER: 3,
  RIGHT_EYE_INNER: 4,
  RIGHT_EYE: 5,
  RIGHT_EYE_OUTER: 6,
  LEFT_EAR: 7,
  RIGHT_EAR: 8,
  MOUTH_LEFT: 9,
  MOUTH_RIGHT: 10,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_PINKY: 17,
  RIGHT_PINKY: 18,
  LEFT_INDEX: 19,
  RIGHT_INDEX: 20,
  LEFT_THUMB: 21,
  RIGHT_THUMB: 22,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
  LEFT_HEEL: 29,
  RIGHT_HEEL: 30,
  LEFT_FOOT_INDEX: 31,
  RIGHT_FOOT_INDEX: 32
};

class PoseEngine {
  constructor(options = {}) {
    this.pose = null;
    this.isInitialized = false;
    this.isRunning = false;
    this.lastResults = null;
    
    // 콜백
    this.onPoseDetected = null;
    this.onError = null;

    // One Euro Filter 스무딩 (기본 활성화)
    this.useOneEuroFilter = options.useOneEuroFilter ?? true;
    this.landmarkSmoother = null;
    this.worldLandmarkSmoother = null;
    
    // 필터 설정 (SMOOTHER_PRESETS 참조)
    this.smootherConfig = options.smootherConfig || {
      minCutoff: 1.0,  // 낮을수록 부드러움
      beta: 0.5,       // 높을수록 빠른 움직임에 반응
      dCutoff: 1.0
    };
  }

  /**
   * MediaPipe Pose 초기화
   */
  async initialize() {
    try {
      // MediaPipe Pose 로드
      this.pose = new Pose({
        locateFile: (file) => {
          return `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`;
        }
      });

      // 설정
      this.pose.setOptions({
        modelComplexity: 1,           // 0: Lite, 1: Full, 2: Heavy
        smoothLandmarks: !this.useOneEuroFilter,  // One Euro Filter 사용 시 내장 스무딩 비활성화
        enableSegmentation: false,     // 배경 세그멘테이션 (사용안함)
        smoothSegmentation: false,
        minDetectionConfidence: 0.5,   // 최소 감지 신뢰도
        minTrackingConfidence: 0.5     // 최소 추적 신뢰도
      });

      // One Euro Filter 초기화
      if (this.useOneEuroFilter && typeof LandmarkSmoother !== 'undefined') {
        this.landmarkSmoother = new LandmarkSmoother(this.smootherConfig);
        this.worldLandmarkSmoother = new LandmarkSmoother(this.smootherConfig);
        console.log('[PoseEngine] One Euro Filter 활성화:', this.smootherConfig);
      }

      // 결과 콜백 설정
      this.pose.onResults((results) => this.handleResults(results));

      this.isInitialized = true;
      console.log('[PoseEngine] MediaPipe Pose 초기화 완료');
      return true;
    } catch (error) {
      console.error('[PoseEngine] 초기화 실패:', error);
      if (this.onError) this.onError(error);
      return false;
    }
  }

  /**
   * 비디오 프레임 전송
   */
  async send(videoElement) {
    if (!this.isInitialized || !this.isRunning) return;
    
    try {
      await this.pose.send({ image: videoElement });
    } catch (error) {
      console.error('[PoseEngine] 프레임 전송 실패:', error);
    }
  }

  /**
   * 포즈 감지 결과 처리
   */
  handleResults(results) {
    this.lastResults = results;

    if (!results.poseLandmarks) {
      return;
    }

    const timestamp = performance.now();

    // 정규화된 랜드마크 (0~1 범위) - One Euro Filter 적용
    let landmarks = results.poseLandmarks;
    if (this.landmarkSmoother) {
      landmarks = this.landmarkSmoother.filter(timestamp, landmarks);
    }
    
    // 월드 좌표 랜드마크 (미터 단위) - One Euro Filter 적용
    let worldLandmarks = results.poseWorldLandmarks;
    if (this.worldLandmarkSmoother && worldLandmarks) {
      worldLandmarks = this.worldLandmarkSmoother.filter(timestamp, worldLandmarks);
    }

    // 관절 각도 계산 (필터링된 랜드마크 사용)
    const angles = this.calculateAllAngles(landmarks);

    // 콜백 호출
    if (this.onPoseDetected) {
      this.onPoseDetected({
        landmarks,
        worldLandmarks,
        angles,
        timestamp
      });
    }
  }

  /**
   * 모든 주요 관절 각도 계산
   */
  calculateAllAngles(landmarks) {
    return {
      // 무릎 각도 (서있을 때 ~180도, 스쿼트 시 ~90도)
      leftKnee: this.getAngle(
        landmarks[LANDMARKS.LEFT_HIP],
        landmarks[LANDMARKS.LEFT_KNEE],
        landmarks[LANDMARKS.LEFT_ANKLE]
      ),
      rightKnee: this.getAngle(
        landmarks[LANDMARKS.RIGHT_HIP],
        landmarks[LANDMARKS.RIGHT_KNEE],
        landmarks[LANDMARKS.RIGHT_ANKLE]
      ),

      // 팔꿈치 각도 (팔 폈을 때 ~180도, 굽힐 때 ~45도)
      leftElbow: this.getAngle(
        landmarks[LANDMARKS.LEFT_SHOULDER],
        landmarks[LANDMARKS.LEFT_ELBOW],
        landmarks[LANDMARKS.LEFT_WRIST]
      ),
      rightElbow: this.getAngle(
        landmarks[LANDMARKS.RIGHT_SHOULDER],
        landmarks[LANDMARKS.RIGHT_ELBOW],
        landmarks[LANDMARKS.RIGHT_WRIST]
      ),

      // 엉덩이 각도 (서있을 때 ~180도, 굽힐 때 감소)
      leftHip: this.getAngle(
        landmarks[LANDMARKS.LEFT_SHOULDER],
        landmarks[LANDMARKS.LEFT_HIP],
        landmarks[LANDMARKS.LEFT_KNEE]
      ),
      rightHip: this.getAngle(
        landmarks[LANDMARKS.RIGHT_SHOULDER],
        landmarks[LANDMARKS.RIGHT_HIP],
        landmarks[LANDMARKS.RIGHT_KNEE]
      ),

      // 어깨 각도 (팔 내렸을 때 ~0도, 올렸을 때 ~180도)
      leftShoulder: this.getAngle(
        landmarks[LANDMARKS.LEFT_HIP],
        landmarks[LANDMARKS.LEFT_SHOULDER],
        landmarks[LANDMARKS.LEFT_ELBOW]
      ),
      rightShoulder: this.getAngle(
        landmarks[LANDMARKS.RIGHT_HIP],
        landmarks[LANDMARKS.RIGHT_SHOULDER],
        landmarks[LANDMARKS.RIGHT_ELBOW]
      ),

      // 척추 각도 (상체 기울기)
      spine: this.getSpineAngle(landmarks),

      // 무릎 정렬 (무릎이 발끝을 넘는지)
      kneeAlignment: this.getKneeAlignment(landmarks)
    };
  }

  /**
   * 세 점 사이의 각도 계산 (도 단위)
   */
  getAngle(p1, p2, p3) {
    if (!p1 || !p2 || !p3) return null;

    const radians = Math.atan2(p3.y - p2.y, p3.x - p2.x) - 
                    Math.atan2(p1.y - p2.y, p1.x - p2.x);
    let degrees = Math.abs(radians * 180 / Math.PI);
    
    if (degrees > 180) {
      degrees = 360 - degrees;
    }
    
    return Math.round(degrees);
  }

  /**
   * 척추(상체) 기울기 각도 계산
   */
  getSpineAngle(landmarks) {
    const shoulderMid = {
      x: (landmarks[LANDMARKS.LEFT_SHOULDER].x + landmarks[LANDMARKS.RIGHT_SHOULDER].x) / 2,
      y: (landmarks[LANDMARKS.LEFT_SHOULDER].y + landmarks[LANDMARKS.RIGHT_SHOULDER].y) / 2
    };
    const hipMid = {
      x: (landmarks[LANDMARKS.LEFT_HIP].x + landmarks[LANDMARKS.RIGHT_HIP].x) / 2,
      y: (landmarks[LANDMARKS.LEFT_HIP].y + landmarks[LANDMARKS.RIGHT_HIP].y) / 2
    };

    // 수직선과의 각도 계산
    const dx = shoulderMid.x - hipMid.x;
    const dy = shoulderMid.y - hipMid.y;
    const angle = Math.abs(Math.atan2(dx, -dy) * 180 / Math.PI);

    return Math.round(angle);
  }

  /**
   * 무릎 정렬 체크 (무릎이 발끝보다 앞으로 나왔는지)
   */
  getKneeAlignment(landmarks) {
    const leftDiff = landmarks[LANDMARKS.LEFT_KNEE].x - landmarks[LANDMARKS.LEFT_ANKLE].x;
    const rightDiff = landmarks[LANDMARKS.RIGHT_KNEE].x - landmarks[LANDMARKS.RIGHT_ANKLE].x;

    return {
      left: leftDiff,
      right: rightDiff,
      isAligned: Math.abs(leftDiff) < 0.05 && Math.abs(rightDiff) < 0.05
    };
  }

  /**
   * 캔버스에 포즈 그리기
   */
  drawPose(canvas, results) {
    if (!results || !results.poseLandmarks) return;

    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;

    ctx.clearRect(0, 0, width, height);

    // 연결선 그리기
    this.drawConnections(ctx, results.poseLandmarks, width, height);

    // 랜드마크 점 그리기
    this.drawLandmarks(ctx, results.poseLandmarks, width, height);
  }

  /**
   * 관절 연결선 그리기
   */
  drawConnections(ctx, landmarks, width, height) {
    const connections = [
      // 상체
      [LANDMARKS.LEFT_SHOULDER, LANDMARKS.RIGHT_SHOULDER],
      [LANDMARKS.LEFT_SHOULDER, LANDMARKS.LEFT_ELBOW],
      [LANDMARKS.LEFT_ELBOW, LANDMARKS.LEFT_WRIST],
      [LANDMARKS.RIGHT_SHOULDER, LANDMARKS.RIGHT_ELBOW],
      [LANDMARKS.RIGHT_ELBOW, LANDMARKS.RIGHT_WRIST],
      
      // 몸통
      [LANDMARKS.LEFT_SHOULDER, LANDMARKS.LEFT_HIP],
      [LANDMARKS.RIGHT_SHOULDER, LANDMARKS.RIGHT_HIP],
      [LANDMARKS.LEFT_HIP, LANDMARKS.RIGHT_HIP],
      
      // 하체
      [LANDMARKS.LEFT_HIP, LANDMARKS.LEFT_KNEE],
      [LANDMARKS.LEFT_KNEE, LANDMARKS.LEFT_ANKLE],
      [LANDMARKS.RIGHT_HIP, LANDMARKS.RIGHT_KNEE],
      [LANDMARKS.RIGHT_KNEE, LANDMARKS.RIGHT_ANKLE]
    ];

    ctx.strokeStyle = '#5b6cff';
    ctx.lineWidth = 3;

    connections.forEach(([start, end]) => {
      const p1 = landmarks[start];
      const p2 = landmarks[end];
      
      if (p1.visibility > 0.5 && p2.visibility > 0.5) {
        ctx.beginPath();
        ctx.moveTo(p1.x * width, p1.y * height);
        ctx.lineTo(p2.x * width, p2.y * height);
        ctx.stroke();
      }
    });
  }

  /**
   * 랜드마크 점 그리기
   */
  drawLandmarks(ctx, landmarks, width, height) {
    landmarks.forEach((landmark, index) => {
      if (landmark.visibility > 0.5) {
        ctx.beginPath();
        ctx.arc(landmark.x * width, landmark.y * height, 5, 0, 2 * Math.PI);
        ctx.fillStyle = '#7c54ff';
        ctx.fill();
      }
    });
  }

  /**
   * 시작
   */
  start() {
    this.isRunning = true;
    console.log('[PoseEngine] 포즈 감지 시작');
  }

  /**
   * 정지
   */
  stop() {
    this.isRunning = false;
    console.log('[PoseEngine] 포즈 감지 정지');
  }

  /**
   * 필터 리셋 (새 세션 시작 시)
   */
  resetFilters() {
    if (this.landmarkSmoother) {
      this.landmarkSmoother.reset();
    }
    if (this.worldLandmarkSmoother) {
      this.worldLandmarkSmoother.reset();
    }
    console.log('[PoseEngine] 필터 리셋 완료');
  }

  /**
   * 필터 파라미터 변경
   * @param {string} presetName - 프리셋 이름: 'ULTRA_SMOOTH', 'SMOOTH', 'RESPONSIVE', 'MINIMAL'
   */
  setSmootherPreset(presetName) {
    if (typeof SMOOTHER_PRESETS !== 'undefined' && SMOOTHER_PRESETS[presetName]) {
      const preset = SMOOTHER_PRESETS[presetName];
      if (this.landmarkSmoother) {
        this.landmarkSmoother.setParameters(preset.minCutoff, preset.beta, preset.dCutoff);
      }
      if (this.worldLandmarkSmoother) {
        this.worldLandmarkSmoother.setParameters(preset.minCutoff, preset.beta, preset.dCutoff);
      }
      console.log('[PoseEngine] 스무딩 프리셋 변경:', presetName);
    }
  }

  /**
   * 리소스 정리
   */
  destroy() {
    this.stop();
    if (this.pose) {
      this.pose.close();
      this.pose = null;
    }
    this.isInitialized = false;
  }
}

// 전역 접근 가능하도록 export
window.PoseEngine = PoseEngine;
window.LANDMARKS = LANDMARKS;
