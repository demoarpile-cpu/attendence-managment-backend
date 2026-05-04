const db = require('../config/db');

async function checkSchema() {
    try {
        const tables = ['employees', 'attendance', 'payroll', 'users', 'settings'];
        for (const table of tables) {
            console.log(`--- Table: ${table} ---`);
            const [columns] = await db.execute(`DESCRIBE ${table}`);
            console.table(columns);
        }
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

checkSchema();
