
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

// ================= SOCKET.IO =================
const io = new Server(server, {
    cors: { origin: "*" }
});

// ================= MIDDLEWARE =================
app.use(cors({
    origin: "http://attendence.softwaredemolive.live",
}));

// ⚠️ IMPORTANT: ZKTeco ke liye raw/text body chahiye
app.use(express.text({ type: "*/*" }));

// Agar tum normal APIs me JSON bhi use karte ho
app.use(express.json());

// ================= ROUTES =================
const iclockRoutes = require('./routes/iclock.route');
const apiRoutes = require('./routes/api');

// IMPORTANT: ZKTeco machine expects /iclock/cdata at the root level
app.use('/iclock', iclockRoutes);

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

server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
