const { test } = require('node:test');
const assert = require('node:assert/strict');
const TurnEngine = require('../lib/turn-engine');

// Simple fake connection to test at the database seam
function createFakeConnection({ card, participant, question, powerEffect, leaderboard, lobbyParticipants = [1, 2], currentTurn = 1 }) {
    const executedQueries = [];
    return {
        executedQueries,
        async execute(sql, params) {
            executedQueries.push({ sql, params });

            // Query card
            if (sql.includes('FROM Cards WHERE card_id = ?')) {
                return [[card]];
            }
            // Query participant
            if (sql.includes('FROM Participants WHERE participant_id = ?')) {
                return [[participant]];
            }
            // Query power effects
            if (sql.includes('FROM PowerEffects')) {
                return [[powerEffect || { power_effect_id: 1, name: 'Double Score', description: 'Doubles next points' }]];
            }
            // Query leaderboard
            if (sql.includes('FROM Participants WHERE lobby_id = ? ORDER BY current_score DESC')) {
                return [leaderboard || [{ participant_id: 1, current_score: 50 }]];
            }
            // Query questions
            if (sql.includes('FROM Questions')) {
                return [[question || { question_id: 99, question_text: 'What is 2+2?', option_a: '4', option_b: '3', option_c: '5', option_d: '6', correct_option: 'A' }]];
            }
            // Advance turn: lobby status
            if (sql.includes('SELECT current_turn_participant_id FROM Lobby WHERE lobby_id = ?')) {
                return [[{ current_turn_participant_id: currentTurn }]];
            }
            // Advance turn: participants list
            if (sql.includes('FROM Participants WHERE lobby_id = ? ORDER BY participant_id ASC')) {
                return [lobbyParticipants.map(id => ({ participant_id: id }))];
            }
            // Updates and Inserts
            return [{ affectedRows: 1, insertId: 1 }];
        }
    };
}

test('Slice 1: Empty Card draw awards 10 base points and advances turn', async () => {
    const fakeConn = createFakeConnection({
        card: { card_id: 10, card_type: 'Empty Card' },
        participant: { participant_id: 1, active_effect_id: null, current_score: 0 },
        lobbyParticipants: [1, 2],
        currentTurn: 1
    });

    const engine = new TurnEngine();
    const result = await engine.resolveCardDraw(fakeConn, {
        lobbyId: 100,
        participantId: 1,
        cardId: 10,
        username: 'Alice'
    });

    // 1. Verify outcome payload
    assert.deepEqual(result, {
        outcome: 'turn_completed',
        cardType: 'Empty Card',
        points: 10,
        message: 'Safe draw! +10 points.'
    });

    // 2. Verify score updated with 10 points
    const scoreUpdate = fakeConn.executedQueries.find(q => 
        q.sql.includes('UPDATE Participants SET current_score = current_score + ?')
    );
    assert.ok(scoreUpdate, 'Expected Participants score to be updated');
    assert.equal(scoreUpdate.params[0], 10);
    assert.equal(scoreUpdate.params[1], 1);

    // 3. Verify turn advanced to next participant (2)
    const turnUpdate = fakeConn.executedQueries.find(q => 
        q.sql.includes('UPDATE Lobby SET current_turn_participant_id = ?')
    );
    assert.ok(turnUpdate, 'Expected Lobby current_turn_participant_id to advance');
    assert.equal(turnUpdate.params[0], 2);
    assert.equal(turnUpdate.params[1], 100);
});

test('Slice 2: Empty Card draw doubles points to 20 when Double Score is active and clears effect', async () => {
    const fakeConn = createFakeConnection({
        card: { card_id: 10, card_type: 'Empty Card' },
        participant: { participant_id: 1, active_effect_id: 1, current_score: 10 },
        lobbyParticipants: [1, 2],
        currentTurn: 1
    });

    const engine = new TurnEngine();
    const result = await engine.resolveCardDraw(fakeConn, {
        lobbyId: 100,
        participantId: 1,
        cardId: 10,
        username: 'Alice'
    });

    // 1. Verify outcome payload has 20 points
    assert.deepEqual(result, {
        outcome: 'turn_completed',
        cardType: 'Empty Card',
        points: 20,
        message: 'Safe draw! +20 points.'
    });

    // 2. Verify score updated with 20 points
    const scoreUpdate = fakeConn.executedQueries.find(q => 
        q.sql.includes('UPDATE Participants SET current_score = current_score + ?')
    );
    assert.ok(scoreUpdate);
    assert.equal(scoreUpdate.params[0], 20);

    // 3. Verify active effect cleared
    const effectCleared = fakeConn.executedQueries.find(q => 
        q.sql.includes('UPDATE Participants SET active_effect_id = NULL')
    );
    assert.ok(effectCleared, 'Expected active_effect_id to be cleared to NULL');
    assert.equal(effectCleared.params[0], 1);

    // 4. Verify GameLog records applied_effect_id as 1
    const logInsert = fakeConn.executedQueries.find(q => 
        q.sql.includes('INSERT INTO GameLog')
    );
    assert.ok(logInsert);
    assert.equal(logInsert.params[3], 1);
    assert.equal(logInsert.params[4], 20);
});

test('Slice 3a: Enemy Card bypasses when Skip Enemy effect is active', async () => {
    const fakeConn = createFakeConnection({
        card: { card_id: 20, card_type: 'Enemy Card' },
        participant: { participant_id: 1, active_effect_id: 2, current_score: 0 },
        lobbyParticipants: [1, 2],
        currentTurn: 1
    });

    const engine = new TurnEngine();
    const result = await engine.resolveCardDraw(fakeConn, {
        lobbyId: 100,
        participantId: 1,
        cardId: 20,
        username: 'Alice'
    });

    // 1. Verify outcome payload
    assert.deepEqual(result, {
        outcome: 'turn_completed',
        cardType: 'Empty Card',
        points: 10,
        message: 'Enemy bypassed using your Skip power! +10 points.'
    });

    // 2. Verify active effect cleared
    const effectCleared = fakeConn.executedQueries.find(q => 
        q.sql.includes('UPDATE Participants SET active_effect_id = NULL')
    );
    assert.ok(effectCleared);

    // 3. Verify turn advanced
    const turnUpdate = fakeConn.executedQueries.find(q => 
        q.sql.includes('UPDATE Lobby SET current_turn_participant_id = ?')
    );
    assert.ok(turnUpdate);
});

test('Slice 3b: Enemy Card prompts a question and caches it when no skip effect', async () => {
    const mockQuestion = {
        question_id: 42,
        question_text: 'Which planet is closest to the sun?',
        option_a: 'Venus',
        option_b: 'Mercury',
        option_c: 'Mars',
        option_d: 'Jupiter'
    };

    const fakeConn = createFakeConnection({
        card: { card_id: 20, card_type: 'Enemy Card' },
        participant: { participant_id: 1, active_effect_id: null, current_score: 0 },
        question: mockQuestion,
        lobbyParticipants: [1, 2],
        currentTurn: 1
    });

    const engine = new TurnEngine();
    const result = await engine.resolveCardDraw(fakeConn, {
        lobbyId: 100,
        participantId: 1,
        cardId: 20,
        username: 'Alice'
    });

    // 1. Verify outcome payload requires question
    assert.deepEqual(result, {
        outcome: 'question_required',
        cardType: 'Enemy Card',
        question: mockQuestion
    });

    // 2. Verify turn was NOT advanced yet
    const turnUpdate = fakeConn.executedQueries.find(q => 
        q.sql.includes('UPDATE Lobby SET current_turn_participant_id = ?')
    );
    assert.equal(turnUpdate, undefined, 'Turn must not advance until answer is submitted');

    // 3. Verify active question is accessible via getActiveQuestion
    const cached = engine.getActiveQuestion(100);
    assert.ok(cached, 'Expected active question in memory cache');
    assert.equal(cached.question.question_id, 42);
    assert.equal(cached.username, 'Alice');
});

test('Slice 4a: Power Card draw applies power effect and advances turn', async () => {
    const fakeConn = createFakeConnection({
        card: { card_id: 30, card_type: 'Power Card' },
        participant: { participant_id: 1, active_effect_id: null, current_score: 0 },
        powerEffect: { power_effect_id: 1, name: 'Double Score', description: 'Next points earned are doubled.' },
        lobbyParticipants: [1, 2],
        currentTurn: 1
    });

    const engine = new TurnEngine();
    const result = await engine.resolveCardDraw(fakeConn, {
        lobbyId: 100,
        participantId: 1,
        cardId: 30,
        username: 'Alice'
    });

    // 1. Verify outcome payload
    assert.deepEqual(result, {
        outcome: 'turn_completed',
        cardType: 'Power Card',
        effectName: 'Double Score',
        effectDescription: 'Next points earned are doubled.'
    });

    // 2. Verify participant active_effect_id updated to 1
    const effectUpdate = fakeConn.executedQueries.find(q => 
        q.sql.includes('UPDATE Participants SET active_effect_id = ?')
    );
    assert.ok(effectUpdate);
    assert.equal(effectUpdate.params[0], 1);
    assert.equal(effectUpdate.params[1], 1);

    // 3. Verify turn advanced
    const turnUpdate = fakeConn.executedQueries.find(q => 
        q.sql.includes('UPDATE Lobby SET current_turn_participant_id = ?')
    );
    assert.ok(turnUpdate);
});

test('Slice 4b: Correct answer submission awards 20 points (doubled to 40 with Double Score) and advances turn', async () => {
    const fakeConn = createFakeConnection({
        participant: { participant_id: 1, active_effect_id: 1, current_score: 0 },
        question: { question_id: 42, correct_option: 'B' },
        lobbyParticipants: [1, 2],
        currentTurn: 1
    });

    const engine = new TurnEngine();
    // Simulate active question in memory via encapsulated helper
    engine.setMockActiveQuestion(100, { question_id: 42 }, 'Alice');

    const result = await engine.resolveAnswerSubmission(fakeConn, {
        lobbyId: 100,
        participantId: 1,
        questionId: 42,
        cardId: 20,
        selectedOption: 'B'
    });

    // 1. Verify outcome payload
    assert.deepEqual(result, {
        success: true,
        isCorrect: true,
        pointsEarned: 40,
        message: 'Correct! +40 points (Doubled!).'
    });

    // 2. Verify active effect cleared
    const effectCleared = fakeConn.executedQueries.find(q => 
        q.sql.includes('UPDATE Participants SET active_effect_id = NULL')
    );
    assert.ok(effectCleared);

    // 3. Verify score updated with 40
    const scoreUpdate = fakeConn.executedQueries.find(q => 
        q.sql.includes('UPDATE Participants SET current_score = current_score + ?')
    );
    assert.ok(scoreUpdate);
    assert.equal(scoreUpdate.params[0], 40);

    // 4. Verify turn advanced and active question cleared
    assert.equal(engine.getActiveQuestion(100), null, 'Active question must be cleared on turn advance');
});

test('Slice 4c: Incorrect answer submission awards 0 points and advances turn', async () => {
    const fakeConn = createFakeConnection({
        participant: { participant_id: 1, active_effect_id: null, current_score: 10 },
        question: { question_id: 42, correct_option: 'B' },
        lobbyParticipants: [1, 2],
        currentTurn: 1
    });

    const engine = new TurnEngine();
    engine.setMockActiveQuestion(100, { question_id: 42 }, 'Alice');

    const result = await engine.resolveAnswerSubmission(fakeConn, {
        lobbyId: 100,
        participantId: 1,
        questionId: 42,
        cardId: 20,
        selectedOption: 'C'
    });

    // 1. Verify outcome payload
    assert.deepEqual(result, {
        success: true,
        isCorrect: false,
        pointsEarned: 0,
        message: 'Incorrect. Better luck next time!'
    });

    // 2. Verify turn advanced and active question cleared
    assert.equal(engine.getActiveQuestion(100), null);
});

test('Slice 4d: Power Card with Point Steal steals up to 5 points from 1st place', async () => {
    const fakeConn = createFakeConnection({
        card: { card_id: 30, card_type: 'Power Card' },
        participant: { participant_id: 2, active_effect_id: null, current_score: 10 },
        powerEffect: { power_effect_id: 3, name: 'Point Steal', description: 'Steals points from the leader.' },
        leaderboard: [
            { participant_id: 1, current_score: 30 },
            { participant_id: 2, current_score: 10 }
        ],
        lobbyParticipants: [1, 2],
        currentTurn: 2
    });

    const engine = new TurnEngine();
    const result = await engine.resolveCardDraw(fakeConn, {
        lobbyId: 100,
        participantId: 2,
        cardId: 30,
        username: 'Bob'
    });

    assert.equal(result.outcome, 'turn_completed');
    assert.equal(result.cardType, 'Power Card');
    assert.match(result.effectDescription, /You stole 5 points from 1st place!/);

    // Verify 5 points subtracted from 1st place (participant 1)
    const subPoints = fakeConn.executedQueries.find(q => 
        q.sql.includes('UPDATE Participants SET current_score = current_score - ?')
    );
    assert.ok(subPoints);
    assert.equal(subPoints.params[0], 5);
    assert.equal(subPoints.params[1], 1);

    // Verify 5 points added to participant 2
    const addPoints = fakeConn.executedQueries.find(q => 
        q.sql.includes('UPDATE Participants SET current_score = current_score + ?')
    );
    assert.ok(addPoints);
    assert.equal(addPoints.params[0], 5);
    assert.equal(addPoints.params[1], 2);
});

test('Slice 4e: Standard correct answer without Double Score awards exactly 20 points', async () => {
    const fakeConn = createFakeConnection({
        participant: { participant_id: 1, active_effect_id: null, current_score: 5 },
        question: { question_id: 42, correct_option: 'A' },
        lobbyParticipants: [1, 2],
        currentTurn: 1
    });

    const engine = new TurnEngine();
    engine.setMockActiveQuestion(100, { question_id: 42 }, 'Alice');

    const result = await engine.resolveAnswerSubmission(fakeConn, {
        lobbyId: 100,
        participantId: 1,
        questionId: 42,
        cardId: 20,
        selectedOption: 'A'
    });

    assert.deepEqual(result, {
        success: true,
        isCorrect: true,
        pointsEarned: 20,
        message: 'Correct! +20 points.'
    });

    const scoreUpdate = fakeConn.executedQueries.find(q => 
        q.sql.includes('UPDATE Participants SET current_score = current_score + ?')
    );
    assert.ok(scoreUpdate);
    assert.equal(scoreUpdate.params[0], 20);
});

test('Slice 4f: Point Steal grants 10 bonus points if user is already in 1st place', async () => {
    const fakeConn = createFakeConnection({
        card: { card_id: 30, card_type: 'Power Card' },
        participant: { participant_id: 1, active_effect_id: null, current_score: 100 },
        powerEffect: { power_effect_id: 3, name: 'Point Steal', description: 'Steals points.' },
        leaderboard: [
            { participant_id: 1, current_score: 100 },
            { participant_id: 2, current_score: 50 }
        ],
        lobbyParticipants: [1, 2],
        currentTurn: 1
    });

    const engine = new TurnEngine();
    const result = await engine.resolveCardDraw(fakeConn, {
        lobbyId: 100,
        participantId: 1,
        cardId: 30,
        username: 'Alice'
    });

    assert.equal(result.outcome, 'turn_completed');
    assert.match(result.effectDescription, /You are already in 1st place! You gained 10 points instead!/);

    const addPoints = fakeConn.executedQueries.find(q => 
        q.sql.includes('UPDATE Participants SET current_score = current_score + ?')
    );
    assert.ok(addPoints);
    assert.equal(addPoints.params[0], 10);
    assert.equal(addPoints.params[1], 1);
});

test('Slice 4g: Point Steal caps at leader score when leader has less than 5 points', async () => {
    const fakeConn = createFakeConnection({
        card: { card_id: 30, card_type: 'Power Card' },
        participant: { participant_id: 2, active_effect_id: null, current_score: 0 },
        powerEffect: { power_effect_id: 3, name: 'Point Steal', description: 'Steals points.' },
        leaderboard: [
            { participant_id: 1, current_score: 3 },
            { participant_id: 2, current_score: 0 }
        ],
        lobbyParticipants: [1, 2],
        currentTurn: 2
    });

    const engine = new TurnEngine();
    const result = await engine.resolveCardDraw(fakeConn, {
        lobbyId: 100,
        participantId: 2,
        cardId: 30,
        username: 'Bob'
    });

    assert.equal(result.outcome, 'turn_completed');
    assert.match(result.effectDescription, /You stole 3 points from 1st place!/);

    const subPoints = fakeConn.executedQueries.find(q => 
        q.sql.includes('UPDATE Participants SET current_score = current_score - ?')
    );
    assert.ok(subPoints);
    assert.equal(subPoints.params[0], 3);
});

test('Slice 4h: Rejects answer submission when questionId does not match active question for lobby', async () => {
    const fakeConn = createFakeConnection({
        participant: { participant_id: 1, active_effect_id: null, current_score: 0 },
        question: { question_id: 42, correct_option: 'A' }
    });

    const engine = new TurnEngine();
    // Active question in lobby is 42
    engine.setMockActiveQuestion(100, { question_id: 42 }, 'Alice');

    // Attempt to submit answer for question 999
    await assert.rejects(
        async () => {
            await engine.resolveAnswerSubmission(fakeConn, {
                lobbyId: 100,
                participantId: 1,
                questionId: 999,
                cardId: 20,
                selectedOption: 'A'
            });
        },
        /Submitted question does not match active question for this lobby/
    );
});





