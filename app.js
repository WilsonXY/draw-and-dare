const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const session = require('express-session');
const mysql = require('mysql2/promise'); // Using promise wrapper for async/await

const app = express();
const PORT = process.env.PORT || 3000;


// 1. View Engine Setup (Pug)
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'pug');


// 2. Middleware Configuration
// Serve static files (CSS, client-side JS, images)
app.use(express.static(path.join(__dirname, 'public')));

// Parse URL-encoded bodies (Standard form submissions)
app.use(bodyParser.urlencoded({ extended: false }));

// Parse JSON bodies (Crucial for receiving AJAX requests)
app.use(bodyParser.json());

// Configure Sessions
app.use(session({
    secret: 'draw_and_dare_secret_key', // Replace with a strong environment variable in production
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: false, // Set to true if using HTTPS
        maxAge: 1000 * 60 * 60 * 24 // 24 hours
    }
}));

// Global variable middleware for Pug templates
app.use((req, res, next) => {
    // Make session data accessible in all Pug templates
    res.locals.user = req.session.user || null;
    next();
});

// 3. Database Connection Pool Setup
// It's best practice to use a pool rather than a single connection
const db = mysql.createPool({
    host: 'localhost',
    user: 'root', // Replace with your MySQL username
    password: 'MySQL050530140787.', // Replace with your MySQL password
    database: 'drawanddare', // Database name
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Pass the database pool to requests so routes can use it
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