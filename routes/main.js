const express = require('express');
const { getSignupPage, handleSignup, checkLoginId } = require('../controllers/signup');
const { getLoginPage, handleLogin } = require('../controllers/login');
const { requireGuest, handleLogout } = require('../middleware/auth');
const router = express.Router();

const formatKoreanDate = () => {
    const now = new Date();
    return `${now.getFullYear()}년 ${now.getMonth() + 1}월 ${now.getDate()}일`;
};

// admin 계정은 일반 페이지 접근 불가
const blockAdmin = (req, res, next) => {
    if (res.locals.isAuthenticated && res.locals.user?.login_id === 'admin') {
        return res.redirect('/admin');
    }
    next();
};

router.route('/')
    .get(blockAdmin, (req, res) => {
        res.render('home', {
            title: 'Home',
            today: formatKoreanDate(),
            activeTab: 'home'
        });
    });

// 로그인 (로그인한 사용자는 접근 불가)
router.route('/login')
    .get(requireGuest, getLoginPage)
    .post(requireGuest, handleLogin);

// 회원가입 (로그인한 사용자는 접근 불가)
router.route('/signup')
    .get(requireGuest, getSignupPage)
    .post(requireGuest, handleSignup);
router.post('/signup/check-id', checkLoginId);

// 로그아웃
router.get('/logout', handleLogout);

module.exports = router;