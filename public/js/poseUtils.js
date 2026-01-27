/**
 * 포즈 랜드마크 관련 유틸리티 (core/pose.py 포팅)
 */

export const LANDMARK_INDEX = {
    "LEFT_SHOULDER": 11,
    "RIGHT_SHOULDER": 12,
    "LEFT_ELBOW": 13,
    "RIGHT_ELBOW": 14,
    "LEFT_WRIST": 15,
    "RIGHT_WRIST": 16,
    "LEFT_HIP": 23,
    "RIGHT_HIP": 24,
    "LEFT_KNEE": 25,
    "RIGHT_KNEE": 26,
    "LEFT_ANKLE": 27,
    "RIGHT_ANKLE": 28,
    "LEFT_HEEL": 29,
    "RIGHT_HEEL": 30,
    "LEFT_FOOT_INDEX": 31,
    "RIGHT_FOOT_INDEX": 32,
};

/**
 * 3점(a, b, c)으로 이루는 각도를 계산 (b가 꼭짓점)
 * @param {Object} a - 첫 번째 랜드마크 {x, y, z}
 * @param {Object} b - 꼭짓점 랜드마크
 * @param {Object} c - 세 번째 랜드마크
 */
export function calculateAngle(a, b, c) {
    if (!a || !b || !c) return null;

    const bax = a.x - b.x;
    const bay = a.y - b.y;
    const baz = a.z - b.z;

    const bcx = c.x - b.x;
    const bcy = c.y - b.y;
    const bcz = c.z - b.z;

    const baNorm = Math.sqrt(bax * bax + bay * bay + baz * baz);
    const bcNorm = Math.sqrt(bcx * bcx + bcy * bcy + bcz * bcz);

    if (baNorm === 0 || bcNorm === 0) return null;

    const cosAngle = (bax * bcx + bay * bcy + baz * bcz) / (baNorm * bcNorm);
    const clampedCos = Math.max(-1.0, Math.min(1.0, cosAngle));

    return parseFloat(((Math.acos(clampedCos) * 180) / Math.PI).toFixed(2));
}

/**
 * 랜드마크 이름으로 객체 가져오기
 */
export function getLandmark(landmarks, name) {
    const idx = LANDMARK_INDEX[name];
    if (idx === undefined || idx >= landmarks.length) return null;
    return landmarks[idx];
}

/**
 * 주요 관절 각도 일괄 계산
 */
export function computeJointAngles(landmarks) {
    const l_sh = getLandmark(landmarks, "LEFT_SHOULDER");
    const r_sh = getLandmark(landmarks, "RIGHT_SHOULDER");
    const l_el = getLandmark(landmarks, "LEFT_ELBOW");
    const r_el = getLandmark(landmarks, "RIGHT_ELBOW");
    const l_wr = getLandmark(landmarks, "LEFT_WRIST");
    const r_wr = getLandmark(landmarks, "RIGHT_WRIST");
    const l_hip = getLandmark(landmarks, "LEFT_HIP");
    const r_hip = getLandmark(landmarks, "RIGHT_HIP");
    const l_knee = getLandmark(landmarks, "LEFT_KNEE");
    const r_knee = getLandmark(landmarks, "RIGHT_KNEE");
    const l_ank = getLandmark(landmarks, "LEFT_ANKLE");
    const r_ank = getLandmark(landmarks, "RIGHT_ANKLE");

    return {
        "left_elbow": calculateAngle(l_sh, l_el, l_wr),
        "right_elbow": calculateAngle(r_sh, r_el, r_wr),
        "left_knee": calculateAngle(l_hip, l_knee, l_ank),
        "right_knee": calculateAngle(r_hip, r_knee, r_ank),
        "left_hip": calculateAngle(l_sh, l_hip, l_knee),
        "right_hip": calculateAngle(r_sh, r_hip, r_knee),
        "left_shoulder": calculateAngle(l_el, l_sh, l_hip),
        "right_shoulder": calculateAngle(r_el, r_sh, r_hip),
    };
}

/**
 * 평균 가시성 계산
 */
function getAvgVisibility(landmarks, indices) {
    const vis = indices.map(idx => landmarks[idx]?.visibility || 0);
    return vis.reduce((a, b) => a + b, 0) / vis.length;
}

/**
 * 더 잘 보이는 쪽 선택
 */
export function choosePrimarySide(landmarks) {
    const leftIndices = [
        LANDMARK_INDEX["LEFT_SHOULDER"],
        LANDMARK_INDEX["LEFT_HIP"],
        LANDMARK_INDEX["LEFT_KNEE"],
        LANDMARK_INDEX["LEFT_ANKLE"],
    ];
    const rightIndices = [
        LANDMARK_INDEX["RIGHT_SHOULDER"],
        LANDMARK_INDEX["RIGHT_HIP"],
        LANDMARK_INDEX["RIGHT_KNEE"],
        LANDMARK_INDEX["RIGHT_ANKLE"],
    ];

    const leftScore = getAvgVisibility(landmarks, leftIndices);
    const rightScore = getAvgVisibility(landmarks, rightIndices);

    return leftScore >= rightScore ? "left" : "right";
}

/**
 * 수직 위쪽(0, -1)과의 각도 계산
 */
export function calculateVerticalAngle(a, b) {
    if (!a || !b) return null;
    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const norm = Math.sqrt(vx * vx + vy * vy);
    if (norm === 0) return null;

    // 수직 위쪽 벡터 (0, -1)과의 내적: -vy
    const cosAngle = (-vy) / norm;
    const clampedCos = Math.max(-1.0, Math.min(1.0, cosAngle));
    return parseFloat(((Math.acos(clampedCos) * 180) / Math.PI).toFixed(2));
}
