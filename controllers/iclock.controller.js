const db = require("../config/db");

/**
 * 1. CDATA Endpoint: handles Handshake (GET) and Data Upload (POST)
 * Path: /iclock/cdata
 */
exports.handleCdata = async (req, res) => {
    try {
        const sn = req.query.SN;
        const table = req.query.table;

        // --- HANDSHAKE (GET Request) ---
        // Machine calls this to initialize connection
        if (req.method === "GET") {
            console.log(`📡 [ADMS] Machine Handshake - SN: ${sn}`);
            // Returning OK is standard. Some machines might need "GET OPTION FROM: SN" 
            // but OK works for most uFace800 models.
            return res.send("OK");
        }

        // --- DATA UPLOAD (POST Request) ---
        const rawData = req.body?.toString() || "";
        console.log(`📥 [ADMS] Data Received - SN: ${sn}, Table: ${table}`);

        if (table === "ATTLOG" && rawData) {
            const rows = rawData.split("\n");
            let count = 0;

            for (let row of rows) {
                if (!row.trim()) continue;

                // Standard ATTLOG Format: PIN \t Time \t Status \t VerifyMethod ...
                const parts = row.split("\t");
                
                const userId = parts[0];
                const dateTime = parts[1]; // Index 1 is the timestamp

                if (userId && dateTime) {
                    // Using INSERT IGNORE to prevent duplicate logs if machine sends twice
                    await db.execute(
                        "INSERT IGNORE INTO raw_logs (machine_user_id, punch_time, device_sn) VALUES (?, ?, ?)",
                        [userId, dateTime, sn]
                    );
                    count++;
                }
            }
            console.log(`✅ [ADMS] Processed ${count} logs for SN: ${sn}`);
        }

        res.send("OK");
    } catch (err) {
        console.error("❌ [ADMS] Error in cdata:", err.message);
        res.status(500).send("ERROR");
    }
};

/**
 * 2. GETREQUEST Endpoint: The "Heartbeat" of the machine
 * Path: /iclock/getrequest
 */
exports.handleGetRequest = (req, res) => {
    // console.log(`💓 [ADMS] Heartbeat - SN: ${req.query.SN}`);
    
    // Returning "OK" tells the machine there are no pending commands from the server.
    // If you want to send a command (like Reboot), you'd return it here.
    res.send("OK");
};

/**
 * 3. DEVICECMD Endpoint: Receives response of commands sent to machine
 * Path: /iclock/devicecmd
 */
exports.handleDeviceCmd = (req, res) => {
    console.log(`📨 [ADMS] Command Response - SN: ${req.query.SN}`);
    console.log("Response Body:", req.body);
    res.send("OK");
};