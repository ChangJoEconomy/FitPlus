# FitPlus 실시간 점수 계산 시스템

이 문서는 FitPlus에서 운동 중 실시간으로 점수를 계산하고 피드백을 제공하는 방식을 설명합니다.

---

## 1. 개요

### 1.1 설계 철학

- **백엔드 중심**: 점수 계산 로직과 규칙을 서버에서 관리하여 정책 변경이 용이
- **Rep 단위 평가**: 1회 동작(Rep) 동안의 데이터를 누적하여 평가 (프레임 단위 노이즈 완화)
- **실시간 피드백**: Rep 완료 즉시 점수와 피드백을 반환

### 1.2 아키텍처

```
┌──────────────────────────────────────────────────────────────────┐
│                        클라이언트 (브라우저)                       │
├──────────────────────────────────────────────────────────────────┤
│  ┌────────────┐    ┌────────────┐    ┌────────────────────────┐  │
│  │PoseDetector│───▶│ RepCounter │───▶│   ExerciseScorer       │  │
│  │ (MediaPipe)│    │            │    │                        │  │
│  └────────────┘    └────────────┘    │ - metrics 누적         │  │
│        │                  │          │ - features 생성        │  │
│        ▼                  ▼          │ - 백엔드 API 호출      │  │
│   [landmarks]        [rep_event]     └────────────────────────┘  │
│        │                  │                      │               │
│        ▼                  │                      ▼               │
│   [metrics]               │          POST /api/workout/session   │
│   - knee_angle            │               /:sessionId/rep        │
│   - hip_angle             │                      │               │
│   - torso_angle           │                      │               │
│   - phase                 │                      │               │
└───────────────────────────┼──────────────────────┼───────────────┘
                            │                      │
                            ▼                      ▼
┌──────────────────────────────────────────────────────────────────┐
│                          백엔드 (Node.js)                         │
├──────────────────────────────────────────────────────────────────┤
│  1. scoring_profile 조회 (DB)                                    │
│  2. features → 컴포넌트별 점수 계산                               │
│  3. 가중 평균으로 총점 산출                                       │
│  4. 피드백 메시지 생성                                            │
│  5. session_event, session_metric_result 저장                    │
└──────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│                           응답                                    │
│  { total: 85, components: [...], feedback: { type, message } }   │
└──────────────────────────────────────────────────────────────────┘
```

---

## 2. 점수 계산 흐름

### 2.1 Phase 1: 클라이언트 - Metrics 수집

MediaPipe로 매 프레임 랜드마크를 추출하고, 운동별 metrics를 계산합니다.

```javascript
// poseDetector.js에서 매 프레임
const landmarks = await poseLandmarker.detect(videoFrame);

// poseUtils.js에서 metrics 계산
const metrics = computeSideSquatMetrics(landmarks);
// {
//   phase: "bottom",        // 현재 동작 단계
//   knee_angle: 92.5,       // 무릎 각도
//   hip_angle: 85.3,        // 엉덩이 각도
//   torso_angle_rel: 15.2,  // 상체 기울기
//   knee_forward_ratio: 0.03 // 무릎 전진 비율
// }
```

### 2.2 Phase 2: 클라이언트 - Rep 카운팅

`RepCounter`가 phase 변화를 감지하여 1회 동작 완료를 판정합니다.

```javascript
// repCounter.js
const repEvent = updateRepCounter('side_squat', metrics, repState, timestampMs);
// Rep 완료 시:
// { repIndex: 3, repIntervalMs: 1520 }
```

**Rep 판정 로직 (side_squat 예시):**
```
standing → mid → bottom → mid → standing = 1 Rep 완료
```

### 2.3 Phase 3: 클라이언트 - Features 생성

`ExerciseScorer`가 Rep 구간 동안 metrics를 누적하고, Rep 완료 시 대표값(features)을 생성합니다.

```javascript
// scoring.js
const scorer = new ExerciseScorer('side_squat', { sessionId, scoringProfileId });

// 매 프레임 호출
const features = scorer.updateRepFeatures(metrics, repState, repEvent);

// Rep 완료 시 features 반환:
// {
//   version: "v1",
//   components: [
//     { key: "depth", value: 92.1, agg: "p05", status: "ok" },
//     { key: "hip_hinge", value: 128.5, agg: "p05", status: "ok" },
//     { key: "torso_lean", value: 18.3, agg: "p95", status: "ok" },
//     { key: "knee_forward", value: 0.045, agg: "p95", status: "ok" }
//   ]
// }
```

**대표값(Aggregation) 종류:**

| agg | 설명 | 용도 |
|-----|------|------|
| `p05` | 하위 5% 분위수 | 최솟값 대체 (outlier 완화) |
| `p95` | 상위 5% 분위수 | 최댓값 대체 (outlier 완화) |
| `min` | 최솟값 | 가장 낮은 순간 |
| `max` | 최댓값 | 가장 높은 순간 |
| `mean` | 평균 | 전체 평균 |
| `last` | 마지막 값 | Rep 완료 시점 값 (템포 등) |

### 2.4 Phase 4: 백엔드 - 점수 계산

클라이언트가 features를 백엔드로 전송하면, DB의 `scoring_profile`을 기반으로 점수를 계산합니다.

#### API 요청
```http
POST /api/workout/session/:sessionId/rep
Content-Type: application/json

{
  "rep_index": 3,
  "rep_interval_ms": 1520,
  "features": {
    "version": "v1",
    "components": [
      { "key": "depth", "value": 92.1, "agg": "p05", "status": "ok" },
      { "key": "hip_hinge", "value": 128.5, "agg": "p05", "status": "ok" },
      ...
    ]
  }
}
```

#### 점수 계산 로직

```javascript
// services/scoring.js

// 1. DB에서 scoring_profile 조회
const profile = await getScoringProfile(scoringProfileId);
// profile.scoring_profile_metric = [
//   { metric: { key: "depth" }, weight: 0.35, rule: {...} },
//   { metric: { key: "hip_hinge" }, weight: 0.25, rule: {...} },
//   ...
// ]

// 2. 각 컴포넌트 점수 계산
for (const pm of profile.scoring_profile_metric) {
    const value = features.components.find(c => c.key === pm.metric.key)?.value;
    const { score, status } = scoreComponent(pm.rule, value);
    // score: 0~100
}

// 3. 가중 평균으로 총점 계산
total = Σ(weight × score) / Σ(weight)
```

---

## 3. 점수화 규칙 (Scoring Rules)

### 3.1 DB 스키마

```sql
-- scoring_profile_metric.rule (JSONB)
{
  "kind": "range",           -- 점수화 방식
  "agg": "p05",              -- 대표값 집계 방식
  "ideal": [80.0, 110.0],    -- 100점 구간
  "hard": [70.0, 150.0],     -- 0점 경계
  "phases": ["mid", "bottom"] -- 평가 대상 phase (null이면 전체)
}
```

### 3.2 점수화 방식 (kind)

#### A) `range` - 범위형 (범위 안이 최고)

무릎 깊이, 템포 등 "적정 범위"가 있는 지표에 사용

```
         0점        선형 증가      100점       선형 감소       0점
    ◀────────▶◀──────────────▶◀────────────▶◀──────────────▶◀────────▶
   hard_min                ideal_min    ideal_max               hard_max
```

```javascript
// 예: 무릎 깊이 (knee_angle)
// ideal: [80, 110], hard: [70, 150]

if (80 <= value <= 110) score = 100;      // 이상적 범위
else if (value < 80)                       // 너무 깊음
    score = 100 * (value - 70) / (80 - 70);
else if (value > 110)                      // 너무 얕음
    score = 100 * (150 - value) / (150 - 110);
```

#### B) `max` - 최대형 (작을수록 좋음)

상체 기울기, 무릎 전진 등 "작을수록 좋은" 지표에 사용

```
      100점           선형 감소           0점
◀─────────────────▶◀──────────────────▶◀────────▶
                ideal_max            hard_max
```

```javascript
// 예: 상체 기울기 (torso_angle_rel)
// ideal: [0, 25], hard: [0, 45]

if (value <= 25) score = 100;
else if (value >= 45) score = 0;
else score = 100 * (45 - value) / (45 - 25);
```

#### C) `min` - 최소형 (클수록 좋음)

몸통 일직선 각도 등 "클수록 좋은" 지표에 사용

```
      0점            선형 증가          100점
◀─────────────────▶◀──────────────────▶◀────────▶
   hard_min                         ideal_min
```

### 3.3 가중치 적용

```javascript
// side_squat 예시
const weights = {
    depth: 0.35,        // 35%
    hip_hinge: 0.25,    // 25%
    torso_lean: 0.25,   // 25%
    knee_forward: 0.15  // 15%
};

// 총점 = (0.35×depth_score + 0.25×hip_score + ...) / (0.35 + 0.25 + ...)
```

### 3.4 Missing 값 처리

- 값이 `null`인 컴포넌트는 **가중치에서 제외**
- 최소 커버리지 미달 시 Rep 점수를 `null`로 처리 가능

---

## 4. 피드백 생성

### 4.1 컴포넌트별 피드백

점수 status에 따라 구체적인 피드백 메시지를 생성합니다.

| status | 의미 | 예시 피드백 |
|--------|------|------------|
| `ok` | 이상적 | "좋은 스쿼트 깊이입니다!" |
| `low` | 약간 부족 | "조금 더 깊이 앉아주세요." |
| `too_low` | 매우 부족 | "스쿼트 깊이가 부족합니다." |
| `high` | 약간 과함 | "조금 더 얕게 앉아도 됩니다." |
| `too_high` | 매우 과함 | "무릎을 너무 깊이 구부렸습니다." |

### 4.2 요약 피드백

가장 점수가 낮은 컴포넌트를 기반으로 요약 피드백을 생성합니다.

```javascript
// 응답 예시
{
  "feedback": {
    "type": "warning",  // success | info | warning
    "message": "상체가 너무 앞으로 기울어졌습니다. 등을 더 세워주세요."
  }
}
```

---

## 5. API 응답 예시

### 5.1 Rep 이벤트 응답

```json
{
  "success": true,
  "event_id": "uuid-...",
  "rep_index": 3,
  "score": {
    "version": "v1",
    "total": 85,
    "components": [
      {
        "metric_id": "uuid-...",
        "key": "depth",
        "label": "무릎 깊이",
        "value": 92.1,
        "raw_score": 100,
        "score": 100,
        "max_score": 100,
        "weight": 0.35,
        "status": "ok",
        "feedback": "좋은 스쿼트 깊이입니다!"
      },
      {
        "metric_id": "uuid-...",
        "key": "torso_lean",
        "label": "상체 기울기",
        "value": 32.5,
        "raw_score": 62.5,
        "score": 63,
        "max_score": 100,
        "weight": 0.25,
        "status": "high",
        "feedback": "상체를 조금 더 세워주세요."
      }
    ],
    "feedback": {
      "type": "info",
      "message": "상체를 조금 더 세워주세요."
    }
  }
}
```

---

## 6. 클라이언트 사용법

### 6.1 초기화

```javascript
import { ExerciseScorer } from './scoring.js';
import { workoutApi } from './workoutApi.js';
import { RepCounterState, updateRepCounter } from './repCounter.js';

// 1. 세션 시작
const { session } = await workoutApi.startSession({
    exerciseId: exercise.exercise_id,
    scoringProfileId: scoringProfile.scoring_profile_id,
    mode: 'FREE'
});

// 2. Scorer 초기화
const scorer = new ExerciseScorer('side_squat', {
    sessionId: session.session_id,
    scoringProfileId: scoringProfile.scoring_profile_id,
    scoringProfile: scoringProfile  // DB에서 받은 프로필 (옵션)
});

// 3. Rep Counter 초기화
const repState = new RepCounterState();

// 4. 콜백 등록
scorer.onRepScored = (scoreResult) => {
    updateScoreUI(scoreResult.total);
    updateComponentBars(scoreResult.components);
};

scorer.onFeedback = (feedback) => {
    showFeedbackToast(feedback.message, feedback.type);
};
```

### 6.2 프레임 루프

```javascript
function onFrame(landmarks, timestampMs) {
    // 1. Metrics 계산
    const metrics = computeSideSquatMetrics(landmarks);
    
    // 2. Rep 카운팅
    const repEvent = updateRepCounter('side_squat', metrics, repState, timestampMs);
    
    // 3. 점수 업데이트 (Rep 완료 시 자동으로 백엔드 호출)
    const features = scorer.updateRepFeatures(metrics, repState, repEvent);
    
    // 4. 실시간 UI 업데이트 (프레임 단위)
    if (metrics.phase === 'bottom') {
        updateRealtimeIndicator(metrics);
    }
    
    // 5. Rep 카운트 표시
    if (repEvent) {
        updateRepCountUI(repEvent.repIndex);
    }
}
```

### 6.3 세션 종료

```javascript
// 세션 종료 시 자동으로 final_score 계산
const { session } = await workoutApi.endSession(sessionId, {
    durationSec: totalSeconds,
    totalReps: repState.count,
    summaryFeedback: '오늘 운동 수고하셨습니다!'
});

// session.final_score에 최종 점수 포함
console.log('최종 점수:', session.final_score);
```

---

## 7. DB 저장 구조

### 7.1 session_event (Rep별 상세 기록)

```sql
SELECT * FROM session_event WHERE session_id = '...' AND type = 'rep';

-- payload 예시:
{
  "rep_index": 3,
  "rep_interval_ms": 1520,
  "features": { ... },
  "score": {
    "total": 85,
    "components": [ ... ],
    "feedback": { ... }
  }
}
```

### 7.2 session_metric_result (세션 평균)

```sql
SELECT 
    m.key, 
    m.title, 
    smr.score AS avg_score,
    smr.raw AS rep_count
FROM session_metric_result smr
JOIN metric m ON smr.metric_id = m.metric_id
WHERE smr.session_id = '...';

-- 결과:
-- key          | title        | avg_score | rep_count
-- depth        | 무릎 깊이     | 92        | 15
-- torso_lean   | 상체 기울기   | 78        | 15
```

### 7.3 workout_session (최종 결과)

```sql
SELECT 
    final_score,
    total_reps,
    duration_sec,
    summary_feedback
FROM workout_session
WHERE session_id = '...';

-- final_score: 세션 전체 가중 평균 점수
```

---

## 8. 확장 포인트

### 8.1 새 운동 추가

1. `exercise` 테이블에 운동 추가
2. `metric` 테이블에 측정 지표 추가
3. `scoring_profile` 생성
4. `scoring_profile_metric`에 규칙(rule) 설정
5. 클라이언트에 metrics 계산 로직 추가

### 8.2 점수 규칙 변경

- DB의 `scoring_profile_metric.rule` 수정만으로 반영
- 버전 관리: 새 `scoring_profile` 생성 후 `is_active` 전환

### 8.3 피드백 커스터마이징

- `services/scoring.js`의 `FEEDBACK_MESSAGES` 수정
- 또는 DB에 피드백 템플릿 테이블 추가

---

## 9. 트러블슈팅

### Q: 점수가 계속 0점으로 나와요

- **원인**: features의 value가 모두 `null`
- **확인**: 클라이언트에서 metrics가 제대로 계산되는지 확인
- **확인**: `scoring_profile_metric.rule`의 `phases` 설정 확인

### Q: 피드백이 안 나와요

- **원인**: `FEEDBACK_MESSAGES`에 해당 운동/컴포넌트가 없음
- **해결**: `services/scoring.js`에 피드백 추가

### Q: Rep 카운트가 안 돼요

- **원인**: phase 감지 실패
- **확인**: metrics.phase 값 확인
- **확인**: `repCounter.js`의 `REP_CONFIGS` 설정 확인
