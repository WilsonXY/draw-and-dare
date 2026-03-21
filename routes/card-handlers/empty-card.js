async function processEmptyCard(connection, participantId, activeEffectId, lobbyId, cardId, advanceTurn) {
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
        [lobbyId, participantId, cardId, consumedEffectId, pointsEarned]
    );

    await advanceTurn(lobbyId, connection); // End turn

    return {
        points: pointsEarned,
        message: `Safe draw! +${pointsEarned} points.`
    };
}

module.exports = processEmptyCard;