import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { createServer as createViteServer } from 'vite';
import mongoose from 'mongoose';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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

async function connectDB() {
    try {
        await mongoose.connect(MONGO_URI);
        console.log('MongoDB Connected successfully');
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
            const scores = await LeaderboardModel.find().sort({ wave: -1 }).limit(100);
            leaderboard = scores.map(s => ({
                username: s.username,
                wave: s.wave,
                date: s.date
            }));
            console.log('Leaderboard loaded from MongoDB');
        }
    } catch (err) {
        console.error('Error loading leaderboard from MongoDB:', err);
    }
}

async function saveScore(username, wave) {
    try {
        if (mongoose.connection.readyState === 1) {
            const newScore = new LeaderboardModel({
                username,
                wave,
                date: new Date()
            });
            await newScore.save();
            console.log(`Score saved to MongoDB: ${username} - Wave ${wave}`);
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

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('record-score', async (data) => {
        console.log('Received record-score event:', data);
        const { username, wave } = data;
        if (!username || !wave) {
            console.log('Missing username or wave in record-score event');
            return;
        }

        // Optimistic update
        leaderboard.push({ username, wave, date: new Date().toISOString() });
        leaderboard.sort((a, b) => b.wave - a.wave);
        if (leaderboard.length > 100) leaderboard = leaderboard.slice(0, 100);
        
        io.emit('leaderboard-update', leaderboard);
        
        // Save to DB
        await saveScore(username, wave);
        saveLocalLeaderboard(); // Keep local backup synced
    });

    socket.on('get-leaderboard', () => {
        console.log('Client requested leaderboard');
        socket.emit('leaderboard-update', leaderboard);
    });

    socket.on('create-lobby', (lobbyName, username) => {
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
