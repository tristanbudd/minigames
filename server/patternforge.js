"use strict";

/**
 * Pattern Forge - Multiplayer WebSocket Server
 *
 * Manages 6-digit sessions with a lobby, server-authoritative turn flow,
 * timed pattern previews, and score-based round progression.
 *
 * Dependencies: ws (npm install ws)
 * Run: node server/patternforge.js
 */

const { WebSocketServer, WebSocket } = require('ws');
const http = require('http');

const PORT = process.env.PORT || 8083;
const MAX_SESSIONS = 999999;
const MAX_PLAYERS_PER_SESSION = 5;
const MIN_PLAYERS_TO_START = 2;
const BASE_MATCH_MINUTES = {
    short: 1,
    medium: 3,
    long: 5,
};

const BASE_GRID_SIZE = 3;
const MAX_GRID_SIZE = 8;
const ROUNDS_PER_GRID_INCREASE = 3;
const PREVIEW_MS = 1400;

const sessions = new Map();

console.group('Info | Pattern Forge Server Initialized');
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
        attempts += 1;
        if (attempts > 10000) {
            throw new Error('No session codes available');
        }
    } while (sessions.has(code));

    return code;
}

/**
 * Creates a new session object.
 *
 * @param {string} code - The 6-digit session code.
 * @param {string} hostId - The host player ID.
 * @param {Object} options - Match options.
 * @param {string} [options.length='medium'] - Selected match length.
 * @returns {Object} Session object.
 */
function createSession(code, hostId, options = {}) {
    return {
        code,
        hostId,
        players: new Map(),
        phase: 'lobby',
        currentPlayerIndex: 0,
        currentRound: 1,
        turnsCompletedThisRound: 0,
        timerInterval: null,
        timeRemaining: 0,
        currentPattern: [],
        playerDraftPatterns: new Map(),
        currentGridSize: BASE_GRID_SIZE,
        currentPatternCount: 0,
        previewTimeout: null,
        turnLocked: false,
        startTime: 0,
        gameDurationMs: getMatchDurationMs(options.length || 'medium'),
        length: options.length || 'medium',
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
        points: 0,
        isAI: false,
    };
}

/**
 * Sends a JSON payload to a single WebSocket client if it is open.
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
 * Broadcasts a JSON payload to all players in a session.
 *
 * @param {Object} session - The session.
 * @param {Object} payload - Data to send.
 * @param {string} [excludeId] - Optional player ID to skip.
 */
function broadcast(session, payload, excludeId) {
    for (const [id, player] of session.players) {
        if (excludeId && id === excludeId) {
            continue;
        }

        send(player.ws, payload);
    }
}

/**
 * Builds a serialisable player list safe to send to clients.
 *
 * @param {Object} session - The session.
 * @returns {Array<Object>} Array of plain player objects.
 */
function getPlayerList(session) {
    return [...session.players.values()].map(player => ({
        id: player.id,
        name: player.name,
        isHost: player.isHost,
        points: player.points,
        isAI: false,
    }));
}

/**
 * Sends a full lobby snapshot to every player in the session.
 *
 * @param {Object} session - The session.
 */
function broadcastLobbyState(session) {
    broadcast(session, {
        type: 'lobby_state',
        players: getPlayerList(session),
        hostId: session.hostId,
        code: session.code,
        length: session.length,
    });
}

/**
 * Updates the lobby length for a session.
 *
 * @param {Object} session - The session.
 * @param {string} length - The selected match length.
 */
function setLobbyLength(session, length) {
    if (!BASE_MATCH_MINUTES[length]) {
        return;
    }

    session.length = length;
    session.gameDurationMs = getMatchDurationMs(length);

    if (session.phase === 'lobby') {
        broadcastLobbyState(session);
    }
}

/**
 * Returns the configured match duration in milliseconds.
 *
 * @param {string} length - The selected match length.
 * @returns {number} Match duration in milliseconds.
 */
function getMatchDurationMs(length) {
    const minutes = BASE_MATCH_MINUTES[length] || BASE_MATCH_MINUTES.medium;
    return minutes * 60 * 1000;
}

/**
 * Returns the grid size for the current round.
 *
 * @param {number} round - Round number.
 * @returns {number} Grid side length.
 */
function getGridSizeForRound(round) {
    const increases = Math.floor((round - 1) / ROUNDS_PER_GRID_INCREASE);
    return Math.min(MAX_GRID_SIZE, BASE_GRID_SIZE + increases);
}

/**
 * Returns how many cells should be lit in the target pattern.
 *
 * @param {number} size - Grid side length.
 * @param {number} round - Round number.
 * @returns {number} Number of filled cells.
 */
function getPatternCellCount(size, round) {
    const min = Math.max(3, Math.floor(size * 0.7));
    const extra = Math.floor((round - 1) / 2);
    const max = Math.min(size * size - 1, min + size + extra);
    return Math.max(min, max);
}

/**
 * Returns the per-turn countdown for the current round.
 *
 * @param {number} round - Round number.
 * @returns {number} Turn time in seconds.
 */
function getRoundTime(round) {
    const baseTime = Math.max(6, 12 - Math.floor((round - 1) / 2));
    return Math.max(5, baseTime);
}

/**
 * Converts a flat index into row and column coordinates.
 *
 * @param {number} index - Flat cell index.
 * @param {number} size - Grid side length.
 * @returns {{ row: number, col: number }} Row and column coordinates.
 */
function indexToPoint(index, size) {
    return { row: Math.floor(index / size), col: index % size };
}

/**
 * Converts row and column coordinates into a flat index.
 *
 * @param {number} row - Row index.
 * @param {number} col - Column index.
 * @param {number} size - Grid side length.
 * @returns {number} Flat cell index.
 */
function pointToIndex(row, col, size) {
    return (row * size) + col;
}

/**
 * Returns a new empty boolean pattern array.
 *
 * @param {number} size - Grid side length.
 * @returns {boolean[]} Empty pattern array.
 */
function buildEmptyPattern(size) {
    return Array.from({ length: size * size }, () => false);
}

/**
 * Shuffles an array in place using Fisher-Yates.
 *
 * @template T
 * @param {T[]} items - Array to shuffle.
 * @returns {T[]} The shuffled array.
 */
function shuffleArray(items) {
    for (let i = items.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const temp = items[i];
        items[i] = items[j];
        items[j] = temp;
    }

    return items;
}

/**
 * Generates a connected target pattern for the current grid.
 *
 * @param {number} size - Grid side length.
 * @param {number} count - Number of filled cells to generate.
 * @returns {boolean[]} Generated pattern.
 */
function generateConnectedPattern(size, count) {
    const pattern = buildEmptyPattern(size);
    const visited = new Set();
    const neighbors = [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
    ];

    const start = Math.floor(Math.random() * size * size);
    visited.add(start);

    while (visited.size < count) {
        const anchorArray = Array.from(visited);
        const anchor = anchorArray[Math.floor(Math.random() * anchorArray.length)];
        const anchorPoint = indexToPoint(anchor, size);

        const shuffled = neighbors
            .map(delta => ({
                row: anchorPoint.row + delta[0],
                col: anchorPoint.col + delta[1],
            }))
            .sort(() => Math.random() - 0.5);

        let expanded = false;

        for (const next of shuffled) {
            if (next.row < 0 || next.row >= size || next.col < 0 || next.col >= size) {
                continue;
            }

            const nextIndex = pointToIndex(next.row, next.col, size);
            if (visited.has(nextIndex)) {
                continue;
            }

            visited.add(nextIndex);
            expanded = true;
            break;
        }

        if (!expanded) {
            visited.add(Math.floor(Math.random() * size * size));
        }
    }

    visited.forEach(index => {
        pattern[index] = true;
    });

    return pattern;
}

/**
 * Calculates the signed accuracy and point score for a submitted pattern.
 *
 * @param {boolean[]} submittedPattern - Submitted pattern.
 * @param {boolean[]} targetPattern - Expected pattern.
 * @returns {{ accuracy: number, points: number, success: boolean }} Turn result.
 */
function calculateTurnResult(submittedPattern, targetPattern) {
    let matches = 0;
    let wrong = 0;

    for (let i = 0; i < targetPattern.length; i++) {
        if (targetPattern[i] === submittedPattern[i]) {
            matches += 1;
        } else {
            wrong += 1;
        }
    }

    const total = targetPattern.length;
    const accuracy = (matches - wrong) / total;
    const points = Math.round(((matches - wrong) / total) * 100);

    return {
        accuracy,
        points,
        success: matches === total,
    };
}

/**
 * Returns whether the overall match timer has expired.
 *
 * @param {Object} session - The session.
 * @returns {boolean} True when the match time is over.
 */
function isGameOver(session) {
    if (!session.startTime || !session.gameDurationMs) {
        return false;
    }

    return (Date.now() - session.startTime) >= session.gameDurationMs;
}

/**
 * Returns the current player.
 *
 * @param {Object} session - The session.
 * @returns {Object|null} Current player or null.
 */
function getCurrentPlayer(session) {
    const active = [...session.players.values()];

    if (active.length === 0) {
        return null;
    }

    return active[session.currentPlayerIndex % active.length] || null;
}

/**
 * Returns all active players (players still in the session).
 *
 * @param {Object} session - The session.
 * @returns {Array<Object>} Active players.
 */
function getActivePlayers(session) {
    return [...session.players.values()];
}

/**
 * Advances the player index to the next active player.
 *
 * @param {Object} session - The session.
 */
function advanceToNextPlayer(session) {
    const active = getActivePlayers(session);

    if (active.length === 0) {
        session.currentPlayerIndex = 0;
        return;
    }

    session.currentPlayerIndex = (session.currentPlayerIndex + 1) % active.length;
}

/**
 * Clears the active timer for a session.
 *
 * @param {Object} session - The session.
 */
function clearSessionTimer(session) {
    if (session.timerInterval) {
        clearInterval(session.timerInterval);
        session.timerInterval = null;
    }

    if (session.previewTimeout) {
        clearTimeout(session.previewTimeout);
        session.previewTimeout = null;
    }
}

/**
 * Builds standings sorted by highest points first.
 *
 * @param {Object} session - The session.
 * @returns {Array<Object>} Standings array.
 */
function getStandings(session) {
    return [...session.players.values()]
        .sort((a, b) => b.points - a.points)
        .map(player => ({
            id: player.id,
            name: player.name,
            points: player.points,
            isHost: player.isHost,
        }));
}

/**
 * Ends the game and broadcasts the summary.
 *
 * @param {Object} session - The session.
 * @param {string} [reason] - Optional end reason.
 */
function endGame(session, reason) {
    clearSessionTimer(session);
    session.phase = 'finished';

    const standings = getStandings(session);
    const winner = standings[0] || null;

    broadcast(session, {
        type: 'game_over',
        winnerId: winner ? winner.id : null,
        winnerName: winner ? winner.name : null,
        standings,
        reason,
    });

    setTimeout(() => {
        sessions.delete(session.code);
    }, 30000);
}

/**
 * Starts the countdown timer for the current turn.
 *
 * @param {Object} session - The session.
 */
function startSessionTimer(session) {
    clearSessionTimer(session);
    session.timeRemaining = getRoundTime(session.currentRound);

    session.timerInterval = setInterval(() => {
        session.timeRemaining = Math.max(0, parseFloat((session.timeRemaining - 0.1).toFixed(1)));

        broadcast(session, {
            type: 'timer_tick',
            timeRemaining: session.timeRemaining,
        });

        if (session.timeRemaining <= 0) {
            clearSessionTimer(session);
            const currentPlayer = getCurrentPlayer(session);
            if (currentPlayer && !session.turnLocked) {
                const draftPattern = session.playerDraftPatterns.get(currentPlayer.id) || buildEmptyPattern(session.currentGridSize);
                handlePatternSubmit(session, currentPlayer, draftPattern, true);
            }
        }
    }, 100);
}

/**
 * Starts a new turn for the current player.
 *
 * @param {Object} session - The session.
 */
function startTurn(session) {
    if (session.phase !== 'playing') {
        return;
    }

    const currentPlayer = getCurrentPlayer(session);
    if (!currentPlayer) {
        endGame(session, 'No players available.');
        return;
    }

    const gridSize = getGridSizeForRound(session.currentRound);
    const patternCount = getPatternCellCount(gridSize, session.currentRound);
    const pattern = generateConnectedPattern(gridSize, patternCount);

    session.currentGridSize = gridSize;
    session.currentPatternCount = patternCount;
    session.currentPattern = pattern;
    session.playerDraftPatterns.set(currentPlayer.id, buildEmptyPattern(gridSize));
    session.turnLocked = false;

    broadcast(session, {
        type: 'turn_start',
        currentPlayerId: currentPlayer.id,
        round: session.currentRound,
        timerSeconds: getRoundTime(session.currentRound),
        players: getPlayerList(session),
        gridSize,
        patternSize: patternCount,
        pattern,
    });

    startSessionTimer(session);
}

/**
 * Handles the completion of a turn and advances the match.
 *
 * @param {Object} session - The session.
 * @param {Object} player - The player who submitted the pattern.
 * @param {boolean[]} submittedPattern - Submitted pattern.
 * @param {boolean} [isTimeout=false] - Whether the submission came from a timeout.
 */
function handlePatternSubmit(session, player, submittedPattern, isTimeout = false) {
    if (session.phase !== 'playing') {
        return;
    }

    if (session.turnLocked) {
        return;
    }

    const activePlayer = getCurrentPlayer(session);
    if (!activePlayer || activePlayer.id !== player.id) {
        return;
    }

    session.turnLocked = true;
    clearSessionTimer(session);
    session.playerDraftPatterns.set(player.id, submittedPattern.slice());

    const result = calculateTurnResult(submittedPattern, session.currentPattern);
    player.points += result.points;

    broadcast(session, {
        type: 'turn_result',
        playerId: player.id,
        playerName: player.name,
        success: result.success,
        accuracy: result.accuracy,
        points: result.points,
        isTimeout,
        submittedPattern,
        players: getPlayerList(session),
        round: session.currentRound,
    });

    session.turnsCompletedThisRound += 1;
    const active = getActivePlayers(session);
    const roundComplete = session.turnsCompletedThisRound >= active.length;

    if (roundComplete) {
        session.turnsCompletedThisRound = 0;
        session.currentRound += 1;

        broadcast(session, {
            type: 'next_round',
            round: session.currentRound,
            timerSeconds: getRoundTime(session.currentRound),
            playersRemaining: active.length,
        });
    }

    const elapsedMs = Date.now() - session.startTime;
    if (elapsedMs >= session.gameDurationMs) {
        endGame(session, 'Time up.');
        return;
    }

    session.previewTimeout = setTimeout(() => {
        if (session.phase !== 'playing') {
            return;
        }

        advanceToNextPlayer(session);
        startTurn(session);
    }, 950);
}

/**
 * Returns true if a name is already taken in the session.
 *
 * @param {Object} session - The session to check.
 * @param {string} name - Candidate name.
 * @returns {boolean} True if taken.
 */
function isNameTaken(session, name) {
    const lower = name.toLowerCase();
    for (const player of session.players.values()) {
        if (player.name.toLowerCase() === lower) {
            return true;
        }
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
    if (ws.sessionCode) {
        return send(ws, { type: 'error', message: 'You are already in a session.' });
    }

    const code = generateSessionCode();
    const session = createSession(code, ws.playerId, {
        length: msg.length || 'medium',
    });

    const player = createPlayer(ws.playerId, msg.playerName || 'Player 1', ws, true);
    session.players.set(ws.playerId, player);
    sessions.set(code, session);
    ws.sessionCode = code;

    send(ws, {
        type: 'session_created',
        code,
        playerId: ws.playerId,
        players: getPlayerList(session),
        hostId: session.hostId,
        length: session.length,
    });
}

/**
 * Handles join_session from client.
 *
 * @param {WebSocket} ws - Joining socket.
 * @param {Object} msg - Payload.
 */
function handleJoinSession(ws, msg) {
    if (ws.sessionCode) {
        return send(ws, { type: 'error', message: 'You are already in a session.' });
    }

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

    const resolvedName = msg.playerName || `Player ${session.players.size + 1}`;

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
        length: session.length,
    });

    broadcastLobbyState(session);
}

/**
 * Handles start_game from host.
 *
 * @param {WebSocket} ws - Host socket.
 * @param {Object} session - Session object.
 */
function handleStartGame(ws, session, msg) {
    if (ws.playerId !== session.hostId) {
        return send(ws, { type: 'error', message: 'Only the host can start the game.' });
    }

    if (session.players.size < MIN_PLAYERS_TO_START) {
        return send(ws, { type: 'error', message: `Need at least ${MIN_PLAYERS_TO_START} players to start.` });
    }

    if (session.phase !== 'lobby') {
        return send(ws, { type: 'error', message: 'Game already in progress.' });
    }

    if (typeof msg.length === 'string' && BASE_MATCH_MINUTES[msg.length]) {
        session.length = msg.length;
    }

    session.phase = 'playing';
    session.currentPlayerIndex = 0;
    session.currentRound = 1;
    session.turnsCompletedThisRound = 0;
    session.startTime = Date.now();
    session.gameDurationMs = getMatchDurationMs(session.length);

    console.group('Info | Game starting');
    console.log('Info | Session:', session.code);
    console.log('Info | Players:', session.players.size);
    console.groupEnd();

    broadcast(session, {
        type: 'game_started',
        players: getPlayerList(session),
        round: session.currentRound,
        timerSeconds: getRoundTime(session.currentRound),
        startTime: session.startTime,
        gameDurationMs: session.gameDurationMs,
        length: session.length,
    });

    startTurn(session);
}

/**
 * Updates the lobby match length.
 *
 * @param {WebSocket} ws - Host socket.
 * @param {Object} session - Session object.
 * @param {Object} msg - Payload.
 */
function handleSetLobbyLength(ws, session, msg) {
    if (ws.playerId !== session.hostId) {
        return send(ws, { type: 'error', message: 'Only the host can change the game length.' });
    }

    if (session.phase !== 'lobby') {
        return send(ws, { type: 'error', message: 'Game length can only be changed before the match starts.' });
    }

    if (!BASE_MATCH_MINUTES[msg.length]) {
        return send(ws, { type: 'error', message: 'Invalid game length.' });
    }

    session.length = msg.length;
    broadcastLobbyState(session);
}

/**
 * Stores the active player's latest draft pattern.
 *
 * @param {WebSocket} ws - Sender socket.
 * @param {Object} session - Session object.
 * @param {Object} msg - Payload.
 */
function handlePatternDraft(ws, session, msg) {
    if (session.phase !== 'playing') {
        return;
    }

    const currentPlayer = getCurrentPlayer(session);
    if (!currentPlayer || currentPlayer.id !== ws.playerId) {
        return;
    }

    if (!Array.isArray(msg.pattern)) {
        return;
    }

    session.playerDraftPatterns.set(ws.playerId, msg.pattern.map(Boolean));
}

/**
 * Handles submit_pattern from the active player.
 *
 * @param {WebSocket} ws - Sender socket.
 * @param {Object} msg - Payload.
 * @param {Object} session - Session object.
 */
function handleSubmitPattern(ws, msg, session) {
    if (session.phase !== 'playing') {
        return;
    }

    const currentPlayer = getCurrentPlayer(session);
    if (!currentPlayer || currentPlayer.id !== ws.playerId) {
        return;
    }

    const pattern = Array.isArray(msg.pattern) ? msg.pattern.map(Boolean) : buildEmptyPattern(session.currentGridSize);
    handlePatternSubmit(session, currentPlayer, pattern, false);
}

/**
 * Handles leave_session and disconnect.
 *
 * @param {WebSocket} ws - Leaving socket.
 */
function handleLeave(ws) {
    const code = ws.sessionCode;
    if (!code) {
        return;
    }

    const session = sessions.get(code);
    if (!session) {
        return;
    }

    const player = session.players.get(ws.playerId);
    const playerName = player ? player.name : ws.playerId;
    const allPlayers = [...session.players.values()];
    const leavingIndex = allPlayers.findIndex(p => p.id === ws.playerId);
    const wasCurrentPlayer = session.phase === 'playing' && session.players.size > 0 && getCurrentPlayer(session)?.id === ws.playerId;

    session.players.delete(ws.playerId);
    ws.sessionCode = null;

    console.log('Info | Player left session', code + ':', playerName);

    if (session.players.size === 0) {
        clearSessionTimer(session);
        sessions.delete(code);
        console.log('Info | Session closed - no players remaining:', code);
        return;
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
        return;
    }

    if (leavingIndex !== -1 && leavingIndex < session.currentPlayerIndex) {
        session.currentPlayerIndex -= 1;
    }

    if (session.currentPlayerIndex >= session.players.size) {
        session.currentPlayerIndex = 0;
    }

    if (wasCurrentPlayer) {
        clearSessionTimer(session);
        session.turnsCompletedThisRound += 1;

        broadcast(session, {
            type: 'player_left',
            playerId: ws.playerId,
            playerName,
            newHostId: session.hostId,
            players: getPlayerList(session),
        });

        const active = getActivePlayers(session);
        if (active.length <= 1) {
            endGame(session, `${playerName} disconnected.`);
            return;
        }

        const roundComplete = session.turnsCompletedThisRound >= active.length;
        if (roundComplete) {
            session.turnsCompletedThisRound = 0;
            session.currentRound += 1;

            broadcast(session, {
                type: 'next_round',
                round: session.currentRound,
                timerSeconds: getRoundTime(session.currentRound),
                playersRemaining: active.length,
            });
        }

        session.previewTimeout = setTimeout(() => {
            if (session.phase === 'playing') {
                startTurn(session);
            }
        }, 950);

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
                if (session) {
                    handleStartGame(ws, session, msg);
                }
                break;

            case 'set_lobby_length':
                if (session) {
                    handleSetLobbyLength(ws, session, msg);
                }
                break;

            case 'submit_pattern':
                if (session) {
                    handleSubmitPattern(ws, msg, session);
                }
                break;

            case 'pattern_draft':
                if (session) {
                    handlePatternDraft(ws, session, msg);
                }
                break;

            case 'leave_session':
                handleLeave(ws);
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

server.listen(PORT, () => {
    console.log('Info | Pattern Forge WebSocket server running on ws://localhost:' + PORT);
});
