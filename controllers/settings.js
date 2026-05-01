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
        ot_multiplier 
    } = req.body;

    try {
        await db.execute(
            'UPDATE settings SET machine_ip = ?, machine_port = ?, machine_alias = ?, sync_interval = ?, late_deduction = ?, salary_cycle = ?, ot_multiplier = ? WHERE id = 1',
            [machine_ip, machine_port, machine_alias, sync_interval, late_deduction ? 1 : 0, salary_cycle, ot_multiplier]
        );
        res.json({ message: 'Settings updated successfully' });
    } catch (err) {
        res.status(500).json({ message: 'Error updating settings', error: err.message });
    }
};
