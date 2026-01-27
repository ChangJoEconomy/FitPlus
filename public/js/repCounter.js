/**
 * Rep 카운팅 로직 (core/rep_counter.py 포팅)
 */

export const REP_CONFIGS = {
    "side_squat": {
        topPhases: ["standing"],
        bottomPhases: ["bottom"],
        minRepIntervalMs: 400,
        minBottomHoldMs: 0,
        requireTopBeforeBottom: true,
    },
    "push_up": {
        topPhases: ["up"],
        bottomPhases: ["bottom"],
        minRepIntervalMs: 400,
        minBottomHoldMs: 0,
        requireTopBeforeBottom: true,
    },
};

export class RepCounterState {
    constructor() {
        this.count = 0;
        this.lastRepTsMs = null;
        this.lastRepIntervalMs = null;
        this.armed = false;
        this.sawBottom = false;
        this.bottomEnterTsMs = null;
    }
}

export function updateRepCounter(exerciseKey, metrics, state, timestampMs) {
    const config = REP_CONFIGS[exerciseKey];
    if (!config || !metrics) return null;

    const phase = metrics.phase;
    if (!phase) return null;

    // Armed 설정
    if (!state.armed) {
        if (!config.requireTopBeforeBottom) {
            state.armed = true;
        } else if (config.topPhases.includes(phase)) {
            state.armed = true;
        }
    }

    // Bottom 진입
    if (config.bottomPhases.includes(phase)) {
        if (state.armed && !state.sawBottom) {
            state.sawBottom = true;
            state.bottomEnterTsMs = timestampMs;
        }
        return null;
    }

    // Bottom -> Top 복귀 시 Rep 완료
    if (state.sawBottom && config.topPhases.includes(phase)) {
        const intervalMs = state.lastRepTsMs === null ? null : timestampMs - state.lastRepTsMs;

        if (state.lastRepTsMs === null || intervalMs >= config.minRepIntervalMs) {
            // Bottom 유지 시간 체크
            if (config.minBottomHoldMs && state.bottomEnterTsMs !== null) {
                const bottomHoldMs = timestampMs - state.bottomEnterTsMs;
                if (bottomHoldMs < config.minBottomHoldMs) {
                    state.sawBottom = false;
                    state.bottomEnterTsMs = null;
                    return null;
                }
            }

            // 카운팅 성공
            state.count++;
            state.lastRepTsMs = timestampMs;
            state.lastRepIntervalMs = intervalMs;
            state.sawBottom = false;
            state.bottomEnterTsMs = null;

            return {
                repIndex: state.count,
                repIntervalMs: intervalMs,
            };
        }

        // 간격 너무 짧음
        state.sawBottom = false;
        state.bottomEnterTsMs = null;
    }

    return null;
}
