const db = require('../config/db');

exports.generatePayroll = async (req, res) => {
    const { startDate, endDate } = req.body;

    try {
        // 1. Get all active employees
        const [employees] = await db.execute('SELECT id, name, salary_rate, salary_type, advance_balance FROM employees WHERE status = "active"');

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

            // 4. Calculate UIF (1% of baseSalary)
            const uifAmount = baseSalary * 0.01;

            // 5. Calculate Deductions (Late penalties)
            let lateDeductions = 0;
            if (settings[0]?.late_deduction) {
                lateDeductions = lateCount * latePenaltyAmount;
            }

            // 6. Handle Advance Payment Deduction
            const advanceToDeduct = Math.min(emp.advance_balance || 0, baseSalary - lateDeductions - uifAmount);
            
            const netSalary = baseSalary - lateDeductions - uifAmount - advanceToDeduct;

            // 7. Delete existing record for this period if exists
            await db.execute('DELETE FROM payroll WHERE employee_id = ? AND cycle_start = ? AND cycle_end = ?', [emp.id, startDate, endDate]);

            // 8. Save to payroll table
            await db.execute(
                'INSERT INTO payroll (employee_id, cycle_start, cycle_end, total_hours, base_salary, deductions, uif_amount, advance_deduction, net_salary, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [emp.id, startDate, endDate, totalHours, baseSalary, lateDeductions, uifAmount, advanceToDeduct, netSalary, 'pending']
            );

            // 9. Update Employee Advance Balance if any was deducted
            if (advanceToDeduct > 0) {
                await db.execute('UPDATE employees SET advance_balance = advance_balance - ? WHERE id = ?', [advanceToDeduct, emp.id]);
            }
        }

        res.json({ message: 'Payroll generated successfully with UIF and Advance Deductions' });
    } catch (err) {
        res.status(500).json({ message: 'Payroll generation failed', error: err.message });
    }
};

exports.getPayrollHistory = async (req, res) => {
    try {
        let query = 'SELECT p.*, e.name, e.photo FROM payroll p JOIN employees e ON p.employee_id = e.id';
        const params = [];

        if (req.user.role === 'employee') {
            query += ' WHERE p.employee_id = ?';
            params.push(req.user.employee_id);
        }

        query += ' ORDER BY p.cycle_end DESC';
        const [rows] = await db.execute(query, params);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ message: 'Error fetching payroll' });
    }
};
exports.updatePayrollStatus = async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;

    try {
        if (!status || !id) {
            return res.status(400).json({ message: 'Missing status or id' });
        }
        await db.execute('UPDATE payroll SET status = ? WHERE id = ?', [status, id]);
        res.json({ message: `Payroll marked as ${status}` });
    } catch (err) {
        res.status(500).json({ message: 'Error updating payroll status', error: err.message });
    }
};
