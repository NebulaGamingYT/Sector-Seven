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
const USE_GOOGLE_DRIVE = true; // Set to true if you have configured the Google Cloud Project
const FOLDER_ID = '1n6W6Kk651Jg_HnrsUMG30Br-lQBfS_LB';
const SERVICE_ACCOUNT_EMAIL = 'leaderboard-bot@gen-lang-client-0619714191.iam.gserviceaccount.com';
const PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDFs928Oj21xbiV\nLW9i5K0LN3NDf/KbQWyIMfMlCgCTfOVxE6JNyyo0Aq7ZQ5bgxtxjMxpVvvFgwJgS\niV8acH/g2mLTihACC3xTGDdH8f/UT5DgrBzb0nR1ai76CxYLkvKFTcquu38I0d0u\nXdau36m4MVRD/HUevohlchWaNDvanl1XJYEJCKc4ALdWAQgfzkbb8lVfVPdvzih+\nGmL/tbhV94FCw7wXVdAsQYAbXh9NggQ++7foaAXn9WbrwDaHIXcHMJ0K37kjpKrA\nmMDSPgJGjDaDQDL0s40Syi/1IUbDqzMtRzIk5PDpVfe9Vd5gOh0SvB7eT6YjSX9Y\nVPEcm95TAgMBAAECggEAH15jI87/5JwLJgxP/Jp5BGsXbFHcThsK2+9E+48DOWOb\nSh5J5dsDBr6YPJvXUDHtXQYKOymxRd85IdPPFbRc7fHotVTWJmTpJIwWlWFF7Mt1\nGtjkOVLCrLCc5IqmxE5cEZ+etavFQ8J8vDMicZvGY5XcH29qq+aiYKpB2DZKeuzX\nTZ+67eEBWVwFKk/ydL8fY4l/37HFPp43V+DqP+f7metI9Vuwt3MCBBuYZr8kMvRG\nJWmbab9U7oHKN8348XXTMZAOLE8pMLFvJYFak6cP0Nr/2DD1o76rSYLUA6SsZaGF\nfFop9H0fCOR6F9lXo/7ytgIeJWjSbh7p0Bk6KBkKzQKBgQDlizHf1rMCx/XGDqAk\nnNNknQpoHOmIfmPmTb6Lc7kGXdiXu9B2E5k6OfPRipCUCfCJGcuygTUS8N88KRPt\nS8msZ62BSgJNwPfxDjwgkNGTUDDSHsd7lFgtYPNmuEm9WaknOFtKfCuQW5cC7fRy\nQG+GBeCe6lL4awqJNSeifw/rFQKBgQDcfS69CbcEVO2e6HHxaqRrMmojdy/R82kB\nAggouEh8AcYwR0g0/Lb5NQrqRTvpem6ns3EeLGDb5rWkmOPVJJN9FqlikrVgdU7k\n7ddWSa4ICFh+mDmyLUCyyp14+wsQLtag2uuTynmNT4JLq4MpsagIQu/ntXr3IoFP\nps0XCt/dxwKBgQDFmO12Ivw2iKupsy1oVxgipI0w0rK2LRcSShqdMSE1udOZyrPI\n8VYWKY0Z9I5A4c2OOAaBw3hMtc11nGbq/zK8lwNlKLCS/mpxuC9KWWAP0Bg2yQgv\n+aNubOcapcnUljpm6LytgfZ+blmwy+aB87YNSUHziwOhlYOcWYWk/HxXgQKBgAq/\nw5aNsbFxXoA/vsZRN6DOPWRrPBaVMkpNSg6KJWZ+Q6Y442lJ5LWzg0u2glw4jsp4\nMgyRh0tRLQvQNFNAzDvt7eYTVupT7bu1aKkZQHW9ymqpiy6HjD7rJ9AtFPX+ApKm\n+ZMj7NcZyDVeMC/JLHLyqHV4YH1J3ln+vMLh0dYjAoGAAvbhWQFnRQjRzphhaUIk\nBFJc+soaI+LsLEt6SpAnP3LFJAg2jZeo33xlsCe4WM2D1DhdM8lVHgwWh7wM3Snc\nxSBZQZMHLA9ghFP79LUM2Qg4mErtV0HocsuMoNvSrNG7IglnSLzXzpNtNmicZwmq\nXZJ6NwrXRpSvPP32F/oAtaM=\n-----END PRIVATE KEY-----\n`;

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
        console.error('---------------------------------------------------');
        console.error('GOOGLE DRIVE INITIALIZATION FAILED');
        console.error('The server will continue using LOCAL storage only.');
        console.error('Reason:', error.message);
        if (error.code === 403) {
            console.error('ACTION REQUIRED: Enable the Google Drive and Sheets APIs in your Google Cloud Console.');
            console.error('Links:');
            console.error(' - Drive: https://console.developers.google.com/apis/api/drive.googleapis.com/overview');
            console.error(' - Sheets: https://console.developers.google.com/apis/api/sheets.googleapis.com/overview');
        }
        console.error('---------------------------------------------------');
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
if (USE_GOOGLE_DRIVE) {
    initGoogleDrive();
} else {
    console.log('Google Drive integration disabled. Using local storage for leaderboard.');
}

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
