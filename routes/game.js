const express = require('express');
const router = express.Router();

// In-memory store for currently active question
const activeLobbyQuestions = {};

// Helper to advance the turn
async function advanceTurn(lobbyId, connection) {
    delete activeLobbyQuestions[lobbyId];
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
        
        delete activeLobbyQuestions[lobbyId];

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
            'SELECT status FROM Lobby WHERE lobby_id = ?',
            [req.session.currentLobbyId]
        );

        if (lobbies.length === 0 || lobbies[0].status !== 'playing') {
            return res.redirect('/lobby'); // Send them back if the game hasnt started/has ended
        }

        // Render different views based on user's role
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

        let responsePayload = { success: true, cardType: card.card_type };

        // Process Logic Based on Card Type
        if (card.card_type === 'Empty Card') {
            let pointsEarned = 10; // Base points
            let consumedEffectId = null;

            // Double Score applied
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

            await connection.execute(
                'INSERT INTO GameLog (lobby_id, participant_id, card_id, applied_effect_id, points_earned) VALUES (?, ?, ?, ?, ?)',
                [lobbyId, participantId, card.card_id, consumedEffectId, pointsEarned]
            );

            responsePayload.points = pointsEarned;
            responsePayload.message = `Safe draw! +${pointsEarned} points.`;

            await advanceTurn(lobbyId, connection); // End turn

        } else if (card.card_type === 'Power Card') {
            // Apply a random effect
            const [effects] = await connection.execute(
                'SELECT * FROM PowerEffects ORDER BY RAND() LIMIT 1'
            );
            const effect = effects[0];
            const randomPowerEffectId = effect.power_effect_id;

            let activeEffectToSet = randomPowerEffectId;
            let pointsEarned = 0;
            let effectAddendum = '';

            // Point Steal
            if (randomPowerEffectId === 3) {
                activeEffectToSet = null

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

            await advanceTurn(lobbyId, connection); // End turn

        } else if (card.card_type === 'Enemy Card') {
            // Skip Enemy applied
            if (Number(activeEffectId) === 2) {
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

                // Use empty card UI to show skip status
                responsePayload.cardType = 'Empty Card';
                responsePayload.points = pointsEarned;
                responsePayload.message = `Enemy bypassed using your Skip power! +${pointsEarned} points.`;
                
                await advanceTurn(lobbyId, connection); // End turn
            } else {
                // Fetch a random question
                const [questions] = await connection.execute(
                    'SELECT question_id, question_text, option_a, option_b, option_c, option_d FROM Questions ORDER BY RAND() LIMIT 1'
                );
                
                // Store the current turn state in the session so we can verify the answer later
                req.session.currentTurn = {
                    cardId: card.card_id,
                    questionId: questions[0].question_id
                };
                
                // Store the current question in memory for host view to sync
                activeLobbyQuestions[lobbyId] = {
                    question: questions[0],
                    username: req.session.user.username
                };

                responsePayload.question = questions[0];
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
        let activeEffectId = participants[0].active_effect_id;

        // Verify answer
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

        // Calculate points based on assignment rules
        if (isCorrect) {
            pointsEarned = 20; 
            // Check `activeEffectId`
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

        // Log the turn in GameLog
        await connection.execute(
            'INSERT INTO GameLog (lobby_id, participant_id, question_id, card_id, applied_effect_id, points_earned, is_correct) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [lobbyId, participantId, questionId, cardId, consumedEffectId, pointsEarned, isCorrect]
        );

        // Clear current turn from session (to prevent duplicate submissions)
        req.session.currentTurn = null;

        await advanceTurn(lobbyId, connection); // End turn

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

// Host Dashboard Polling API
router.get('/api/host-data', async (req, res) => {
    if (!req.session.user || !req.session.currentLobbyId || !req.session.isHost) {
        return res.status(403).json({ success: false, message: 'Unauthorized.' });
    }

    const lobbyId = req.session.currentLobbyId;

    try {
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
            activeQuestion: activeLobbyQuestions[lobbyId] || null
        });

    } catch (error) {
        console.error('Host Data Error:', error);
        res.status(500).json({ success: false, message: 'Server error fetching host data.' });
    }
});

module.exports = router;