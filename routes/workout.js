const express = require('express');
const { requireAuth } = require('../middleware/auth');
const {
    getRoutinesPage,
    getRoutineDetail,
    getNewRoutinePage,
    getEditRoutinePage,
    createRoutine,
    updateRoutine,
    deleteRoutine
} = require('../controllers/routine');
const {
    getFreeWorkoutPage,
    getFreeWorkoutSession,
    getRoutineWorkoutSession,
    startWorkoutSession,
    endWorkoutSession,
    recordWorkoutSet,
    recordSessionEvent,
    recordRepEvent,
    getWorkoutResult,
    getExercises,
    getPoseTestPage
} = require('../controllers/workout');


const router = express.Router();

// ============ 루틴 라우트 ============

// 루틴 목록 페이지
router.get('/routine', requireAuth, getRoutinesPage);

// 새 루틴 만들기 페이지
router.get('/routine/new', requireAuth, getNewRoutinePage);

// 루틴 수정 페이지
router.get('/routine/:routineId/edit', requireAuth, getEditRoutinePage);

// 루틴 API
router.post('/api/routine', requireAuth, createRoutine);
router.get('/api/routine/:routineId', requireAuth, getRoutineDetail);
router.put('/api/routine/:routineId', requireAuth, updateRoutine);
router.delete('/api/routine/:routineId', requireAuth, deleteRoutine);

// ============ 운동 라우트 ============

// 자율 운동 목록
router.get('/workout/free', requireAuth, getFreeWorkoutPage);

// 자율 운동 세션
router.get('/workout/free/:exerciseCode', requireAuth, getFreeWorkoutSession);

// 루틴 운동 세션
router.get('/workout/routine/:routineId', requireAuth, getRoutineWorkoutSession);

// 운동 결과 페이지
router.get('/workout/result/:sessionId', requireAuth, getWorkoutResult);

// 운동 API
router.get('/api/exercises', getExercises);
router.post('/api/workout/session', requireAuth, startWorkoutSession);
router.put('/api/workout/session/:sessionId/end', requireAuth, endWorkoutSession);
router.post('/api/workout/session/:sessionId/set', requireAuth, recordWorkoutSet);

// Rep 이벤트 API (클라이언트에서 계산된 점수 저장)
router.post('/api/workout/session/:sessionId/rep', requireAuth, recordRepEvent);

// 테스트 라우트
router.get('/workout/pose-test', getPoseTestPage);

module.exports = router;
