const db = require('../config/db');

exports.getSettings = async (req, res) => {
    try {
        const [rows] = await db.execute('SELECT * FROM settings WHERE id = 1');
        if (rows.length === 0) return res.status(404).json({ message: 'Settings not found' });
        res.json(rows[0]);
    } catch (err) {
        res.status(500).json({ message: 'Error fetching settings', error: err.message });
    }
};

exports.updateSettings = async (req, res) => {
    const { 
        machine_ip, 
        machine_port, 
        machine_alias, 
        sync_interval, 
        late_deduction, 
        salary_cycle, 
        ot_multiplier,
        business_name,
        business_address,
        business_phone,
        business_email
    } = req.body;

    try {
        await db.execute(
            'UPDATE settings SET machine_ip = ?, machine_port = ?, machine_alias = ?, sync_interval = ?, late_deduction = ?, salary_cycle = ?, ot_multiplier = ?, business_name = ?, business_address = ?, business_phone = ?, business_email = ? WHERE id = 1',
            [
                machine_ip || null, 
                machine_port || 4370, 
                machine_alias || '', 
                sync_interval || 30, 
                late_deduction ? 1 : 0, 
                salary_cycle || '15 Days Cycle', 
                ot_multiplier || 1.5,
                business_name || 'BioTrack Pro',
                business_address || '',
                business_phone || '',
                business_email || ''
            ]
        );
        res.json({ message: 'Settings updated successfully' });
    } catch (err) {
        res.status(500).json({ message: 'Error updating settings', error: err.message });
    }
};
