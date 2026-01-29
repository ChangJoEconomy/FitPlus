const { supabase } = require('../config/db');

// 현재 주의 시작일과 종료일 계산
const getWeekRange = () => {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const monday = new Date(now);
    monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
    monday.setHours(0, 0, 0, 0);
    
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);
    
    return { start: monday, end: sunday };
};

// 오늘 날짜 범위
const getTodayRange = () => {
    const now = new Date();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);
    
    return { start, end };
};

// 퀘스트 메인 페이지
const getQuestPage = async (req, res, next) => {
    try {
        const userId = req.user.user_id;
        const today = getTodayRange();
        const week = getWeekRange();
        
        // 사용자의 활성 퀘스트 조회
        const { data: userQuests, error: questError } = await supabase
            .from('user_quest')
            .select(`
                user_quest_id,
                status,
                progress,
                period_start,
                period_end,
                quest_template:quest_template_id (
                    quest_template_id,
                    scope,
                    type,
                    title,
                    condition,
                    reward_points
                )
            `)
            .eq('user_id', userId)
            .in('status', ['ACTIVE', 'DONE'])
            .gte('period_end', today.start.toISOString().split('T')[0])
            .order('created_at', { ascending: false });

        if (questError) throw questError;

        // 일일/주간 퀘스트 분류
        const dailyQuests = (userQuests || []).filter(q => q.quest_template?.scope === 'DAILY');
        const weeklyQuests = (userQuests || []).filter(q => q.quest_template?.scope === 'WEEKLY');

        // 사용자 포인트 조회
        const { data: pointData, error: pointError } = await supabase
            .from('point_ledger')
            .select('points')
            .eq('user_id', userId);

        const totalPoints = (pointData || []).reduce((sum, p) => sum + p.points, 0);

        // 티어 조회
        const { data: tierRules, error: tierError } = await supabase
            .from('tier_rule')
            .select('*')
            .order('min_points', { ascending: false });

        let currentTier = { tier: 1, name: '브론즈', min_points: 0 };
        let nextTier = null;

        if (tierRules && tierRules.length > 0) {
            for (let i = 0; i < tierRules.length; i++) {
                if (totalPoints >= tierRules[i].min_points) {
                    currentTier = tierRules[i];
                    nextTier = i > 0 ? tierRules[i - 1] : null;
                    break;
                }
            }
        }

        // 최근 포인트 이력 조회
        const { data: pointHistory, error: historyError } = await supabase
            .from('point_ledger')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(10);

        // 오늘 완료한 운동 세션 수
        const { count: todaySessions } = await supabase
            .from('workout_session')
            .select('session_id', { count: 'exact', head: true })
            .eq('user_id', userId)
            .gte('started_at', today.start.toISOString())
            .lte('started_at', today.end.toISOString())
            .not('ended_at', 'is', null);

        // 이번 주 운동 일수 계산
        const { data: weekSessions } = await supabase
            .from('workout_session')
            .select('started_at')
            .eq('user_id', userId)
            .gte('started_at', week.start.toISOString())
            .lte('started_at', week.end.toISOString())
            .not('ended_at', 'is', null);

        const uniqueDays = new Set(
            (weekSessions || []).map(s => new Date(s.started_at).toDateString())
        ).size;

        res.render('quest/index', {
            title: '퀘스트',
            activeTab: 'quest',
            dailyQuests,
            weeklyQuests,
            totalPoints,
            currentTier,
            nextTier,
            pointHistory: pointHistory || [],
            stats: {
                todaySessions: todaySessions || 0,
                weeklyDays: uniqueDays
            }
        });
    } catch (error) {
        next(error);
    }
};

// 퀘스트 완료 처리 API
const completeQuest = async (req, res, next) => {
    try {
        const userId = req.user.user_id;
        const { questId } = req.params;

        // 퀘스트 조회
        const { data: userQuest, error: fetchError } = await supabase
            .from('user_quest')
            .select(`
                *,
                quest_template:quest_template_id (
                    reward_points,
                    title
                )
            `)
            .eq('user_quest_id', questId)
            .eq('user_id', userId)
            .eq('status', 'ACTIVE')
            .single();

        if (fetchError || !userQuest) {
            return res.status(404).json({ error: '퀘스트를 찾을 수 없습니다.' });
        }

        // 퀘스트 완료 처리
        const { error: updateError } = await supabase
            .from('user_quest')
            .update({ 
                status: 'DONE',
                updated_at: new Date().toISOString()
            })
            .eq('user_quest_id', questId);

        if (updateError) throw updateError;

        // 포인트 지급
        const rewardPoints = userQuest.quest_template.reward_points;
        if (rewardPoints > 0) {
            const { error: pointError } = await supabase
                .from('point_ledger')
                .insert({
                    user_id: userId,
                    source_type: 'QUEST',
                    source_id: questId,
                    points: rewardPoints,
                    note: `퀘스트 완료: ${userQuest.quest_template.title}`
                });

            if (pointError) throw pointError;
        }

        res.json({ 
            success: true, 
            points: rewardPoints,
            message: `${rewardPoints} 포인트를 획득했습니다!`
        });
    } catch (error) {
        next(error);
    }
};

// 일일 퀘스트 자동 할당 (미들웨어로 사용 가능)
const assignDailyQuests = async (req, res, next) => {
    try {
        if (!req.user) {
            return next();
        }

        const userId = req.user.user_id;
        const today = new Date().toISOString().split('T')[0];

        // 오늘 할당된 일일 퀘스트 확인
        const { data: existingDaily } = await supabase
            .from('user_quest')
            .select('user_quest_id')
            .eq('user_id', userId)
            .eq('period_start', today)
            .limit(1);

        if (existingDaily && existingDaily.length > 0) {
            return next();
        }

        // 기본 일일 퀘스트 템플릿 조회
        const { data: dailyTemplates } = await supabase
            .from('quest_template')
            .select('*')
            .eq('scope', 'DAILY')
            .eq('is_default', true)
            .eq('is_active', true);

        if (dailyTemplates && dailyTemplates.length > 0) {
            const questsToInsert = dailyTemplates.map(t => ({
                user_id: userId,
                quest_template_id: t.quest_template_id,
                period_start: today,
                period_end: today,
                status: 'ACTIVE',
                progress: {}
            }));

            await supabase
                .from('user_quest')
                .insert(questsToInsert);
        }

        next();
    } catch (error) {
        console.error('Daily quest assignment error:', error);
        next();
    }
};

// 주간 퀘스트 자동 할당
const assignWeeklyQuests = async (req, res, next) => {
    try {
        if (!req.user) {
            return next();
        }

        const userId = req.user.user_id;
        const week = getWeekRange();
        const weekStart = week.start.toISOString().split('T')[0];
        const weekEnd = week.end.toISOString().split('T')[0];

        // 이번 주 할당된 주간 퀘스트 확인
        const { data: existingWeekly } = await supabase
            .from('user_quest')
            .select('user_quest_id, quest_template:quest_template_id(scope)')
            .eq('user_id', userId)
            .eq('period_start', weekStart);

        const hasWeekly = (existingWeekly || []).some(q => q.quest_template?.scope === 'WEEKLY');

        if (hasWeekly) {
            return next();
        }

        // 기본 주간 퀘스트 템플릿 조회
        const { data: weeklyTemplates } = await supabase
            .from('quest_template')
            .select('*')
            .eq('scope', 'WEEKLY')
            .eq('is_default', true)
            .eq('is_active', true);

        if (weeklyTemplates && weeklyTemplates.length > 0) {
            const questsToInsert = weeklyTemplates.map(t => ({
                user_id: userId,
                quest_template_id: t.quest_template_id,
                period_start: weekStart,
                period_end: weekEnd,
                status: 'ACTIVE',
                progress: {}
            }));

            await supabase
                .from('user_quest')
                .insert(questsToInsert);
        }

        next();
    } catch (error) {
        console.error('Weekly quest assignment error:', error);
        next();
    }
};

// 퀘스트 진행도 업데이트 (운동 완료 시 호출)
const updateQuestProgress = async (userId, workoutData) => {
    try {
        const today = getTodayRange();
        const week = getWeekRange();
        const todayStr = today.start.toISOString().split('T')[0];
        const weekStartStr = week.start.toISOString().split('T')[0];

        // 활성 퀘스트 조회
        const { data: activeQuests, error } = await supabase
            .from('user_quest')
            .select(`
                user_quest_id,
                status,
                progress,
                period_start,
                period_end,
                quest_template:quest_template_id (
                    quest_template_id,
                    scope,
                    type,
                    title,
                    condition,
                    reward_points
                )
            `)
            .eq('user_id', userId)
            .eq('status', 'ACTIVE');

        if (error || !activeQuests) return;

        for (const quest of activeQuests) {
            const template = quest.quest_template;
            if (!template) continue;

            const condition = template.condition || {};
            const progress = quest.progress || {};
            let updated = false;
            let newCurrent = progress.current || 0;

            // 퀘스트 타입별 진행도 업데이트
            switch (template.type) {
                case 'DO':
                    // 수행 퀘스트: 운동 완료 횟수, 특정 운동 완료 등
                    if (condition.metric === 'workout_count') {
                        newCurrent += 1;
                        updated = true;
                    } else if (condition.metric === 'exercise_code' && condition.value === workoutData.exercise_code) {
                        newCurrent += 1;
                        updated = true;
                    } else if (condition.metric === 'total_reps') {
                        newCurrent += (workoutData.total_reps || 0);
                        updated = true;
                    } else if (condition.metric === 'duration_min') {
                        newCurrent += Math.floor((workoutData.duration_sec || 0) / 60);
                        updated = true;
                    } else if (condition.metric === 'sets') {
                        newCurrent += (workoutData.sets || 1);
                        updated = true;
                    }
                    break;

                case 'QUALITY':
                    // 품질 퀘스트: 특정 점수 이상 달성
                    if (condition.metric === 'score_above' && workoutData.final_score >= condition.value) {
                        newCurrent = 1;
                        updated = true;
                    } else if (condition.metric === 'avg_score' && workoutData.final_score) {
                        // 평균 점수 계산 (누적)
                        const totalScore = (progress.totalScore || 0) + workoutData.final_score;
                        const count = (progress.count || 0) + 1;
                        newCurrent = Math.round(totalScore / count);
                        progress.totalScore = totalScore;
                        progress.count = count;
                        updated = true;
                    }
                    break;

                case 'HABIT':
                    // 습관 퀘스트: 연속 운동 일수, 주간 운동 일수
                    if (condition.metric === 'weekly_days') {
                        // 주간 운동 일수는 별도 계산 필요
                        const { data: weekSessions } = await supabase
                            .from('workout_session')
                            .select('started_at')
                            .eq('user_id', userId)
                            .gte('started_at', week.start.toISOString())
                            .lte('started_at', week.end.toISOString())
                            .not('ended_at', 'is', null);

                        const uniqueDays = new Set(
                            (weekSessions || []).map(s => new Date(s.started_at).toDateString())
                        ).size;
                        newCurrent = uniqueDays;
                        updated = true;
                    }
                    break;
            }

            if (updated) {
                progress.current = newCurrent;
                const target = condition.target || 1;

                // 목표 달성 시 자동 완료
                if (newCurrent >= target) {
                    await supabase
                        .from('user_quest')
                        .update({
                            status: 'DONE',
                            progress,
                            updated_at: new Date().toISOString()
                        })
                        .eq('user_quest_id', quest.user_quest_id);

                    // 포인트 지급
                    if (template.reward_points > 0) {
                        await supabase
                            .from('point_ledger')
                            .insert({
                                user_id: userId,
                                source_type: 'QUEST',
                                source_id: quest.user_quest_id,
                                points: template.reward_points,
                                note: `퀘스트 완료: ${template.title}`
                            });
                    }
                } else {
                    // 진행도만 업데이트
                    await supabase
                        .from('user_quest')
                        .update({
                            progress,
                            updated_at: new Date().toISOString()
                        })
                        .eq('user_quest_id', quest.user_quest_id);
                }
            }
        }
    } catch (error) {
        console.error('Quest progress update error:', error);
    }
};

// 수동 퀘스트 클레임 (완료 조건을 만족한 퀘스트 보상 수령)
const claimQuestReward = async (req, res, next) => {
    try {
        const userId = req.user.user_id;
        const { questId } = req.params;

        // 퀘스트 조회
        const { data: userQuest, error: fetchError } = await supabase
            .from('user_quest')
            .select(`
                *,
                quest_template:quest_template_id (
                    quest_template_id,
                    reward_points,
                    title,
                    condition
                )
            `)
            .eq('user_quest_id', questId)
            .eq('user_id', userId)
            .single();

        if (fetchError || !userQuest) {
            return res.status(404).json({ error: '퀘스트를 찾을 수 없습니다.' });
        }

        // 이미 완료된 퀘스트인지 확인
        if (userQuest.status === 'DONE') {
            return res.status(400).json({ error: '이미 완료된 퀘스트입니다.' });
        }

        // 진행도 확인
        const condition = userQuest.quest_template.condition || {};
        const progress = userQuest.progress || {};
        const current = progress.current || 0;
        const target = condition.target || 1;

        if (current < target) {
            return res.status(400).json({ 
                error: '퀘스트 조건을 충족하지 않았습니다.',
                current,
                target
            });
        }

        // 퀘스트 완료 처리
        const { error: updateError } = await supabase
            .from('user_quest')
            .update({
                status: 'DONE',
                updated_at: new Date().toISOString()
            })
            .eq('user_quest_id', questId);

        if (updateError) throw updateError;

        // 포인트 지급
        const rewardPoints = userQuest.quest_template.reward_points;
        if (rewardPoints > 0) {
            const { error: pointError } = await supabase
                .from('point_ledger')
                .insert({
                    user_id: userId,
                    source_type: 'QUEST',
                    source_id: questId,
                    points: rewardPoints,
                    note: `퀘스트 완료: ${userQuest.quest_template.title}`
                });

            if (pointError) throw pointError;
        }

        res.json({
            success: true,
            points: rewardPoints,
            message: `🎉 ${rewardPoints} 포인트를 획득했습니다!`
        });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getQuestPage,
    completeQuest,
    assignDailyQuests,
    assignWeeklyQuests,
    updateQuestProgress,
    claimQuestReward,
    getWeekRange,
    getTodayRange
};
