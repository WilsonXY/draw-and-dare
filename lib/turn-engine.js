const EFFECTS = {
    DOUBLE_SCORE: 1,
    SKIP_ENEMY: 2,
    POINT_STEAL: 3
};

const CARD_TYPES = {
    EMPTY: 'Empty Card',
    POWER: 'Power Card',
    ENEMY: 'Enemy Card'
};

class TurnEngine {
    #activeQuestions = new Map();

    async advanceTurn(connection, lobbyId) {
        this.#activeQuestions.delete(Number(lobbyId));
        const [lobby] = await connection.execute(
            'SELECT current_turn_participant_id FROM Lobby WHERE lobby_id = ?',
            [lobbyId]
        );
        if (lobby.length === 0 || !lobby[0].current_turn_participant_id) return;

        const currentId = lobby[0].current_turn_participant_id;
        const [participants] = await connection.execute(
            'SELECT participant_id FROM Participants WHERE lobby_id = ? ORDER BY participant_id ASC',
            [lobbyId]
        );

        if (participants.length > 0) {
            let nextIndex = 0;
            for (let i = 0; i < participants.length; i++) {
                if (participants[i].participant_id === currentId) {
                    nextIndex = (i + 1) % participants.length;
                    break;
                }
            }
            const nextId = participants[nextIndex].participant_id;
            await connection.execute(
                'UPDATE Lobby SET current_turn_participant_id = ? WHERE lobby_id = ?',
                [nextId, lobbyId]
            );
        }
    }

    async resolveCardDraw(connection, { lobbyId, participantId, cardId, username }) {
        const [cards] = await connection.execute(
            'SELECT * FROM Cards WHERE card_id = ?',
            [cardId]
        );
        if (cards.length === 0) {
            throw new Error('Card not found');
        }
        const card = cards[0];
        const participant = await this.#getParticipant(connection, participantId);
        const activeEffectId = participant ? participant.active_effect_id : null;

        switch (card.card_type) {
            case CARD_TYPES.EMPTY:
                return this.#handleEmptyCard(connection, { lobbyId, participantId, cardId, activeEffectId });
            case CARD_TYPES.ENEMY:
                return this.#handleEnemyCard(connection, { lobbyId, participantId, cardId, activeEffectId, username });
            case CARD_TYPES.POWER:
                return this.#handlePowerCard(connection, { lobbyId, participantId, cardId });
            default:
                throw new Error(`Unsupported card type: ${card.card_type}`);
        }
    }

    async #handleEmptyCard(connection, { lobbyId, participantId, cardId, activeEffectId }) {
        const { pointsEarned, consumedEffectId } = await this.#awardPoints(
            connection,
            participantId,
            10,
            activeEffectId
        );

        await connection.execute(
            'INSERT INTO GameLog (lobby_id, participant_id, card_id, applied_effect_id, points_earned) VALUES (?, ?, ?, ?, ?)',
            [lobbyId, participantId, cardId, consumedEffectId, pointsEarned]
        );

        await this.advanceTurn(connection, lobbyId);

        return {
            outcome: 'turn_completed',
            cardType: CARD_TYPES.EMPTY,
            points: pointsEarned,
            message: `Safe draw! +${pointsEarned} points.`
        };
    }

    async #handleEnemyCard(connection, { lobbyId, participantId, cardId, activeEffectId, username }) {
        // If Skip Enemy is active, bypass question and grant safe points
        if (Number(activeEffectId) === EFFECTS.SKIP_ENEMY) {
            await connection.execute(
                'UPDATE Participants SET active_effect_id = NULL WHERE participant_id = ?',
                [participantId]
            );

            const pointsEarned = 10;
            await connection.execute(
                'UPDATE Participants SET current_score = current_score + ?, score_updated_at = CURRENT_TIMESTAMP WHERE participant_id = ?',
                [pointsEarned, participantId]
            );

            await connection.execute(
                'INSERT INTO GameLog (lobby_id, participant_id, card_id, applied_effect_id, points_earned) VALUES (?, ?, ?, ?, ?)',
                [lobbyId, participantId, cardId, EFFECTS.SKIP_ENEMY, pointsEarned]
            );

            await this.advanceTurn(connection, lobbyId);

            // Return EMPTY cardType for client UI routing (displays points granted view)
            return {
                outcome: 'turn_completed',
                cardType: CARD_TYPES.EMPTY,
                points: pointsEarned,
                message: `Enemy bypassed using your Skip power! +${pointsEarned} points.`
            };
        }

        const [questions] = await connection.execute(
            'SELECT question_id, question_text, option_a, option_b, option_c, option_d FROM Questions ORDER BY RAND() LIMIT 1'
        );
        const question = questions[0];

        this.#activeQuestions.set(Number(lobbyId), {
            question,
            username
        });

        return {
            outcome: 'question_required',
            cardType: CARD_TYPES.ENEMY,
            question
        };
    }

    async #handlePowerCard(connection, { lobbyId, participantId, cardId }) {
        const [effects] = await connection.execute(
            'SELECT * FROM PowerEffects ORDER BY RAND() LIMIT 1'
        );
        const effect = effects[0];
        const randomPowerEffectId = effect.power_effect_id;

        let activeEffectToSet = randomPowerEffectId;
        let pointsEarned = 0;
        let effectAddendum = '';

        if (randomPowerEffectId === EFFECTS.POINT_STEAL) {
            activeEffectToSet = null;
            const stealResult = await this.#executePointSteal(connection, lobbyId, participantId);
            pointsEarned = stealResult.pointsEarned;
            effectAddendum = stealResult.effectAddendum;
        }

        await connection.execute(
            'UPDATE Participants SET active_effect_id = ? WHERE participant_id = ?',
            [activeEffectToSet, participantId]
        );

        await connection.execute(
            'INSERT INTO GameLog (lobby_id, participant_id, card_id, applied_effect_id, points_earned) VALUES (?, ?, ?, ?, ?)',
            [lobbyId, participantId, cardId, randomPowerEffectId, pointsEarned]
        );

        await this.advanceTurn(connection, lobbyId);

        return {
            outcome: 'turn_completed',
            cardType: CARD_TYPES.POWER,
            effectName: effect.name,
            effectDescription: effect.description + effectAddendum
        };
    }

    async #executePointSteal(connection, lobbyId, participantId) {
        const [leaderboard] = await connection.execute(
            'SELECT participant_id, current_score FROM Participants WHERE lobby_id = ? ORDER BY current_score DESC, score_updated_at ASC, participant_id ASC',
            [lobbyId]
        );

        if (leaderboard.length === 0) {
            return { pointsEarned: 0, effectAddendum: '' };
        }

        if (leaderboard[0].participant_id === participantId) {
            const pointsEarned = 10;
            await connection.execute(
                'UPDATE Participants SET current_score = current_score + ?, score_updated_at = CURRENT_TIMESTAMP WHERE participant_id = ?',
                [pointsEarned, participantId]
            );
            return {
                pointsEarned,
                effectAddendum: `\n\nYou are already in 1st place! You gained ${pointsEarned} points instead!`
            };
        }

        const targetId = leaderboard[0].participant_id;
        const targetScore = leaderboard[0].current_score;
        const pointsEarned = Math.min(5, targetScore);

        if (pointsEarned > 0) {
            await connection.execute(
                'UPDATE Participants SET current_score = current_score - ?, score_updated_at = CURRENT_TIMESTAMP WHERE participant_id = ?',
                [pointsEarned, targetId]
            );
            await connection.execute(
                'UPDATE Participants SET current_score = current_score + ?, score_updated_at = CURRENT_TIMESTAMP WHERE participant_id = ?',
                [pointsEarned, participantId]
            );
            return {
                pointsEarned,
                effectAddendum: `\n\nYou stole ${pointsEarned} points from 1st place!`
            };
        }

        return {
            pointsEarned: 0,
            effectAddendum: `\n\nYou tried to steal from 1st place, but they had 0 points to steal!`
        };
    }

    async #awardPoints(connection, participantId, basePoints, activeEffectId) {
        let pointsEarned = basePoints;
        let consumedEffectId = null;

        if (Number(activeEffectId) === EFFECTS.DOUBLE_SCORE) {
            pointsEarned *= 2;
            consumedEffectId = EFFECTS.DOUBLE_SCORE;
            await connection.execute(
                'UPDATE Participants SET active_effect_id = NULL WHERE participant_id = ?',
                [participantId]
            );
        }

        await connection.execute(
            'UPDATE Participants SET current_score = current_score + ?, score_updated_at = CURRENT_TIMESTAMP WHERE participant_id = ?',
            [pointsEarned, participantId]
        );

        return { pointsEarned, consumedEffectId };
    }

    async #getParticipant(connection, participantId) {
        const [participants] = await connection.execute(
            'SELECT participant_id, active_effect_id FROM Participants WHERE participant_id = ?',
            [participantId]
        );
        return participants[0] || null;
    }

    async resolveAnswerSubmission(connection, { lobbyId, participantId, questionId, cardId, selectedOption }) {
        const active = this.getActiveQuestion(lobbyId);
        if (active && active.question.question_id !== Number(questionId)) {
            throw new Error('Submitted question does not match active question for this lobby');
        }

        const participant = await this.#getParticipant(connection, participantId);
        if (!participant) {
            throw new Error('Participant not found');
        }

        const [questions] = await connection.execute(
            'SELECT correct_option FROM Questions WHERE question_id = ?',
            [questionId]
        );
        if (questions.length === 0) {
            throw new Error('Question not found');
        }

        const isCorrect = (questions[0].correct_option === selectedOption);
        let pointsEarned = 0;
        let consumedEffectId = null;

        if (isCorrect) {
            const award = await this.#awardPoints(
                connection,
                participantId,
                20,
                participant.active_effect_id
            );
            pointsEarned = award.pointsEarned;
            consumedEffectId = award.consumedEffectId;
        }

        await connection.execute(
            'INSERT INTO GameLog (lobby_id, participant_id, question_id, card_id, applied_effect_id, points_earned, is_correct) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [lobbyId, participantId, questionId, cardId, consumedEffectId, pointsEarned, isCorrect]
        );

        await this.advanceTurn(connection, lobbyId);

        let message = 'Incorrect. Better luck next time!';
        if (isCorrect) {
            message = consumedEffectId ? `Correct! +${pointsEarned} points (Doubled!).` : `Correct! +${pointsEarned} points.`;
        }

        return {
            success: true,
            isCorrect,
            pointsEarned,
            message
        };
    }

    getActiveQuestion(lobbyId) {
        return this.#activeQuestions.get(Number(lobbyId)) || null;
    }

    clearLobby(lobbyId) {
        this.#activeQuestions.delete(Number(lobbyId));
    }

    setMockActiveQuestion(lobbyId, question, username) {
        this.#activeQuestions.set(Number(lobbyId), { question, username });
    }
}

TurnEngine.EFFECTS = EFFECTS;
TurnEngine.CARD_TYPES = CARD_TYPES;
module.exports = TurnEngine;
