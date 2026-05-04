const db = require('../config/db');

// Get attendance logs (Filtered by creator if admin)
exports.getAttendance = async (req, res) => {
    const { date } = req.query;
    let employeeId = req.query.employeeId;

    if (req.user.role === 'employee') {
        employeeId = req.user.employee_id;
    }

    let query = 'SELECT a.*, e.name, e.role, e.photo, e.department, e.shift, e.salary_rate, e.salary_type, e.created_by FROM attendance a JOIN employees e ON a.employee_id = e.id';
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

    if (req.query.date_from && req.query.date_to) {
        whereClauses.push('a.date BETWEEN ? AND ?');
        params.push(req.query.date_from, req.query.date_to);
    }

    // Data Isolation for Multi-Admin
    if (req.user.role === 'admin') {
        whereClauses.push('e.created_by = ?');
        params.push(req.user.id);
    }

    if (whereClauses.length > 0) {
        query += ' WHERE ' + whereClauses.join(' AND ');
    }
 
    query += ' ORDER BY a.date DESC, a.in_time DESC';
 
    try {
        const [rows] = await db.execute(query, params);
        const enhancedRows = rows.map(row => {
            const hours = parseFloat(row.total_hours || 0);
            const rate = parseFloat(row.salary_rate || 0);
            let earning = 0;
            if (row.salary_type === 'hourly') earning = hours * rate;
            else if (row.salary_type === 'daily') earning = hours > 0 ? rate : 0;
            const uif = earning * 0.01;
            return { ...row, earning: earning.toFixed(2), uif: uif.toFixed(2) };
        });
        res.json(enhancedRows);
    } catch (err) {
        res.status(500).json({ message: 'Error fetching attendance', error: err.message });
    }
};

// Process Raw Logs (Machine logs might need to be filtered or globally processed)
exports.processLogs = async (req, res) => {
    try {
        const [rawLogs] = await db.execute('SELECT * FROM raw_logs WHERE is_processed = FALSE ORDER BY punch_time ASC');
        if (rawLogs.length === 0) return res.json({ message: 'No new logs' });

        for (let log of rawLogs) {
            const date = log.punch_time.toISOString().split('T')[0];
            const [emps] = await db.execute('SELECT id FROM employees WHERE machine_id = ?', [log.machine_user_id]);
            if (emps.length === 0) continue;
            const employeeId = emps[0].id;
            const [existing] = await db.execute('SELECT * FROM attendance WHERE employee_id = ? AND date = ?', [employeeId, date]);

            if (existing.length === 0) {
                await db.execute('INSERT INTO attendance (employee_id, date, in_time, status) VALUES (?, ?, ?, ?)', [employeeId, date, log.punch_time, 'present']);
            } else {
                const inTime = new Date(existing[0].in_time);
                const outTime = new Date(log.punch_time);
                const diffMs = outTime - inTime;
                const hours = (diffMs / (1000 * 60 * 60)).toFixed(2);
                await db.execute('UPDATE attendance SET out_time = ?, total_hours = ? WHERE id = ?', [log.punch_time, hours, existing[0].id]);
            }
            await db.execute('UPDATE raw_logs SET is_processed = TRUE WHERE id = ?', [log.id]);
        }
        res.json({ message: 'Logs processed' });
    } catch (err) {
        res.status(500).json({ message: 'Processing failed', error: err.message });
    }
};

exports.addManualAttendance = async (req, res) => {
    const { employeeId, date, inTime, outTime, status } = req.body;
    try {
        // Safety: Verify admin owns this employee
        const [emp] = await db.execute('SELECT created_by FROM employees WHERE id = ?', [employeeId]);
        if (emp.length > 0 && req.user.role === 'admin' && emp[0].created_by !== req.user.id) {
            return res.status(403).json({ message: 'Cannot mark attendance for staff added by another admin' });
        }

        let totalHours = 0;
        let fIn = inTime ? `${date} ${inTime}:00` : null;
        let fOut = outTime ? `${date} ${outTime}:00` : null;
        if (fIn && fOut) {
            totalHours = ((new Date(fOut) - new Date(fIn)) / (1000 * 60 * 60)).toFixed(2);
        }
        await db.execute('INSERT INTO attendance (employee_id, date, in_time, out_time, total_hours, status) VALUES (?, ?, ?, ?, ?, ?)', [employeeId, date, fIn, fOut, totalHours, status || 'present']);
        await logAudit(req.user.id, 'ADD_MANUAL_ATTENDANCE', employeeId, { date, status });
        res.json({ message: 'Added successfully' });
    } catch (err) {
        res.status(500).json({ message: 'Failed', error: err.message });
    }
};

exports.updateAttendance = async (req, res) => {
    const { id } = req.params;
    const { in_time, out_time, status } = req.body;
    try {
        // Safety: Verify admin owns this attendance record via employee
        const [existing] = await db.execute('SELECT e.created_by FROM attendance a JOIN employees e ON a.employee_id = e.id WHERE a.id = ?', [id]);
        if (existing.length > 0 && req.user.role === 'admin' && existing[0].created_by !== req.user.id) {
            return res.status(403).json({ message: 'Cannot update record' });
        }

        let totalHours = 0;
        if (in_time && out_time) {
            const diff = new Date(out_time) - new Date(in_time);
            if (!isNaN(diff)) {
                totalHours = (diff / (1000 * 60 * 60)).toFixed(2);
            }
        }
        
        const finalStatus = status ? status.toLowerCase() : 'present';
        await db.execute('UPDATE attendance SET in_time = ?, out_time = ?, status = ?, total_hours = ? WHERE id = ?', [in_time, out_time, finalStatus, totalHours, id]);
        res.json({ message: 'Updated' });
    } catch (err) {
        res.status(500).json({ message: 'Failed', error: err.message });
    }
};

exports.bulkMarkAttendance = async (req, res) => {
    const { employeeIds, date, status, inTime, outTime } = req.body;
    try {
        // Set default times if not provided: 8am and 5pm
        const finalIn = inTime || '08:00';
        const finalOut = outTime || '17:00';
        
        let fIn = `${date} ${finalIn}:00`;
        let fOut = `${date} ${finalOut}:00`;
        let totalHours = ((new Date(fOut) - new Date(fIn)) / (1000 * 60 * 60)).toFixed(2);

        for (let empId of employeeIds) {
            // Check ownership
            const [emp] = await db.execute('SELECT created_by FROM employees WHERE id = ?', [empId]);
            if (emp.length > 0 && req.user.role === 'admin' && emp[0].created_by !== req.user.id) continue;

            const [existing] = await db.execute('SELECT id FROM attendance WHERE employee_id = ? AND date = ?', [empId, date]);
            if (existing.length > 0) {
                await db.execute(
                    'UPDATE attendance SET status = ?, in_time = ?, out_time = ?, total_hours = ?, marked_by = ? WHERE id = ?', 
                    [status, fIn, fOut, totalHours, req.user.id, existing[0].id]
                );
            } else {
                await db.execute(
                    'INSERT INTO attendance (employee_id, date, status, in_time, out_time, total_hours, marked_by) VALUES (?, ?, ?, ?, ?, ?, ?)', 
                    [empId, date, status, fIn, fOut, totalHours, req.user.id]
                );
            }
        }
        res.json({ message: 'Bulk updated' });
    } catch (err) {
        res.status(500).json({ message: 'Failed', error: err.message });
    }
};

exports.getDashboardStats = async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        const now = new Date();
        const cycleStart = now.getDate() <= 15 ? 1 : 16;
        const cycleEnd = now.getDate() <= 15 ? 15 : 31;
        const cycleStartDate = new Date(now.getFullYear(), now.getMonth(), cycleStart).toISOString().split('T')[0];

        // Filter employees by creator if admin
        let empQuery = 'SELECT id, salary_rate, salary_type FROM employees WHERE status = "active"';
        let attQuery = 'SELECT a.status, a.employee_id FROM attendance a JOIN employees e ON a.employee_id = e.id WHERE a.date = ?';
        let cycleAttQuery = 'SELECT a.employee_id, COUNT(*) as days FROM attendance a JOIN employees e ON a.employee_id = e.id WHERE a.date BETWEEN ? AND ? AND (a.status = "present" || a.status = "late")';
        let params = [];
        let attParams = [today];
        let cycleParams = [cycleStartDate, today];

        if (req.user.role === 'admin') {
            empQuery += ' AND created_by = ?';
            params.push(req.user.id);
            
            attQuery += ' AND e.created_by = ?';
            attParams.push(req.user.id);

            cycleAttQuery += ' AND e.created_by = ?';
            cycleParams.push(req.user.id);
        }
        cycleAttQuery += ' GROUP BY a.employee_id';

        const [employees] = await db.execute(empQuery, params);
        const [attendance] = await db.execute(attQuery, attParams);
        const [cycleAttendance] = await db.execute(cycleAttQuery, cycleParams);

        let totalPayout = 0;
        cycleAttendance.forEach(att => {
            const emp = employees.find(e => e.id === att.employee_id);
            if (emp) totalPayout += att.days * (emp.salary_rate || 0);
        });

        const trendData = [];
        for (let i = 6; i >= 0; i--) {
            const d = new Date(); d.setDate(d.getDate() - i);
            const dStr = d.toISOString().split('T')[0];
            let trendQuery = 'SELECT COUNT(*) as present FROM attendance a JOIN employees e ON a.employee_id = e.id WHERE a.date = ? AND (a.status = "present" || a.status = "late")';
            let trendParams = [dStr];
            if (req.user.role === 'admin') { trendQuery += ' AND e.created_by = ?'; trendParams.push(req.user.id); }
            const [attDay] = await db.execute(trendQuery, trendParams);
            trendData.push({ name: d.toLocaleDateString('en-US', { weekday: 'short' }), present: attDay[0].present, absent: employees.length - attDay[0].present });
        }

        res.json({
            totalStaff: employees.length,
            presentToday: attendance.filter(a => a.status?.toLowerCase() === 'present' || a.status?.toLowerCase() === 'late').length,
            absentToday: employees.length - attendance.filter(a => a.status?.toLowerCase() === 'present' || a.status?.toLowerCase() === 'late' || a.status?.toLowerCase() === 'half_day').length,
            lateToday: attendance.filter(a => a.status?.toLowerCase() === 'late').length,
            trend: trendData,
            salaryCycle: { progress: Math.min(Math.round(((now.getDate() - cycleStart + 1) / (cycleEnd - cycleStart + 1)) * 100), 100), day: now.getDate() - cycleStart + 1, totalDays: cycleEnd - cycleStart + 1, estimatedPayout: totalPayout }
        });
    } catch (err) {
        res.status(500).json({ message: 'Stats error', error: err.message });
    }
};

exports.getPublicHolidays = async (req, res) => {
    try { const [rows] = await db.execute('SELECT * FROM public_holidays ORDER BY holiday_date ASC'); res.json(rows); } 
    catch (err) { res.status(500).json({ message: 'Error', error: err.message }); }
};

const logAudit = async (adminId, action, targetId, details) => {
    try { await db.execute('INSERT INTO audit_logs (admin_id, action, target_id, details) VALUES (?, ?, ?, ?)', [adminId, action, targetId, JSON.stringify(details)]); } 
    catch (err) { console.error('Audit failed:', err); }
};
