const db = require('../config/db');
const bcrypt = require('bcryptjs');

// Get all employees (Filtered by creator if admin)
exports.getAllEmployees = async (req, res) => {
    try {
        let query = 'SELECT * FROM employees';
        let params = [];

        // If admin, they only see staff they added
        if (req.user.role === 'admin') {
            query += ' WHERE created_by = ?';
            params.push(req.user.id);
        }

        query += ' ORDER BY created_at DESC';
        const [rows] = await db.execute(query, params);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ message: 'Error fetching employees', error: err.message });
    }
};

// Add new employee / staff / admin
exports.addEmployee = async (req, res) => {
    const { 
        machine_id, custom_id, name, role, department, shift, email, phone, 
        salary_rate, salary_type, password, joined_date, 
        uif_number, advance_balance, eSignature 
    } = req.body;
    
    // User who is creating this record
    const creatorId = req.user.id;

    // Use uploaded file if present
    let photo = req.body.photo;
    if (req.file) {
        photo = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
    }

    try {
        // 1. Insert into employees table
        const [empResult] = await db.execute(
            'INSERT INTO employees (machine_id, custom_id, name, role, department, shift, email, phone, salary_rate, salary_type, joined_date, photo, uif_number, advance_balance, signature, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [
                machine_id || null, 
                custom_id || '', 
                name || '', 
                role || 'employee', 
                department || 'General', 
                shift || 'Morning Shift', 
                email || '', 
                phone || '', 
                salary_rate || 0, 
                salary_type || 'hourly', 
                joined_date || new Date().toISOString().split('T')[0], 
                photo || null, 
                uif_number || '', 
                advance_balance || 0, 
                eSignature || null,
                creatorId
            ]
        );

        const employeeId = empResult.insertId;
        const hashedPassword = await bcrypt.hash(password || '123456', 10);

        // 2. Create login user
        // The role here determines if they get the admin dashboard or employee portal
        const finalRole = role === 'admin' ? 'admin' : 'employee';
        
        await db.execute(
            'INSERT INTO users (employee_id, email, password, role, name, created_by) VALUES (?, ?, ?, ?, ?, ?)',
            [employeeId, email || '', hashedPassword, finalRole, name || '', creatorId]
        );

        res.status(201).json({ message: 'Personnel added successfully', id: employeeId });
    } catch (err) {
        res.status(500).json({ message: 'Error adding personnel', error: err.message });
    }
};

// Get single employee details
exports.getEmployeeById = async (req, res) => {
    try {
        const [rows] = await db.execute('SELECT * FROM employees WHERE id = ?', [req.params.id]);
        if (rows.length === 0) return res.status(404).json({ message: 'Not found' });
        
        // Safety: If admin, check if they own this record
        if (req.user.role === 'admin' && rows[0].created_by !== req.user.id) {
            return res.status(403).json({ message: 'Access denied to this record' });
        }
        
        res.json(rows[0]);
    } catch (err) {
        res.status(500).json({ message: 'Server error' });
    }
};

// Update employee
exports.updateEmployee = async (req, res) => {
    const { id } = req.params;
    const { 
        machine_id, custom_id, name, role, department, shift, email, phone, 
        salary_rate, salary_type, joined_date, 
        uif_number, advance_balance, eSignature, status, password 
    } = req.body;

    // Use uploaded file if present
    let photo = req.body.photo;
    if (req.file) {
        photo = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
    }

    try {
        // Safety: If admin, verify ownership
        const [existing] = await db.execute('SELECT created_by FROM employees WHERE id = ?', [id]);
        if (existing.length > 0 && req.user.role === 'admin' && existing[0].created_by !== req.user.id) {
            return res.status(403).json({ message: 'Cannot edit records added by another admin' });
        }

        // 1. Update employees table
        await db.execute(
            'UPDATE employees SET machine_id = ?, custom_id = ?, name = ?, role = ?, department = ?, shift = ?, email = ?, phone = ?, salary_rate = ?, salary_type = ?, joined_date = ?, photo = ?, uif_number = ?, advance_balance = ?, signature = ?, status = ? WHERE id = ?',
            [
                machine_id || null, 
                custom_id || '', 
                name || '', 
                role || 'employee', 
                department || 'General', 
                shift || 'Morning Shift', 
                email || '', 
                phone || '', 
                salary_rate || 0, 
                salary_type || 'hourly', 
                joined_date || null, 
                photo || null, 
                uif_number || '', 
                advance_balance || 0, 
                eSignature || null,
                status || 'active',
                id
            ]
        );

        // 2. Update users table
        if (email || name || password || role) {
            let updateQuery = 'UPDATE users SET email = ?, name = ?';
            let params = [email, name];
            
            if (password) {
                const hashedPassword = await bcrypt.hash(password, 10);
                updateQuery += ', password = ?';
                params.push(hashedPassword);
            }
            
            if (role) {
                const finalRole = role === 'admin' ? 'admin' : 'employee';
                updateQuery += ', role = ?';
                params.push(finalRole);
            }
            
            updateQuery += ' WHERE employee_id = ?';
            params.push(id);
            
            await db.execute(updateQuery, params);
        }

        res.json({ message: 'Record updated successfully' });
    } catch (err) {
        res.status(500).json({ message: 'Error updating record', error: err.message });
    }
};

// Delete employee
exports.deleteEmployee = async (req, res) => {
    const { id } = req.params;
    try {
        // Safety: If admin, verify ownership
        const [existing] = await db.execute('SELECT created_by FROM employees WHERE id = ?', [id]);
        if (existing.length > 0 && req.user.role === 'admin' && existing[0].created_by !== req.user.id) {
            return res.status(403).json({ message: 'Cannot delete records added by another admin' });
        }

        await db.execute('DELETE FROM users WHERE employee_id = ?', [id]);
        const [result] = await db.execute('DELETE FROM employees WHERE id = ?', [id]);
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Record not found' });
        }
        
        res.json({ message: 'Record deleted successfully' });
    } catch (err) {
        res.status(500).json({ message: 'Error deleting record', error: err.message });
    }
};
