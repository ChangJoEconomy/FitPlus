/**
 * FitPlus Scoring Engine - 실시간 점수 계산
 * DB의 scoring_profile_metric 기반 점수 산출
 */

class ScoringEngine {
  /**
   * @param {Object} scoringProfile - DB에서 가져온 채점 프로파일
   *   - scoring_profile_id
   *   - scoring_profile_metric[] (weight, max_score, rule, metric)
   */
  constructor(scoringProfile) {
    this.profile = scoringProfile;
    this.metrics = scoringProfile?.scoring_profile_metric || [];
    
    // 점수 히스토리 (평균 계산용)
    this.scoreHistory = [];
    this.maxHistoryLength = 30; // 최근 30프레임

    console.log('[ScoringEngine] 초기화:', this.metrics.length, '개 지표');
  }

  /**
   * 현재 포즈에 대한 점수 계산
   * @param {Object} angles - PoseEngine에서 계산된 각도들
   * @returns {Object} { score, breakdown }
   */
  calculate(angles) {
    if (!this.metrics.length || !angles) {
      return { score: 0, breakdown: [] };
    }

    const breakdown = [];
    let totalScore = 0;
    let totalWeight = 0;

    for (const pm of this.metrics) {
      const metric = pm.metric;
      const rule = pm.rule || {};

      // 메트릭 키에 해당하는 실제 값 추출
      const actualValue = this.getMetricValue(angles, metric.key);
      
      if (actualValue === null) {
        continue; // 해당 각도를 계산할 수 없는 경우 스킵
      }

      // 규칙에 따른 점수 계산
      const metricScore = this.evaluateMetric(actualValue, rule, pm.max_score);
      
      breakdown.push({
        metric_id: metric.metric_id,
        key: metric.key,
        title: metric.title,
        unit: metric.unit,
        actualValue,
        score: metricScore,
        maxScore: pm.max_score,
        weight: pm.weight,
        feedback: metricScore < pm.max_score * 0.7 ? 
          this.generateFeedback(metric.key, actualValue, rule) : null
      });

      totalScore += metricScore * pm.weight;
      totalWeight += pm.weight;
    }

    const finalScore = totalWeight > 0 
      ? Math.round(totalScore / totalWeight) 
      : 0;

    // 히스토리에 추가
    this.scoreHistory.push(finalScore);
    if (this.scoreHistory.length > this.maxHistoryLength) {
      this.scoreHistory.shift();
    }

    return {
      score: finalScore,
      breakdown,
      timestamp: Date.now()
    };
  }

  /**
   * 메트릭 키에 해당하는 실제 각도 값 추출
   * DB의 metric.key와 angles 객체를 매핑
   */
  getMetricValue(angles, metricKey) {
    // metric.key와 angles 프로퍼티 매핑
    const keyMapping = {
      // 무릎 관련
      'knee_angle': () => Math.min(angles.leftKnee, angles.rightKnee),
      'left_knee_angle': () => angles.leftKnee,
      'right_knee_angle': () => angles.rightKnee,
      'knee_depth': () => (angles.leftKnee + angles.rightKnee) / 2,
      
      // 엉덩이/힙 관련
      'hip_angle': () => Math.min(angles.leftHip, angles.rightHip),
      'left_hip_angle': () => angles.leftHip,
      'right_hip_angle': () => angles.rightHip,
      'hip_hinge': () => (angles.leftHip + angles.rightHip) / 2,
      
      // 팔꿈치 관련
      'elbow_angle': () => Math.min(angles.leftElbow, angles.rightElbow),
      'left_elbow_angle': () => angles.leftElbow,
      'right_elbow_angle': () => angles.rightElbow,
      
      // 어깨 관련
      'shoulder_angle': () => Math.min(angles.leftShoulder, angles.rightShoulder),
      'left_shoulder_angle': () => angles.leftShoulder,
      'right_shoulder_angle': () => angles.rightShoulder,
      
      // 척추/상체 관련
      'spine_angle': () => angles.spine,
      'torso_angle': () => angles.spine,
      'back_angle': () => angles.spine,
      
      // 정렬 관련
      'knee_alignment': () => angles.kneeAlignment?.isAligned ? 100 : 50,
      'knee_over_toe': () => {
        const avg = (Math.abs(angles.kneeAlignment?.left || 0) + 
                    Math.abs(angles.kneeAlignment?.right || 0)) / 2;
        return Math.max(0, 100 - avg * 500); // 정렬 점수로 변환
      }
    };

    const getter = keyMapping[metricKey];
    if (getter) {
      const value = getter();
      return value !== null && !isNaN(value) ? value : null;
    }

    // 직접 매핑 시도
    if (angles[metricKey] !== undefined) {
      return angles[metricKey];
    }

    console.warn(`[ScoringEngine] 알 수 없는 메트릭 키: ${metricKey}`);
    return null;
  }

  /**
   * 규칙에 따른 점수 평가
   * @param {number} value - 실제 측정값
   * @param {Object} rule - DB의 rule JSON
   *   예: { type: 'range', min: 85, max: 95, optimal: 90 }
   *   예: { type: 'threshold', value: 170, direction: 'gte' }
   * @param {number} maxScore - 최대 점수
   */
  evaluateMetric(value, rule, maxScore) {
    if (!rule || !rule.type) {
      // 규칙이 없으면 기본 점수 부여
      return maxScore * 0.7;
    }

    switch (rule.type) {
      case 'range':
        return this.evaluateRange(value, rule, maxScore);
      
      case 'threshold':
        return this.evaluateThreshold(value, rule, maxScore);
      
      case 'optimal':
        return this.evaluateOptimal(value, rule, maxScore);
      
      case 'boolean':
        return value ? maxScore : 0;
      
      default:
        return maxScore * 0.7;
    }
  }

  /**
   * 범위 기반 평가
   * rule: { type: 'range', min: 85, max: 95, optimal: 90 }
   */
  evaluateRange(value, rule, maxScore) {
    const { min, max, optimal } = rule;

    // 최적값에 가까울수록 높은 점수
    if (optimal !== undefined) {
      const deviation = Math.abs(value - optimal);
      const maxDeviation = Math.max(optimal - min, max - optimal);
      const score = maxScore * (1 - (deviation / maxDeviation));
      return Math.max(0, Math.round(score));
    }

    // 범위 내에 있으면 만점, 벗어나면 감점
    if (value >= min && value <= max) {
      return maxScore;
    } else if (value < min) {
      const deficit = min - value;
      return Math.max(0, maxScore - deficit * 2);
    } else {
      const excess = value - max;
      return Math.max(0, maxScore - excess * 2);
    }
  }

  /**
   * 임계값 기반 평가
   * rule: { type: 'threshold', value: 170, direction: 'gte' }
   */
  evaluateThreshold(value, rule, maxScore) {
    const { value: threshold, direction } = rule;

    switch (direction) {
      case 'gte': // 이상
        return value >= threshold ? maxScore : maxScore * (value / threshold);
      case 'lte': // 이하
        return value <= threshold ? maxScore : maxScore * (threshold / value);
      case 'gt': // 초과
        return value > threshold ? maxScore : maxScore * 0.5;
      case 'lt': // 미만
        return value < threshold ? maxScore : maxScore * 0.5;
      default:
        return maxScore * 0.7;
    }
  }

  /**
   * 최적값 기반 평가
   * rule: { type: 'optimal', value: 90, tolerance: 10 }
   */
  evaluateOptimal(value, rule, maxScore) {
    const { value: optimal, tolerance = 15 } = rule;
    const deviation = Math.abs(value - optimal);

    if (deviation <= tolerance) {
      // 허용 범위 내
      return maxScore;
    } else {
      // 허용 범위 초과 시 점진적 감점
      const excessDeviation = deviation - tolerance;
      const penalty = Math.min(excessDeviation * 2, maxScore);
      return Math.max(0, Math.round(maxScore - penalty));
    }
  }

  /**
   * 피드백 메시지 생성
   */
  generateFeedback(metricKey, value, rule) {
    const feedbackTemplates = {
      'knee_angle': {
        low: '무릎을 더 굽혀주세요',
        high: '무릎을 조금 펴주세요'
      },
      'knee_depth': {
        low: '더 깊이 앉아주세요',
        high: '너무 깊습니다, 조금만 일어나세요'
      },
      'hip_angle': {
        low: '엉덩이를 더 뒤로 빼주세요',
        high: '엉덩이가 너무 뒤에 있어요'
      },
      'spine_angle': {
        low: '등을 더 곧게 펴주세요',
        high: '상체가 너무 뒤로 젖혀졌어요'
      },
      'torso_angle': {
        low: '상체를 세워주세요',
        high: '상체를 너무 세우지 마세요'
      },
      'elbow_angle': {
        low: '팔을 더 굽혀주세요',
        high: '팔을 조금 펴주세요'
      },
      'knee_alignment': {
        default: '무릎이 발끝 방향을 향하도록 해주세요'
      },
      'knee_over_toe': {
        default: '무릎이 발끝을 넘지 않도록 주의하세요'
      }
    };

    const template = feedbackTemplates[metricKey];
    if (!template) {
      return '자세를 확인해주세요';
    }

    if (template.default) {
      return template.default;
    }

    // 값과 규칙을 비교해서 적절한 피드백 선택
    const optimal = rule?.optimal || rule?.value || 90;
    return value < optimal ? template.low : template.high;
  }

  /**
   * 평균 점수 계산
   */
  getAverageScore() {
    if (this.scoreHistory.length === 0) return 0;
    const sum = this.scoreHistory.reduce((a, b) => a + b, 0);
    return Math.round(sum / this.scoreHistory.length);
  }

  /**
   * 세션 종료 시 최종 결과 생성
   * DB의 session_metric_result에 저장할 데이터 형식
   */
  generateSessionResults() {
    // 각 메트릭별 평균 점수 계산을 위한 누적 데이터가 필요
    // 이 메서드는 WorkoutSession에서 호출됨
    return {
      final_score: this.getAverageScore(),
      metric_results: this.metrics.map(pm => ({
        metric_id: pm.metric.metric_id,
        score: Math.round(this.getAverageScore() * (pm.weight || 1)),
        raw: null // 원시 데이터는 별도 저장
      }))
    };
  }

  /**
   * 리셋
   */
  reset() {
    this.scoreHistory = [];
  }
}

// 전역 접근 가능하도록 export
window.ScoringEngine = ScoringEngine;
