"use strict";

/**
 * Panic Pass - Multiplayer WebSocket Server
 *
 * Manages game sessions identified by 6-digit codes.
 * Each session holds up to 5 players (1 host + 4 others).
 * Game logic mirrors the singleplayer flow but runs server-side
 * so all clients stay in sync.
 *
 * Dependencies: ws (npm install ws)
 * Run: node server.js
 */

const { WebSocketServer, WebSocket } = require('ws');
const https = require('https');
const http = require('http');
const fs = require('fs');

const PORT = process.env.PORT || 8080;
const MAX_SESSIONS = 999999;
const MAX_PLAYERS_PER_SESSION = 5;
const MIN_PLAYERS_TO_START = 2;
const BASE_TIMER = 10;
const WORD_API_URL = 'https://random-word-api.herokuapp.com/word';
const WORD_API_TIMEOUT = 3000;

const sessions = new Map();
let fallbackWords = [];

console.group('Info | Panic Pass Server Initialized');
console.log('Info | Port:', PORT);
console.log('Info | Max sessions:', MAX_SESSIONS);
console.log('Info | Max players per session:', MAX_PLAYERS_PER_SESSION);
console.groupEnd();

/**
 * Loads fallback words from local words.txt file.
 * Called once at startup; safe to call multiple times.
 *
 * @returns {Promise<void>}
 */
async function loadFallbackWords() {
    if (fallbackWords.length) {
        console.log('Debug | Fallback words already loaded');
        return;
    }

    try {
        const text = fs.readFileSync('./data/words.txt', 'utf8');
        fallbackWords = text.split('\n').map(w => w.trim().toLowerCase()).filter(Boolean);
        console.log('Success | Fallback words loaded:', fallbackWords.length, 'words');
    } catch {
        console.log('Warning | Could not load words.txt, using hardcoded defaults');
        fallbackWords = ['apple', 'brave', 'cloud', 'dance', 'earth', 'flame', 'grace', 'house'];
    }
}

/**
 * Returns a random word from the fallback list.
 *
 * @returns {string} A random word.
 */
function getRandomFallbackWord() {
    return fallbackWords[Math.floor(Math.random() * fallbackWords.length)] || 'error';
}

/**
 * Fetches a random word from the external API with timeout.
 *
 * @returns {Promise<string>} Lowercase word.
 * @throws Will throw an error if the request fails or times out.
 */
function fetchWordFromAPI() {
    return new Promise((resolve, reject) => {
        console.log('Debug | Fetching word from API');
        const timer = setTimeout(() => {
            console.log('Warning | API request timeout after', WORD_API_TIMEOUT, 'ms');
            reject(new Error('timeout'));
        }, WORD_API_TIMEOUT);

        https.get(WORD_API_URL, (res) => {
            let raw = '';
            res.on('data', chunk => { raw += chunk; });
            res.on('end', () => {
                clearTimeout(timer);
                try {
                    const data = JSON.parse(raw);
                    if (Array.isArray(data) && data[0]) {
                        console.log('Success | Word fetched from API:', data[0]);
                        resolve(data[0].toLowerCase());
                    } else {
                        console.log('Error | Invalid API response format');
                        reject(new Error('bad format'));
                    }
                } catch {
                    console.log('Error | Failed to parse API response');
                    reject(new Error('parse error'));
                }
            });
        }).on('error', (err) => {
            clearTimeout(timer);
            reject(err);
        });
    });
}

/**
 * Gets a random word from API, falling back to local list.
 *
 * @returns {Promise<string>} A random word.
 */
async function getRandomWord() {
    console.group('Debug | Getting random word');
    try {
        const word = await fetchWordFromAPI();
        console.groupEnd();
        return word;
    } catch {
        console.log('Debug | API failed, using fallback');
        const word = getRandomFallbackWord();
        console.log('Debug | Fallback word selected:', word);
        console.groupEnd();
        return word;
    }
}

/**
 * Generates a unique 6-digit session code string.
 *
 * @returns {string} Zero-padded 6-digit code, e.g. '042731'.
 */
function generateSessionCode() {
    let code;
    let attempts = 0;

    do {
        code = String(Math.floor(Math.random() * MAX_SESSIONS)).padStart(6, '0');
        attempts++;
        if (attempts > 10000) throw new Error('No session codes available');
    } while (sessions.has(code));

    return code;
}

/**
 * Creates a new session object.
 *
 * @param {string} code - The 6-digit session code.
 * @param {string} hostId - The player ID of the session host.
 * @returns {Object} The new session.
 */
function createSession(code, hostId) {
    return {
        code,
        hostId,
        players: new Map(),
        phase: 'lobby',
        currentWord: '',
        currentPlayerIndex: 0,
        currentRound: 1,
        timerInterval: null,
        timeRemaining: BASE_TIMER,
        playersCompletedThisRound: 0,
    };
}

/**
 * Creates a player state object.
 *
 * @param {string} id - Unique player ID.
 * @param {string} name - Display name.
 * @param {WebSocket} ws - The player's WebSocket connection.
 * @param {boolean} isHost - Whether this player is the session host.
 * @returns {Object} Player state.
 */
function createPlayer(id, name, ws, isHost) {
    return {
        id,
        name,
        ws,
        isHost,
        eliminated: false,
        isAI: false,
    };
}

/**
 * Sends a JSON message to a single WebSocket client if it is open.
 *
 * @param {WebSocket} ws - Target WebSocket.
 * @param {Object} payload - Data to serialise and send.
 */
function send(ws, payload) {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(payload));
    }
}

/**
 * Broadcasts a JSON message to all players in a session.
 *
 * @param {Object} session - The session to broadcast to.
 * @param {Object} payload - Data to send.
 * @param {string} [excludeId] - Optional player ID to skip.
 */
function broadcast(session, payload, excludeId) {
    for (const [id, player] of session.players) {
        if (excludeId && id === excludeId) continue;
        send(player.ws, payload);
    }
}

/**
 * Builds a serialisable player list safe to send to clients.
 * Omits the WebSocket reference.
 *
 * @param {Object} session - The session.
 * @returns {Array<Object>} Array of plain player objects.
 */
function getPlayerList(session) {
    return [...session.players.values()].map(p => ({
        id: p.id,
        name: p.name,
        isHost: p.isHost,
        eliminated: p.eliminated,
        isAI: false,
    }));
}

/**
 * Sends a full state snapshot to every player in the session.
 * Used after lobby changes such as join or leave.
 *
 * @param {Object} session - The session.
 */
function broadcastLobbyState(session) {
    const playerList = getPlayerList(session);
    broadcast(session, {
        type: 'lobby_state',
        players: playerList,
        hostId: session.hostId,
        code: session.code,
    });
}

/**
 * Calculates the round timer duration with a minimum of 3 seconds.
 *
 * @param {number} round - Current round number.
 * @returns {number} Timer in seconds.
 */
function getTimerForRound(round) {
    const reduction = Math.floor((round - 1) / 2);
    const timer = Math.max(3, BASE_TIMER - reduction);
    console.log('Debug | Timer for round', round, ':', timer, 'seconds');
    return timer;
}

/**
 * Stops the active timer for a session.
 *
 * @param {Object} session - The session.
 */
function clearSessionTimer(session) {
    if (session.timerInterval) {
        clearInterval(session.timerInterval);
        session.timerInterval = null;
    }
}

/**
 * Starts the countdown timer for the current round turn.
 * Ticks every 100ms; calls explodeCurrentPlayer on expiry.
 *
 * @param {Object} session - The session.
 */
function startSessionTimer(session) {
    clearSessionTimer(session);
    session.timeRemaining = getTimerForRound(session.currentRound);

    session.timerInterval = setInterval(async () => {
        session.timeRemaining = Math.max(0, parseFloat((session.timeRemaining - 0.1).toFixed(1)));

        broadcast(session, {
            type: 'timer_tick',
            timeRemaining: session.timeRemaining,
        });

        if (session.timeRemaining <= 0) {
            clearSessionTimer(session);
            await explodeCurrentPlayer(session);
        }
    }, 100);
}

/**
 * Returns an ordered array of non-eliminated players preserving insertion order.
 *
 * @param {Object} session - The session.
 * @returns {Array<Object>} Active players.
 */
function getActivePlayers(session) {
    return [...session.players.values()].filter(p => !p.eliminated);
}

/**
 * Returns the player whose turn it currently is.
 *
 * @param {Object} session - The session.
 * @returns {Object|undefined} Current player or undefined.
 */
function getCurrentPlayer(session) {
    const all = [...session.players.values()];
    return all[session.currentPlayerIndex];
}

/**
 * Advances currentPlayerIndex to the next non-eliminated player.
 *
 * @param {Object} session - The session.
 */
function advanceToNextPlayer(session) {
    const all = [...session.players.values()];
    const total = all.length;
    let next = (session.currentPlayerIndex + 1) % total;

    for (let i = 0; i < total; i++) {
        if (!all[next].eliminated) break;
        next = (next + 1) % total;
    }

    session.currentPlayerIndex = next;
}

/**
 * Sends a turn_start event to all players announcing whose turn it is,
 * the new word, and the current timer duration.
 *
 * @param {Object} session - The session.
 */
async function startTurn(session) {
    session.currentWord = await getRandomWord();
    const currentPlayer = getCurrentPlayer(session);

    if (!currentPlayer) {
        console.log('Error | No current player found, aborting turn');
        return;
    }

    const active = getActivePlayers(session);

    console.log('Info | Round', session.currentRound, '-', currentPlayer.name + "'s turn, word:", session.currentWord);

    broadcast(session, {
        type: 'turn_start',
        currentPlayerId: currentPlayer.id,
        word: session.currentWord,
        round: session.currentRound,
        timerSeconds: getTimerForRound(session.currentRound),
        players: getPlayerList(session),
        playersRemaining: active.length,
    });

    startSessionTimer(session);
}

/**
 * Handles word completion by the active player.
 * Passes the bomb or advances the round if all players have typed.
 *
 * @param {Object} session - The session.
 * @param {Object} player - The player who completed the word.
 */
async function handleWordComplete(session, player) {
    clearSessionTimer(session);

    broadcast(session, {
        type: 'word_complete',
        completedBy: player.name,
        players: getPlayerList(session),
    });

    setTimeout(() => {
        if (session.phase === 'playing') {
            session.currentRound++;
            advanceToNextPlayer(session);
            startTurn(session);
        }
    }, 1500);
}

/**
 * Eliminates the current player when the timer expires.
 * Ends the game if only one player remains; otherwise continues to next round.
 *
 * @param {Object} session - The session.
 */
async function explodeCurrentPlayer(session) {
    const player = getCurrentPlayer(session);
    if (!player) return;

    player.eliminated = true;
    console.log('Info | Player eliminated:', player.name, '- Round', session.currentRound);

    const active = getActivePlayers(session);

    broadcast(session, {
        type: 'player_eliminated',
        eliminatedId: player.id,
        eliminatedName: player.name,
        players: getPlayerList(session),
        playersRemaining: active.length,
    });

    if (active.length <= 1) {
        const winner = active[0] || null;
        session.phase = 'finished';

        broadcast(session, {
            type: 'game_over',
            winnerId: winner ? winner.id : null,
            winnerName: winner ? winner.name : null,
        });

        console.log('Success | Game over - winner:', winner ? winner.name : 'none');

        setTimeout(() => sessions.delete(session.code), 30000);
        return;
    }

    session.currentRound++;
    session.playersCompletedThisRound = 0;

    broadcast(session, {
        type: 'next_round',
        round: session.currentRound,
        timerSeconds: getTimerForRound(session.currentRound),
        playersRemaining: active.length,
    });

    setTimeout(() => {
        if (session.phase === 'playing') {
            advanceToNextPlayer(session);
            startTurn(session);
        }
    }, 2000);
}

/**
 * Returns true if the given name is already taken in the session,
 * compared case-insensitively.
 *
 * @param {Object} session - The session to check.
 * @param {string} name - The name to look up.
 * @returns {boolean} Whether the name is already in use.
 */
function isNameTaken(session, name) {
    const lower = name.toLowerCase();
    for (const player of session.players.values()) {
        if (player.name.toLowerCase() === lower) return true;
    }
    return false;
}

/**
 * Handles create_session from a client wanting to host.
 * Creates a session, adds the host player, and responds with the code.
 *
 * @param {WebSocket} ws - The host's socket.
 * @param {Object} msg - Parsed message payload.
 */
function handleCreateSession(ws, msg) {
    const code = generateSessionCode();
    const session = createSession(code, ws.playerId);

    const player = createPlayer(ws.playerId, msg.playerName || 'Player 1', ws, true);
    session.players.set(ws.playerId, player);
    sessions.set(code, session);
    ws.sessionCode = code;

    console.log('Info | Session created:', code, 'by', player.name, '(' + ws.playerId + ')');

    send(ws, {
        type: 'session_created',
        code,
        playerId: ws.playerId,
        players: getPlayerList(session),
    });
}

/**
 * Handles join_session from a client entering a code.
 * Validates the session and adds the player if there is room.
 *
 * @param {WebSocket} ws - The joining player's socket.
 * @param {Object} msg - Parsed message with code and playerName.
 */
function handleJoinSession(ws, msg) {
    const session = sessions.get(msg.code);

    if (!session) {
        return send(ws, { type: 'error', message: 'Session not found. Check the code and try again.' });
    }
    if (session.phase !== 'lobby') {
        return send(ws, { type: 'error', message: 'That game has already started.' });
    }
    if (session.players.size >= MAX_PLAYERS_PER_SESSION) {
        return send(ws, { type: 'error', message: 'Session is full (max 5 players).' });
    }

    const playerNumber = session.players.size + 1;
    const resolvedName = msg.playerName || `Player ${playerNumber}`;

    if (isNameTaken(session, resolvedName)) {
        console.log('Warning | Duplicate name rejected:', resolvedName);
        return send(ws, { type: 'error', message: 'That name is already taken. Please choose a different name.' });
    }

    const player = createPlayer(ws.playerId, resolvedName, ws, false);
    session.players.set(ws.playerId, player);
    ws.sessionCode = msg.code;

    console.log('Info | Player joined session', msg.code + ':', player.name, '(' + ws.playerId + ')');

    send(ws, {
        type: 'session_joined',
        code: msg.code,
        playerId: ws.playerId,
        players: getPlayerList(session),
        hostId: session.hostId,
    });

    broadcastLobbyState(session);
}

/**
 * Handles start_game from the host.
 * Validates conditions and kicks off the first turn.
 *
 * @param {WebSocket} ws - The host's socket.
 * @param {Object} session - The session.
 */
async function handleStartGame(ws, session) {
    if (ws.playerId !== session.hostId) {
        return send(ws, { type: 'error', message: 'Only the host can start the game.' });
    }
    if (session.players.size < MIN_PLAYERS_TO_START) {
        return send(ws, { type: 'error', message: `Need at least ${MIN_PLAYERS_TO_START} players to start.` });
    }
    if (session.phase !== 'lobby') {
        return send(ws, { type: 'error', message: 'Game already in progress.' });
    }

    session.phase = 'playing';
    session.currentPlayerIndex = 0;
    session.currentRound = 1;
    session.playersCompletedThisRound = 0;

    console.group('Info | Game starting');
    console.log('Info | Session:', session.code);
    console.log('Info | Players:', session.players.size);
    console.groupEnd();

    broadcast(session, {
        type: 'game_started',
        players: getPlayerList(session),
        round: session.currentRound,
        timerSeconds: getTimerForRound(session.currentRound),
    });

    await startTurn(session);
}

/**
 * Handles submit_word from the active player.
 * Ignores if it is not that player's turn or the word is wrong.
 *
 * @param {WebSocket} ws - The submitting player's socket.
 * @param {Object} msg - Parsed message with typed word.
 * @param {Object} session - The session.
 */
async function handleSubmitWord(ws, msg, session) {
    if (session.phase !== 'playing') return;

    const currentPlayer = getCurrentPlayer(session);
    if (!currentPlayer || currentPlayer.id !== ws.playerId) return;

    const typed = (msg.word || '').toLowerCase().trim();
    if (typed !== session.currentWord) return;

    console.log('Success | Word completed by', currentPlayer.name + ':', session.currentWord);
    await handleWordComplete(session, currentPlayer);
}

/**
 * Handles typing_update from the active player for live preview.
 * Broadcasts the partial input to all other players.
 *
 * @param {WebSocket} ws - The typing player's socket.
 * @param {Object} msg - Parsed message with partial input.
 * @param {Object} session - The session.
 */
function handleTypingUpdate(ws, msg, session) {
    if (session.phase !== 'playing') return;

    const currentPlayer = getCurrentPlayer(session);
    if (!currentPlayer || currentPlayer.id !== ws.playerId) return;

    broadcast(session, {
        type: 'typing_update',
        playerId: ws.playerId,
        input: msg.input || '',
    }, ws.playerId);
}

/**
 * Handles leave_session or unexpected disconnection.
 * Removes the player; if host leaves, migrates host or closes session.
 *
 * @param {WebSocket} ws - The disconnecting socket.
 */
function handleLeave(ws) {
    const code = ws.sessionCode;
    if (!code) return;

    const session = sessions.get(code);
    if (!session) return;

    const player = session.players.get(ws.playerId);
    const playerName = player ? player.name : ws.playerId;
    session.players.delete(ws.playerId);

    console.log('Info | Player left session', code + ':', playerName);

    if (session.players.size === 0) {
        clearSessionTimer(session);
        sessions.delete(code);
        console.log('Info | Session closed - no players remaining:', code);
        return;
    }

    if (session.phase === 'playing' && player) {
        player.eliminated = true;

        const active = getActivePlayers(session);
        if (active.length <= 1) {
            clearSessionTimer(session);
            const winner = active[0] || null;
            session.phase = 'finished';

            broadcast(session, {
                type: 'game_over',
                winnerId: winner ? winner.id : null,
                winnerName: winner ? winner.name : null,
                reason: `${playerName} disconnected.`,
            });

            setTimeout(() => sessions.delete(code), 30000);
            return;
        }

        broadcast(session, {
            type: 'player_eliminated',
            eliminatedId: ws.playerId,
            eliminatedName: playerName,
            players: getPlayerList(session),
            playersRemaining: active.length,
            reason: 'disconnected',
        });
    }

    if (ws.playerId === session.hostId) {
        const newHost = [...session.players.values()][0];
        if (newHost) {
            session.hostId = newHost.id;
            newHost.isHost = true;
            console.log('Info | Host migrated to', newHost.name, 'in session', code);
        }
    }

    if (session.phase === 'lobby') {
        broadcastLobbyState(session);
    } else {
        broadcast(session, {
            type: 'player_left',
            playerId: ws.playerId,
            playerName,
            newHostId: session.hostId,
            players: getPlayerList(session),
        });
    }
}

const server = http.createServer();
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
    ws.playerId = `p_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    ws.sessionCode = null;

    console.log('Info | Client connected:', ws.playerId);

    ws.on('message', async (raw) => {
        let msg;

        try {
            msg = JSON.parse(raw);
        } catch {
            return send(ws, { type: 'error', message: 'Invalid message format.' });
        }

        const session = ws.sessionCode ? sessions.get(ws.sessionCode) : null;

        switch (msg.type) {
            case 'create_session':
                handleCreateSession(ws, msg);
                break;

            case 'join_session':
                handleJoinSession(ws, msg);
                break;

            case 'start_game':
                if (session) await handleStartGame(ws, session);
                break;

            case 'submit_word':
                if (session) await handleSubmitWord(ws, msg, session);
                break;

            case 'typing_update':
                if (session) handleTypingUpdate(ws, msg, session);
                break;

            case 'leave_session':
                handleLeave(ws);
                ws.sessionCode = null;
                break;

            default:
                send(ws, { type: 'error', message: `Unknown message type: ${msg.type}` });
        }
    });

    ws.on('close', () => {
        console.log('Info | Client disconnected:', ws.playerId);
        handleLeave(ws);
    });

    ws.on('error', (err) => {
        console.log('Error | Socket error for', ws.playerId + ':', err.message);
    });

    send(ws, { type: 'connected', playerId: ws.playerId });
});

loadFallbackWords().then(() => {
    server.listen(PORT, () => {
        console.log('Info | Panic Pass WebSocket server running on ws://localhost:' + PORT);
    });
});
