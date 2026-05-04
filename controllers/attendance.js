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
        whereClauses.push('(e.created_by = ? OR e.created_by IS NULL)');
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

// Internal helper for background processing
const processAllRawLogs = async () => {
    const [rawLogs] = await db.execute('SELECT * FROM raw_logs WHERE is_processed = FALSE ORDER BY punch_time ASC');
    if (rawLogs.length === 0) return { success: true, count: 0 };

    let count = 0;
    for (let log of rawLogs) {
        // Since we enabled dateStrings: true, punch_time is a string. We might need to split it.
        const date = log.punch_time.split(' ')[0];
        const [emps] = await db.execute('SELECT id FROM employees WHERE machine_id = ?', [log.machine_user_id]);
        
        if (emps.length > 0) {
            const employeeId = emps[0].id;
            const [existing] = await db.execute('SELECT * FROM attendance WHERE employee_id = ? AND date = ?', [employeeId, date]);

            if (existing.length === 0) {
                await db.execute('INSERT INTO attendance (employee_id, date, in_time, status) VALUES (?, ?, ?, ?)', [employeeId, date, log.punch_time, 'present']);
            } else {
                const inTime = new Date(existing[0].in_time);
                const outTime = new Date(log.punch_time);
                const diffMs = outTime - inTime;
                
                // Only update if it's actually later than current out_time or in_time
                if (diffMs > 0) {
                    const hours = (diffMs / (1000 * 60 * 60)).toFixed(2);
                    await db.execute('UPDATE attendance SET out_time = ?, total_hours = ? WHERE id = ?', [log.punch_time, hours, existing[0].id]);
                }
            }
            count++;
        }
        await db.execute('UPDATE raw_logs SET is_processed = TRUE WHERE id = ?', [log.id]);
    }
    return { success: true, count };
};

exports.processAllRawLogs = processAllRawLogs;

// Process Raw Logs (API Route)
exports.processLogs = async (req, res) => {
    try {
        const result = await processAllRawLogs();
        res.json({ message: result.count > 0 ? 'Logs processed' : 'No new logs', count: result.count });
    } catch (err) {
        console.error('Processing failed:', err);
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
        // Safety: Verify admin ownership (Allow NULL for legacy data)
        const [existing] = await db.execute('SELECT e.created_by FROM attendance a JOIN employees e ON a.employee_id = e.id WHERE a.id = ?', [id]);
        if (existing.length > 0 && req.user.role === 'admin' && existing[0].created_by !== req.user.id && existing[0].created_by !== null) {
            return res.status(403).json({ message: 'Cannot update record' });
        }

        // Normalize datetime-local format or ISO strings to MySQL format ("2026-05-04 13:30:00")
        const normalize = (dt) => {
            if (!dt) return null;
            return dt.replace('T', ' ').replace(/\.\d+Z$/, '').substring(0, 19);
        };
        const fIn = normalize(in_time);
        const fOut = normalize(out_time);
        
        // Calculate hours robustly using timestamps
        let totalHours = 0;
        if (fIn && fOut) {
            const diff = new Date(fOut.replace(' ', 'T')) - new Date(fIn.replace(' ', 'T'));
            totalHours = Math.max(0, (diff / (1000 * 60 * 60))).toFixed(2);
        }
        
        const finalStatus = status ? status.toLowerCase() : 'present';
        const finalDate = fIn ? fIn.split(' ')[0] : null; // Extract date from in_time

        await db.execute(
            'UPDATE attendance SET in_time = ?, out_time = ?, status = ?, total_hours = ?, date = ? WHERE id = ?', 
            [fIn, fOut, finalStatus, totalHours, finalDate, id]
        );
        res.json({ message: 'Updated' });
    } catch (err) {
        res.status(500).json({ message: 'Failed', error: err.message });
    }
};

exports.bulkMarkAttendance = async (req, res) => {
    const { employeeIds, date, status, inTime, outTime } = req.body;
    try {
        const finalIn = inTime || '08:00';
        const finalOut = outTime || '17:00';
        
        let fIn = `${date} ${finalIn}:00`;
        let fOut = `${date} ${finalOut}:00`;
        
        // Calculate hours robustly
        const diff = new Date(fOut.replace(' ', 'T')) - new Date(fIn.replace(' ', 'T'));
        const totalHours = Math.max(0, (diff / (1000 * 60 * 60))).toFixed(2);

        for (let empId of employeeIds) {
            // Safety: Verify admin ownership (Allow NULL for manual/legacy data)
            const [emp] = await db.execute('SELECT created_by FROM employees WHERE id = ?', [empId]);
            if (emp.length > 0 && req.user.role === 'admin' && emp[0].created_by !== req.user.id && emp[0].created_by !== null) continue;

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

        // 1. Fetch All Active Employees
        let empQuery = 'SELECT id, salary_rate, salary_type FROM employees WHERE status = "active"';
        let empParams = [];
        if (req.user.role === 'admin') {
            empQuery += ' AND (created_by = ? OR created_by IS NULL)';
            empParams.push(req.user.id);
        }
        const [employees] = await db.execute(empQuery, empParams);

        // 2. Fetch Today's Attendance
        let attQuery = `
            SELECT a.status, a.employee_id 
            FROM attendance a 
            JOIN employees e ON a.employee_id = e.id 
            WHERE a.date = ?
        `;
        let attParams = [today];
        if (req.user.role === 'admin') {
            attQuery += ' AND (e.created_by = ? OR e.created_by IS NULL)';
            attParams.push(req.user.id);
        }
        const [attendance] = await db.execute(attQuery, attParams);

        // 3. Fetch Cycle Attendance for Payout Calculation
        let cycleAttQuery = `
            SELECT a.employee_id, COUNT(*) as days 
            FROM attendance a 
            JOIN employees e ON a.employee_id = e.id 
            WHERE a.date BETWEEN ? AND ? 
            AND (a.status = 'present' OR a.status = 'late')
        `;
        let cycleParams = [cycleStartDate, today];
        if (req.user.role === 'admin') {
            cycleAttQuery += ' AND (e.created_by = ? OR e.created_by IS NULL)';
            cycleParams.push(req.user.id);
        }
        cycleAttQuery += ' GROUP BY a.employee_id';
        const [cycleAttendance] = await db.execute(cycleAttQuery, cycleParams);

        // 4. Calculate Estimated Payout
        let totalPayout = 0;
        cycleAttendance.forEach(att => {
            const emp = employees.find(e => e.id === att.employee_id);
            if (emp) {
                const rate = parseFloat(emp.salary_rate || 0);
                totalPayout += att.days * rate;
            }
        });

        // 5. Generate 7-Day Trend Data
        const trendData = [];
        for (let i = 6; i >= 0; i--) {
            const d = new Date(); 
            d.setDate(d.getDate() - i);
            const dStr = d.toISOString().split('T')[0];
            
            let trendQuery = `
                SELECT COUNT(*) as count 
                FROM attendance a 
                JOIN employees e ON a.employee_id = e.id 
                WHERE a.date = ? AND (a.status = 'present' OR a.status = 'late')
            `;
            let trendParams = [dStr];
            if (req.user.role === 'admin') {
                trendQuery += ' AND (e.created_by = ? OR e.created_by IS NULL)';
                trendParams.push(req.user.id);
            }
            
            const [attDay] = await db.execute(trendQuery, trendParams);
            const presentCount = attDay[0].count;
            
            trendData.push({ 
                name: d.toLocaleDateString('en-US', { weekday: 'short' }), 
                present: presentCount, 
                absent: Math.max(0, employees.length - presentCount) 
            });
        }

        res.json({
            totalStaff: employees.length,
            presentToday: attendance.filter(a => a.status?.toLowerCase() === 'present' || a.status?.toLowerCase() === 'late').length,
            absentToday: Math.max(0, employees.length - attendance.filter(a => a.status?.toLowerCase() === 'present' || a.status?.toLowerCase() === 'late' || a.status?.toLowerCase() === 'half_day').length),
            lateToday: attendance.filter(a => a.status?.toLowerCase() === 'late').length,
            trend: trendData,
            salaryCycle: { 
                progress: Math.min(Math.round(((now.getDate() - cycleStart + 1) / (cycleEnd - cycleStart + 1)) * 100), 100), 
                day: now.getDate() - cycleStart + 1, 
                totalDays: cycleEnd - cycleStart + 1, 
                estimatedPayout: totalPayout 
            }
        });
    } catch (err) {
        res.status(500).json({ message: 'Stats error', error: err.message });
    }
};

exports.getPublicHolidays = async (req, res) => {
    try { const [rows] = await db.execute('SELECT * FROM public_holidays ORDER BY holiday_date ASC'); res.json(rows); } 
    catch (err) { res.status(500).json({ message: 'Error', error: err.message }); }
};

exports.addPublicHoliday = async (req, res) => {
    const { name, date } = req.body;
    if (!name || !date) return res.status(400).json({ message: 'Name and date are required' });
    try {
        await db.execute('INSERT INTO public_holidays (holiday_name, holiday_date) VALUES (?, ?)', [name, date]);
        res.json({ message: 'Holiday added' });
    } catch (err) {
        res.status(500).json({ message: 'Failed to add holiday', error: err.message });
    }
};

exports.deletePublicHoliday = async (req, res) => {
    const { id } = req.params;
    try {
        await db.execute('DELETE FROM public_holidays WHERE id = ?', [id]);
        res.json({ message: 'Holiday deleted' });
    } catch (err) {
        res.status(500).json({ message: 'Failed to delete holiday', error: err.message });
    }
};

const logAudit = async (adminId, action, targetId, details) => {
    try { await db.execute('INSERT INTO audit_logs (admin_id, action, target_id, details) VALUES (?, ?, ?, ?)', [adminId, action, targetId, JSON.stringify(details)]); } 
    catch (err) { console.error('Audit failed:', err); }
};
