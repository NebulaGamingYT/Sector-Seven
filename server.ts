import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { createServer as createViteServer } from 'vite';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const lobbies = new Map();

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

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
