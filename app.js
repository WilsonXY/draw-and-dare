const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const session = require('express-session');
const mysql = require('mysql2/promise'); // Using promise wrapper for async/await
const bcrypt = require('bcrypt');

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


// User Authentication API (AJAX endpoints)
// Sign Up Route
app.post('/api/signup', async (req, res) => {
    try {
        const { username, password } = req.body;

        // Basic validation
        if (!username || !password) {
            return res.status(400).json({ success: false, message: 'Username and password are required.' });
        }

        // Check if the username already exists
        const [existingUsers] = await req.db.execute(
            'SELECT * FROM Users WHERE username = ?',
            [username]
        );

        if (existingUsers.length > 0) {
            return res.status(409).json({ success: false, message: 'Username already taken.' });
        }

        // Hash the password securely with bcrypt
        const saltRounds = 5;
        const passwordHash = await bcrypt.hash(password, saltRounds);

        // Insert the new user into the database
        const [result] = await req.db.execute(
            'INSERT INTO Users (username, password_hash) VALUES (?, ?)',
            [username, passwordHash]
        );

        res.status(201).json({ success: true, message: 'Account created successfully! You can now log in.' });

    } catch (error) {
        console.error('Signup Error:', error);
        res.status(500).json({ success: false, message: 'Server error during signup.' });
    }
});

// Login Route
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ success: false, message: 'Username and password are required.' });
        }

        // Retrieve the user from the database
        const [users] = await req.db.execute(
            'SELECT * FROM Users WHERE username = ?',
            [username]
        );

        if (users.length === 0) {
            return res.status(401).json({ success: false, message: 'Invalid username or password.' });
        }

        const user = users[0];

        // Compare the provided password with the stored hash
        const match = await bcrypt.compare(password, user.password_hash);

        if (!match) {
            return res.status(401).json({ success: false, message: 'Invalid username or password.' });
        }

        // Establish the session
        req.session.user = {
            user_id: user.user_id,
            username: user.username
        };

        res.status(200).json({ success: true, message: 'Login successful!', redirect: '/' });

    } catch (error) {
        console.error('Login Error:', error);
        res.status(500).json({ success: false, message: 'Server error during login.' });
    }
});

// Logout Route
app.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('Logout Error:', err);
            return res.status(500).send('Could not log out.');
        }
        res.redirect('/login');
    });
});


// Change Password Route
app.post('/api/change-password', async (req, res) => {
    try {
        if (!req.session.user) {
            return res.status(401).json({ success: false, message: 'Unauthorized. Please log in.' });
        }

        const { newPassword } = req.body;

        if (!newPassword || newPassword.trim() === '') {
            return res.status(400).json({ success: false, message: 'New password is required.' });
        }

        const saltRounds = 5;
        const passwordHash = await bcrypt.hash(newPassword, saltRounds);

        const [result] = await req.db.execute(
            'UPDATE Users SET password_hash = ? WHERE user_id = ?',
            [passwordHash, req.session.user.user_id]
        );

        if (result.affectedRows === 0) {
            return res.status(400).json({ success: false, message: 'Failed to change password. User not found.' });
        }

        res.status(200).json({ success: true, message: 'Password changed successfully!' });
    } catch (error) {
        console.error('Change Password Error:', error);
        res.status(500).json({ success: false, message: 'Server error during password change.' });
    }
});


// 4. Standard Page Routes (UI Rendering)
app.get('/', (req, res) => {
    if (req.session.user) {
        res.render('main');
    } else {
        res.redirect('/login');
    }
});

app.get('/login', (req, res) => {
    res.render('login'); // Make sure you have login.pug from earlier
});

app.get('/signup', (req, res) => {
    res.render('signup');
});


// 5. AJAX API Endpoints (Data only, no UI)
// These routes will return JSON data for your jQuery AJAX calls

// Example: Polling endpoint for the lobby
app.get('/api/lobby-status', async (req, res) => {
    try {
        const lobbyId = req.session.currentLobbyId;
        if (!lobbyId) {
            return res.status(400).json({ error: 'No active lobby' });
        }

        // Fetch participants and lobby status from the database
        const [participants] = await req.db.execute(
            `SELECT u.username FROM Participants p 
             JOIN Users u ON p.user_id = u.user_id 
             WHERE p.lobby_id = ?`, 
            [lobbyId]
        );

        const [lobbyInfo] = await req.db.execute(
            'SELECT status, current_turn_participant_id FROM Lobby WHERE lobby_id = ?', 
            [lobbyId]
        );

        let isMyTurn = false;
        if (req.session.user) {
            const [me] = await req.db.execute(
                'SELECT participant_id FROM Participants WHERE lobby_id = ? AND user_id = ?', 
                [lobbyId, req.session.user.user_id]
            );
            if (me.length > 0 && lobbyInfo[0].current_turn_participant_id === me[0].participant_id) {
                isMyTurn = true;
            }
        }

        // Send JSON back to the client
        res.json({
            status: lobbyInfo[0].status,
            participants: participants,
            isMyTurn: isMyTurn
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Database error' });
    }
});


// Lobby & Game Management API
// Helper function to generate a random 6-digit code
function generateLobbyCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

// 1. Create Lobby API (AJAX endpoint)
app.post('/api/create-lobby', async (req, res) => {
    // Ensure the user is logged in
    if (!req.session.user) {
        return res.status(401).json({ success: false, message: 'Unauthorized. Please log in.' });
    }

    const hostUserId = req.session.user.user_id;
    let lobbyCode = generateLobbyCode();
    
    // Get a dedicated connection from the pool for the transaction
    const connection = await req.db.getConnection();

    try {
        await connection.beginTransaction();

        // Optional: Check if the code currently exists and is active
        let isUnique = false;
        while (!isUnique) {
            const [existing] = await connection.execute(
                'SELECT lobby_id FROM Lobby WHERE lobby_code = ? AND status != ?', 
                [lobbyCode, 'ended']
            );
            if (existing.length === 0) {
                isUnique = true;
            } else {
                lobbyCode = generateLobbyCode();
            }
        }

        // Insert the new lobby into the database
        const [lobbyResult] = await connection.execute(
            'INSERT INTO Lobby (host_user_id, status, lobby_code) VALUES (?, ?, ?)',
            [hostUserId, 'waiting', lobbyCode]
        );

        const lobbyId = lobbyResult.insertId;

        // Store lobby details and host status in the session
        req.session.currentLobbyId = lobbyId;
        req.session.isHost = true;

        await connection.commit();

        res.status(200).json({ 
            success: true, 
            message: 'Lobby created!', 
            redirect: '/lobby' 
        });

    } catch (error) {
        await connection.rollback();
        console.error('Create Lobby Error:', error);
        res.status(500).json({ success: false, message: 'Server error while creating lobby.' });
    } finally {
        // Always release the connection back to the pool
        connection.release();
    }
});

// 2. Render the Lobby Page
app.get('/lobby', async (req, res) => {
    if (!req.session.user || !req.session.currentLobbyId) {
        return res.redirect('/');
    }

    try {
        // Fetch the lobby details to display the code to the host
        const [lobbies] = await req.db.execute(
            'SELECT lobby_code FROM Lobby WHERE lobby_id = ?',
            [req.session.currentLobbyId]
        );

        if (lobbies.length === 0) {
            return res.redirect('/');
        }

        res.render('lobby', { 
            lobby_code: lobbies[0].lobby_code,
            isHost: req.session.isHost || false
        });

    } catch (error) {
        console.error('Lobby Render Error:', error);
        res.status(500).send('Error loading lobby.');
    }
});

// 3. Render the Join Session Page
app.get('/join-session', (req, res) => {
    if (!req.session.user) {
        return res.redirect('/login');
    }
    res.render('join-session');
});

// 4. Join Lobby API (AJAX endpoint)
app.post('/api/join-lobby', async (req, res) => {
    // Ensure the user is logged in
    if (!req.session.user) {
        return res.status(401).json({ success: false, message: 'Unauthorized. Please log in.' });
    }

    const { lobbyCode } = req.body;
    const userId = req.session.user.user_id;

    if (!lobbyCode) {
        return res.status(400).json({ success: false, message: 'Please enter a lobby code.' });
    }

    try {
        // Find the lobby using the provided code
        const [lobbies] = await req.db.execute(
            'SELECT lobby_id, status FROM Lobby WHERE lobby_code = ?',
            [lobbyCode]
        );

        if (lobbies.length === 0) {
            return res.status(404).json({ success: false, message: 'Lobby not found. Please check the code.' });
        }

        const lobby = lobbies[0];

        // Prevent joining if the game has already started or ended
        if (lobby.status !== 'waiting') {
            return res.status(403).json({ success: false, message: 'This game has already started or ended.' });
        }

        // Check if the user is already a participant in this specific lobby
        const [existingParticipant] = await req.db.execute(
            'SELECT participant_id FROM Participants WHERE lobby_id = ? AND user_id = ?',
            [lobby.lobby_id, userId]
        );

        // If they aren't already in the lobby, insert them into the Participants table
        if (existingParticipant.length === 0) {
            await req.db.execute(
                'INSERT INTO Participants (lobby_id, user_id, current_score) VALUES (?, ?, ?)',
                [lobby.lobby_id, userId, 0] // Starting score is 0
            );
        }

        // Update the user's session with the current game context
        req.session.currentLobbyId = lobby.lobby_id;
        req.session.isHost = false; // Ensure they are recognized as a standard player

        res.status(200).json({ 
            success: true, 
            message: 'Joined lobby successfully!', 
            redirect: '/lobby' 
        });

    } catch (error) {
        console.error('Join Lobby Error:', error);
        res.status(500).json({ success: false, message: 'Server error while joining lobby.' });
    }
});


// Game State API & Routes
// 1. Start Game API (AJAX endpoint for the Host)
app.post('/api/start-game', async (req, res) => {
    // Ensure the requester is logged in, has an active lobby, and is the host
    if (!req.session.user || !req.session.currentLobbyId || !req.session.isHost) {
        return res.status(403).json({ success: false, message: 'Unauthorized. Only the host can start the game.' });
    }

    try {
            // Get the first participant to start the game
            const [participants] = await req.db.execute(
                'SELECT participant_id FROM Participants WHERE lobby_id = ? ORDER BY participant_id ASC LIMIT 1',
                [req.session.currentLobbyId]
            );
            const startingParticipantId = participants.length > 0 ? participants[0].participant_id : null;

        // Update the lobby status to 'playing'
        const [result] = await req.db.execute(
                'UPDATE Lobby SET status = ?, current_turn_participant_id = ? WHERE lobby_id = ? AND host_user_id = ?',
                ['playing', startingParticipantId, req.session.currentLobbyId, req.session.user.user_id]
        );

        if (result.affectedRows === 0) {
            return res.status(400).json({ success: false, message: 'Could not start the game. Lobby not found or invalid permissions.' });
        }

        res.status(200).json({ 
            success: true, 
            message: 'Game started!', 
            redirect: '/game' 
        });

    } catch (error) {
        console.error('Start Game Error:', error);
        res.status(500).json({ success: false, message: 'Server error while starting the game.' });
    }
});

// End Game API (AJAX endpoint for the Host)
app.post('/api/end-game', async (req, res) => {
    // Ensure the requester is logged in, has an active lobby, and is the host
    if (!req.session.user || !req.session.currentLobbyId || !req.session.isHost) {
        return res.status(403).json({ success: false, message: 'Unauthorized. Only the host can end the game.' });
    }

    try {
        // Update the lobby status to 'ended'
        const [result] = await req.db.execute(
            'UPDATE Lobby SET status = ? WHERE lobby_id = ? AND host_user_id = ?',
            ['ended', req.session.currentLobbyId, req.session.user.user_id]
        );

        if (result.affectedRows === 0) {
            return res.status(400).json({ success: false, message: 'Could not end the game. Lobby not found or invalid permissions.' });
        }
        
        // Clear the active lobby from the host's session
        req.session.currentLobbyId = null;
        req.session.isHost = false;

        res.status(200).json({ 
            success: true, 
            message: 'Game ended!', 
            redirect: '/' 
        });

    } catch (error) {
        console.error('End Game Error:', error);
        res.status(500).json({ success: false, message: 'Server error while ending the game.' });
    }
});

// 2. Render the Active Game Views
app.get('/game', async (req, res) => {
    if (!req.session.user || !req.session.currentLobbyId) {
        return res.redirect('/');
    }

    try {
        // Verify the lobby is actually in the 'playing' state
        const [lobbies] = await req.db.execute(
            'SELECT status FROM Lobby WHERE lobby_id = ?',
            [req.session.currentLobbyId]
        );

        if (lobbies.length === 0 || lobbies[0].status !== 'playing') {
            return res.redirect('/lobby'); // Send them back if the game hasn't started or has ended
        }

        // Render the distinct views based on the user's role
        if (req.session.isHost) {
            res.render('host-view', { user: req.session.user });
        } else {
            res.render('player-game', { user: req.session.user });
        }

    } catch (error) {
        console.error('Game Render Error:', error);
        res.status(500).send('Error loading the game.');
    }
});


// Helper to advance the turn sequentially
async function advanceTurn(lobbyId, connection) {
    const [lobby] = await connection.execute('SELECT current_turn_participant_id FROM Lobby WHERE lobby_id = ?', [lobbyId]);
    if (lobby.length === 0 || !lobby[0].current_turn_participant_id) return;
    
    const currentId = lobby[0].current_turn_participant_id;
    const [participants] = await connection.execute('SELECT participant_id FROM Participants WHERE lobby_id = ? ORDER BY participant_id ASC', [lobbyId]);
    
    if (participants.length > 0) {
        let nextIndex = 0;
        for (let i = 0; i < participants.length; i++) {
            if (participants[i].participant_id === currentId) {
                nextIndex = (i + 1) % participants.length;
                break;
            }
        }
        const nextId = participants[nextIndex].participant_id;
        await connection.execute('UPDATE Lobby SET current_turn_participant_id = ? WHERE lobby_id = ?', [nextId, lobbyId]);
    }
}

// Core Game Loop API
// 1. Scan Card API (AJAX endpoint for the Player)
app.post('/api/scan-card', async (req, res) => {
    // Ensure the requester is logged in and in an active game
    if (!req.session.user || !req.session.currentLobbyId) {
        return res.status(401).json({ success: false, message: 'Unauthorized or not in a game.' });
    }

    const { qrCodeValue } = req.body;
    const userId = req.session.user.user_id;
    const lobbyId = req.session.currentLobbyId;

    if (!qrCodeValue) {
        return res.status(400).json({ success: false, message: 'Invalid QR Code.' });
    }

    const connection = await req.db.getConnection();

    try {
        await connection.beginTransaction();

        // 1. Identify the Player's Participant ID
        const [participants] = await connection.execute(
            'SELECT participant_id, active_effect_id FROM Participants WHERE lobby_id = ? AND user_id = ?',
            [lobbyId, userId]
        );

        if (participants.length === 0) {
            await connection.rollback();
            return res.status(403).json({ success: false, message: 'You are not a participant in this game.' });
        }
        const participantId = participants[0].participant_id;
        let activeEffectId = participants[0].active_effect_id;

        // Verify it is the player's turn
        const [lobby] = await connection.execute('SELECT current_turn_participant_id FROM Lobby WHERE lobby_id = ?', [lobbyId]);
        if (lobby.length > 0 && lobby[0].current_turn_participant_id !== participantId) {
            await connection.rollback();
            return res.status(403).json({ success: false, message: 'Wait for your turn to scan!' });
        }

        // 2. Fetch the Card Details
        const [cards] = await connection.execute(
            'SELECT * FROM Cards WHERE qr_code_value = ?',
            [qrCodeValue]
        );

        if (cards.length === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: 'Card not recognized.' });
        }
        const card = cards[0];

        let responsePayload = { success: true, cardType: card.card_type };

        // 3. Process Logic Based on Card Type
        if (card.card_type === 'Empty Card') {
            // Empty cards give safe points immediately
            let pointsEarned = 10; // Base points
            let consumedEffectId = null;

            if (Number(activeEffectId) === 1) { // Double Score
                pointsEarned *= 2;
                consumedEffectId = 1;
                await connection.execute(
                    'UPDATE Participants SET active_effect_id = NULL WHERE participant_id = ?',
                    [participantId]
                );
            }

            await connection.execute(
                'UPDATE Participants SET current_score = current_score + ?, score_updated_at = CURRENT_TIMESTAMP WHERE participant_id = ?',
                [pointsEarned, participantId]
            );

            await connection.execute(
                'INSERT INTO GameLog (lobby_id, participant_id, card_id, applied_effect_id, points_earned) VALUES (?, ?, ?, ?, ?)',
                [lobbyId, participantId, card.card_id, consumedEffectId, pointsEarned]
            );

            responsePayload.points = pointsEarned;
            responsePayload.message = `Safe draw! +${pointsEarned} points.`;

            await advanceTurn(lobbyId, connection); // Turn over!

        } else if (card.card_type === 'Power Card') {
            // Power cards apply a random effect to the user
            const [effects] = await connection.execute(
                'SELECT * FROM PowerEffects ORDER BY RAND() LIMIT 1'
            );
            const effect = effects[0];
            const randomPowerEffectId = effect.power_effect_id;

            let activeEffectToSet = randomPowerEffectId;
            let pointsEarned = 0;
            let effectAddendum = '';

            // point steal (3)
            if (randomPowerEffectId === 3) {
                activeEffectToSet = null; // Consume instantly

                const [leaderboard] = await connection.execute(
                    'SELECT participant_id, current_score FROM Participants WHERE lobby_id = ? ORDER BY current_score DESC, score_updated_at ASC, participant_id ASC',
                    [lobbyId]
                );

                if (leaderboard.length > 0 && leaderboard[0].participant_id === participantId) {
                    pointsEarned = 10;
                    await connection.execute('UPDATE Participants SET current_score = current_score + ?, score_updated_at = CURRENT_TIMESTAMP WHERE participant_id = ?', [pointsEarned, participantId]);
                    effectAddendum = `\n\nYou are already in 1st place! You gained ${pointsEarned} points instead!`;
                } else if (leaderboard.length > 0) {
                    const targetId = leaderboard[0].participant_id;
                    const targetScore = leaderboard[0].current_score;
                    pointsEarned = Math.min(5, targetScore);
                    
                    if (pointsEarned > 0) {
                        await connection.execute('UPDATE Participants SET current_score = current_score - ?, score_updated_at = CURRENT_TIMESTAMP WHERE participant_id = ?', [pointsEarned, targetId]);
                        await connection.execute('UPDATE Participants SET current_score = current_score + ?, score_updated_at = CURRENT_TIMESTAMP WHERE participant_id = ?', [pointsEarned, participantId]);
                        effectAddendum = `\n\nYou stole ${pointsEarned} points from 1st place!`;
                    } else {
                        effectAddendum = `\n\nYou tried to steal from 1st place, but they had 0 points to steal!`;
                    }
                }
            }

            await connection.execute(
                'UPDATE Participants SET active_effect_id = ? WHERE participant_id = ?',
                [activeEffectToSet, participantId]
            );

            await connection.execute(
                'INSERT INTO GameLog (lobby_id, participant_id, card_id, applied_effect_id, points_earned) VALUES (?, ?, ?, ?, ?)',
                [lobbyId, participantId, card.card_id, randomPowerEffectId, pointsEarned]
            );

            responsePayload.effectName = effect.name;
            responsePayload.effectDescription = effect.description + effectAddendum;

            await advanceTurn(lobbyId, connection); // Turn over!

        } else if (card.card_type === 'Enemy Card') {
            if (Number(activeEffectId) === 2) { // Skip Enemy
                await connection.execute('UPDATE Participants SET active_effect_id = NULL WHERE participant_id = ?', [participantId]);
                
                pointsEarned = 10;
                await connection.execute(
                    'UPDATE Participants SET current_score = current_score + ?, score_updated_at = CURRENT_TIMESTAMP WHERE participant_id = ?',
                    [pointsEarned, participantId]
                );

                await connection.execute(
                    'INSERT INTO GameLog (lobby_id, participant_id, card_id, applied_effect_id, points_earned) VALUES (?, ?, ?, ?, ?)',
                    [lobbyId, participantId, card.card_id, 2, pointsEarned]
                );

                // Re-route dynamically using empty card UI to show skip status
                responsePayload.cardType = 'Empty Card';
                responsePayload.points = pointsEarned;
                responsePayload.message = `Enemy bypassed using your Skip power! +${pointsEarned} points.`;
                
                await advanceTurn(lobbyId, connection); // Turn over!
            } else {
                // Enemy cards trigger a quiz. We don't award points yet.
                // Fetch a random question from the database
                const [questions] = await connection.execute(
                    'SELECT question_id, question_text, option_a, option_b, option_c, option_d FROM Questions ORDER BY RAND() LIMIT 1'
                );
                
                // Store the current turn state in the session so we can verify the answer later
                req.session.currentTurn = {
                    cardId: card.card_id,
                    questionId: questions[0].question_id
                };

                responsePayload.question = questions[0];
                // Do NOT advance turn yet, waiting for answer!
            }
        }

        await connection.commit();
        res.status(200).json(responsePayload);

    } catch (error) {
        await connection.rollback();
        console.error('Scan Card Error:', error);
        res.status(500).json({ success: false, message: 'Server error processing card.' });
    } finally {
        connection.release();
    }
});


// 2. Submit Answer API (AJAX endpoint for the Player)
app.post('/api/submit-answer', async (req, res) => {
    // Ensure the user is logged in, in a game, and currently has an active turn/question
    if (!req.session.user || !req.session.currentLobbyId || !req.session.currentTurn) {
        return res.status(400).json({ success: false, message: 'Invalid turn state.' });
    }

    const { selectedOption } = req.body; // Expected: 'A', 'B', 'C', or 'D'
    const userId = req.session.user.user_id;
    const lobbyId = req.session.currentLobbyId;
    const { questionId, cardId } = req.session.currentTurn;

    if (!selectedOption) {
        return res.status(400).json({ success: false, message: 'No answer provided.' });
    }

    const connection = await req.db.getConnection();

    try {
        await connection.beginTransaction();

        // 1. Get the Participant ID
        const [participants] = await connection.execute(
            'SELECT participant_id, active_effect_id FROM Participants WHERE lobby_id = ? AND user_id = ?',
            [lobbyId, userId]
        );

        if (participants.length === 0) {
            await connection.rollback();
            return res.status(403).json({ success: false, message: 'Participant not found.' });
        }
        
        const participantId = participants[0].participant_id;
        let activeEffectId = participants[0].active_effect_id;

        // 2. Verify the Answer
        const [questions] = await connection.execute(
            'SELECT correct_option FROM Questions WHERE question_id = ?',
            [questionId]
        );

        if (questions.length === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: 'Question not found.' });
        }

        const isCorrect = (questions[0].correct_option === selectedOption);
        let pointsEarned = 0;
        let consumedEffectId = null;

        // 3. Calculate Points based on Assignment Rules
        if (isCorrect) {
            // Enemy cards grant double the empty card's base points (10 * 2 = 20)
            pointsEarned = 20; 

            // Check `activeEffectId` to apply Double Score before saving points
            if (Number(activeEffectId) === 1) { 
                pointsEarned *= 2;
                consumedEffectId = 1;
                await connection.execute(
                    'UPDATE Participants SET active_effect_id = NULL WHERE participant_id = ?',
                    [participantId]
                );
            }
            
            await connection.execute(
                'UPDATE Participants SET current_score = current_score + ?, score_updated_at = CURRENT_TIMESTAMP WHERE participant_id = ?',
                [pointsEarned, participantId]
            );
        }

        // 4. Log the Turn in GameLog
        await connection.execute(
            'INSERT INTO GameLog (lobby_id, participant_id, question_id, card_id, applied_effect_id, points_earned, is_correct) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [lobbyId, participantId, questionId, cardId, consumedEffectId, pointsEarned, isCorrect]
        );

        // 5. Clear the current turn from the session to prevent duplicate submissions
        req.session.currentTurn = null;

        await advanceTurn(lobbyId, connection); // Turn over!

        await connection.commit();

        res.status(200).json({
            success: true,
            isCorrect: isCorrect,
            pointsEarned: pointsEarned,
            message: isCorrect ? 'Correct Answer!' : 'Incorrect Answer.'
        });

    } catch (error) {
        await connection.rollback();
        console.error('Submit Answer Error:', error);
        res.status(500).json({ success: false, message: 'Server error processing answer.' });
    } finally {
        connection.release();
    }
});


// Host View Data API
// 3. Host Dashboard Polling API
app.get('/api/host-data', async (req, res) => {
    // Ensure the requester is a logged-in host with an active game
    if (!req.session.user || !req.session.currentLobbyId || !req.session.isHost) {
        return res.status(403).json({ success: false, message: 'Unauthorized.' });
    }

    const lobbyId = req.session.currentLobbyId;

    try {
        // 1. Fetch Leaderboard Data
        // Joins Participants with Users to get usernames, ordered by highest score
        const [leaderboard] = await req.db.execute(`
            SELECT u.username, p.current_score 
            FROM Participants p 
            JOIN Users u ON p.user_id = u.user_id 
            WHERE p.lobby_id = ? 
            ORDER BY p.current_score DESC, p.score_updated_at ASC, p.participant_id ASC
        `, [lobbyId]);

        // 2. Fetch Game Log Data (Last 10 turns)
        // Joins GameLog with Participants, Users, and Cards to generate human-readable events
        const [logs] = await req.db.execute(`
            SELECT u.username, c.card_type, g.points_earned, g.is_correct, pe.name AS power_name
            FROM GameLog g 
            JOIN Participants p ON g.participant_id = p.participant_id 
            JOIN Users u ON p.user_id = u.user_id 
            JOIN Cards c ON g.card_id = c.card_id 
            LEFT JOIN PowerEffects pe ON g.applied_effect_id = pe.power_effect_id
            WHERE g.lobby_id = ? 
            ORDER BY g.turn_id DESC 
            LIMIT 10
        `, [lobbyId]);

        res.status(200).json({ 
            success: true, 
            leaderboard: leaderboard, 
            logs: logs 
        });

    } catch (error) {
        console.error('Host Data Error:', error);
        res.status(500).json({ success: false, message: 'Server error fetching host data.' });
    }
});


// 6. Start Server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});