const db = require('../config/db');
const bcrypt = require('bcryptjs');

// Get all employees
exports.getAllEmployees = async (req, res) => {
    try {
        const [rows] = await db.execute('SELECT * FROM employees ORDER BY created_at DESC');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ message: 'Error fetching employees', error: err.message });
    }
};

// Add new employee
exports.addEmployee = async (req, res) => {
    const { 
        machine_id, 
        name, 
        role = '', 
        department = 'General', 
        shift = 'Morning Shift', 
        email = '', 
        phone = '', 
        salary_rate = 0, 
        salary_type = 'hourly', 
        password = 'password123', 
        joined_date = new Date().toISOString().split('T')[0], 
        photo = null 
    } = req.body;

    try {
        // 1. Insert into employees table
        const [empResult] = await db.execute(
            'INSERT INTO employees (machine_id, name, role, department, shift, email, phone, salary_rate, salary_type, joined_date, photo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [machine_id, name, role, department, shift, email, phone, salary_rate, salary_type, joined_date, photo]
        );

        const employeeId = empResult.insertId;
        const hashedPassword = await bcrypt.hash(password || '123456', 10);

        // 2. Create login user
        await db.execute(
            'INSERT INTO users (employee_id, email, password, role, name) VALUES (?, ?, ?, ?, ?)',
            [employeeId, email, hashedPassword, 'employee', name]
        );

        res.status(201).json({ message: 'Employee added successfully', id: employeeId });
    } catch (err) {
        res.status(500).json({ message: 'Error adding employee', error: err.message });
    }
};

// Get single employee details
exports.getEmployeeById = async (req, res) => {
    try {
        const [rows] = await db.execute('SELECT * FROM employees WHERE id = ?', [req.params.id]);
        if (rows.length === 0) return res.status(404).json({ message: 'Not found' });
        res.json(rows[0]);
    } catch (err) {
        res.status(500).json({ message: 'Server error' });
    }
};
// Delete employee
exports.deleteEmployee = async (req, res) => {
    const { id } = req.params;
    try {
        // First delete from users (if exists) or rely on CASCADE if set up
        await db.execute('DELETE FROM users WHERE employee_id = ?', [id]);
        
        // Then delete from employees
        const [result] = await db.execute('DELETE FROM employees WHERE id = ?', [id]);
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Employee not found' });
        }
        
        res.json({ message: 'Employee deleted successfully' });
    } catch (err) {
        res.status(500).json({ message: 'Error deleting employee', error: err.message });
    }
};
// Update employee
exports.updateEmployee = async (req, res) => {
    const { id } = req.params;
    const { 
        machine_id, 
        name, 
        role = '', 
        department = 'General', 
        shift = 'Morning Shift', 
        email = '', 
        phone = '', 
        salary_rate = 0, 
        salary_type = 'hourly', 
        password = '', 
        joined_date, 
        photo 
    } = req.body;

    try {
        // 1. Update employees table
        await db.execute(
            'UPDATE employees SET machine_id = ?, name = ?, role = ?, department = ?, shift = ?, email = ?, phone = ?, salary_rate = ?, salary_type = ?, joined_date = ?, photo = ? WHERE id = ?',
            [machine_id, name, role, department, shift, email, phone, salary_rate, salary_type, joined_date, photo, id]
        );

        // 2. Update users table if email, name or password provided
        if (email || name) {
            if (password) {
                const hashedPassword = await bcrypt.hash(password, 10);
                await db.execute(
                    'UPDATE users SET email = ?, name = ?, password = ? WHERE employee_id = ?',
                    [email, name, hashedPassword, id]
                );
            } else {
                await db.execute(
                    'UPDATE users SET email = ?, name = ? WHERE employee_id = ?',
                    [email, name, id]
                );
            }
        }

        res.json({ message: 'Employee updated successfully' });
    } catch (err) {
        res.status(500).json({ message: 'Error updating employee', error: err.message });
    }
};
