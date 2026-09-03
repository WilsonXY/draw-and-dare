const express = require('express');
const router = express.Router();
const TurnEngine = require('../lib/turn-engine');

const turnEngine = new TurnEngine();

// Start Game API (for the Host)
router.post('/api/start-game', async (req, res) => {
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

        // Update lobby status to 'playing'
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

// End Game API (for the Host)
router.post('/api/end-game', async (req, res) => {
    if (!req.session.user || !req.session.currentLobbyId || !req.session.isHost) {
        return res.status(403).json({ success: false, message: 'Unauthorized. Only the host can end the game.' });
    }

    try {
        const lobbyId = req.session.currentLobbyId;

        // Fetch final leaderboard
        const [leaderboard] = await req.db.execute(`
            SELECT u.username, p.current_score 
            FROM Participants p 
            JOIN Users u ON p.user_id = u.user_id 
            WHERE p.lobby_id = ? 
            ORDER BY p.current_score DESC, p.score_updated_at ASC, p.participant_id ASC
        `, [lobbyId]);

        // Update the lobby status
        const [result] = await req.db.execute(
            'UPDATE Lobby SET status = ? WHERE lobby_id = ? AND host_user_id = ?',
            ['ended', lobbyId, req.session.user.user_id]
        );

        if (result.affectedRows === 0) {
            return res.status(400).json({ success: false, message: 'Could not end the game. Lobby not found or invalid permissions.' });
        }
        
        // Store leaderboard in session to display on the final results page
        req.session.finalLeaderboard = leaderboard;

        // Clean up memory
        req.session.currentLobbyId = null;
        req.session.isHost = false;
        
        turnEngine.clearLobby(lobbyId);

        res.status(200).json({ 
            success: true, 
            message: 'Game ended!', 
            redirect: '/final-results' 
        });

    } catch (error) {
        console.error('End Game Error:', error);
        res.status(500).json({ success: false, message: 'Server error while ending the game.' });
    }
});

// Skip Turn API (for the Host)
router.post('/api/skip-turn', async (req, res) => {
    if (!req.session.user || !req.session.currentLobbyId || !req.session.isHost) {
        return res.status(403).json({ success: false, message: 'Unauthorized. Only the host can skip a turn.' });
    }

    const lobbyId = req.session.currentLobbyId;
    const connection = await req.db.getConnection();

    try {
        await connection.beginTransaction();

        // Get the current turn participant to ensure there is a turn to skip
        const [lobby] = await connection.execute('SELECT current_turn_participant_id FROM Lobby WHERE lobby_id = ?', [lobbyId]);
        if (lobby.length === 0 || !lobby[0].current_turn_participant_id) {
            await connection.rollback();
            return res.status(400).json({ success: false, message: 'No active turn to skip.' });
        }

        // Advance the turn
        await turnEngine.advanceTurn(connection, lobbyId);

        await connection.commit();

        res.status(200).json({ success: true, message: 'Turn skipped.' });

    } catch (error) {
        await connection.rollback();
        console.error('Skip Turn Error:', error);
        res.status(500).json({ success: false, message: 'Server error while skipping turn.' });
    } finally {
        connection.release();
    }
});

// Final Results Page
router.get('/final-results', (req, res) => {
    if (!req.session.user) {
        return res.redirect('/');
    }

    const leaderboard = req.session.finalLeaderboard || [];
    
    // Clear it so only viewed once
    req.session.finalLeaderboard = null;

    res.render('final-results', { 
        user: req.session.user,
        leaderboard: leaderboard
    });
});

// Render the Active Game Views
router.get('/game', async (req, res) => {
    if (!req.session.user || !req.session.currentLobbyId) {
        return res.redirect('/');
    }

    try {
        // Verify lobby state
        const [lobbies] = await req.db.execute(
            'SELECT status, lobby_code FROM Lobby WHERE lobby_id = ?',
            [req.session.currentLobbyId]
        );

        if (lobbies.length === 0 || lobbies[0].status !== 'playing') {
            return res.redirect('/lobby'); // Send them back if the game hasnt started/has ended
        }

        // Render different views based on user's role
        if (req.session.isHost) {
            res.render('host-view', { user: req.session.user, lobby_code: lobbies[0].lobby_code });
        } else {
            res.render('player-game', { user: req.session.user });
        }

    } catch (error) {
        console.error('Game Render Error:', error);
        res.status(500).send('Error loading the game.');
    }
});

// Scan Card API (for the Player)
router.post('/api/scan-card', async (req, res) => {
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

        // Identify Player's Participant ID
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

        // Verify it is player's turn
        const [lobby] = await connection.execute('SELECT current_turn_participant_id FROM Lobby WHERE lobby_id = ?', [lobbyId]);
        if (lobby.length > 0 && lobby[0].current_turn_participant_id !== participantId) {
            await connection.rollback();
            return res.status(403).json({ success: false, message: 'Wait for your turn to scan!' });
        }

        // Fetch Card Details
        const [cards] = await connection.execute(
            'SELECT * FROM Cards WHERE qr_code_value = ?',
            [qrCodeValue]
        );

        if (cards.length === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: 'Card not recognized.' });
        }
        const card = cards[0];

        const outcome = await turnEngine.resolveCardDraw(connection, {
            lobbyId,
            participantId,
            cardId: card.card_id,
            username: req.session.user.username
        });

        if (outcome.outcome === 'question_required') {
            req.session.currentTurn = {
                cardId: card.card_id,
                questionId: outcome.question.question_id
            };
        }

        await connection.commit();
        res.status(200).json({ success: true, ...outcome });

    } catch (error) {
        await connection.rollback();
        console.error('Scan Card Error:', error);
        res.status(500).json({ success: false, message: 'Server error processing card.' });
    } finally {
        connection.release();
    }
});

// Submit Answer API (for the Player)
router.post('/api/submit-answer', async (req, res) => {
    if (!req.session.user || !req.session.currentLobbyId || !req.session.currentTurn) {
        return res.status(400).json({ success: false, message: 'Invalid turn state.' });
    }

    const { selectedOption } = req.body; // 'A', 'B', 'C', 'D'
    const userId = req.session.user.user_id;
    const lobbyId = req.session.currentLobbyId;
    const { questionId, cardId } = req.session.currentTurn;

    if (!selectedOption) {
        return res.status(400).json({ success: false, message: 'No answer provided.' });
    }

    const connection = await req.db.getConnection();

    try {
        await connection.beginTransaction();

        // Get Participant ID
        const [participants] = await connection.execute(
            'SELECT participant_id, active_effect_id FROM Participants WHERE lobby_id = ? AND user_id = ?',
            [lobbyId, userId]
        );

        if (participants.length === 0) {
            await connection.rollback();
            return res.status(403).json({ success: false, message: 'Participant not found.' });
        }
        
        const participantId = participants[0].participant_id;

        const outcome = await turnEngine.resolveAnswerSubmission(connection, {
            lobbyId,
            participantId,
            questionId,
            cardId,
            selectedOption
        });

        // Clear current turn from session (to prevent duplicate submissions)
        req.session.currentTurn = null;

        await connection.commit();

        res.status(200).json(outcome);

    } catch (error) {
        await connection.rollback();
        console.error('Submit Answer Error:', error);
        res.status(500).json({ success: false, message: 'Server error processing answer.' });
    } finally {
        connection.release();
    }
});

// Host Dashboard Polling API
router.get('/api/host-data', async (req, res) => {
    if (!req.session.user || !req.session.currentLobbyId || !req.session.isHost) {
        return res.status(403).json({ success: false, message: 'Unauthorized.' });
    }

    const lobbyId = req.session.currentLobbyId;

    try {
        // Fetch Lobby Info for current turn
        const [lobbyInfo] = await req.db.execute('SELECT current_turn_participant_id FROM Lobby WHERE lobby_id = ?', [lobbyId]);

        // Fetch Leaderboard Data
        // Joins Participants with Users to get usernames, ordered by highest score
        const [leaderboard] = await req.db.execute(`
            SELECT u.username, p.current_score 
            FROM Participants p 
            JOIN Users u ON p.user_id = u.user_id 
            WHERE p.lobby_id = ? 
            ORDER BY p.current_score DESC, p.score_updated_at ASC, p.participant_id ASC
        `, [lobbyId]);

        // Fetch Game Log Data (the last 10 turns)
        // Joins GameLog with Participants, Users and Cards
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
            logs: logs,
            activeQuestion: turnEngine.getActiveQuestion(lobbyId),
            currentTurnParticipantId: lobbyInfo.length > 0 ? lobbyInfo[0].current_turn_participant_id : null
        });

    } catch (error) {
        console.error('Host Data Error:', error);
        res.status(500).json({ success: false, message: 'Server error fetching host data.' });
    }
});

module.exports = router;