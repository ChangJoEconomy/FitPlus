/**
 * 측면 스쿼트 운동 로직 (exercises/side_squat.py 포팅)
 */

import { calculateAngle, calculateVerticalAngle, getLandmark, choosePrimarySide } from '../poseUtils.js';
import { OneEuroFilter } from '../filter.js';

const SQUAT_KNEE_SHALLOW = 150;
const SQUAT_KNEE_DEEP = 70;
const SQUAT_HIP_SHALLOW = 150;
const SQUAT_TORSO_LEAN_MAX = 45;
const SQUAT_KNEE_OVER_TOE_MAX = 0.10;
const SHIN_LENGTH_EPS = 0.01;

function squatPhase(kneeAngle) {
    if (kneeAngle === null) return "unknown";
    if (kneeAngle > 165) return "standing";
    if (kneeAngle > 140) return "start";
    if (kneeAngle > 110) return "mid";
    return "bottom";
}

export function computeSideSquatMetrics(result) {
    if (!result || !result.poseLandmarks || result.poseLandmarks.length === 0) return null;

    const poseNorm = result.poseLandmarks[0];
    const side = choosePrimarySide(poseNorm);

    // World landmarks 우선 사용 (3D), 없으면 Normalized (2D)
    const poseForAngles = (result.poseWorldLandmarks && result.poseWorldLandmarks.length > 0)
        ? result.poseWorldLandmarks[0]
        : poseNorm;

    const angleSource = (result.poseWorldLandmarks && result.poseWorldLandmarks.length > 0) ? "world" : "normalized";

    const hip = getLandmark(poseForAngles, `${side.toUpperCase()}_HIP`);
    const knee = getLandmark(poseForAngles, `${side.toUpperCase()}_KNEE`);
    const ankle = getLandmark(poseForAngles, `${side.toUpperCase()}_ANKLE`);
    const shoulder = getLandmark(poseForAngles, `${side.toUpperCase()}_SHOULDER`);

    const kneeAngle = calculateAngle(hip, knee, ankle);
    const hipAngle = calculateAngle(shoulder, hip, knee);

    // 무릎 전진 비율 (정강이 길이 대비)
    let kneeForwardRatio = null;
    const kneeN = getLandmark(poseNorm, `${side.toUpperCase()}_KNEE`);
    const ankleN = getLandmark(poseNorm, `${side.toUpperCase()}_ANKLE`);
    const toeN = getLandmark(poseNorm, `${side.toUpperCase()}_FOOT_INDEX`);
    const hipN = getLandmark(poseNorm, `${side.toUpperCase()}_HIP`);

    const torsoAngle = calculateVerticalAngle(hipN, getLandmark(poseNorm, `${side.toUpperCase()}_SHOULDER`));

    // 발끝 방향 판별
    let direction = 1;
    if (toeN && ankleN) {
        direction = (toeN.x - ankleN.x) >= 0 ? 1 : -1;
    } else if (hipN && ankleN) {
        direction = (hipN.x - ankleN.x) >= 0 ? 1 : -1;
    }

    if (kneeN && ankleN) {
        const shinLen = Math.hypot(kneeN.x - ankleN.x, kneeN.y - ankleN.y);
        if (shinLen > SHIN_LENGTH_EPS) {
            kneeForwardRatio = ((kneeN.x - ankleN.x) * direction) / shinLen;
        }
    }

    return {
        side,
        angleSource,
        knee_angle: kneeAngle,
        hip_angle: hipAngle,
        torso_angle: torsoAngle,
        knee_forward_ratio: kneeForwardRatio,
        phase: squatPhase(kneeAngle)
    };
}

export class SideSquatSmoother {
    constructor() {
        this.filters = {};
        this.side = null;
    }

    smooth(metrics, timestampMs) {
        if (!metrics) return null;

        const t = timestampMs / 1000.0;
        if (this.side !== metrics.side) {
            this.filters = {};
            this.side = metrics.side;
        }

        const smoothed = { ...metrics };
        const keys = ["knee_angle", "hip_angle", "torso_angle", "knee_forward_ratio"];

        keys.forEach(key => {
            const val = metrics[key];
            if (val === null) return;

            if (!this.filters[key]) {
                this.filters[key] = new OneEuroFilter(t, val, 0, 1.0, 0.007, 1.0);
                smoothed[key] = val;
            } else {
                smoothed[key] = this.filters[key].filter(t, val);
            }
        });

        smoothed.phase = squatPhase(smoothed.knee_angle);
        return smoothed;
    }
}

export function evaluateSideSquat(metrics) {
    if (!metrics) return [];
    const { phase, knee_angle, hip_angle, torso_angle, knee_forward_ratio } = metrics;

    if (phase === "standing" || phase === "start") {
        return ["스쿼트 시작: 무릎을 굽혀주세요"];
    }

    const feedback = [];
    if (knee_angle !== null) {
        if (knee_angle > SQUAT_KNEE_SHALLOW) feedback.push("스쿼트 깊이가 얕아요");
        else if (knee_angle < SQUAT_KNEE_DEEP) feedback.push("너무 깊게 내려갔어요");
    }
    if (hip_angle !== null && hip_angle > SQUAT_HIP_SHALLOW) feedback.push("엉덩이 접힘이 부족해요");
    if (torso_angle !== null && torso_angle > SQUAT_TORSO_LEAN_MAX) feedback.push("상체가 너무 앞으로 기울었어요");
    if (knee_forward_ratio !== null && knee_forward_ratio > SQUAT_KNEE_OVER_TOE_MAX) feedback.push("무릎이 발끝보다 너무 앞으로 나갔어요");

    if (feedback.length === 0) feedback.push("좋아요! 자세 안정적이에요");
    return feedback;
}
