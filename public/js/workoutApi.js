/**
 * 운동 세션 API 클라이언트
 * 백엔드와의 통신을 담당합니다.
 */

export class WorkoutApiClient {
    constructor() {
        this.baseUrl = '/api/workout';
    }

    /**
     * 운동 세션 시작
     */
    async startSession({ exerciseId, scoringProfileId, mode, routineInstanceId }) {
        const response = await fetch(`${this.baseUrl}/session`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                exercise_id: exerciseId,
                scoring_profile_id: scoringProfileId,
                mode: mode || 'FREE',
                routine_instance_id: routineInstanceId
            })
        });

        if (!response.ok) {
            throw new Error('세션 시작 실패');
        }

        return response.json();
    }

    /**
     * 운동 세션 종료
     */
    async endSession(sessionId, { durationSec, totalReps, finalScore, summaryFeedback, detail }) {
        const response = await fetch(`${this.baseUrl}/session/${sessionId}/end`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                duration_sec: durationSec,
                total_reps: totalReps,
                final_score: finalScore,  // 클라이언트에서 계산된 최종 점수
                summary_feedback: summaryFeedback,
                detail
            })
        });

        if (!response.ok) {
            throw new Error('세션 종료 실패');
        }

        return response.json();
    }

    /**
     * Rep 이벤트 전송 (클라이언트에서 계산된 점수 포함)
     * @param {string} sessionId - 세션 ID
     * @param {object} repData - { repIndex, repIntervalMs, score }
     * @returns {object} { success, event_id }
     */
    async sendRepEvent(sessionId, repData) {
        const response = await fetch(`${this.baseUrl}/session/${sessionId}/rep`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                rep_index: repData.repIndex,
                rep_interval_ms: repData.repIntervalMs,
                score: repData.score  // 클라이언트에서 계산된 점수
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Rep 이벤트 전송 실패');
        }

        return response.json();
    }

    /**
     * 스냅샷 점수 계산 (실시간 피드백용)
     * @param {string} scoringProfileId - 스코어링 프로필 ID
     * @param {object} metrics - 현재 프레임의 metrics
     */
    async getSnapshotScore(scoringProfileId, metrics) {
        const response = await fetch(`${this.baseUrl}/score/snapshot`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                scoring_profile_id: scoringProfileId,
                metrics
            })
        });

        if (!response.ok) {
            throw new Error('스냅샷 점수 계산 실패');
        }

        return response.json();
    }

    /**
     * 세트 기록
     */
    async recordSet(sessionId, { setNo, phase, targetReps, actualReps, durationSec }) {
        const response = await fetch(`${this.baseUrl}/session/${sessionId}/set`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                set_no: setNo,
                phase: phase || 'WORK',
                target_reps: targetReps,
                actual_reps: actualReps,
                duration_sec: durationSec
            })
        });

        if (!response.ok) {
            throw new Error('세트 기록 실패');
        }

        return response.json();
    }
}

// 싱글톤 인스턴스
export const workoutApi = new WorkoutApiClient();
