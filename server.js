const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

const corsOptions = {
    origin: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    credentials: true
};

const io = new Server(server, {
    cors: {
        origin: (origin, callback) => callback(null, true),
        methods: ["GET", "POST"],
        credentials: true
    }
});

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json({ limit: '50mb' }));
app.use('/uploads', express.static('uploads'));

const iclockRoutes = require('./routes/iclock.route');
const apiRoutes = require('./routes/api');

app.use('/iclock', cors(), express.text({ type: ['text/plain', 'application/octet-stream'], limit: '50mb' }), iclockRoutes);
app.use('/api', apiRoutes);

app.get('/', (req, res) => res.send('🚀 BioTrack Pro Backend is Running...'));

io.on('connection', (socket) => {
    console.log('✅ Dashboard Connected');
    socket.on('disconnect', () => console.log('❌ Dashboard Disconnected'));
});

const PORT = process.env.PORT || 8081;

const initDB = async () => {
    const db = require('./config/db');
    try {
        console.log('🔄 Checking database tables...');
        
        // 1. Create Tables if they don't exist
        await db.execute(`
            CREATE TABLE IF NOT EXISTS employees (
                id INT AUTO_INCREMENT PRIMARY KEY,
                machine_id VARCHAR(50) UNIQUE,
                name VARCHAR(100) NOT NULL,
                role ENUM('admin','employee') DEFAULT 'employee',
                department VARCHAR(100) DEFAULT 'General',
                email VARCHAR(150) UNIQUE,
                salary_rate DECIMAL(10,2) DEFAULT 0.00,
                salary_type ENUM('hourly','daily') DEFAULT 'hourly',
                status ENUM('active','on_leave','terminated') DEFAULT 'active',
                joined_date DATE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await db.execute(`
            CREATE TABLE IF NOT EXISTS users (
                id INT AUTO_INCREMENT PRIMARY KEY,
                employee_id INT,
                email VARCHAR(150) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                role ENUM('admin','employee') NOT NULL,
                FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE SET NULL
            )
        `);

        await db.execute(`
            CREATE TABLE IF NOT EXISTS attendance (
                id INT AUTO_INCREMENT PRIMARY KEY,
                employee_id INT NOT NULL,
                date DATE NOT NULL,
                in_time DATETIME,
                out_time DATETIME,
                total_hours DECIMAL(10,2) DEFAULT 0.00,
                status ENUM('present','absent','late','half_day') DEFAULT 'present',
                FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
            )
        `);

        await db.execute(`
            CREATE TABLE IF NOT EXISTS payroll (
                id INT AUTO_INCREMENT PRIMARY KEY,
                employee_id INT NOT NULL,
                cycle_start DATE NOT NULL,
                cycle_end DATE NOT NULL,
                status ENUM('pending','paid') DEFAULT 'pending',
                FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
            )
        `);

        console.log('🔄 Checking database columns...');
        const columns = [
            // Employees Table
            { table: 'employees', column: 'custom_id', type: 'VARCHAR(100) DEFAULT ""' },
            { table: 'employees', column: 'shift', type: "ENUM('Morning Shift','Evening Shift','Night Shift') DEFAULT 'Morning Shift'" },
            { table: 'employees', column: 'phone', type: 'VARCHAR(30) DEFAULT ""' },
            { table: 'employees', column: 'photo', type: 'TEXT' },
            { table: 'employees', column: 'uif_number', type: 'VARCHAR(100) DEFAULT ""' },
            { table: 'employees', column: 'is_uif_registered', type: 'TINYINT(1) DEFAULT 1' },
            { table: 'employees', column: 'advance_balance', type: 'DECIMAL(10,2) DEFAULT 0.00' },
            { table: 'employees', column: 'signature', type: 'LONGTEXT' },
            { table: 'employees', column: 'created_by', type: 'INT' },
            
            // Users Table
            { table: 'users', column: 'name', type: 'VARCHAR(100) DEFAULT ""' },
            { table: 'users', column: 'photo', type: 'TEXT' },
            { table: 'users', column: 'created_by', type: 'INT' },
            
            // Payroll Table
            { table: 'payroll', column: 'total_hours', type: 'DECIMAL(10,2) DEFAULT 0.00' },
            { table: 'payroll', column: 'gross_earnings', type: 'DECIMAL(10,2) DEFAULT 0.00' },
            { table: 'payroll', column: 'base_salary', type: 'DECIMAL(10,2) DEFAULT 0.00' },
            { table: 'payroll', column: 'deductions', type: 'DECIMAL(10,2) DEFAULT 0.00' },
            { table: 'payroll', column: 'uif_amount', type: 'DECIMAL(10,2) DEFAULT 0.00' },
            { table: 'payroll', column: 'advance_deduction', type: 'DECIMAL(10,2) DEFAULT 0.00' },
            { table: 'payroll', column: 'overtime', type: 'DECIMAL(10,2) DEFAULT 0.00' },
            { table: 'payroll', column: 'net_salary', type: 'DECIMAL(10,2) DEFAULT 0.00' },
            { table: 'payroll', column: 'shifts_data', type: 'JSON' }
        ];

        for (const col of columns) {
            try {
                const [check] = await db.execute(`
                    SELECT COLUMN_NAME 
                    FROM INFORMATION_SCHEMA.COLUMNS 
                    WHERE TABLE_NAME = ? AND COLUMN_NAME = ? AND TABLE_SCHEMA = DATABASE()
                `, [col.table, col.column]);

                if (check.length === 0) {
                    await db.execute(`ALTER TABLE ${col.table} ADD COLUMN ${col.column} ${col.type}`);
                    console.log(`✅ Added column ${col.column} to ${col.table}`);
                }
            } catch (err) {
                console.error(`⚠️ Failed for ${col.column}:`, err.message);
            }
        }

        // 3. Seed Default Admin if no users exist
        const [userCount] = await db.execute('SELECT COUNT(*) as count FROM users');
        if (userCount[0].count === 0) {
            const bcrypt = require('bcryptjs');
            const hashedPassword = await bcrypt.hash('admin123', 10);
            await db.execute(
                'INSERT INTO users (email, password, role, name) VALUES (?, ?, ?, ?)',
                ['admin@biotrack.com', hashedPassword, 'admin', 'System Admin']
            );
            console.log('🎁 Seeded default admin user');
        }

        console.log('✅ Database schema check complete');
    } catch (err) {
        console.error('❌ DB Init failed:', err.message);
    }
};

server.listen(PORT, async () => {
    await initDB();
    console.log(`🚀 Server running on port ${PORT}`);
});
