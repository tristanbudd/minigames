"use strict";

/**
 * Maze Run - Multiplayer WebSocket Server
 *
 * Manages game sessions identified by 6-digit codes.
 * Each session holds up to 5 players (1 host + 4 others).
 * Game logic mirrors the local maze flow but runs server-side
 * so all clients stay in sync.
 *
 * Dependencies: ws (npm install ws)
 * Run: node maze.js
 */

const { WebSocketServer, WebSocket } = require('ws');
const http = require('http');

const PORT = process.env.PORT || 8081;
const MAX_SESSIONS = 999999;
const MAX_PLAYERS_PER_SESSION = 5;
const MIN_PLAYERS_TO_START = 2;
const BASE_TIMER = 12;
const ROUNDS_PER_STAGE = 3;

const sessions = new Map();

console.group('Info | Maze Run Server Initialized');
console.log('Info | Port:', PORT);
console.log('Info | Max sessions:', MAX_SESSIONS);
console.log('Info | Max players per session:', MAX_PLAYERS_PER_SESSION);
console.groupEnd();

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
        currentPlayerIndex: 0,
        currentRound: 1,
        timerInterval: null,
        timeRemaining: BASE_TIMER,
        turnsCompletedThisRound: 0,
        maze: [],
        gridSize: 0,
        playerPos: { x: 1, y: 1 },
        goalPos: { x: 1, y: 1 },
        visited: new Set(),
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
 * Calculates maze size for the given round.
 *
 * @param {number} round - Current round number.
 * @returns {number} Logical maze size.
 */
function getGridSizeForRound(round) {
    const stage = Math.floor((round - 1) / ROUNDS_PER_STAGE);
    return Math.min(7, 4 + stage);
}

/**
 * Calculates the round timer duration with a minimum of 6 seconds.
 *
 * @param {number} round - Current round number.
 * @returns {number} Timer in seconds.
 */
function getTimerForRound(round) {
    const timer = Math.max(6, BASE_TIMER - Math.floor((round - 1) / 2));
    console.log('Debug | Timer for round', round, ':', timer, 'seconds');
    return timer;
}

/**
 * Returns a random integer in [0, max).
 *
 * @param {number} max - Exclusive upper bound.
 * @returns {number} Random integer.
 */
function randomInt(max) {
    return Math.floor(Math.random() * max);
}

/**
 * Shuffles an array in place.
 *
 * @param {Array} arr - Array to shuffle.
 */
function shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = randomInt(i + 1);
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
}

/**
 * Creates a fully walled pixel grid.
 *
 * @param {number} size - Pixel grid side length.
 * @returns {number[][]} The maze grid.
 */
function createGrid(size) {
    return Array.from({ length: size }, () => Array(size).fill(1));
}

/**
 * Carves a perfect maze into `grid` using iterative DFS starting at
 * logical cell (startX, startY).
 *
 * @param {number[][]} grid - The maze pixel grid.
 * @param {number} lSize - Logical cells per side.
 * @param {number} startX - Start logical x.
 * @param {number} startY - Start logical y.
 */
function carveMazeDFS(grid, lSize, startX, startY) {
    const visited = Array.from({ length: lSize }, () => Array(lSize).fill(false));
    const stack = [{ x: startX, y: startY }];
    visited[startY][startX] = true;
    grid[startY * 2 + 1][startX * 2 + 1] = 0;

    const dirs = [
        { dx: 0, dy: -1 }, { dx: 1, dy: 0 },
        { dx: 0, dy: 1 }, { dx: -1, dy: 0 },
    ];

    while (stack.length > 0) {
        const cell = stack[stack.length - 1];
        const order = dirs.slice();
        shuffleArray(order);

        let moved = false;
        for (const dir of order) {
            const nx = cell.x + dir.dx;
            const ny = cell.y + dir.dy;
            if (nx < 0 || ny < 0 || nx >= lSize || ny >= lSize) continue;
            if (visited[ny][nx]) continue;

            grid[cell.y * 2 + 1 + dir.dy][cell.x * 2 + 1 + dir.dx] = 0;
            grid[ny * 2 + 1][nx * 2 + 1] = 0;

            visited[ny][nx] = true;
            stack.push({ x: nx, y: ny });
            moved = true;
            break;
        }

        if (!moved) stack.pop();
    }
}

/**
 * Injects extra openings by removing walls that currently separate
 * two already-open pixels.
 *
 * @param {number[][]} grid - The maze pixel grid.
 * @param {number} pixelSize - Pixel grid side length.
 * @param {number} count - Number of extra openings to add.
 */
function injectFalseRoutes(grid, pixelSize, count) {
    const candidates = [];

    for (let y = 1; y < pixelSize - 1; y++) {
        for (let x = 1; x < pixelSize - 1; x++) {
            if (grid[y][x] !== 1) continue;

            const hWall = grid[y][x - 1] === 0 && grid[y][x + 1] === 0;
            const vWall = grid[y - 1][x] === 0 && grid[y + 1][x] === 0;

            if (hWall || vWall) candidates.push({ x, y });
        }
    }

    shuffleArray(candidates);
    const toRemove = Math.min(count, candidates.length);
    for (let i = 0; i < toRemove; i++) {
        grid[candidates[i].y][candidates[i].x] = 0;
    }
}

/**
 * Runs BFS from `startPx` on the pixel grid and returns a map of
 * pixel key to BFS distance for every reachable open cell.
 *
 * @param {number[][]} grid - The maze pixel grid.
 * @param {{ x: number, y: number }} startPx - Pixel-space start.
 * @returns {Map<string, number>} Distance map.
 */
function bfsDistances(grid, startPx) {
    const dist = new Map();
    const key = (x, y) => `${x},${y}`;
    const dirs = [
        { dx: 1, dy: 0 }, { dx: -1, dy: 0 },
        { dx: 0, dy: 1 }, { dx: 0, dy: -1 },
    ];

    dist.set(key(startPx.x, startPx.y), 0);
    const queue = [startPx];

    while (queue.length > 0) {
        const cur = queue.shift();
        const d = dist.get(key(cur.x, cur.y));

        for (const dir of dirs) {
            const nx = cur.x + dir.dx;
            const ny = cur.y + dir.dy;
            if (!grid[ny] || grid[ny][nx] !== 0) continue;
            const nk = key(nx, ny);
            if (dist.has(nk)) continue;
            dist.set(nk, d + 1);
            queue.push({ x: nx, y: ny });
        }
    }

    return dist;
}

/**
 * Picks a far goal cell based on BFS distance.
 *
 * @param {number[][]} grid - The maze pixel grid.
 * @param {{ x: number, y: number }} startPx - Player start in pixel space.
 * @returns {{ x: number, y: number }} Goal position.
 */
function pickGoalFarthest(grid, startPx) {
    const dist = bfsDistances(grid, startPx);
    const cells = [];

    dist.forEach((d, k) => {
        const [x, y] = k.split(',').map(Number);
        if (x % 2 === 1 && y % 2 === 1) cells.push({ x, y, d });
    });

    if (cells.length === 0) {
        return { x: grid[0].length - 2, y: grid.length - 2 };
    }

    cells.sort((a, b) => b.d - a.d);
    const topN = Math.max(1, Math.floor(cells.length * 0.25));
    const pick = cells[randomInt(topN)];
    return { x: pick.x, y: pick.y };
}

/**
 * Builds a maze for the given round.
 *
 * @param {number} round - Current round number.
 * @returns {Object} Maze state for the turn.
 */
function buildMazeForRound(round) {
    const lSize = getGridSizeForRound(round);
    const pixelSize = lSize * 2 + 1;
    const grid = createGrid(pixelSize);

    const startLX = randomInt(lSize);
    const startLY = randomInt(lSize);
    carveMazeDFS(grid, lSize, startLX, startLY);

    const falseRouteCount = Math.floor(lSize * 1.8);
    injectFalseRoutes(grid, pixelSize, falseRouteCount);

    const playerPos = { x: startLX * 2 + 1, y: startLY * 2 + 1 };
    const goalPos = pickGoalFarthest(grid, playerPos);

    return {
        maze: grid,
        gridSize: pixelSize,
        playerPos,
        goalPos,
        visited: new Set([`${playerPos.x},${playerPos.y}`]),
    };
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
 * Ticks every 100ms; calls eliminateCurrentPlayer on expiry.
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
            await eliminateCurrentPlayer(session, 'timeout');
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
 * Starts a maze turn for the current player.
 * Generates a new maze and announces it to all players.
 *
 * @param {Object} session - The session.
 */
async function startTurn(session) {
    const mazeState = buildMazeForRound(session.currentRound);
    session.maze = mazeState.maze;
    session.gridSize = mazeState.gridSize;
    session.playerPos = mazeState.playerPos;
    session.goalPos = mazeState.goalPos;
    session.visited = mazeState.visited;

    const currentPlayer = getCurrentPlayer(session);
    if (!currentPlayer) {
        console.log('Error | No current player found, aborting turn');
        return;
    }

    const active = getActivePlayers(session);

    console.log('Info | Round', session.currentRound, '-', currentPlayer.name + "'s turn");

    broadcast(session, {
        type: 'turn_start',
        currentPlayerId: currentPlayer.id,
        round: session.currentRound,
        timerSeconds: getTimerForRound(session.currentRound),
        players: getPlayerList(session),
        playersRemaining: active.length,
        maze: session.maze,
        gridSize: session.gridSize,
        playerPos: session.playerPos,
        goalPos: session.goalPos,
        visited: [...session.visited],
    });

    startSessionTimer(session);
}

/**
 * Handles turn completion by the active player.
 * Advances to the next player after a short pause.
 *
 * @param {Object} session - The session.
 * @param {Object} player - The player who completed the maze.
 */
async function handleTurnComplete(session, player) {
    clearSessionTimer(session);
    session.turnsCompletedThisRound++;

    const active = getActivePlayers(session);
    const roundComplete = session.turnsCompletedThisRound >= active.length;

    broadcast(session, {
        type: 'turn_complete',
        completedBy: player.name,
        players: getPlayerList(session),
        round: session.currentRound,
        roundComplete,
    });

    if (roundComplete) {
        session.turnsCompletedThisRound = 0;
        session.currentRound++;
    }

    setTimeout(() => {
        if (session.phase === 'playing') {
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
 * @param {string} reason - Elimination reason.
 */
async function eliminateCurrentPlayer(session, reason) {
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
        reason,
    });

    if (active.length <= 1) {
        const winner = active[0] || null;
        session.phase = 'finished';

        broadcast(session, {
            type: 'game_over',
            winnerId: winner ? winner.id : null,
            winnerName: winner ? winner.name : null,
            reason: reason === 'disconnected' ? `${player.name} disconnected.` : undefined,
        });

        console.log('Success | Game over - winner:', winner ? winner.name : 'none');

        setTimeout(() => sessions.delete(session.code), 30000);
        return;
    }

    session.currentRound++;
    session.turnsCompletedThisRound = 0;

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
    session.turnsCompletedThisRound = 0;

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
 * Handles move_player from the active player.
 * Validates the move server-side and broadcasts the updated position.
 *
 * @param {WebSocket} ws - The moving player's socket.
 * @param {Object} msg - Parsed message with dx and dy.
 * @param {Object} session - The session.
 */
async function handleMovePlayer(ws, msg, session) {
    if (session.phase !== 'playing') return;

    const currentPlayer = getCurrentPlayer(session);
    if (!currentPlayer || currentPlayer.id !== ws.playerId) return;

    const dx = Number(msg.dx);
    const dy = Number(msg.dy);

    if (!Number.isInteger(dx) || !Number.isInteger(dy)) return;
    if (Math.abs(dx) + Math.abs(dy) !== 1) return;

    const nx = session.playerPos.x + dx;
    const ny = session.playerPos.y + dy;
    if (!session.maze[ny] || session.maze[ny][nx] !== 0) return;

    session.playerPos = { x: nx, y: ny };
    session.visited.add(`${nx},${ny}`);

    broadcast(session, {
        type: 'player_moved',
        playerId: ws.playerId,
        playerPos: session.playerPos,
        visited: [...session.visited],
        players: getPlayerList(session),
    });

    if (nx === session.goalPos.x && ny === session.goalPos.y) {
        console.log('Success | Maze solved by', currentPlayer.name);
        await handleTurnComplete(session, currentPlayer);
    }
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

    const all = [...session.players.values()];
    const leavingIndex = all.findIndex(player => player.id === ws.playerId);
    const player = session.players.get(ws.playerId);
    const playerName = player ? player.name : ws.playerId;
    const wasCurrentPlayer = session.phase === 'playing' && leavingIndex === session.currentPlayerIndex;

    session.players.delete(ws.playerId);

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
            playersRemaining: active.length,
            reason: 'disconnected',
        });

        session.currentRound++;
        session.turnsCompletedThisRound = 0;

        broadcast(session, {
            type: 'next_round',
            round: session.currentRound,
            timerSeconds: getTimerForRound(session.currentRound),
            playersRemaining: active.length,
        });

        setTimeout(() => {
            if (session.phase === 'playing') {
                startTurn(session);
            }
        }, 2000);

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
                if (session) await handleStartGame(ws, session);
                break;

            case 'move_player':
                if (session) await handleMovePlayer(ws, msg, session);
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

server.listen(PORT, () => {
    console.log('Info | Maze Run WebSocket server running on ws://localhost:' + PORT);
});
