const db = require('../config/db');

exports.getSettings = async (req, res) => {
    try {
        const sql = 'SELECT * FROM settings WHERE id = 1';
        console.log('📝 Executing SQL:', sql);
        const [rows] = await db.execute(sql);
        if (rows.length === 0) return res.status(404).json({ message: 'Settings not found' });
        res.json(rows[0]);
    } catch (err) {
        console.error('❌ SQL Error (getSettings):', err);
        res.status(500).json({ message: 'Error fetching settings', error: err.message });
    }
};

exports.updateSettings = async (req, res) => {
    const { 
        machine_ip, machine_port, machine_alias, sync_interval, 
        late_deduction, salary_cycle, ot_multiplier,
        business_name, business_address, business_phone, business_email,
        admin_password
    } = req.body;

    try {
        const updates = [];
        const params = [];

        const fields = {
            machine_ip, machine_port, machine_alias, sync_interval, 
            late_deduction: late_deduction !== undefined ? (late_deduction ? 1 : 0) : undefined, 
            salary_cycle, ot_multiplier,
            business_name, business_address, business_phone, business_email
        };

        Object.keys(fields).forEach(key => {
            if (fields[key] !== undefined) {
                updates.push(`${key} = ?`);
                params.push(fields[key]);
            }
        });

        if (updates.length > 0) {
            const query = `UPDATE settings SET ${updates.join(', ')} WHERE id = 1`;
            console.log('📝 Executing SQL (Update Settings):', query, 'Params:', params);
            await db.execute(query, params);
        }

        // Handle Admin Password update if provided
        if (admin_password) {
            const bcrypt = require('bcryptjs');
            const hashedPassword = await bcrypt.hash(admin_password, 10);
            const userSql = 'UPDATE users SET password = ? WHERE role = "admin"';
            console.log('📝 Executing SQL (Update Admin Password):', userSql);
            await db.execute(userSql, [hashedPassword]);
        }

        res.json({ message: 'Settings updated successfully' });
    } catch (err) {
        console.error('❌ SQL Error (updateSettings):', err);
        res.status(500).json({ message: 'Error updating settings', error: err.message });
    }
};
