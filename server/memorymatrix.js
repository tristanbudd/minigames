"use strict";

/**
 * Memory Matrix - Multiplayer WebSocket Server
 *
 * Manages game sessions identified by 6-digit codes.
 * Each session holds up to 5 players (1 host + 4 others).
 * Game logic runs server-side so all clients stay in sync.
 *
 * Dependencies: ws (npm install ws)
 * Run: node server/memorymatrix.js
 */

const { WebSocketServer, WebSocket } = require('ws');
const http = require('http');

const PORT = process.env.PORT || 8082;
const MAX_SESSIONS = 999999;
const MAX_PLAYERS_PER_SESSION = 5;
const MIN_PLAYERS_TO_START = 2;

const BASE_TIMER = 12;
const ROUNDS_PER_GRID_SIZE = 5;
const BASE_GRID_SIZE = 3;
const MAX_GRID_SIZE = 6;
const PLAYER_LIVES = 3;

const sessions = new Map();

console.group('Info | Memory Matrix Server Initialized');
console.log('Info | Port:', PORT);
console.log('Info | Max sessions:', MAX_SESSIONS);
console.log('Info | Max players per session:', MAX_PLAYERS_PER_SESSION);
console.groupEnd();

/**
 * Generates a unique 6-digit session code string.
 *
 * @returns {string} Zero-padded 6-digit code.
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
 * @param {string} hostId - The host player ID.
 * @returns {Object} Session object.
 */
function createSession(code, hostId) {
    return {
        code,
        hostId,
        players: new Map(),
        phase: 'lobby',
        currentPlayerIndex: 0,
        currentRound: 1,
        turnsCompletedThisRound: 0,
        timerInterval: null,
        timeRemaining: BASE_TIMER,
        currentGridSize: BASE_GRID_SIZE,
        currentPatternLength: 3,
        currentSequence: [],
    };
}

/**
 * Creates a player state object.
 *
 * @param {string} id - Unique player ID.
 * @param {string} name - Display name.
 * @param {WebSocket} ws - Player socket.
 * @param {boolean} isHost - Whether this player is host.
 * @returns {Object} Player state.
 */
function createPlayer(id, name, ws, isHost) {
    return {
        id,
        name,
        ws,
        isHost,
        isAI: false,
        lives: PLAYER_LIVES,
        eliminated: false,
    };
}

/**
 * Sends JSON payload to one socket if open.
 *
 * @param {WebSocket} ws - Target socket.
 * @param {Object} payload - JSON payload.
 */
function send(ws, payload) {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(payload));
    }
}

/**
 * Broadcasts payload to all players in a session.
 *
 * @param {Object} session - Session object.
 * @param {Object} payload - Payload to broadcast.
 * @param {string} [excludeId] - Optional player ID to skip.
 */
function broadcast(session, payload, excludeId) {
    for (const [id, player] of session.players) {
        if (excludeId && id === excludeId) continue;
        send(player.ws, payload);
    }
}

/**
 * Returns serialisable player list.
 *
 * @param {Object} session - Session object.
 * @returns {Array<Object>} Plain player list.
 */
function getPlayerList(session) {
    return [...session.players.values()].map(player => ({
        id: player.id,
        name: player.name,
        isHost: player.isHost,
        isAI: false,
        lives: player.lives,
        eliminated: player.eliminated,
    }));
}

/**
 * Sends full lobby state to all lobby players.
 *
 * @param {Object} session - Session object.
 */
function broadcastLobbyState(session) {
    broadcast(session, {
        type: 'lobby_state',
        players: getPlayerList(session),
        hostId: session.hostId,
        code: session.code,
    });
}

/**
 * Returns grid size for a round.
 *
 * @param {number} round - Round number.
 * @returns {number} Grid size.
 */
function getGridSizeForRound(round) {
    const stage = Math.floor((round - 1) / ROUNDS_PER_GRID_SIZE);
    return Math.min(MAX_GRID_SIZE, BASE_GRID_SIZE + stage);
}

/**
 * Returns pattern length for a round.
 *
 * @param {number} round - Round number.
 * @returns {number} Pattern length.
 */
function getPatternLengthForRound(round) {
    const stage = Math.floor((round - 1) / ROUNDS_PER_GRID_SIZE);
    const inStageRound = (round - 1) % ROUNDS_PER_GRID_SIZE;
    return 3 + stage + Math.floor(inStageRound / 2);
}

/**
 * Returns timer seconds for a round.
 *
 * @param {number} round - Round number.
 * @returns {number} Timer in seconds.
 */
function getTimerForRound(round) {
    return Math.max(4, BASE_TIMER - Math.floor((round - 1) / 2));
}

/**
 * Generates random sequence for a grid and length.
 *
 * @param {number} gridSize - Grid side length.
 * @param {number} length - Sequence length.
 * @returns {number[]} Sequence.
 */
function generateSequence(gridSize, length) {
    const maxCell = gridSize * gridSize;
    const sequence = [];

    for (let i = 0; i < length; i++) {
        sequence.push(Math.floor(Math.random() * maxCell));
    }

    return sequence;
}

/**
 * Clears active timer for a session.
 *
 * @param {Object} session - Session object.
 */
function clearSessionTimer(session) {
    if (session.timerInterval) {
        clearInterval(session.timerInterval);
        session.timerInterval = null;
    }
}

/**
 * Returns active (non-eliminated) players in insertion order.
 *
 * @param {Object} session - Session object.
 * @returns {Array<Object>} Active players.
 */
function getActivePlayers(session) {
    return [...session.players.values()].filter(player => !player.eliminated);
}

/**
 * Returns current active player based on currentPlayerIndex.
 *
 * @param {Object} session - Session object.
 * @returns {Object|undefined} Current player.
 */
function getCurrentPlayer(session) {
    const allPlayers = [...session.players.values()];
    return allPlayers[session.currentPlayerIndex];
}

/**
 * Advances index to next non-eliminated player.
 *
 * @param {Object} session - Session object.
 */
function advanceToNextPlayer(session) {
    const allPlayers = [...session.players.values()];
    const total = allPlayers.length;
    let next = (session.currentPlayerIndex + 1) % total;

    for (let i = 0; i < total; i++) {
        if (!allPlayers[next].eliminated) break;
        next = (next + 1) % total;
    }

    session.currentPlayerIndex = next;
}

/**
 * Starts session timer for current turn.
 *
 * @param {Object} session - Session object.
 */
function startSessionTimer(session) {
    clearSessionTimer(session);
    session.timeRemaining = getTimerForRound(session.currentRound);

    session.timerInterval = setInterval(() => {
        session.timeRemaining = Math.max(0, parseFloat((session.timeRemaining - 0.1).toFixed(1)));

        broadcast(session, {
            type: 'timer_tick',
            timeRemaining: session.timeRemaining,
        });

        if (session.timeRemaining <= 0) {
            clearSessionTimer(session);
            const currentPlayer = getCurrentPlayer(session);
            if (currentPlayer) {
                handleSequenceSubmit(session, currentPlayer, []);
            }
        }
    }, 100);
}

/**
 * Starts a new turn for current player.
 *
 * @param {Object} session - Session object.
 */
function startTurn(session) {
    const currentPlayer = getCurrentPlayer(session);
    if (!currentPlayer) return;

    const gridSize = getGridSizeForRound(session.currentRound);
    const patternLength = getPatternLengthForRound(session.currentRound);
    const sequence = generateSequence(gridSize, patternLength);

    session.currentGridSize = gridSize;
    session.currentPatternLength = patternLength;
    session.currentSequence = sequence;

    broadcast(session, {
        type: 'turn_start',
        currentPlayerId: currentPlayer.id,
        round: session.currentRound,
        timerSeconds: getTimerForRound(session.currentRound),
        players: getPlayerList(session),
        gridSize,
        patternLength,
        sequence,
    });

    startSessionTimer(session);
}

/**
 * Handles all post-turn progression.
 *
 * @param {Object} session - Session object.
 */
function continueAfterTurn(session) {
    const active = getActivePlayers(session);

    if (active.length <= 1) {
        const winner = active[0] || null;
        session.phase = 'finished';

        broadcast(session, {
            type: 'game_over',
            winnerId: winner ? winner.id : null,
            winnerName: winner ? winner.name : null,
        });

        setTimeout(() => sessions.delete(session.code), 30000);
        return;
    }

    session.turnsCompletedThisRound++;
    if (session.turnsCompletedThisRound >= active.length) {
        session.turnsCompletedThisRound = 0;
        session.currentRound++;

        broadcast(session, {
            type: 'next_round',
            round: session.currentRound,
            playersRemaining: active.length,
        });
    }

    setTimeout(() => {
        if (session.phase === 'playing') {
            advanceToNextPlayer(session);
            startTurn(session);
        }
    }, 1200);
}

/**
 * Compares submitted sequence against expected sequence.
 *
 * @param {number[]} submitted - Submitted sequence.
 * @param {number[]} expected - Expected sequence.
 * @returns {boolean} True when equal.
 */
function isSequenceCorrect(submitted, expected) {
    if (!Array.isArray(submitted)) return false;
    if (submitted.length !== expected.length) return false;

    for (let i = 0; i < expected.length; i++) {
        if (Number(submitted[i]) !== Number(expected[i])) return false;
    }

    return true;
}

/**
 * Handles submitted sequence for active player.
 *
 * @param {Object} session - Session object.
 * @param {Object} player - Player submitting sequence.
 * @param {number[]} submittedSequence - Sequence from client.
 */
function handleSequenceSubmit(session, player, submittedSequence) {
    clearSessionTimer(session);

    const success = isSequenceCorrect(submittedSequence, session.currentSequence);

    if (success) {
        broadcast(session, {
            type: 'turn_result',
            playerId: player.id,
            playerName: player.name,
            success: true,
            livesRemaining: player.lives,
            players: getPlayerList(session),
        });

        continueAfterTurn(session);
        return;
    }

    player.lives = Math.max(0, player.lives - 1);

    if (player.lives <= 0) {
        player.eliminated = true;

        broadcast(session, {
            type: 'player_eliminated',
            eliminatedId: player.id,
            eliminatedName: player.name,
            players: getPlayerList(session),
        });
    } else {
        broadcast(session, {
            type: 'turn_result',
            playerId: player.id,
            playerName: player.name,
            success: false,
            livesRemaining: player.lives,
            players: getPlayerList(session),
        });
    }

    continueAfterTurn(session);
}

/**
 * Returns true if a name already exists in session (case-insensitive).
 *
 * @param {Object} session - Session object.
 * @param {string} name - Candidate name.
 * @returns {boolean} True if taken.
 */
function isNameTaken(session, name) {
    const lower = name.toLowerCase();
    for (const player of session.players.values()) {
        if (player.name.toLowerCase() === lower) return true;
    }
    return false;
}

/**
 * Handles create_session from host client.
 *
 * @param {WebSocket} ws - Host socket.
 * @param {Object} msg - Payload.
 */
function handleCreateSession(ws, msg) {
    const code = generateSessionCode();
    const session = createSession(code, ws.playerId);

    const player = createPlayer(ws.playerId, msg.playerName || 'Player 1', ws, true);
    session.players.set(ws.playerId, player);

    sessions.set(code, session);
    ws.sessionCode = code;

    send(ws, {
        type: 'session_created',
        code,
        playerId: ws.playerId,
        players: getPlayerList(session),
    });
}

/**
 * Handles join_session from client.
 *
 * @param {WebSocket} ws - Joining socket.
 * @param {Object} msg - Payload.
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
        return send(ws, { type: 'error', message: 'That name is already taken. Please choose a different name.' });
    }

    const player = createPlayer(ws.playerId, resolvedName, ws, false);
    session.players.set(ws.playerId, player);
    ws.sessionCode = msg.code;

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
 * Handles start_game from host.
 *
 * @param {WebSocket} ws - Host socket.
 * @param {Object} session - Session object.
 */
function handleStartGame(ws, session) {
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
    session.turnsCompletedThisRound = 0;

    broadcast(session, {
        type: 'game_started',
        players: getPlayerList(session),
        round: session.currentRound,
    });

    startTurn(session);
}

/**
 * Handles submit_sequence from active player.
 *
 * @param {WebSocket} ws - Sender socket.
 * @param {Object} msg - Payload.
 * @param {Object} session - Session object.
 */
function handleSubmitSequence(ws, msg, session) {
    if (session.phase !== 'playing') return;

    const currentPlayer = getCurrentPlayer(session);
    if (!currentPlayer || currentPlayer.id !== ws.playerId) return;

    handleSequenceSubmit(session, currentPlayer, msg.sequence || []);
}

/**
 * Handles leave_session and disconnect.
 *
 * @param {WebSocket} ws - Leaving socket.
 */
function handleLeave(ws) {
    const code = ws.sessionCode;
    if (!code) return;

    const session = sessions.get(code);
    if (!session) return;

    const allPlayers = [...session.players.values()];
    const leavingIndex = allPlayers.findIndex(player => player.id === ws.playerId);
    const player = session.players.get(ws.playerId);
    const playerName = player ? player.name : ws.playerId;
    const wasCurrentPlayer = session.phase === 'playing' && leavingIndex === session.currentPlayerIndex;

    session.players.delete(ws.playerId);

    if (session.players.size === 0) {
        clearSessionTimer(session);
        sessions.delete(code);
        return;
    }

    if (ws.playerId === session.hostId) {
        const newHost = [...session.players.values()][0];
        if (newHost) {
            session.hostId = newHost.id;
            newHost.isHost = true;
        }
    }

    if (session.phase === 'lobby') {
        broadcastLobbyState(session);
        return;
    }

    if (leavingIndex !== -1 && leavingIndex < session.currentPlayerIndex) {
        session.currentPlayerIndex--;
    }

    if (session.currentPlayerIndex >= session.players.size) {
        session.currentPlayerIndex = 0;
    }

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

    if (wasCurrentPlayer) {
        clearSessionTimer(session);

        broadcast(session, {
            type: 'player_eliminated',
            eliminatedId: ws.playerId,
            eliminatedName: playerName,
            players: getPlayerList(session),
        });

        session.turnsCompletedThisRound++;
        if (session.turnsCompletedThisRound >= active.length) {
            session.turnsCompletedThisRound = 0;
            session.currentRound++;
            broadcast(session, {
                type: 'next_round',
                round: session.currentRound,
                playersRemaining: active.length,
            });
        }

        setTimeout(() => {
            if (session.phase === 'playing') {
                startTurn(session);
            }
        }, 1200);

        return;
    }

    broadcast(session, {
        type: 'player_left',
        playerId: ws.playerId,
        playerName,
        newHostId: session.hostId,
        players: getPlayerList(session),
    });
}

const server = http.createServer();
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
    ws.playerId = `p_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    ws.sessionCode = null;

    ws.on('message', (raw) => {
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
                if (session) handleStartGame(ws, session);
                break;

            case 'submit_sequence':
                if (session) handleSubmitSequence(ws, msg, session);
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
        handleLeave(ws);
    });

    ws.on('error', (err) => {
        console.log('Error | Socket error for', ws.playerId + ':', err.message);
    });

    send(ws, { type: 'connected', playerId: ws.playerId });
});

server.listen(PORT, () => {
    console.log('Info | Memory Matrix WebSocket server running on ws://localhost:' + PORT);
});
