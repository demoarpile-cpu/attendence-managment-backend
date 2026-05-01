const db = require('../config/db');

// Get attendance logs
exports.getAttendance = async (req, res) => {
    const { date } = req.query;
    let employeeId = req.query.employeeId;

    // If logged in user is an employee, only show their own data
    if (req.user.role === 'employee') {
        employeeId = req.user.employee_id;
    }

    let query = 'SELECT a.*, e.name, e.role, e.photo, e.department FROM attendance a JOIN employees e ON a.employee_id = e.id';
    const params = [];

    if (date) {
        query += ' WHERE a.date = ?';
        params.push(date);
    }

    if (employeeId) {
        query += params.length > 0 ? ' AND a.employee_id = ?' : ' WHERE a.employee_id = ?';
        params.push(employeeId);
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
