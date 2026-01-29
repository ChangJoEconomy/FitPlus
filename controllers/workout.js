const { supabase } = require('../config/db');
const { updateQuestProgress } = require('./quest');

// 자율 운동 목록 페이지
const getFreeWorkoutPage = async (req, res, next) => {
    try {
        // 운동 목록 조회
        const { data: exercises, error } = await supabase
            .from('exercise')
            .select('exercise_id, code, name, description')
            .eq('is_active', true)
            .order('name');

        if (error) throw error;

        res.render('workout/free', {
            title: '자율 운동',
            activeTab: 'workout',
            exercises: exercises || []
        });
    } catch (error) {
        next(error);
    }
};

// 자율 운동 화면
const getFreeWorkoutSession = async (req, res, next) => {
    try {
        const { exerciseCode } = req.params;
        const userId = req.user.user_id;

        // 운동 정보 조회
        const { data: exercise, error: exError } = await supabase
            .from('exercise')
            .select('exercise_id, code, name, description')
            .eq('code', exerciseCode)
            .eq('is_active', true)
            .single();

        if (exError || !exercise) {
            return res.redirect('/workout/free?error=운동을 찾을 수 없습니다');
        }

        // 활성화된 스코어링 프로필 조회
        const { data: scoringProfile, error: spError } = await supabase
            .from('scoring_profile')
            .select(`
                scoring_profile_id,
                version,
                name,
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
            .eq('exercise_id', exercise.exercise_id)
            .eq('is_active', true)
            .single();

        if (spError || !scoringProfile) {
            return res.redirect('/workout/free?error=스코어링 프로필이 설정되지 않았습니다');
        }

        // metrics 정렬
        scoringProfile.scoring_profile_metric.sort((a, b) => a.order_no - b.order_no);

        res.render('workout/session', {
            title: `${exercise.name} - 자율 운동`,
            activeTab: 'workout',
            mode: 'FREE',
            exercise,
            scoringProfile,
            routine: null,
            routineInstance: null,
            layout: 'layouts/workout'
        });
    } catch (error) {
        next(error);
    }
};

// 루틴 운동 화면
const getRoutineWorkoutSession = async (req, res, next) => {
    try {
        const { routineId } = req.params;
        const userId = req.user.user_id;

        // 루틴 정보 조회
        const { data: routine, error: rError } = await supabase
            .from('routine')
            .select(`
                routine_id,
                name,
                routine_setup (
                    step_id,
                    order_no,
                    target_type,
                    target_value,
                    rest_sec,
                    sets,
                    exercise:exercise_id (
                        exercise_id,
                        code,
                        name,
                        description
                    )
                )
            `)
            .eq('routine_id', routineId)
            .eq('user_id', userId)
            .eq('is_active', true)
            .single();

        if (rError || !routine) {
            return res.redirect('/routine?error=루틴을 찾을 수 없습니다');
        }

        // order_no 기준으로 정렬
        routine.routine_setup.sort((a, b) => a.order_no - b.order_no);

        if (routine.routine_setup.length === 0) {
            return res.redirect('/routine?error=루틴에 운동이 없습니다');
        }

        // 첫 번째 운동의 스코어링 프로필 조회
        const firstExercise = routine.routine_setup[0].exercise;
        const { data: scoringProfile, error: spError } = await supabase
            .from('scoring_profile')
            .select(`
                scoring_profile_id,
                version,
                name,
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
            .eq('exercise_id', firstExercise.exercise_id)
            .eq('is_active', true)
            .single();

        // 루틴 인스턴스 생성
        const { data: routineInstance, error: riError } = await supabase
            .from('routine_instance')
            .insert({
                routine_id: routineId
            })
            .select()
            .single();

        if (riError) throw riError;

        res.render('workout/session', {
            title: `${routine.name} - 루틴 운동`,
            activeTab: 'workout',
            mode: 'ROUTINE',
            exercise: firstExercise,
            scoringProfile: scoringProfile || null,
            routine,
            routineInstance,
            layout: 'layouts/workout'
        });
    } catch (error) {
        next(error);
    }
};

// 운동 세션 시작 API
const startWorkoutSession = async (req, res, next) => {
    try {
        const userId = req.user.user_id;
        const { exercise_id, scoring_profile_id, mode, routine_instance_id } = req.body;

        const sessionData = {
            user_id: userId,
            exercise_id,
            scoring_profile_id,
            mode: mode || 'FREE'
        };

        if (routine_instance_id) {
            sessionData.routine_instance_id = routine_instance_id;
        }

        const { data: session, error } = await supabase
            .from('workout_session')
            .insert(sessionData)
            .select()
            .single();

        if (error) throw error;

        res.json({ success: true, session });
    } catch (error) {
        next(error);
    }
};

// 운동 세션 종료 API
const endWorkoutSession = async (req, res, next) => {
    try {
        const { sessionId } = req.params;
        const userId = req.user.user_id;
        const { duration_sec, total_reps, final_score, summary_feedback, detail, exercise_code, sets } = req.body;

        // 세션 소유자 확인 및 업데이트
        const { data: session, error } = await supabase
            .from('workout_session')
            .update({
                ended_at: new Date().toISOString(),
                duration_sec,
                total_reps,
                final_score,
                summary_feedback,
                detail
            })
            .eq('session_id', sessionId)
            .eq('user_id', userId)
            .select(`
                *,
                exercise:exercise_id (code, name)
            `)
            .single();

        if (error) throw error;

        // 퀘스트 진행도 업데이트
        try {
            await updateQuestProgress(userId, {
                exercise_code: session.exercise?.code || exercise_code,
                duration_sec: duration_sec || 0,
                total_reps: total_reps || 0,
                final_score: final_score || 0,
                sets: sets || 1
            });
        } catch (questError) {
            console.error('Quest progress update failed:', questError);
            // 퀘스트 업데이트 실패해도 운동 완료는 성공으로 처리
        }

        res.json({ success: true, session });
    } catch (error) {
        next(error);
    }
};

// 운동 세트 기록 API
const recordWorkoutSet = async (req, res, next) => {
    try {
        const { sessionId } = req.params;
        const { set_no, phase, target_reps, actual_reps, duration_sec } = req.body;

        const { data: workoutSet, error } = await supabase
            .from('workout_set')
            .insert({
                session_id: sessionId,
                set_no,
                phase: phase || 'WORK',
                target_reps,
                actual_reps,
                duration_sec
            })
            .select()
            .single();

        if (error) throw error;

        res.json({ success: true, workoutSet });
    } catch (error) {
        next(error);
    }
};

// 세션 이벤트 기록 API
const recordSessionEvent = async (req, res, next) => {
    try {
        const { sessionId } = req.params;
        const { type, payload } = req.body;

        const { data: event, error } = await supabase
            .from('session_event')
            .insert({
                session_id: sessionId,
                type,
                payload
            })
            .select()
            .single();

        if (error) throw error;

        res.json({ success: true, event });
    } catch (error) {
        next(error);
    }
};

// 운동 결과 페이지
const getWorkoutResult = async (req, res, next) => {
    try {
        const { sessionId } = req.params;
        const userId = req.user.user_id;

        // 세션 정보 조회
        const { data: session, error } = await supabase
            .from('workout_session')
            .select(`
                session_id,
                mode,
                started_at,
                ended_at,
                duration_sec,
                total_reps,
                final_score,
                summary_feedback,
                detail,
                exercise:exercise_id (
                    exercise_id,
                    code,
                    name
                ),
                session_metric_result (
                    score,
                    raw,
                    metric:metric_id (
                        metric_id,
                        key,
                        title,
                        unit
                    )
                )
            `)
            .eq('session_id', sessionId)
            .eq('user_id', userId)
            .single();

        if (error || !session) {
            return res.redirect('/?error=세션을 찾을 수 없습니다');
        }

        // 오늘 총 운동 시간 조회
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const { data: todaySessions, error: tsError } = await supabase
            .from('workout_session')
            .select('duration_sec')
            .eq('user_id', userId)
            .gte('started_at', today.toISOString())
            .not('duration_sec', 'is', null);

        const totalTodayMinutes = todaySessions
            ? Math.round(todaySessions.reduce((sum, s) => sum + (s.duration_sec || 0), 0) / 60)
            : 0;

        res.render('workout/result', {
            title: '운동 결과',
            activeTab: 'workout',
            session,
            totalTodayMinutes
        });
    } catch (error) {
        next(error);
    }
};

// 운동 목록 API (스코어링 프로필 포함)
const getExercises = async (req, res, next) => {
    try {
        const { data: exercises, error } = await supabase
            .from('exercise')
            .select(`
                exercise_id,
                code,
                name,
                description,
                scoring_profile (
                    scoring_profile_id,
                    version,
                    name,
                    is_active
                )
            `)
            .eq('is_active', true)
            .order('name');

        if (error) throw error;

        res.json(exercises || []);
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getFreeWorkoutPage,
    getFreeWorkoutSession,
    getRoutineWorkoutSession,
    startWorkoutSession,
    endWorkoutSession,
    recordWorkoutSet,
    recordSessionEvent,
    getWorkoutResult,
    getExercises
};
