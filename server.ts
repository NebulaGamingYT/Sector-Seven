import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { createServer as createViteServer } from 'vite';
import { google } from 'googleapis';

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

// Google Drive Configuration
const FOLDER_ID = '1n6W6Kk651Jg_HnrsUMG30Br-lQBfS_LB';
const SERVICE_ACCOUNT_EMAIL = 'leaderboard-bot@crafty-elf-488704-q6.iam.gserviceaccount.com';
const PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDPQVDcGYBrJsTP\nhVVPp8VPzMR9RMcUSkIOYZSKANmyq+ZqHZxKxy3Ee7vF3JyT8GF15z8tJBbUdmYM\nJwRVdNcH7M2AvoWRj/2QgW8jvgW1SOZr2cCZxL4liWlgDwEsnMjeU0MR6VfFCm5A\njJVraCosOwK5BK5tvfpuLcPfAcMQesQQVnBuHtlTTI0tVW3QRNMgw3JMZrYBqdIh\ngqDC+PLwQrWxVXiTWg9RDFoaNQu+GWWTGVTXogQcxcMdmNVFLrTgBZdcFYdzwHkY\naa67Sv+EbajdRPb5bPlbYr2OfgtGaccC1WAEHTRoz39A+xqBtMCNXQ0m8fL9dCKu\nNmijkrzDAgMBAAECggEAF+zc1kO1YOk9UA1+zy65ZuBnEGT3rF50KK/YE2RMvUT9\n2OMpLzK2FFgKUamJg8R8o705vE7NueIfHqkEZY8S4a3S/VlBFxAtv9hJSbF+fDJ5\nsxqUksu0/aVSvk2NH6bLw2qONAuhX7Q4DQiNmTQRpkB7rHsfXbjQJ5bt5RkReR3V\nrPtOS/ZBIIW75I42VPbza1HiFBLXYFwk+PhF9kVlKruxkNABHOtRCo0shV4Igka/\naX+uyFIF16OJOwWIm02apO72sqwbxVoZzWYeTO70fD+KBmRDEdEitumQ6cxPuQlL\nXRHAH/4Sch8LDRGuLbVrzSaxpv7KPmn1Km5mLJsoqQKBgQD0amGhI7AIyhRJqv+t\nKi/Kxavw+w19zlWwEzE9KoVmUbSQg1kvDuFHwrB1Sx3Mo9QFDla7vErtM8lW21Gk\nsy38dMu1SL0sH+oLpkP7U4DDLU1ZiP77OceA0rC/omPhubiACs97V8tWtabVP0au\n9Ws3hG2p2iqLiBFM5RxQNxgr2QKBgQDZFAxZ90qn54N4m5digYcaldL0AzPqP49w\ngUpeuKt36AFErrPCIowrgCPJyb4a3mc5ssJrW6N9YejaJS9/uPW95jkRCbDlM3WL\nbRutlWUL5QY2MKY8gvOImvVNG3wFQ4Auk43/0dsulSUjnbBz5IzA92Pulj4mXVZl\nokVWKSFX+wKBgQDfTK3jjXpPnWgJoeuzZj6BsDUVlhhOXwuUMQSkUEvOHkmsWgRJ\n5PtXF30lvDn+c5LKB76gCDggHFcPPpKJuZYC9yYBevIx9PpcKEwlurWCG8p2SZ5D\nIheuD0+h1RgR6x6wBLBojN5eWtmQLB5EzD1nXFrgekyya976dLt4Yc14iQKBgEq1\nfqa72AK/R90LV2d8gp3gsHBwZb6Zz2j95jWBQuoKe91CbvVCZJFYEXkSKI4gus/9\nuLGwIS02tCfXomhHpLONd1hoyGupcSviCiOMhfE5ChE+Xwf2XZBHHGNEMUOyfnwJ\nJlbDx7ZZeCWw0JiiMNr8iXUEWjFj8CccWNaVYzdfAoGAf21h/vPvuvo5Jd6wf5Di\n5fMdlCCubLFvh6X9aGHObdKhou2SK6TXd+PGKsKLZJBu73aQJ0Tt8LGFyWdy7qG8\nZrP2MY6En7TY+d9rU9FE71xmPaukECGMyaG6XzfpGMV7ShKz0xlBk70EzGKceOBA\nid+oZe/z2JdskN1PBonmgG0=\n-----END PRIVATE KEY-----`;

let authClient;
let sheetId = null;

async function initGoogleDrive() {
    try {
        const auth = new google.auth.GoogleAuth({
            credentials: {
                client_email: SERVICE_ACCOUNT_EMAIL,
                private_key: PRIVATE_KEY,
            },
            scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'],
        });
        authClient = await auth.getClient();
        console.log('Google Auth successful');

        const drive = google.drive({ version: 'v3', auth: authClient });
        const sheets = google.sheets({ version: 'v4', auth: authClient });

        // Check if leaderboard sheet exists in folder
        const res = await drive.files.list({
            q: `'${FOLDER_ID}' in parents and name = 'Leaderboard' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`,
            fields: 'files(id, name)',
        });

        if (res.data.files.length > 0) {
            sheetId = res.data.files[0].id;
            console.log('Found existing leaderboard sheet:', sheetId);
        } else {
            // Create new sheet
            const sheetRes = await sheets.spreadsheets.create({
                requestBody: {
                    properties: { title: 'Leaderboard' },
                },
            });
            sheetId = sheetRes.data.spreadsheetId;
            console.log('Created new leaderboard sheet:', sheetId);

            // Move to folder (Drive API v3 requires adding parents)
            // Note: create() puts it in root. We need to move it.
            // Actually, v3 create allows parents but sheets.create doesn't directly support parents easily in one go usually, 
            // so we move it.
            const fileId = sheetId;
            const file = await drive.files.get({ fileId: fileId, fields: 'parents' });
            const previousParents = file.data.parents.join(',');
            await drive.files.update({
                fileId: fileId,
                addParents: FOLDER_ID,
                removeParents: previousParents,
                fields: 'id, parents',
            });
            
            // Initialize header
            await sheets.spreadsheets.values.update({
                spreadsheetId: sheetId,
                range: 'Sheet1!A1:C1',
                valueInputOption: 'RAW',
                requestBody: { values: [['Username', 'Wave', 'Date']] },
            });
        }
        
        // Initial load
        await loadLeaderboardFromSheet();

    } catch (error) {
        console.error('Error initializing Google Drive:', error);
    }
}

async function loadLeaderboardFromSheet() {
    if (!sheetId || !authClient) return;
    try {
        const sheets = google.sheets({ version: 'v4', auth: authClient });
        const res = await sheets.spreadsheets.values.get({
            spreadsheetId: sheetId,
            range: 'Sheet1!A2:C', // Skip header
        });
        
        const rows = res.data.values;
        if (rows && rows.length) {
            leaderboard = rows.map(row => ({
                username: row[0],
                wave: parseInt(row[1]) || 0,
                date: row[2]
            }));
            // Sort
            leaderboard.sort((a, b) => b.wave - a.wave);
            if (leaderboard.length > 100) leaderboard = leaderboard.slice(0, 100);
        } else {
            leaderboard = [];
        }
    } catch (error) {
        console.error('Error loading leaderboard from sheet:', error);
    }
}

async function saveScoreToSheet(username, wave) {
    if (!sheetId || !authClient) return;
    try {
        const sheets = google.sheets({ version: 'v4', auth: authClient });
        const date = new Date().toISOString();
        await sheets.spreadsheets.values.append({
            spreadsheetId: sheetId,
            range: 'Sheet1!A:C',
            valueInputOption: 'RAW',
            requestBody: { values: [[username, wave, date]] },
        });
        // Reload to keep sync and sort
        await loadLeaderboardFromSheet();
    } catch (error) {
        console.error('Error saving score to sheet:', error);
    }
}

// Initialize Drive
initGoogleDrive();

// Load leaderboard on startup (fallback to local if drive fails initially)
try {
    if (fs.existsSync(LEADERBOARD_FILE)) {
        const data = fs.readFileSync(LEADERBOARD_FILE, 'utf8');
        // Only use local if drive hasn't loaded anything yet
        if (leaderboard.length === 0) {
             leaderboard = JSON.parse(data);
        }
    }
} catch (err) {
    console.error('Error loading local leaderboard:', err);
}

function saveLeaderboard() {
    // Save locally as backup
    try {
        fs.writeFileSync(LEADERBOARD_FILE, JSON.stringify(leaderboard, null, 2));
    } catch (err) {
        console.error('Error saving local leaderboard:', err);
    }
}

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('record-score', (data) => {
        const { username, wave } = data;
        if (!username || !wave) return;

        // Optimistic update
        leaderboard.push({ username, wave, date: new Date().toISOString() });
        leaderboard.sort((a, b) => b.wave - a.wave);
        if (leaderboard.length > 100) leaderboard = leaderboard.slice(0, 100);
        
        io.emit('leaderboard-update', leaderboard);
        
        // Save to Drive (async)
        saveScoreToSheet(username, wave);
        saveLeaderboard(); // Local backup
    });

    socket.on('get-leaderboard', () => {
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
