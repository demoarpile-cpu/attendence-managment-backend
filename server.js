
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
require('dotenv').config();

const app = express();
const server = http.createServer(app);


// ================= CORS CONFIG =================
const corsOptions = {
    origin: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    credentials: true
};

// ================= SOCKET.IO =================
const io = new Server(server, {
    cors: {
        origin: (origin, callback) => callback(null, true),
        methods: ["GET", "POST"],
        credentials: true
    }
});


// ================= MIDDLEWARE =================
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));



app.use(express.json({ limit: '50mb' }));
app.use('/uploads', express.static('uploads'));

// ================= ROUTES =================
const iclockRoutes = require('./routes/iclock.route');
const apiRoutes = require('./routes/api');

// ⚠️ IMPORTANT: ZKTeco ke liye raw/text body chahiye, sirf /iclock routes par
app.use('/iclock',
    cors(), // 👈 ADD THIS (open for machine)
    express.text({
        type: ['text/plain', 'application/octet-stream'],
        limit: '50mb'
    }),
    iclockRoutes
);

app.use('/api', apiRoutes);

// ================= HEALTH CHECK =================
app.get('/', (req, res) => {
    res.send('🚀 BioTrack Pro Backend is Running...');
});

// ================= SOCKET CONNECTION =================
io.on('connection', (socket) => {
    console.log('✅ Dashboard Connected via Socket');

    socket.on('disconnect', () => {
        console.log('❌ Dashboard Disconnected');
    });
});

// ================= SERVER START =================
const PORT = process.env.PORT || 8081;

const initDB = async () => {
    const db = require('./config/db');
    try {
        console.log('🔄 Checking database schema...');
        const columns = [
            { table: 'employees', column: 'custom_id', type: 'VARCHAR(100) DEFAULT ""' },
            { table: 'employees', column: 'uif_number', type: 'VARCHAR(100) DEFAULT ""' },
            { table: 'employees', column: 'advance_balance', type: 'DECIMAL(10,2) DEFAULT 0.00' },
            { table: 'employees', column: 'signature', type: 'LONGTEXT' },
            { table: 'employees', column: 'created_by', type: 'INT' },
            { table: 'users', column: 'created_by', type: 'INT' },
            { table: 'payroll', column: 'advance_deduction', type: 'DECIMAL(10,2) DEFAULT 0.00' },
            { table: 'payroll', column: 'uif_amount', type: 'DECIMAL(10,2) DEFAULT 0.00' },
            { table: 'payroll', column: 'shifts_data', type: 'JSON' }
        ];

        for (const col of columns) {
            try {
                await db.execute(`ALTER TABLE ${col.table} ADD COLUMN ${col.column} ${col.type}`);
                console.log(`✅ Added column ${col.column} to ${col.table}`);
            } catch (err) {
                // Ignore if already exists
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
