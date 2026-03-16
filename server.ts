import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { createServer as createViteServer } from 'vite';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(express.json({ limit: '1mb' })); // Enable JSON body parsing

// Ban Check API
app.get('/api/check-ban', (req, res) => {
    const userEmail = req.headers['x-goog-authenticated-user-email'] || 
                      req.headers['x-replit-user-email'] || 
                      req.headers['x-forwarded-user-email'];
    
    let banned = false;
    let email = null;

    if (userEmail && typeof userEmail === 'string') {
        email = userEmail.replace('accounts.google.com:', '').toLowerCase().trim();
        const bannedEmails = ['sectorsevenstorage@gmail.com'];
        if (bannedEmails.includes(email)) {
            banned = true;
        }
    }

    res.json({ banned, email });
});

// Auth Config API
app.get('/api/auth/config', (req, res) => {
    res.json({ 
        clientId: process.env.GOOGLE_CLIENT_ID || '705855269324-6odeb4vu486smrev2lah486ud9rh9ao2.apps.googleusercontent.com',
        // Do not expose client secret
    });
});

// Player Data API
app.post('/api/player/load', async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });

    try {
        const player = await PlayerModel.findOne({ email: email.toLowerCase() });
        if (player) {
            res.json({ data: player.data });
        } else {
            res.json({ data: null });
        }
    } catch (err) {
        console.error('Error loading player data:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/player/save', async (req, res) => {
    const { email, data } = req.body;
    if (!email || !data) return res.status(400).json({ error: 'Email and data required' });

    try {
        await PlayerModel.findOneAndUpdate(
            { email: email.toLowerCase() },
            { data, lastUpdated: new Date() },
            { upsert: true, new: true }
        );
        res.json({ success: true });
    } catch (err) {
        console.error('Error saving player data:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const lobbies = new Map();
const LEADERBOARD_FILE = path.join(__dirname, 'leaderboard.json');
let leaderboard = [];

// MongoDB Configuration
const MONGO_URI = 'mongodb+srv://sectorseven:meow1234@sectorseven.db0g1vp.mongodb.net/?appName=SectorSeven';

const leaderboardSchema = new mongoose.Schema({
    username: String,
    wave: Number,
    date: Date
});

const LeaderboardModel = mongoose.model('Leaderboard', leaderboardSchema);

const playerSchema = new mongoose.Schema({
    email: { type: String, unique: true, required: true },
    data: {
        totalDataShards: Number,
        bestWave: Number,
        maxDamage: Number,
        maxCards: Number,
        totalShardsEver: Number,
        seenCards: [String],
        purchasedUpgrades: mongoose.Schema.Types.Mixed,
        username: String
    },
    lastUpdated: { type: Date, default: Date.now }
});

const PlayerModel = mongoose.model('Player', playerSchema);

async function connectDB() {
    try {
        await mongoose.connect(MONGO_URI);
        console.log('MongoDB Connected successfully');
        await cleanupLeaderboard();
        await loadLeaderboard();
    } catch (err) {
        console.error('MongoDB connection error:', err.message);
        
        // Check for common IP whitelist error
        if (err.message && (err.message.includes('whitelist') || err.message.includes('Could not connect to any servers'))) {
            console.error('---------------------------------------------------');
            console.error('ACTION REQUIRED: MongoDB Atlas IP Whitelist');
            console.error('1. Go to your MongoDB Atlas Dashboard.');
            console.error('2. Click "Network Access" in the sidebar.');
            console.error('3. Click "Add IP Address".');
            console.error('4. Select "Allow Access from Anywhere" (0.0.0.0/0).');
            console.error('5. Click "Confirm".');
            console.error('---------------------------------------------------');
        }

        // Fallback to local file if DB fails
        if (leaderboard.length === 0) {
            loadLocalLeaderboard();
        }
        
        // Retry connection in 20 seconds
        console.log('Retrying MongoDB connection in 20 seconds...');
        setTimeout(connectDB, 20000);
    }
}

async function loadLeaderboard() {
    try {
        if (mongoose.connection.readyState === 1) {
            // Use aggregation to ensure unique usernames with their highest wave
            const scores = await LeaderboardModel.aggregate([
                { $sort: { wave: -1 } },
                { $group: {
                    _id: "$username",
                    wave: { $first: "$wave" },
                    date: { $first: "$date" }
                }},
                { $project: {
                    _id: 0,
                    username: "$_id",
                    wave: 1,
                    date: 1
                }},
                { $sort: { wave: -1 } },
                { $limit: 100 }
            ]);
            leaderboard = scores;
            console.log('Leaderboard loaded from MongoDB (unique players)');
        }
    } catch (err) {
        console.error('Error loading leaderboard from MongoDB:', err);
    }
}

async function cleanupLeaderboard() {
    try {
        if (mongoose.connection.readyState === 1) {
            console.log('Starting leaderboard cleanup...');
            const allScores = await LeaderboardModel.find().sort({ username: 1, wave: -1 });
            const seen = new Set();
            const toDelete = [];
            
            for (const score of allScores) {
                if (seen.has(score.username)) {
                    toDelete.push(score._id);
                } else {
                    seen.add(score.username);
                }
            }
            
            if (toDelete.length > 0) {
                await LeaderboardModel.deleteMany({ _id: { $in: toDelete } });
                console.log(`Cleanup complete: Deleted ${toDelete.length} duplicate/lower entries`);
            } else {
                console.log('Cleanup complete: No duplicates found');
            }
        }
    } catch (err) {
        console.error('Error during leaderboard cleanup:', err);
    }
}

async function saveScore(username, wave) {
    try {
        if (mongoose.connection.readyState === 1) {
            const existingScore = await LeaderboardModel.findOne({ username });
            
            if (existingScore) {
                if (wave > existingScore.wave) {
                    existingScore.wave = wave;
                    existingScore.date = new Date();
                    await existingScore.save();
                    console.log(`Score updated for ${username}: Wave ${wave}`);
                } else {
                    console.log(`Score for ${username} not updated (existing ${existingScore.wave} >= new ${wave})`);
                }
            } else {
                const newScore = new LeaderboardModel({
                    username,
                    wave,
                    date: new Date()
                });
                await newScore.save();
                console.log(`New score saved for ${username}: Wave ${wave}`);
            }
            
            // Insurance: delete any other entries that might have slipped in
            await LeaderboardModel.deleteMany({ username, wave: { $lt: wave } });
            
            await loadLeaderboard();
        }
    } catch (err) {
        console.error('Error saving score to MongoDB:', err);
    }
}

function loadLocalLeaderboard() {
    try {
        if (fs.existsSync(LEADERBOARD_FILE)) {
            const data = fs.readFileSync(LEADERBOARD_FILE, 'utf8');
            leaderboard = JSON.parse(data);
            console.log('Loaded local leaderboard backup');
        }
    } catch (err) {
        console.error('Error loading local leaderboard:', err);
    }
}

function saveLocalLeaderboard() {
    try {
        fs.writeFileSync(LEADERBOARD_FILE, JSON.stringify(leaderboard, null, 2));
    } catch (err) {
        console.error('Error saving local leaderboard:', err);
    }
}

// Initialize DB
connectDB();

const PROFANITY_LIST = ['fuck', 'shit', 'bitch', 'ass', 'cunt', 'nigger', 'nigga', 'faggot', 'fag', 'slut', 'whore', 'dick', 'cock', 'pussy', 'bastard', 'crap', 'damn', 'twat', 'wanker', 'prick', 'retard', 'spic', 'chink', 'gook', 'kike', 'dyke', 'tranny', 'cum', 'rape', 'hitler', 'nazi', 'pedophile', 'porn', 'sex', 'jigaboo', 'jiggaboo'];
function containsProfanity(text) {
    if (!text) return false;
    const lower = text.toLowerCase().replace(/[\s\._\-]/g, '');
    const normalized = lower
        .replace(/0/g, 'o')
        .replace(/1/g, 'i')
        .replace(/3/g, 'e')
        .replace(/4/g, 'a')
        .replace(/5/g, 's')
        .replace(/7/g, 't')
        .replace(/8/g, 'b')
        .replace(/@/g, 'a')
        .replace(/\$/g, 's')
        .replace(/!/g, 'i');
    
    return PROFANITY_LIST.some(word => normalized.includes(word));
}

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('record-score', async (data) => {
        // Ban Check
        const userEmail = socket.handshake.headers['x-goog-authenticated-user-email'] || 
                          socket.handshake.headers['x-replit-user-email'] || 
                          socket.handshake.headers['x-forwarded-user-email'];
        if (userEmail && typeof userEmail === 'string') {
            const email = userEmail.replace('accounts.google.com:', '').toLowerCase().trim();
            const bannedEmails = ['sectorsevenstorage@gmail.com'];
            if (bannedEmails.includes(email)) {
                console.log(`Banned user ${email} attempted to record score.`);
                return;
            }
        }

        console.log('Received record-score event:', data);
        const { username, wave } = data;
        if (!username || !wave) {
            console.log('Missing username or wave in record-score event');
            return;
        }

        // Optimistic update handling duplicates
        const existingIdx = leaderboard.findIndex(s => s.username === username);
        if (existingIdx !== -1) {
            if (wave > leaderboard[existingIdx].wave) {
                leaderboard[existingIdx].wave = wave;
                leaderboard[existingIdx].date = new Date().toISOString();
            }
        } else {
            leaderboard.push({ username, wave, date: new Date().toISOString() });
        }
        
        leaderboard.sort((a, b) => b.wave - a.wave);
        if (leaderboard.length > 100) leaderboard = leaderboard.slice(0, 100);
        
        io.emit('leaderboard-update', leaderboard);
        
        // Save to DB (handles unique names internally)
        await saveScore(username, wave);
        saveLocalLeaderboard(); // Keep local backup synced
    });

    socket.on('get-leaderboard', () => {
        console.log('Client requested leaderboard');
        socket.emit('leaderboard-update', leaderboard);
    });

    socket.on('create-lobby', (lobbyName, username) => {
        if (containsProfanity(lobbyName) || containsProfanity(username)) {
            socket.emit('join-error', 'Inappropriate content detected in lobby name or username.');
            return;
        }
        const lobbyId = Math.random().toString(36).substring(2, 9);
        const lobby = {
            id: lobbyId,
            name: lobbyName,
            hostId: socket.id,
            players: [{ id: socket.id, name: username || 'Player 1', ready: false, inventory: {} }],
            state: 'waiting',
            selectingCardPlayers: new Set()
        };
        lobbies.set(lobbyId, lobby);
        socket.join(lobbyId);
        socket.emit('lobby-created', lobby);
        io.emit('lobbies-update', Array.from(lobbies.values()));
    });

    socket.on('get-lobbies', () => {
        socket.emit('lobbies-update', Array.from(lobbies.values()));
    });

    socket.on('join-lobby', (lobbyId, username) => {
        // Redundant Ban Check
        const userEmail = socket.handshake.headers['x-goog-authenticated-user-email'] || 
                          socket.handshake.headers['x-replit-user-email'] || 
                          socket.handshake.headers['x-forwarded-user-email'];
        if (userEmail && typeof userEmail === 'string') {
            const email = userEmail.replace('accounts.google.com:', '').toLowerCase().trim();
            const bannedEmails = ['sectorsevenstorage@gmail.com'];
            if (bannedEmails.includes(email)) {
                socket.emit('error', 'Access Denied: Your account has been permanently banned.');
                socket.disconnect(true);
                return;
            }
        }

        if (containsProfanity(username)) {
            socket.emit('join-error', 'Inappropriate username detected.');
            return;
        }
        const lobby = lobbies.get(lobbyId);
        if (lobby && lobby.players.length < 4 && lobby.state === 'waiting') {
            lobby.players.push({ id: socket.id, name: username || `Player ${lobby.players.length + 1}`, ready: false, inventory: {} });
            socket.join(lobbyId);
            socket.emit('join-success', lobby);
            io.to(lobbyId).emit('lobby-updated', lobby);
            io.emit('lobbies-update', Array.from(lobbies.values()));
        } else {
            socket.emit('join-error', 'Lobby full or not found');
        }
    });

    socket.on('leave-lobby', () => {
        leaveLobby(socket);
    });

    socket.on('disconnect', () => {
        leaveLobby(socket);
    });

    socket.on('start-game', (lobbyId) => {
        const lobby = lobbies.get(lobbyId);
        if (lobby && lobby.hostId === socket.id) {
            lobby.state = 'playing';
            io.to(lobbyId).emit('game-started', lobby);
            io.emit('lobbies-update', Array.from(lobbies.values()));
        }
    });

    // Game Sync Events
    socket.on('host-update', (data) => {
        // Broadcast game state from host to all other players in the lobby
        if (data.lobbyId) {
            socket.to(data.lobbyId).emit('game-state-update', data.state);
        }
    });

    socket.on('client-update', (data) => {
        // Client sends its state, host relays it to other clients
        if (data.lobbyId) {
            socket.to(data.lobbyId).emit('player-state-update', { 
                playerId: socket.id, 
                state: data.state 
            });
        }
    });

    socket.on('client-input', (data) => {
        // Send client input to host
        // data should include lobbyId
        if (data.lobbyId) {
            const lobby = lobbies.get(data.lobbyId);
            if (lobby) {
                const player = lobby.players.find(p => p.id === socket.id);
                if (player) {
                    player.inventory = data.input.playerData.inventory;
                }
                io.to(lobby.hostId).emit('player-input', { playerId: socket.id, input: data.input });
            }
        }
    });

    socket.on('pause-game', (lobbyId) => {
        const lobby = lobbies.get(lobbyId);
        if (lobby && lobby.hostId === socket.id) {
            io.to(lobbyId).emit('game-paused');
        }
    });

    socket.on('resume-game', (lobbyId) => {
        const lobby = lobbies.get(lobbyId);
        if (lobby && lobby.hostId === socket.id) {
            io.to(lobbyId).emit('game-resumed');
        }
    });

    socket.on('started-selecting-card', (lobbyId) => {
        const lobby = lobbies.get(lobbyId);
        if (lobby) {
            lobby.selectingCardPlayers.add(socket.id);
            io.to(lobbyId).emit('force-pause-selection', true);
        }
    });

    socket.on('finished-selecting-card', (lobbyId) => {
        const lobby = lobbies.get(lobbyId);
        if (lobby) {
            lobby.selectingCardPlayers.delete(socket.id);
            if (lobby.selectingCardPlayers.size === 0) {
                io.to(lobbyId).emit('force-pause-selection', false);
            }
        }
    });

    socket.on('trigger-upgrade', (data) => {
        // Host triggers upgrade for all players
        if (data.lobbyId) {
            socket.to(data.lobbyId).emit('show-upgrade-modal', { 
                isBossReward: data.isBossReward, 
                forcedRarity: data.forcedRarity 
            });
        }
    });

    socket.on('card-selected', (data) => {
        if (data.lobbyId) {
            io.to(data.lobbyId).emit('player-card-updated', { 
                playerId: socket.id, 
                cardId: data.cardId, 
                inventory: data.inventory 
            });
        }
    });
});

function leaveLobby(socket) {
    for (const [lobbyId, lobby] of lobbies.entries()) {
        const playerIndex = lobby.players.findIndex(p => p.id === socket.id);
        if (playerIndex !== -1) {
            const wasHost = lobby.hostId === socket.id;
            lobby.players.splice(playerIndex, 1);
            socket.leave(lobbyId);
            
            if (wasHost) {
                io.to(lobbyId).emit('lobby-disbanded');
                lobbies.delete(lobbyId);
                io.in(lobbyId).socketsLeave(lobbyId);
            } else {
                if (lobby.players.length === 0) {
                    lobbies.delete(lobbyId);
                } else {
                    io.to(lobbyId).emit('lobby-updated', lobby);
                }
            }
            io.emit('lobbies-update', Array.from(lobbies.values()));
            break;
        }
    }
}

async function startServer() {
    const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: 'spa',
    });

    app.use(vite.middlewares);

    httpServer.listen(3000, '0.0.0.0', () => {
        console.log('Server running on http://localhost:3000');
    });
}

startServer();
