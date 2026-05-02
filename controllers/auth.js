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
        console.log('--- LOGIN DEBUG START ---');
        console.log('Identifier received:', identifier);
        
        // Comprehensive search: Check Email, Machine ID, or Employee Database ID
        const [users] = await db.execute(`
            SELECT u.*, e.name as emp_name, e.photo as emp_photo, e.machine_id, e.id as employee_db_id 
            FROM users u 
            LEFT JOIN employees e ON u.employee_id = e.id 
            WHERE u.email = ? OR e.machine_id = ? OR e.id = ?
        `, [identifier, identifier, identifier]);
        
        console.log('Database result count:', users.length);
        
        if (users.length === 0) {
            console.log('FAILURE: No user found matching identifier');
            return res.status(401).json({ message: 'Invalid credentials (User not found)' });
        }

        const user = users[0];
        console.log('User found:', { 
            db_id: user.id, 
            email: user.email, 
            emp_id: user.employee_id, 
            machine_id: user.machine_id,
            role: user.role 
        });

        // Password comparison
        console.log('Comparing password for:', user.email || `EMP-${user.employee_db_id}`);
        const isMatch = await bcrypt.compare(password, user.password);
        console.log('Password match result:', isMatch);
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
                name: user.emp_name || user.name, // Use latest employee name if available
                email: user.email,
                role: user.role,
                photo: user.emp_photo || user.photo, // Use latest employee photo if available
                employee_id: user.employee_id
            }
        });
    } catch (err) {
        res.status(500).json({ message: 'Server error', error: err.message });
    }
};
