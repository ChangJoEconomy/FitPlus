/**
 * FitPlus Rep Counter - 운동 횟수 감지
 * 상태 머신 기반 횟수 카운팅
 */

// 운동별 상태
const REP_STATES = {
  NEUTRAL: 'NEUTRAL',     // 중립 상태 (서있음, 팔 펴짐 등)
  TRANSITION: 'TRANSITION', // 전환 중
  ACTIVE: 'ACTIVE'        // 활성 상태 (스쿼트, 푸시업 다운 등)
};

class RepCounter {
  /**
   * @param {string} exerciseCode - 운동 코드 (squat, pushup, lunge 등)
   */
  constructor(exerciseCode) {
    this.exerciseCode = (exerciseCode || '').toString();
    this.pattern = this.getExercisePattern(this.exerciseCode);

    // 상태
    this.currentState = REP_STATES.NEUTRAL;
    this.repCount = 0;
    this.lastRepTime = performance.now(); // 마지막 rep 종료 시각 (ms)
    this.stateHistory = [];
    this.maxHistoryLength = 10;

    // 횟수별 기록
    this.repRecords = [];

    // 현재 rep 상태/점수 누적
    this.repStartTime = null;
    this.hadActive = false;
    this.activeStateEnterTime = null;
    this.activeTimeMs = 0;
    this.currentRepScores = [];     // ACTIVE 구간 점수
    this.currentRepAllScores = [];  // TRANSITION+ACTIVE 점수 (fallback)
    this.lastCompletedRepScore = 0;

    // 콜백
    this.onRepComplete = null;

    console.log('[RepCounter] 초기화:', exerciseCode);
  }

  /**
   * 운동별 패턴 정의
   * 각 운동의 상태 전이 규칙 정의
   */
  getExercisePattern(code) {
    const normalized = (code || '')
      .toString()
      .trim()
      .toLowerCase()
      .replace(/-/g, '_');

    const aliases = {
      pushup: 'push_up'
    };
    const key = aliases[normalized] || normalized;

    const patterns = {
      // 스쿼트: 서있음 → 앉음 → 서있음 = 1회
      'squat': {
        primaryAngle: 'knee_angle',
        thresholds: {
          neutral: 160,    // 서있을 때 무릎 각도
          active: 100      // 스쿼트 시 무릎 각도
        },
        direction: 'decrease', // 각도가 감소하면 active
        minDuration: 800,      // 최소 동작 시간 (ms)
        minActiveTime: 200     // 최소 active 유지 시간 (ms)
      },

      // 푸시업: 팔 펴짐 → 굽힘 → 펴짐 = 1회
      'push_up': {
        primaryAngle: 'elbow_angle',
        thresholds: {
          neutral: 160,
          active: 90
        },
        direction: 'decrease',
        minDuration: 600,
        minActiveTime: 150
      },

      // 런지: 서있음 → 런지 → 서있음 = 1회
      'lunge': {
        primaryAngle: 'knee_angle', // 앞쪽 무릎
        thresholds: {
          neutral: 160,
          active: 100
        },
        direction: 'decrease',
        minDuration: 1000,
        minActiveTime: 200
      },

      // 플랭크: 시간 기반 (횟수 X)
      'plank': {
        isTimeBased: true,
        primaryAngle: 'spine_angle',
        thresholds: {
          maintain: 15  // 척추가 15도 이내 유지
        }
      },

      // 버피: 복합 동작
      'burpee': {
        primaryAngle: 'hip_angle',
        secondaryAngle: 'knee_angle',
        thresholds: {
          neutral: 160,
          active: 90
        },
        direction: 'decrease',
        minDuration: 1500,
        minActiveTime: 300
      },

      // 데드리프트: 힙 힌지
      'deadlift': {
        primaryAngle: 'hip_angle',
        thresholds: {
          neutral: 170,
          active: 100
        },
        direction: 'decrease',
        minDuration: 1200,
        minActiveTime: 200
      },

      // 숄더프레스: 어깨 각도
      'shoulder_press': {
        primaryAngle: 'shoulder_angle',
        thresholds: {
          neutral: 30,   // 팔 내린 상태
          active: 160    // 팔 올린 상태
        },
        direction: 'increase',
        minDuration: 800,
        minActiveTime: 150
      },

      // 바이셉 컬
      'bicep_curl': {
        primaryAngle: 'elbow_angle',
        thresholds: {
          neutral: 160,
          active: 45
        },
        direction: 'decrease',
        minDuration: 600,
        minActiveTime: 150
      }
    };

    // 기본 패턴 (스쿼트 기반)
    return patterns[key] || patterns['squat'];
  }

  /**
   * 각 프레임에서 호출
   * @param {Object} angles - PoseEngine에서 계산된 각도
   * @param {number} currentScore - 현재 프레임의 점수
   */
  update(angles, currentScore = 0) {
    if (this.pattern.isTimeBased) {
      return this.updateTimeBased(angles);
    }

    const primaryAngle = this.getAngleValue(angles, this.pattern.primaryAngle);
    if (primaryAngle === null) return null;

    const now = performance.now();
    const prevState = this.currentState;

    // 현재 상태 판단
    const newState = this.detectState(primaryAngle);

    // 상태 전이 기록
    if (newState !== prevState) {
      this.stateHistory.push({
        from: prevState,
        to: newState,
        angle: primaryAngle,
        timestamp: now
      });

      if (this.stateHistory.length > this.maxHistoryLength) {
        this.stateHistory.shift();
      }
    }

    this.currentState = newState;

    // rep 시작 감지 (NEUTRAL -> 비NEUTRAL)
    if (prevState === REP_STATES.NEUTRAL && newState !== REP_STATES.NEUTRAL) {
      this.repStartTime = now;
      this.hadActive = false;
      this.activeStateEnterTime = null;
      this.activeTimeMs = 0;
      this.currentRepScores = [];
      this.currentRepAllScores = [];
    }

    // ACTIVE 체류 시간 누적
    if (prevState !== REP_STATES.ACTIVE && newState === REP_STATES.ACTIVE) {
      this.hadActive = true;
      this.activeStateEnterTime = now;
    } else if (prevState === REP_STATES.ACTIVE && newState !== REP_STATES.ACTIVE) {
      if (this.activeStateEnterTime != null) {
        this.activeTimeMs += (now - this.activeStateEnterTime);
        this.activeStateEnterTime = null;
      }
    }

    // 점수 버퍼링: TRANSITION/ACTIVE는 기록하되, rep 점수는 ACTIVE만 반영
    if (this.repStartTime != null && newState !== REP_STATES.NEUTRAL) {
      this.currentRepAllScores.push(currentScore);
      if (newState === REP_STATES.ACTIVE) {
        this.currentRepScores.push(currentScore);
      }
    }

    // 횟수 완료 체크
    const repCompleted = this.checkRepCompletion(now);

    if (repCompleted) {
      return this.completeRep(now);
    }

    return null;
  }

  /**
   * 현재 각도로 상태 판단
   */
  detectState(angle) {
    const { thresholds, direction } = this.pattern;
    const midPoint = (thresholds.neutral + thresholds.active) / 2;

    if (direction === 'decrease') {
      // 각도가 감소하면 active (스쿼트, 푸시업 등)
      if (angle >= thresholds.neutral - 10) {
        return REP_STATES.NEUTRAL;
      } else if (angle <= thresholds.active + 10) {
        return REP_STATES.ACTIVE;
      } else {
        return REP_STATES.TRANSITION;
      }
    } else {
      // 각도가 증가하면 active (숄더 프레스 등)
      if (angle <= thresholds.neutral + 10) {
        return REP_STATES.NEUTRAL;
      } else if (angle >= thresholds.active - 10) {
        return REP_STATES.ACTIVE;
      } else {
        return REP_STATES.TRANSITION;
      }
    }
  }

  /**
   * 횟수 완료 여부 체크
   * 패턴: NEUTRAL → ACTIVE → NEUTRAL
   */
  checkRepCompletion(now) {
    if (this.repStartTime == null) return false;

    // ACTIVE 상태가 끝나지 않은 채로 NEUTRAL로 들어온 경우, activeTimeMs 보정
    if (this.currentState === REP_STATES.NEUTRAL && this.activeStateEnterTime != null) {
      this.activeTimeMs += (now - this.activeStateEnterTime);
      this.activeStateEnterTime = null;
    }

    // ACTIVE 없이 다시 NEUTRAL로 돌아오면 rep 취소
    if (this.currentState === REP_STATES.NEUTRAL && !this.hadActive) {
      this.repStartTime = null;
      this.currentRepScores = [];
      this.currentRepAllScores = [];
      this.activeTimeMs = 0;
      return false;
    }

    if (this.currentState !== REP_STATES.NEUTRAL || !this.hadActive) return false;

    const repDuration = now - this.repStartTime;
    if (repDuration < (this.pattern.minDuration || 0)) return false;

    const minActiveTime = this.pattern.minActiveTime || 0;
    if (this.activeTimeMs < minActiveTime) return false;

    return true;
  }

  /**
   * 횟수 완료 처리
   */
  completeRep(now) {
    this.repCount++;
    const duration = this.repStartTime != null ? (now - this.repStartTime) : (now - this.lastRepTime);
    this.lastRepTime = now;

    // 이번 동작의 점수 계산: ACTIVE 구간 점수 우선, 없으면 전체 구간 fallback
    const scoreSamples = this.currentRepScores.length > 0 ? this.currentRepScores : this.currentRepAllScores;
    const repScore = this.aggregateScores(scoreSamples);
    this.lastCompletedRepScore = repScore;

    const repRecord = {
      repNumber: this.repCount,
      score: repScore,
      duration: Math.round(duration),
      timestamp: Date.now()
    };

    this.repRecords.push(repRecord);

    // 상태 리셋
    this.stateHistory = [];
    this.repStartTime = null;
    this.hadActive = false;
    this.activeStateEnterTime = null;
    this.activeTimeMs = 0;
    this.currentRepScores = [];
    this.currentRepAllScores = [];

    // 콜백 호출
    if (this.onRepComplete) {
      this.onRepComplete(repRecord);
    }

    console.log(`[RepCounter] 횟수 완료: ${this.repCount}회, 점수: ${repScore}`);

    return repRecord;
  }

  /**
   * 현재 rep 진행 중인지 여부
   */
  isInProgress() {
    if (this.pattern.isTimeBased) return false;
    return this.repStartTime != null;
  }

  /**
   * 현재 rep 점수(진행 중이면 누적, 아니면 직전 rep 점수)
   */
  getCurrentRepScore() {
    if (this.pattern.isTimeBased) return 0;
    if (!this.isInProgress()) return this.lastCompletedRepScore || 0;

    const scoreSamples = this.currentRepScores.length > 0 ? this.currentRepScores : this.currentRepAllScores;
    return this.aggregateScores(scoreSamples);
  }

  /**
   * 점수 샘플을 안정적으로 집계 (trimmed mean)
   */
  aggregateScores(scores) {
    if (!scores || scores.length === 0) return 0;
    const sorted = scores
      .filter(s => typeof s === 'number' && !Number.isNaN(s))
      .slice()
      .sort((a, b) => a - b);
    if (sorted.length === 0) return 0;

    const trimCount = Math.floor(sorted.length * 0.1);
    const trimmed = sorted.length >= 10 ? sorted.slice(trimCount, sorted.length - trimCount) : sorted;
    const sum = trimmed.reduce((a, b) => a + b, 0);
    return Math.round(sum / trimmed.length);
  }

  /**
   * 시간 기반 운동 (플랭크 등)
   */
  updateTimeBased(angles) {
    // 플랭크 등 자세 유지 운동은 시간으로 측정
    // 여기서는 자세 유지 여부만 반환
    const spineAngle = angles.spine || 0;
    const isHolding = spineAngle <= this.pattern.thresholds.maintain;

    return {
      isHolding,
      angle: spineAngle
    };
  }

  /**
   * 각도 값 추출
   */
  getAngleValue(angles, key) {
    const mapping = {
      'knee_angle': () => Math.min(angles.leftKnee || 180, angles.rightKnee || 180),
      'elbow_angle': () => Math.min(angles.leftElbow || 180, angles.rightElbow || 180),
      'hip_angle': () => Math.min(angles.leftHip || 180, angles.rightHip || 180),
      'shoulder_angle': () => Math.max(angles.leftShoulder || 0, angles.rightShoulder || 0),
      'spine_angle': () => angles.spine || 0
    };

    const getter = mapping[key];
    return getter ? getter() : null;
  }

  /**
   * 현재 횟수 반환
   */
  getCount() {
    return this.repCount;
  }

  /**
   * 세션 결과용 데이터 반환
   */
  getRecords() {
    return this.repRecords;
  }

  /**
   * 리셋
   */
  reset() {
    this.currentState = REP_STATES.NEUTRAL;
    this.repCount = 0;
    this.lastRepTime = performance.now();
    this.stateHistory = [];
    this.repRecords = [];
    this.repStartTime = null;
    this.hadActive = false;
    this.activeStateEnterTime = null;
    this.activeTimeMs = 0;
    this.currentRepScores = [];
    this.currentRepAllScores = [];
    this.lastCompletedRepScore = 0;
  }
}

// 전역 접근 가능하도록 export
window.RepCounter = RepCounter;
window.REP_STATES = REP_STATES;
