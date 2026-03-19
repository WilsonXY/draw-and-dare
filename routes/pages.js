const express = require('express');
const router = express.Router();

// Page Routes (UI Rendering)
router.get('/', (req, res) => {
    if (req.session.user) {
        res.render('main');
    } else {
        res.redirect('/login');
    }
});

router.get('/login', (req, res) => {
    res.render('login');
});

router.get('/signup', (req, res) => {
    res.render('signup');
});

// Render the Join Session Page
router.get('/join-session', (req, res) => {
    if (!req.session.user) {
        return res.redirect('/login');
    }
    res.render('join-session');
});

module.exports = router;