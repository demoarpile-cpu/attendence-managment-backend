const db = require('../config/db');
const bcrypt = require('bcryptjs');

// Get all employees (Filtered by creator if admin)
exports.getAllEmployees = async (req, res) => {
    try {
        let query = 'SELECT * FROM employees';
        let params = [];

        // If admin, they only see staff they added
        if (req.user.role === 'admin') {
            query += ' WHERE (created_by = ? OR created_by IS NULL)';
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
        uif_number, advance_balance, eSignature, is_uif_registered 
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
        const formattedJoinedDate = joined_date ? joined_date.split('T')[0] : new Date().toISOString().split('T')[0];

        const [empResult] = await db.execute(
            'INSERT INTO employees (machine_id, custom_id, name, role, department, shift, email, phone, salary_rate, salary_type, joined_date, photo, uif_number, advance_balance, signature, created_by, is_uif_registered) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
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
                formattedJoinedDate, 
                photo || null, 
                uif_number || '', 
                advance_balance || 0, 
                eSignature || null,
                creatorId,
                is_uif_registered === undefined ? 1 : (is_uif_registered ? 1 : 0)
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
    const data = req.body;
    
    // Handle Profile Image Upload
    let photo = data.photo;
    if (req.file) {
        photo = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
    }

    try {
        // 1. Safety Check: Verify ownership if admin
        const [existing] = await db.execute('SELECT created_by FROM employees WHERE id = ?', [id]);
        if (existing.length === 0) return res.status(404).json({ message: 'Employee not found' });
        
        if (req.user.role === 'admin' && existing[0].created_by !== req.user.id && existing[0].created_by !== null) {
            return res.status(403).json({ message: 'Cannot edit staff added by another admin' });
        }

        // 2. Build Dynamic Update for Employees Table
        const empUpdates = [];
        const empParams = [];
        
        const empFields = [
            'machine_id', 'custom_id', 'name', 'role', 'department', 'shift', 
            'email', 'phone', 'salary_rate', 'salary_type', 'uif_number', 
            'advance_balance', 'status'
        ];

        empFields.forEach(field => {
            if (data[field] !== undefined) {
                empUpdates.push(`\`${field}\` = ?`);
                let val = data[field] === '' ? null : data[field];
                // Ensure numeric fields are numbers or null
                if (field === 'salary_rate' || field === 'advance_balance') {
                    val = val !== null ? parseFloat(val) : 0;
                }
                empParams.push(val);
            }
        });

        if (photo !== undefined) {
            empUpdates.push('`photo` = ?');
            empParams.push(photo);
        }

        if (data.eSignature !== undefined) {
            empUpdates.push('`signature` = ?');
            empParams.push(data.eSignature);
        }

        if (data.is_uif_registered !== undefined) {
            const isUif = data.is_uif_registered === 'true' || data.is_uif_registered === true || data.is_uif_registered === 1 || data.is_uif_registered === '1';
            empUpdates.push('`is_uif_registered` = ?');
            empParams.push(isUif ? 1 : 0);
        }

        if (data.joined_date) {
            empUpdates.push('`joined_date` = ?');
            empParams.push(data.joined_date.split('T')[0]);
        }

        if (empUpdates.length > 0) {
            const empQuery = `UPDATE employees SET ${empUpdates.join(', ')} WHERE id = ?`;
            empParams.push(id);
            await db.execute(empQuery, empParams);
        }

        // 3. Sync to Users Table (if relevant fields provided)
        const userUpdates = [];
        const userParams = [];

        if (data.email) { userUpdates.push('email = ?'); userParams.push(data.email); }
        if (data.name) { userUpdates.push('name = ?'); userParams.push(data.name); }
        if (photo) { userUpdates.push('photo = ?'); userParams.push(photo); }
        if (data.role) { userUpdates.push('role = ?'); userParams.push(data.role === 'admin' ? 'admin' : 'employee'); }
        
        if (data.password && data.password.trim() !== '') {
            const hashedPassword = await bcrypt.hash(data.password, 10);
            userUpdates.push('password = ?');
            userParams.push(hashedPassword);
        }

        if (userUpdates.length > 0) {
            try {
                const userQuery = `UPDATE users SET ${userUpdates.join(', ')} WHERE employee_id = ?`;
                userParams.push(id);
                await db.execute(userQuery, userParams);
            } catch (uErr) {
                console.error('⚠️ User sync failed:', uErr.message);
            }
        }

        res.json({ message: 'Record updated successfully' });
    } catch (err) {
        console.error('❌ Update Employee Error:', err);
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ message: 'Duplicate entry: Machine ID or Email already exists', error: err.message });
        }
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
