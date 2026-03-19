require('dotenv').config();
const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const session = require('express-session');
const mysql = require('mysql2/promise'); // Use promise wrapper

const app = express();
const PORT = process.env.PORT || 3000;

// View Engine Setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'pug');


// Middleware Configuration
app.use(express.static(path.join(__dirname, 'public')));

// Parse URL-encoded bodies
app.use(bodyParser.urlencoded({ extended: false }));

// Parse JSON bodies (for AJAX requests)
app.use(bodyParser.json());

// Configure Sessions
app.use(session({
    secret: process.env.SESSION_SECRET || 'draw_and_dare_secret_key',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: false,
        maxAge: 1000 * 60 * 60 * 24 // 24 hours
    }
}));

// Global variable middleware
app.use((req, res, next) => {
    // Make session data accessible in Pug templates
    res.locals.user = req.session.user || null;
    next();
});

// Database Connection Pool Setup
const db = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'drawanddare',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Pass the database pool to requests
app.use((req, res, next) => {
    req.db = db;
    next();
});

const authRoutes = require('./routes/auth');
const pageRoutes = require('./routes/pages');
const lobbyRoutes = require('./routes/lobby');
const gameRoutes = require('./routes/game');

app.use('/', authRoutes);
app.use('/', pageRoutes);
app.use('/', lobbyRoutes);
app.use('/', gameRoutes);

// 6. Start Server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});