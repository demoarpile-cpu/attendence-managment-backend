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
        console.log('🔄 Checking database schema...');
        const columns = [
            // Employees Table
            { table: 'employees', column: 'custom_id', type: 'VARCHAR(100) DEFAULT ""' },
            { table: 'employees', column: 'uif_number', type: 'VARCHAR(100) DEFAULT ""' },
            { table: 'employees', column: 'advance_balance', type: 'DECIMAL(10,2) DEFAULT 0.00' },
            { table: 'employees', column: 'signature', type: 'LONGTEXT' },
            { table: 'employees', column: 'created_by', type: 'INT' },
            
            // Users Table
            { table: 'users', column: 'created_by', type: 'INT' },
            
            // Payroll Table (Ensuring core columns exist)
            { table: 'payroll', column: 'cycle_start', type: 'DATE' },
            { table: 'payroll', column: 'cycle_end', type: 'DATE' },
            { table: 'payroll', column: 'advance_deduction', type: 'DECIMAL(10,2) DEFAULT 0.00' },
            { table: 'payroll', column: 'uif_amount', type: 'DECIMAL(10,2) DEFAULT 0.00' },
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
        console.log('✅ Database schema check complete');
    } catch (err) {
        console.error('❌ DB Init failed:', err.message);
    }
};

server.listen(PORT, async () => {
    await initDB();
    console.log(`🚀 Server running on port ${PORT}`);
});
