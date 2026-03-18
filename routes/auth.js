const express = require('express');
const bcrypt = require('bcrypt');
const router = express.Router();

// Sign Up Route
router.post('/api/signup', async (req, res) => {
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
router.post('/api/login', async (req, res) => {
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
router.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('Logout Error:', err);
            return res.status(500).send('Could not log out.');
        }
        res.redirect('/login');
    });
});

// Change Password Route
router.post('/api/change-password', async (req, res) => {
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

module.exports = router;