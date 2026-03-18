const express = require('express');
const router = express.Router();

// Helper function to generate a random 6-digit code
function generateLobbyCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

// Polling endpoint for the lobby
router.get('/api/lobby-status', async (req, res) => {
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

// Create Lobby API (AJAX endpoint)
router.post('/api/create-lobby', async (req, res) => {
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

// Render the Lobby Page
router.get('/lobby', async (req, res) => {
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

// Join Lobby API (AJAX endpoint)
router.post('/api/join-lobby', async (req, res) => {
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

module.exports = router;