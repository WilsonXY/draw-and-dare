async function processEnemyCard(req, connection, participantId, activeEffectId, lobbyId, cardId, advanceTurn, activeLobbyQuestions) {
    let responsePayload = {};
    
    // Skip Enemy applied
    if (Number(activeEffectId) === 2) {
        await connection.execute('UPDATE Participants SET active_effect_id = NULL WHERE participant_id = ?', [participantId]);
        
        let pointsEarned = 10;
        await connection.execute(
            'UPDATE Participants SET current_score = current_score + ?, score_updated_at = CURRENT_TIMESTAMP WHERE participant_id = ?',
            [pointsEarned, participantId]
        );

        await connection.execute(
            'INSERT INTO GameLog (lobby_id, participant_id, card_id, applied_effect_id, points_earned) VALUES (?, ?, ?, ?, ?)',
            [lobbyId, participantId, cardId, 2, pointsEarned]
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
            cardId: cardId,
            questionId: questions[0].question_id
        };
        
        // Store the current question in memory for host view to sync
        activeLobbyQuestions[lobbyId] = {
            question: questions[0],
            username: req.session.user.username
        };

        responsePayload.question = questions[0];
    }

    return responsePayload;
}

module.exports = processEnemyCard;