/**
 * 백엔드 점수 계산 서비스
 * 
 * DB의 scoring_profile, scoring_profile_metric 테이블을 기반으로
 * Rep 이벤트의 features를 점수화하고 실시간 피드백을 생성합니다.
 */

const { supabase } = require('../config/db');

const SCORE_VERSION = 'v1';

// ============ 점수화 함수 ============

function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
}

/**
 * kind="max" (값이 작을수록 좋음)
 * 예: 상체 기울기, 무릎 전진
 */
function scoreMax(value, idealMax, hardMax) {
    if (value <= idealMax) return { score: 100, status: 'ok' };
    if (value >= hardMax) return { score: 0, status: 'too_high' };
    const score = 100.0 * (hardMax - value) / Math.max(hardMax - idealMax, 1e-9);
    return { score: clamp(score, 0, 100), status: 'high' };
}

/**
 * kind="min" (값이 클수록 좋음)
 * 예: 몸통 일직선 각도
 */
function scoreMin(value, idealMin, hardMin) {
    if (value >= idealMin) return { score: 100, status: 'ok' };
    if (value <= hardMin) return { score: 0, status: 'too_low' };
    const score = 100.0 * (value - hardMin) / Math.max(idealMin - hardMin, 1e-9);
    return { score: clamp(score, 0, 100), status: 'low' };
}

/**
 * kind="range" (범위 내가 가장 좋음)
 * 예: 무릎 깊이, 템포
 */
function scoreRange(value, idealMin, idealMax, hardMin, hardMax) {
    if (value >= idealMin && value <= idealMax) return { score: 100, status: 'ok' };
    if (value < idealMin) {
        if (value <= hardMin) return { score: 0, status: 'too_low' };
        const score = 100.0 * (value - hardMin) / Math.max(idealMin - hardMin, 1e-9);
        return { score: clamp(score, 0, 100), status: 'low' };
    }
    if (value >= hardMax) return { score: 0, status: 'too_high' };
    const score = 100.0 * (hardMax - value) / Math.max(hardMax - idealMax, 1e-9);
    return { score: clamp(score, 0, 100), status: 'high' };
}

/**
 * 단일 컴포넌트 점수 계산
 * @param {object} rule - scoring_profile_metric.rule (JSON)
 * @param {number} value - 대표값
 */
function scoreComponent(rule, value) {
    if (!rule || value === null || value === undefined) {
        return { score: null, status: 'missing' };
    }

    const { kind, ideal, hard } = rule;
    const [idealA, idealB] = ideal || [0, 0];
    const [hardA, hardB] = hard || [0, 0];

    if (kind === 'max') return scoreMax(value, idealB, hardB);
    if (kind === 'min') return scoreMin(value, idealA, hardA);
    if (kind === 'range') return scoreRange(value, idealA, idealB, hardA, hardB);

    return { score: 0, status: 'invalid' };
}

// ============ 피드백 생성 ============

/**
 * 피드백 메시지 생성
 * status에 따라 구체적인 피드백 제공
 */
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

/**
 * 컴포넌트별 피드백 생성
 */
function generateComponentFeedback(exerciseCode, componentKey, status) {
    const exerciseFeedback = FEEDBACK_MESSAGES[exerciseCode];
    if (!exerciseFeedback) return null;

    const componentFeedback = exerciseFeedback[componentKey];
    if (!componentFeedback) return null;

    return componentFeedback[status] || null;
}

/**
 * 전체 Rep에 대한 요약 피드백 생성
 */
function generateRepSummaryFeedback(exerciseCode, components) {
    // 가장 낮은 점수의 컴포넌트 찾기
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

    const feedback = generateComponentFeedback(
        exerciseCode,
        worstComponent.key,
        worstComponent.status
    );

    if (worstScore < 50) {
        return { type: 'warning', message: feedback || '자세를 교정해주세요.' };
    }

    return { type: 'info', message: feedback || '조금만 더 신경 써주세요.' };
}

// ============ 메인 서비스 함수 ============

/**
 * DB에서 스코어링 프로필 조회
 */
async function getScoringProfile(scoringProfileId) {
    const { data, error } = await supabase
        .from('scoring_profile')
        .select(`
            scoring_profile_id,
            exercise_id,
            version,
            name,
            is_active,
            exercise:exercise_id (
                code,
                name
            ),
            scoring_profile_metric (
                weight,
                max_score,
                rule,
                order_no,
                metric:metric_id (
                    metric_id,
                    key,
                    title,
                    description,
                    unit
                )
            )
        `)
        .eq('scoring_profile_id', scoringProfileId)
        .single();

    if (error) throw error;

    // order_no 기준 정렬
    if (data && data.scoring_profile_metric) {
        data.scoring_profile_metric.sort((a, b) => a.order_no - b.order_no);
    }

    return data;
}

/**
 * Rep Features를 기반으로 점수 계산
 * 
 * @param {object} scoringProfile - DB에서 조회한 스코어링 프로필
 * @param {object} features - 클라이언트에서 전송한 rep features
 * @returns {object} { total, components[], feedback }
 */
function calculateRepScore(scoringProfile, features) {
    if (!scoringProfile || !features || !features.components) {
        return null;
    }

    const exerciseCode = scoringProfile.exercise?.code;
    const profileMetrics = scoringProfile.scoring_profile_metric || [];

    // features.components를 key로 매핑
    const featureMap = {};
    for (const fc of features.components) {
        featureMap[fc.key] = fc;
    }

    const components = [];
    let weightSum = 0;
    let weightedScore = 0;

    for (const pm of profileMetrics) {
        const metric = pm.metric;
        const rule = pm.rule;
        const weight = parseFloat(pm.weight) || 0;
        const maxScore = pm.max_score || 100;

        // features에서 해당 metric의 값 찾기
        const featureComp = featureMap[metric.key];
        const value = featureComp?.value;

        // 점수 계산
        const { score, status } = scoreComponent(rule, value);

        // max_score 적용 (0~100 → 0~max_score 스케일)
        const scaledScore = score !== null ? Math.round(score * maxScore / 100) : null;

        // 피드백 생성
        const feedback = generateComponentFeedback(exerciseCode, metric.key, status);

        components.push({
            metric_id: metric.metric_id,
            key: metric.key,
            label: metric.title,
            value: value !== undefined ? value : null,
            raw_score: score !== null ? Math.round(score * 100) / 100 : null,
            score: scaledScore,
            max_score: maxScore,
            weight,
            status,
            feedback
        });

        // 가중 평균 계산 (missing 제외)
        if (score !== null && weight > 0) {
            weightSum += weight;
            weightedScore += weight * score;
        }
    }

    // 총점 계산
    const total = weightSum > 0 ? Math.round(weightedScore / weightSum) : null;

    // 요약 피드백
    const summaryFeedback = generateRepSummaryFeedback(exerciseCode, components);

    return {
        version: SCORE_VERSION,
        total,
        components,
        feedback: summaryFeedback
    };
}

/**
 * Rep 이벤트 처리 및 저장
 * 
 * @param {string} sessionId - 세션 ID
 * @param {object} repEvent - rep 이벤트 데이터
 * @param {object} scoringProfile - 스코어링 프로필 (미리 조회된)
 */
async function processRepEvent(sessionId, repEvent, scoringProfile) {
    const { rep_index, rep_interval_ms, features } = repEvent;

    // 1. 점수 계산
    const scoreResult = calculateRepScore(scoringProfile, features);

    // 2. session_event에 rep 이벤트 저장
    const { data: event, error: eventError } = await supabase
        .from('session_event')
        .insert({
            session_id: sessionId,
            type: 'rep',
            payload: {
                rep_index,
                rep_interval_ms,
                features,
                score: scoreResult
            }
        })
        .select()
        .single();

    if (eventError) throw eventError;

    // 3. session_metric_result 업데이트 (누적)
    // 각 metric별로 점수를 누적 저장 (세션 종료 시 평균 계산용)
    if (scoreResult && scoreResult.components) {
        for (const comp of scoreResult.components) {
            if (comp.score === null) continue;

            // upsert: 이미 있으면 평균 업데이트, 없으면 삽입
            const { data: existing } = await supabase
                .from('session_metric_result')
                .select('score, raw')
                .eq('session_id', sessionId)
                .eq('metric_id', comp.metric_id)
                .single();

            if (existing) {
                // 기존 값과 평균 (raw에 rep count 저장)
                const repCount = (existing.raw || 0) + 1;
                const avgScore = Math.round(
                    ((existing.score * (repCount - 1)) + comp.raw_score) / repCount
                );

                await supabase
                    .from('session_metric_result')
                    .update({ score: avgScore, raw: repCount })
                    .eq('session_id', sessionId)
                    .eq('metric_id', comp.metric_id);
            } else {
                await supabase
                    .from('session_metric_result')
                    .insert({
                        session_id: sessionId,
                        metric_id: comp.metric_id,
                        score: Math.round(comp.raw_score),
                        raw: 1 // rep count
                    });
            }
        }
    }

    return {
        event_id: event.event_id,
        rep_index,
        score: scoreResult
    };
}

/**
 * 세션 최종 점수 계산
 * session_metric_result의 평균을 기반으로 final_score 계산
 */
async function calculateSessionFinalScore(sessionId, scoringProfileId) {
    // 스코어링 프로필 조회
    const profile = await getScoringProfile(scoringProfileId);
    if (!profile) return null;

    // 세션의 metric 결과 조회
    const { data: metricResults, error } = await supabase
        .from('session_metric_result')
        .select('score, metric_id')
        .eq('session_id', sessionId);

    if (error || !metricResults || metricResults.length === 0) {
        return null;
    }

    // metric_id로 weight 매핑
    const weightMap = {};
    for (const pm of profile.scoring_profile_metric) {
        weightMap[pm.metric.metric_id] = parseFloat(pm.weight) || 0;
    }

    // 가중 평균 계산
    let weightSum = 0;
    let weightedScore = 0;

    for (const mr of metricResults) {
        const weight = weightMap[mr.metric_id] || 0;
        if (weight > 0) {
            weightSum += weight;
            weightedScore += weight * mr.score;
        }
    }

    return weightSum > 0 ? Math.round(weightedScore / weightSum) : null;
}

/**
 * 실시간 프레임 피드백 생성 (옵션)
 * 매 프레임이 아닌 일정 주기(예: 1초)마다 호출 권장
 */
function generateFrameFeedback(exerciseCode, metrics, rule) {
    // 간단한 실시간 피드백 (phase 기반)
    const feedbacks = [];

    if (metrics.phase === 'bottom' || metrics.phase === 'mid') {
        // 하강/중간 구간에서만 자세 체크
        if (rule && metrics) {
            for (const [key, value] of Object.entries(metrics)) {
                // rule에서 해당 metric 찾기
                // (이 부분은 필요시 확장)
            }
        }
    }

    return feedbacks;
}

module.exports = {
    SCORE_VERSION,
    scoreComponent,
    calculateRepScore,
    getScoringProfile,
    processRepEvent,
    calculateSessionFinalScore,
    generateComponentFeedback,
    generateRepSummaryFeedback,
    generateFrameFeedback
};
