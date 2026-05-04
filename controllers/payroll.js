const db = require('../config/db');

exports.generatePayroll = async (req, res) => {
    const { employeeIds, cycleStart, cycleEnd } = req.body;
    try {
        const results = [];
        for (const empId of employeeIds) {
            const [empCheck] = await db.execute('SELECT created_by, salary_rate, salary_type FROM employees WHERE id = ?', [empId]);
            if (empCheck.length > 0 && req.user.role === 'admin' && empCheck[0].created_by !== req.user.id) continue;
            
            const employee = empCheck[0];
            const [attendance] = await db.execute(
                'SELECT status, total_hours FROM attendance WHERE employee_id = ? AND date BETWEEN ? AND ?',
                [empId, cycleStart, cycleEnd]
            );

            let totalHours = 0;
            let presentDays = 0;
            attendance.forEach(a => {
                totalHours += parseFloat(a.total_hours || 0);
                if (a.status === 'present' || a.status === 'late') presentDays++;
            });

            const rate = parseFloat(employee.salary_rate || 0);
            let grossEarnings = 0;
            if (employee.salary_type === 'hourly') grossEarnings = totalHours * rate;
            else if (employee.salary_type === 'daily') grossEarnings = presentDays * rate;

            const uif = grossEarnings * 0.01;
            const netSalary = grossEarnings - uif;

            const [existing] = await db.execute('SELECT id FROM payroll WHERE employee_id = ? AND cycle_start = ? AND cycle_end = ?', [empId, cycleStart, cycleEnd]);
            
            if (existing.length > 0) {
                await db.execute(
                    'UPDATE payroll SET total_hours = ?, gross_earnings = ?, uif_amount = ?, net_salary = ?, status = "pending" WHERE id = ?',
                    [totalHours, grossEarnings, uif, netSalary, existing[0].id]
                );
                results.push({ empId, action: 'updated' });
            } else {
                await db.execute(
                    'INSERT INTO payroll (employee_id, cycle_start, cycle_end, total_hours, gross_earnings, uif_amount, net_salary, status) VALUES (?, ?, ?, ?, ?, ?, ?, "pending")',
                    [empId, cycleStart, cycleEnd, totalHours, grossEarnings, uif, netSalary]
                );
                results.push({ empId, action: 'created' });
            }
        }
        res.json({ message: 'Payroll generation complete', results });
    } catch (err) {
        res.status(500).json({ message: 'Generation failed', error: err.message });
    }
};

exports.getPayrollHistory = async (req, res) => {
    try {
        let query = 'SELECT p.*, e.name, e.photo, e.salary_rate, e.salary_type FROM payroll p JOIN employees e ON p.employee_id = e.id';
        const params = [];

        if (req.user.role === 'employee') {
            query += ' WHERE p.employee_id = ?';
            params.push(req.user.employee_id);
        } else if (req.user.role === 'admin') {
            query += ' WHERE e.created_by = ?';
            params.push(req.user.id);
        }

        query += ' ORDER BY p.cycle_end DESC';
        const [rows] = await db.execute(query, params);

        const enhancedRows = await Promise.all(rows.map(async (p) => {
            // Safety: Avoid 'undefined' in query if columns are missing
            const start = p.cycle_start || null;
            const end = p.cycle_end || null;
            
            let shifts = [];
            if (start && end) {
                const [shiftRows] = await db.execute(
                    'SELECT date, total_hours FROM attendance WHERE employee_id = ? AND date BETWEEN ? AND ?',
                    [p.employee_id, start, end]
                );
                shifts = shiftRows;
            }

            return {
                ...p,
                shifts_data: shifts,
                totalEarnings: p.gross_earnings || 0,
                totalUIF: p.uif_amount || 0,
                netSalary: p.net_salary || 0
            };
        }));

        res.json(enhancedRows);
    } catch (err) {
        console.error('Payroll fetch error:', err);
        res.status(500).json({ message: 'Error fetching payroll', error: err.message });
    }
};

exports.getPayrollById = async (req, res) => {
    const { id } = req.params;
    try {
        const [rows] = await db.execute(
            'SELECT p.*, e.name, e.photo, e.role, e.department, e.salary_rate, e.salary_type FROM payroll p JOIN employees e ON p.employee_id = e.id WHERE p.id = ?',
            [id]
        );
        if (rows.length === 0) return res.status(404).json({ message: 'Not found' });
        
        const p = rows[0];
        const start = p.cycle_start || null;
        const end = p.cycle_end || null;
        let shifts = [];
        
        if (start && end) {
            const [shiftRows] = await db.execute(
                'SELECT date, total_hours, in_time, out_time, status FROM attendance WHERE employee_id = ? AND date BETWEEN ? AND ?',
                [p.employee_id, start, end]
            );
            shifts = shiftRows;
        }
        
        res.json({ ...p, shifts_data: shifts });
    } catch (err) {
        res.status(500).json({ message: 'Error', error: err.message });
    }
};

exports.updatePayrollStatus = async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    try {
        await db.execute('UPDATE payroll SET status = ? WHERE id = ?', [status, id]);
        res.json({ message: 'Status updated' });
    } catch (err) {
        res.status(500).json({ message: 'Update failed', error: err.message });
    }
};
