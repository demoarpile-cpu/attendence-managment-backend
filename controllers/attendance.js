const db = require('../config/db');

// Get attendance logs
exports.getAttendance = async (req, res) => {
    const { date } = req.query;
    let employeeId = req.query.employeeId;

    // If logged in user is an employee, only show their own data
    if (req.user.role === 'employee') {
        employeeId = req.user.employee_id;
    }

    let query = 'SELECT a.*, e.name, e.role, e.photo, e.department, e.shift FROM attendance a JOIN employees e ON a.employee_id = e.id';
    const params = [];
 
    let whereClauses = [];
 
    if (date) {
        whereClauses.push('a.date = ?');
        params.push(date);
    }
 
    if (employeeId) {
        whereClauses.push('a.employee_id = ?');
        params.push(employeeId);
    }
 
    if (req.query.shift && req.query.shift !== 'All Shifts') {
        whereClauses.push('e.shift = ?');
        params.push(req.query.shift);
    }
 
    if (whereClauses.length > 0) {
        query += ' WHERE ' + whereClauses.join(' AND ');
    }
 
    query += ' ORDER BY a.date DESC, a.in_time DESC';
 
    try {
        const [rows] = await db.execute(query, params);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ message: 'Error fetching attendance', error: err.message });
    }
};

// Process Raw Logs into Attendance Sessions (The Logic)
exports.processLogs = async (req, res) => {
    try {
        // 1. Get all unprocessed raw logs
        const [rawLogs] = await db.execute('SELECT * FROM raw_logs WHERE is_processed = FALSE ORDER BY punch_time ASC');
        
        if (rawLogs.length === 0) return res.json({ message: 'No new logs to process' });

        for (let log of rawLogs) {
            const date = log.punch_time.toISOString().split('T')[0];
            
            // Find employee by machine_id
            const [emps] = await db.execute('SELECT id FROM employees WHERE machine_id = ?', [log.machine_user_id]);
            if (emps.length === 0) continue;

            const employeeId = emps[0].id;

            // Check if record for this day exists
            const [existing] = await db.execute('SELECT * FROM attendance WHERE employee_id = ? AND date = ?', [employeeId, date]);

            if (existing.length === 0) {
                // First punch of the day = IN
                await db.execute(
                    'INSERT INTO attendance (employee_id, date, in_time, status) VALUES (?, ?, ?, ?)',
                    [employeeId, date, log.punch_time, 'present']
                );
            } else {
                // Any subsequent punch = OUT (updates the existing record)
                const inTime = new Date(existing[0].in_time);
                const outTime = new Date(log.punch_time);
                const diffMs = outTime - inTime;
                const hours = (diffMs / (1000 * 60 * 60)).toFixed(2);

                await db.execute(
                    'UPDATE attendance SET out_time = ?, total_hours = ? WHERE id = ?',
                    [log.punch_time, hours, existing[0].id]
                );
            }

            // Mark log as processed
            await db.execute('UPDATE raw_logs SET is_processed = TRUE WHERE id = ?', [log.id]);
        }

        res.json({ message: 'Logs processed successfully' });
    } catch (err) {
        res.status(500).json({ message: 'Processing failed', error: err.message });
    }
};

exports.addManualAttendance = async (req, res) => {
    const { employeeId, date, inTime, outTime, status } = req.body;
    
    try {
        let totalHours = 0;
        let formattedIn = null;
        let formattedOut = null;

        if (inTime) {
            formattedIn = `${date} ${inTime}:00`;
        }
        
        if (outTime) {
            formattedOut = `${date} ${outTime}:00`;
        }

        if (inTime && outTime) {
            const start = new Date(formattedIn);
            const end = new Date(formattedOut);
            const diffMs = end - start;
            totalHours = (diffMs / (1000 * 60 * 60)).toFixed(2);
        }

        const query = 'INSERT INTO attendance (employee_id, date, in_time, out_time, total_hours, status) VALUES (?, ?, ?, ?, ?, ?)';
        await db.execute(query, [employeeId, date, formattedIn, formattedOut, totalHours, status || 'present']);
        
        res.json({ message: 'Manual attendance added successfully' });
    } catch (err) {
        res.status(500).json({ message: 'Failed to add manual attendance', error: err.message });
    }
};
exports.updateAttendance = async (req, res) => {
    const { id } = req.params;
    const { in_time, out_time, status } = req.body;
    
    try {
        let totalHours = 0;
        if (in_time && out_time) {
            const start = new Date(in_time);
            const end = new Date(out_time);
            const diffMs = end - start;
            totalHours = (diffMs / (1000 * 60 * 60)).toFixed(2);
        }

        await db.execute(
            'UPDATE attendance SET in_time = ?, out_time = ?, status = ?, total_hours = ? WHERE id = ?',
            [in_time, out_time, status, totalHours, id]
        );
        res.json({ message: 'Attendance updated successfully' });
    } catch (err) {
        res.status(500).json({ message: 'Update failed', error: err.message });
    }
};

exports.bulkMarkAttendance = async (req, res) => {
    const { employeeIds, date, status, inTime, outTime } = req.body;
    
    try {
        let totalHours = 0;
        let formattedIn = null;
        let formattedOut = null;

        if (inTime) formattedIn = `${date} ${inTime}:00`;
        if (outTime) formattedOut = `${date} ${outTime}:00`;

        if (inTime && outTime) {
            const start = new Date(formattedIn);
            const end = new Date(formattedOut);
            const diffMs = end - start;
            totalHours = (diffMs / (1000 * 60 * 60)).toFixed(2);
        }

        for (let empId of employeeIds) {
            // Check if exists
            const [existing] = await db.execute('SELECT id FROM attendance WHERE employee_id = ? AND date = ?', [empId, date]);
            
            if (existing.length > 0) {
                await db.execute(
                    'UPDATE attendance SET status = ?, in_time = ?, out_time = ?, total_hours = ? WHERE id = ?', 
                    [status, formattedIn, formattedOut, totalHours, existing[0].id]
                );
            } else {
                await db.execute(
                    'INSERT INTO attendance (employee_id, date, status, in_time, out_time, total_hours) VALUES (?, ?, ?, ?, ?, ?)', 
                    [empId, date, status, formattedIn, formattedOut, totalHours]
                );
            }
        }
        res.json({ message: 'Bulk attendance updated' });
    } catch (err) {
        res.status(500).json({ message: 'Bulk update failed', error: err.message });
    }
};
exports.getDashboardStats = async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        const now = new Date();
        const dayOfMonth = now.getDate();
        
        // Calculate cycle (1-15 or 16-31)
        const cycleStart = dayOfMonth <= 15 ? 1 : 16;
        const cycleEnd = dayOfMonth <= 15 ? 15 : 31;
        const progress = ((dayOfMonth - cycleStart + 1) / (cycleEnd - cycleStart + 1)) * 100;

        const [employees] = await db.execute('SELECT id, salary_rate, salary_type FROM employees WHERE status = "active"');
        const [attendance] = await db.execute('SELECT status, employee_id FROM attendance WHERE date = ?', [today]);
        
        // Calculate Payout (Simple estimate based on present days in current cycle)
        const cycleStartDate = new Date(now.getFullYear(), now.getMonth(), cycleStart).toISOString().split('T')[0];
        const [cycleAttendance] = await db.execute(
            'SELECT employee_id, COUNT(*) as days FROM attendance WHERE date BETWEEN ? AND ? AND (status = "present" || status = "late") GROUP BY employee_id',
            [cycleStartDate, today]
        );

        let totalPayout = 0;
        cycleAttendance.forEach(att => {
            const emp = employees.find(e => e.id === att.employee_id);
            if (emp) {
                totalPayout += att.days * (emp.salary_rate || 0);
            }
        });

        // Fetch last 7 days for trend graph
        const trendData = [];
        for (let i = 6; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            const dStr = d.toISOString().split('T')[0];
            const [attDay] = await db.execute('SELECT COUNT(*) as present FROM attendance WHERE date = ? AND (status = "present" || status = "late")', [dStr]);
            trendData.push({
                name: d.toLocaleDateString('en-US', { weekday: 'short' }),
                present: attDay[0].present,
                absent: employees.length - attDay[0].present
            });
        }

        res.json({
            totalStaff: employees.length,
            presentToday: attendance.filter(a => a.status?.toLowerCase() === 'present' || a.status?.toLowerCase() === 'late').length,
            absentToday: employees.length - attendance.filter(a => a.status?.toLowerCase() === 'present' || a.status?.toLowerCase() === 'late' || a.status?.toLowerCase() === 'half_day').length,
            lateToday: attendance.filter(a => a.status?.toLowerCase() === 'late').length,
            trend: trendData,
            salaryCycle: {
                progress: Math.min(Math.round(progress), 100),
                day: dayOfMonth - cycleStart + 1,
                totalDays: cycleEnd - cycleStart + 1,
                estimatedPayout: totalPayout,
                pendingAmount: (employees.length * 500 * (cycleEnd - dayOfMonth)) // Dummy estimate for pending
            }
        });
    } catch (err) {
        res.status(500).json({ message: 'Error fetching stats', error: err.message });
    }
};
