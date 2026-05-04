const db = require('../config/db');

exports.generatePayroll = async (req, res) => {
    const { startDate, endDate } = req.body;

    try {
        // 1. Get employees (Filtered by creator if admin)
        let query = 'SELECT id, name, salary_rate, salary_type, advance_balance FROM employees WHERE status = "active"';
        let params = [];

        if (req.user.role === 'admin') {
            query += ' AND created_by = ?';
            params.push(req.user.id);
        }

        const [employees] = await db.execute(query, params);

        // 2. Get settings for deduction rules
        const [settings] = await db.execute('SELECT late_deduction FROM settings LIMIT 1');
        const latePenaltyAmount = 100; // Default penalty per late mark

        for (let emp of employees) {
            // 3. Get attendance data for the period
            const [attendance] = await db.execute(
                'SELECT SUM(total_hours) as total_hours, COUNT(IF(status = "late", 1, NULL)) as late_count FROM attendance WHERE employee_id = ? AND date BETWEEN ? AND ?',
                [emp.id, startDate, endDate]
            );

            const totalHours = attendance[0].total_hours || 0;
            const lateCount = attendance[0].late_count || 0;
            
            let baseSalary = 0;
            if (emp.salary_type === 'hourly') {
                baseSalary = totalHours * emp.salary_rate;
            } else {
                const [days] = await db.execute(
                    'SELECT COUNT(*) as days FROM attendance WHERE employee_id = ? AND date BETWEEN ? AND ?',
                    [emp.id, startDate, endDate]
                );
                baseSalary = days[0].days * emp.salary_rate;
            }

            const uifAmount = baseSalary * 0.01;

            let lateDeductions = 0;
            if (settings[0]?.late_deduction) {
                lateDeductions = lateCount * latePenaltyAmount;
            }

            const advanceToDeduct = Math.min(emp.advance_balance || 0, baseSalary - lateDeductions - uifAmount);
            const netSalary = baseSalary - lateDeductions - uifAmount - advanceToDeduct;

            await db.execute('DELETE FROM payroll WHERE employee_id = ? AND cycle_start = ? AND cycle_end = ?', [emp.id, startDate, endDate]);

            await db.execute(
                'INSERT INTO payroll (employee_id, cycle_start, cycle_end, total_hours, base_salary, deductions, uif_amount, advance_deduction, net_salary, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [emp.id, startDate, endDate, totalHours, baseSalary, lateDeductions, uifAmount, advanceToDeduct, netSalary, 'pending']
            );

            if (advanceToDeduct > 0) {
                await db.execute('UPDATE employees SET advance_balance = advance_balance - ? WHERE id = ?', [advanceToDeduct, emp.id]);
            }
        }

        res.json({ message: 'Payroll generated successfully' });
    } catch (err) {
        res.status(500).json({ message: 'Payroll generation failed', error: err.message });
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
            const [shifts] = await db.execute(
                'SELECT date, total_hours FROM attendance WHERE employee_id = ? AND date BETWEEN ? AND ?',
                [p.employee_id, p.cycle_start, p.cycle_end]
            );

            const shiftDetails = shifts.map(s => {
                let earning = 0;
                if (p.salary_type === 'hourly') {
                    earning = s.total_hours * p.salary_rate;
                } else {
                    earning = p.salary_rate;
                }
                const uif = (earning * 0.01).toFixed(2);
                return {
                    date: s.date,
                    earning: earning.toFixed(2),
                    uif: parseFloat(uif)
                };
            });

            return { ...p, shifts: shiftDetails, totalUIF: p.uif_amount };
        }));

        res.json(enhancedRows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Error fetching payroll' });
    }
};

exports.updatePayrollStatus = async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;

    try {
        // Safety: If admin, verify ownership
        const [existing] = await db.execute('SELECT e.created_by FROM payroll p JOIN employees e ON p.employee_id = e.id WHERE p.id = ?', [id]);
        if (existing.length > 0 && req.user.role === 'admin' && existing[0].created_by !== req.user.id) {
            return res.status(403).json({ message: 'Cannot update payroll for staff added by another admin' });
        }

        await db.execute('UPDATE payroll SET status = ? WHERE id = ?', [status, id]);
        res.json({ message: `Payroll marked as ${status}` });
    } catch (err) {
        res.status(500).json({ message: 'Error updating payroll status', error: err.message });
    }
};
