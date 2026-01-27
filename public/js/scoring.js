/**
 * 운동 채점 시스템
 * 
 * 클라이언트 중심 아키텍처:
 * - 클라이언트: Rep 구간 동안 metrics 누적 → features 생성 → 점수 계산 → 백엔드 전송
 * - 백엔드: 계산된 점수를 DB에 저장
 */

import { workoutApi } from './workoutApi.js';

export const SCORE_VERSION = "v1";

// ============ 점수화 함수 ============

function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
}

function scoreMax(value, idealMax, hardMax) {
    if (value <= idealMax) return [100.0, "ok"];
    if (value >= hardMax) return [0.0, "too_high"];
    const score = 100.0 * (hardMax - value) / Math.max(hardMax - idealMax, 1e-9);
    return [clamp(score, 0.0, 100.0), "high"];
}

function scoreMin(value, idealMin, hardMin) {
    if (value >= idealMin) return [100.0, "ok"];
    if (value <= hardMin) return [0.0, "too_low"];
    const score = 100.0 * (value - hardMin) / Math.max(idealMin - hardMin, 1e-9);
    return [clamp(score, 0.0, 100.0), "low"];
}

function scoreRange(value, idealMin, idealMax, hardMin, hardMax) {
    if (value >= idealMin && value <= idealMax) return [100.0, "ok"];
    if (value < idealMin) {
        if (value <= hardMin) return [0.0, "too_low"];
        const score = 100.0 * (value - hardMin) / Math.max(idealMin - hardMin, 1e-9);
        return [clamp(score, 0.0, 100.0), "low"];
    }
    if (value >= hardMax) return [0.0, "too_high"];
    const score = 100.0 * (hardMax - value) / Math.max(hardMax - idealMax, 1e-9);
    return [clamp(score, 0.0, 100.0), "high"];
}

export function scoreComponent(spec, value) {
    const [idealA, idealB] = spec.ideal;
    const [hardA, hardB] = spec.hard;
    if (spec.kind === "max") return scoreMax(value, idealB, hardB);
    if (spec.kind === "min") return scoreMin(value, idealA, hardA);
    if (spec.kind === "range") return scoreRange(value, idealA, idealB, hardA, hardB);
    return [0.0, "invalid"];
}

// ============ 피드백 메시지 ============

const FEEDBACK_MESSAGES = {
    'side_squat': {
        depth: {
            too_low: '무릎을 너무 깊이 구부렸습니다. 허벅지가 바닥과 평행할 때까지만 내려가세요.',
            low: '조금 더 얕게 앉아도 됩니다.',
            too_high: '스쿼트 깊이가 부족합니다. 더 깊이 앉아주세요.',
            high: '조금 더 깊이 앉아주세요.',
            ok: '좋은 스쿼트 깊이입니다!'
        },
        hip_hinge: {
            too_high: '엉덩이를 너무 뒤로 빼고 있습니다.',
            high: '엉덩이를 조금 덜 빼세요.',
            ok: '엉덩이 자세가 좋습니다!'
        },
        torso_lean: {
            too_high: '상체가 너무 앞으로 기울어졌습니다. 등을 더 세워주세요.',
            high: '상체를 조금 더 세워주세요.',
            ok: '상체 자세가 좋습니다!'
        },
        knee_forward: {
            too_high: '무릎이 발끝을 너무 많이 넘어갔습니다.',
            high: '무릎이 조금 앞으로 나갔습니다.',
            ok: '무릎 위치가 좋습니다!'
        },
        tempo: {
            too_low: '너무 빠릅니다. 천천히 동작하세요.',
            low: '조금 천천히 해보세요.',
            too_high: '너무 느립니다. 조금 더 빠르게 해보세요.',
            high: '조금 더 빠르게 해도 좋습니다.',
            ok: '좋은 템포입니다!'
        }
    },
    'push_up': {
        depth: {
            too_low: '팔을 너무 깊이 구부렸습니다.',
            low: '조금 덜 내려가도 됩니다.',
            too_high: '더 깊이 내려가세요. 팔꿈치가 90도가 될 때까지!',
            high: '조금 더 깊이 내려가세요.',
            ok: '좋은 깊이입니다!'
        },
        body_line: {
            too_low: '몸이 일직선이 아닙니다. 코어에 힘을 주세요.',
            low: '몸을 더 곧게 펴세요.',
            ok: '몸 라인이 완벽합니다!'
        },
        wrist_stack: {
            too_high: '손목이 어깨 아래에 있지 않습니다. 손 위치를 조정하세요.',
            high: '손목 위치를 조금 조정하세요.',
            ok: '손목 위치가 좋습니다!'
        },
        hip_sag: {
            too_low: '골반이 처졌습니다. 엉덩이를 들어올리세요.',
            low: '골반을 조금 더 올려주세요.',
            ok: '골반 위치가 좋습니다!'
        },
        tempo: {
            too_low: '너무 빠릅니다. 천천히 동작하세요.',
            low: '조금 천천히 해보세요.',
            too_high: '너무 느립니다.',
            high: '조금 더 빠르게 해도 좋습니다.',
            ok: '좋은 템포입니다!'
        }
    }
};

function generateComponentFeedback(exerciseCode, componentKey, status) {
    const exerciseFeedback = FEEDBACK_MESSAGES[exerciseCode];
    if (!exerciseFeedback) return null;
    const componentFeedback = exerciseFeedback[componentKey];
    if (!componentFeedback) return null;
    return componentFeedback[status] || null;
}

function generateRepSummaryFeedback(exerciseCode, components) {
    let worstComponent = null;
    let worstScore = 101;

    for (const comp of components) {
        if (comp.score !== null && comp.score < worstScore) {
            worstScore = comp.score;
            worstComponent = comp;
        }
    }

    if (!worstComponent || worstScore >= 80) {
        return { type: 'success', message: '좋습니다! 자세가 정확합니다.' };
    }

    const feedback = generateComponentFeedback(exerciseCode, worstComponent.key, worstComponent.status);

    if (worstScore < 50) {
        return { type: 'warning', message: feedback || '자세를 교정해주세요.' };
    }

    return { type: 'info', message: feedback || '조금만 더 신경 써주세요.' };
}

// ============ 스코어 스펙 ============

export const SCORE_SPECS = {
    "side_squat": {
        exerciseKey: "side_squat",
        label: "측면 스쿼트",
        components: [
            {
                key: "depth", label: "무릎 깊이", metricKey: "knee_angle",
                agg: "p05", kind: "range", weight: 0.35,
                ideal: [80.0, 110.0], hard: [70.0, 150.0],
                phases: ["mid", "bottom"]
            },
            {
                key: "hip_hinge", label: "엉덩이 접힘", metricKey: "hip_angle",
                agg: "p05", kind: "max", weight: 0.25,
                ideal: [0.0, 140.0], hard: [0.0, 160.0],
                phases: ["mid", "bottom"]
            },
            {
                key: "torso_lean", label: "상체 기울기(보정)", metricKey: "torso_angle_rel",
                agg: "p95", kind: "max", weight: 0.25,
                ideal: [0.0, 25.0], hard: [0.0, 45.0],
                phases: null
            },
            {
                key: "knee_forward", label: "무릎 전진", metricKey: "knee_forward_ratio",
                agg: "p95", kind: "max", weight: 0.15,
                ideal: [0.0, 0.06], hard: [0.0, 0.10],
                phases: null
            },
            {
                key: "tempo", label: "템포(인터벌)", metricKey: "rep_interval_ms",
                agg: "last", kind: "range", weight: 0.15,
                ideal: [800.0, 2500.0], hard: [400.0, 5000.0],
                phases: null
            }
        ]
    },
    "push_up": {
        exerciseKey: "push_up",
        label: "푸쉬업",
        components: [
            {
                key: "depth", label: "팔꿈치 깊이", metricKey: "elbow_angle",
                agg: "p05", kind: "range", weight: 0.35,
                ideal: [75.0, 115.0], hard: [70.0, 140.0],
                phases: ["mid", "bottom"]
            },
            {
                key: "body_line", label: "몸통 일직선", metricKey: "body_angle",
                agg: "p05", kind: "min", weight: 0.30,
                ideal: [170.0, 180.0], hard: [160.0, 180.0],
                phases: null
            },
            {
                key: "wrist_stack", label: "손목 정렬", metricKey: "wrist_shoulder_offset",
                agg: "p95", kind: "max", weight: 0.15,
                ideal: [0.0, 0.05], hard: [0.0, 0.08],
                phases: null
            },
            {
                key: "hip_sag", label: "골반 처짐", metricKey: "hip_angle",
                agg: "p05", kind: "min", weight: 0.20,
                ideal: [170.0, 180.0], hard: [160.0, 180.0],
                phases: null
            },
            {
                key: "tempo", label: "템포(인터벌)", metricKey: "rep_interval_ms",
                agg: "last", kind: "range", weight: 0.15,
                ideal: [800.0, 2500.0], hard: [400.0, 5000.0],
                phases: null
            }
        ]
    }
};

// ============ Accumulator ============

class Accumulator {
    constructor(spec) {
        this.spec = spec;
        this.reset();
    }
    reset() {
        this._min = null;
        this._max = null;
        this._sum = 0.0;
        this._count = 0;
        this._last = null;
        this._values = [];
    }
    update(metrics) {
        let val = metrics[this.spec.metricKey];
        if (val === undefined || val === null) return;
        val = Number(val);
        if (this.spec.agg === "min") {
            this._min = (this._min === null) ? val : Math.min(this._min, val);
        } else if (this.spec.agg === "max") {
            this._max = (this._max === null) ? val : Math.max(this._max, val);
        } else if (this.spec.agg === "mean") {
            this._sum += val;
            this._count++;
        } else if (["p05", "p95"].includes(this.spec.agg)) {
            this._values.push(val);
        }
        this._last = val;
    }
    value() {
        if (this.spec.agg === "min") return this._min;
        if (this.spec.agg === "max") return this._max;
        if (this.spec.agg === "mean") return this._count > 0 ? this._sum / this._count : null;
        if (["p05", "p95"].includes(this.spec.agg)) {
            if (this._values.length === 0) return null;
            const sorted = [...this._values].sort((a, b) => a - b);
            const q = this.spec.agg === "p05" ? 0.05 : 0.95;
            const pos = q * (sorted.length - 1);
            const lo = Math.floor(pos);
            const hi = Math.min(lo + 1, sorted.length - 1);
            const frac = pos - lo;
            return sorted[lo] * (1.0 - frac) + sorted[hi] * frac;
        }
        return this._last;
    }
}

// ============ ExerciseScorer ============

export class ExerciseScorer {
    /**
     * @param {string} exerciseKey - 운동 코드 (예: 'side_squat')
     * @param {object} options - 옵션
     * @param {string} options.sessionId - 세션 ID
     * @param {object} options.scoringProfile - DB에서 조회한 스코어링 프로필
     */
    constructor(exerciseKey, options = {}) {
        this.exerciseKey = exerciseKey;
        this.sessionId = options.sessionId || null;
        this.scoringProfile = options.scoringProfile || null;
        
        // 스펙 설정 (DB 프로필 우선, 없으면 로컬 스펙)
        this.spec = SCORE_SPECS[exerciseKey];
        if (this.scoringProfile) {
            this.spec = this._buildSpecFromProfile(this.scoringProfile);
        }
        
        this.repActive = false;
        this.accs = [];
        this.repCount = 0;
        this.repScores = []; // 세션 내 모든 rep 점수 저장
        this.lastRepScore = null;
        this.lastFeedback = null;
        
        // 콜백
        this.onRepScored = null;  // (scoreResult) => {}
        this.onFeedback = null;   // (feedback) => {}
        
        if (this.spec) {
            this.accs = this.spec.components.map(c => new Accumulator(c));
        }
    }
    
    /**
     * DB 스코어링 프로필에서 클라이언트용 스펙 생성
     */
    _buildSpecFromProfile(profile) {
        if (!profile || !profile.scoring_profile_metric) return null;
        
        const components = profile.scoring_profile_metric.map(pm => ({
            key: pm.metric.key,
            label: pm.metric.title,
            metricKey: pm.metric.key,
            metricId: pm.metric.metric_id,
            agg: pm.rule?.agg || 'p05',
            kind: pm.rule?.kind || 'range',
            weight: parseFloat(pm.weight) || 0,
            maxScore: pm.max_score || 100,
            ideal: pm.rule?.ideal || [0, 100],
            hard: pm.rule?.hard || [0, 100],
            phases: pm.rule?.phases || null
        }));
        
        return {
            exerciseKey: this.exerciseKey,
            label: profile.name,
            components
        };
    }
    
    resetRep() {
        this.repActive = false;
        this.accs.forEach(a => a.reset());
    }
    
    /**
     * 프레임마다 호출 - metrics 누적 및 rep 완료 시 점수 계산
     * @param {object} metrics - 현재 프레임의 측정값
     * @param {object} repState - RepCounterState
     * @param {object} repEvent - rep 완료 이벤트 (null이면 아직 진행 중)
     * @returns {object|null} rep 완료 시 점수 결과 반환
     */
    updateRep(metrics, repState, repEvent) {
        if (!this.spec || !metrics) return null;
        const phase = metrics.phase;

        // Rep 구간 시작 판정
        if (!this.repActive && phase !== "standing") {
            this.repActive = true;
            this.accs.forEach(a => a.reset());
        }

        // 누적
        if (this.repActive) {
            this.accs.forEach(acc => {
                if (!acc.spec.phases || acc.spec.phases.includes(phase)) {
                    acc.update(metrics);
                }
            });
        }

        if (!repEvent) return null;

        // Rep 완료 - 점수 계산
        this.repCount++;
        const scoreResult = this._computeRepScore(repEvent);
        
        this.resetRep();
        
        // 점수 저장
        this.repScores.push(scoreResult);
        this.lastRepScore = scoreResult;
        this.lastFeedback = scoreResult.feedback;
        
        // 콜백 호출
        if (this.onRepScored) {
            this.onRepScored(scoreResult);
        }
        if (this.onFeedback && scoreResult.feedback) {
            this.onFeedback(scoreResult.feedback);
        }
        
        // 백엔드로 전송 (비동기)
        if (this.sessionId) {
            this._sendToBackend(repEvent, scoreResult);
        }
        
        return scoreResult;
    }
    
    /**
     * Rep 점수 계산 (클라이언트에서 수행)
     */
    _computeRepScore(repEvent) {
        const components = this.accs.map(acc => {
            const val = acc.value();
            
            if (val === null || val === undefined) {
                return {
                    key: acc.spec.key,
                    label: acc.spec.label,
                    metricKey: acc.spec.metricKey,
                    metricId: acc.spec.metricId || null,
                    agg: acc.spec.agg,
                    value: null,
                    score: null,
                    weight: acc.spec.weight,
                    status: 'missing',
                    feedback: null
                };
            }
            
            const [score, status] = scoreComponent(acc.spec, val);
            const feedback = generateComponentFeedback(this.exerciseKey, acc.spec.key, status);
            
            return {
                key: acc.spec.key,
                label: acc.spec.label,
                metricKey: acc.spec.metricKey,
                metricId: acc.spec.metricId || null,
                agg: acc.spec.agg,
                value: parseFloat(val.toFixed(4)),
                score: parseFloat(score.toFixed(2)),
                weight: acc.spec.weight,
                status,
                feedback
            };
        });
        
        // 가중 평균으로 총점 계산
        let weightSum = 0;
        let weighted = 0;
        components.forEach(c => {
            if (c.score !== null) {
                weightSum += c.weight;
                weighted += c.weight * c.score;
            }
        });
        
        const total = weightSum > 0 ? parseFloat((weighted / weightSum).toFixed(2)) : null;
        const feedback = generateRepSummaryFeedback(this.exerciseKey, components);
        
        return {
            version: SCORE_VERSION,
            repIndex: this.repCount,
            repIntervalMs: repEvent.repIntervalMs,
            total,
            components,
            feedback
        };
    }
    
    /**
     * 백엔드로 점수 전송 (저장용)
     */
    async _sendToBackend(repEvent, scoreResult) {
        try {
            await workoutApi.sendRepEvent(this.sessionId, {
                repIndex: scoreResult.repIndex,
                repIntervalMs: scoreResult.repIntervalMs,
                score: scoreResult
            });
        } catch (error) {
            console.error('Rep 점수 전송 실패:', error);
        }
    }
    
    /**
     * 프레임 단위 실시간 점수 (UI용)
     */
    computeFrameScore(metrics) {
        if (!this.spec || !metrics) return null;
        const phase = metrics.phase;
        
        const components = this.spec.components.map(comp => {
            if (comp.phases && !comp.phases.includes(phase)) {
                return { key: comp.key, label: comp.label, score: null, status: "skipped" };
            }
            const val = metrics[comp.metricKey];
            if (val === undefined || val === null) {
                return { key: comp.key, label: comp.label, score: null, status: "missing" };
            }
            const [score, status] = scoreComponent(comp, val);
            return {
                key: comp.key,
                label: comp.label,
                metricKey: comp.metricKey,
                value: val,
                score: parseFloat(score.toFixed(2)),
                weight: comp.weight,
                status
            };
        });

        let weightSum = 0, weighted = 0;
        components.forEach(c => {
            if (c.score !== null) {
                weightSum += c.weight;
                weighted += c.weight * c.score;
            }
        });

        const total = weightSum > 0 ? parseFloat((weighted / weightSum).toFixed(2)) : null;
        return { total, components };
    }
    
    /**
     * 세션 평균 점수 계산
     */
    getSessionAverage() {
        if (this.repScores.length === 0) return null;
        
        const validScores = this.repScores.filter(s => s.total !== null);
        if (validScores.length === 0) return null;
        
        const sum = validScores.reduce((acc, s) => acc + s.total, 0);
        return parseFloat((sum / validScores.length).toFixed(2));
    }
    
    /**
     * 세션 요약 (종료 시 사용)
     */
    getSessionSummary() {
        const avgScore = this.getSessionAverage();
        
        // 컴포넌트별 평균 계산
        const componentAverages = {};
        if (this.spec) {
            for (const comp of this.spec.components) {
                const values = this.repScores
                    .map(s => s.components.find(c => c.key === comp.key)?.score)
                    .filter(v => v !== null && v !== undefined);
                
                if (values.length > 0) {
                    componentAverages[comp.key] = {
                        label: comp.label,
                        metricId: comp.metricId || null,
                        avgScore: parseFloat((values.reduce((a, b) => a + b, 0) / values.length).toFixed(2)),
                        repCount: values.length
                    };
                }
            }
        }
        
        return {
            totalReps: this.repCount,
            avgScore,
            componentAverages
        };
    }
    
    getLastRepScore() {
        return this.lastRepScore;
    }
    
    getLastFeedback() {
        return this.lastFeedback;
    }
}
