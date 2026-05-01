const db = require('../config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

exports.login = async (req, res) => {
    console.log('Login attempt:', req.body);
    const { email, userId, password } = req.body;
    const identifier = email || userId;

    if (!identifier) {
        return res.status(400).json({ message: 'Email or User ID is required' });
    }

    try {
        console.log('Searching for user:', identifier);
        const [users] = await db.execute('SELECT * FROM users WHERE email = ?', [identifier]);
        console.log('Users found:', users.length);
        
        if (users.length === 0) {
            return res.status(401).json({ message: 'Invalid credentials (User not found)' });
        }

        const user = users[0];
        console.log('Comparing password for user:', user.email);
        
        // Use bcrypt to comparehashed password
        const isMatch = await bcrypt.compare(password, user.password);
        console.log('Password match:', isMatch);
        if (!isMatch) {
            return res.status(401).json({ message: 'Invalid credentials (Password mismatch)' });
        }

        const token = jwt.sign(
            { id: user.id, role: user.role, employee_id: user.employee_id },
            process.env.JWT_SECRET || 'biotrack_secret_key',
            { expiresIn: '24h' }
        );

        res.json({
            token,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                role: user.role,
                photo: user.photo,
                employee_id: user.employee_id
            }
        });
    } catch (err) {
        res.status(500).json({ message: 'Server error', error: err.message });
    }
};
