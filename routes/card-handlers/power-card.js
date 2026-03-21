async function processPowerCard(connection, participantId, lobbyId, cardId, advanceTurn) {
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
        activeEffectToSet = null;

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
        [lobbyId, participantId, cardId, randomPowerEffectId, pointsEarned]
    );

    await advanceTurn(lobbyId, connection); // End turn

    return {
        effectName: effect.name,
        effectDescription: effect.description + effectAddendum
    };
}

module.exports = processPowerCard;