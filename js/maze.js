"use strict";

/* DOM elements */
const startGameBtn       = document.querySelector('#start-game-btn');
const leaveGameBtn       = document.querySelector('#leave-game-btn');
const mazeGrid           = document.querySelector('#maze-grid');
const mazeLoading        = document.querySelector('#maze-loading');
const timerElement       = document.querySelector('#game-timer');
const timerWrapper       = document.querySelector('.timer-wrapper');
const startStatusMessage = document.querySelector('#start-status-message');
const gameStatusMessage  = document.querySelector('#game-status-message');
const roundNumber        = document.querySelector('#round-number');
const timeLabel          = document.querySelector('#time-label');
const startScreen        = document.querySelector('#start-screen');
const gameScreen         = document.querySelector('#game-screen');
const singleplayerOption = document.querySelector('#singleplayer-option');
const multiplayerOption  = document.querySelector('#multiplayer-option');
const aiSelector         = document.querySelector('#ai-selector');
const aiCountBtns        = document.querySelectorAll('.ai-count-btn');
const difficultySelector = document.querySelector('#difficulty-selector');
const difficultyBtns     = document.querySelectorAll('.difficulty-btn');
const playersList        = document.querySelector('#players-list');
const turnIndicator      = document.querySelector('#turn-indicator');

/* Multiplayer DOM elements */
const multiplayerSetup = document.querySelector('#multiplayer-setup');
const sessionCodeInput = document.querySelector('#session-code-input');
const playerNameInput  = document.querySelector('#player-name-input');
const createSessionBtn = document.querySelector('#create-session-btn');
const joinSessionBtn   = document.querySelector('#join-session-btn');
const lobbyScreen      = document.querySelector('#lobby-screen');
const lobbyPlayersList = document.querySelector('#lobby-players-list');
const lobbyCodeDisplay = document.querySelector('#lobby-code-display');
const lobbyStatusMsg   = document.querySelector('#lobby-status-msg');
const copyCodeBtn      = document.querySelector('#copy-code-btn');
const startMultiBtn    = document.querySelector('#start-multi-btn');
const leaveLobbyBtn    = document.querySelector('#leave-lobby-btn');
const multiStatusMsg   = document.querySelector('#multi-status-msg');

/* Game state variables */
let gridSize               = 6;
let maze                   = [];
let playerPos              = { x: 1, y: 1 };
let goalPos                = { x: 1, y: 1 };
let visited                = new Set();
let currentRound           = 1;
let timeRemaining          = 12;
let timerInterval          = null;
let gameActive             = false;
let roundTimeout           = null;
let selectedMode           = null;
let aiMoveInterval         = null;
let selectedAICount        = null;
let selectedDifficulty     = null;
let currentPlayerIndex     = 0;
let players                = [];
let roundsPerStage         = 3;
let turnsCompletedThisRound = 0;

/* Multiplayer state variables */
let ws                   = null;
let myPlayerId           = null;
let mySessionCode        = null;
let isHost               = false;
let multiCurrentPlayerId = null;

/* WebSocket server URL - auto-select based on environment */
const WS_URL = (() => {
    const hostname = window.location.hostname;
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
        return 'ws://localhost:8081';
    } else {
        return 'wss://api.tristanbudd.com/minigames/mazerun';
    }
})();

console.group('Info | Maze Run Initialized');
console.log('Info | DOM elements loaded');
console.log('Info | Game variables initialized');
console.groupEnd();

/**
 * Shows start screen and resets UI state.
 */
function showStartScreen() {
    startScreen.style.display = 'flex';
    gameScreen.style.display  = 'none';
    if (lobbyScreen) lobbyScreen.style.display = 'none';
    if (multiplayerSetup) multiplayerSetup.style.display = 'none';
    selectedMode = null;
    if (singleplayerOption) singleplayerOption.classList.remove('selected');
    if (multiplayerOption)  multiplayerOption.classList.remove('selected');
    if (aiSelector)         aiSelector.classList.remove('visible');
    if (difficultySelector) difficultySelector.classList.remove('visible');
    aiCountBtns.forEach(btn  => btn.classList.remove('selected'));
    difficultyBtns.forEach(btn => btn.classList.remove('selected'));
    selectedAICount    = null;
    selectedDifficulty = null;
    if (startStatusMessage) startStatusMessage.textContent = '';
    if (gameStatusMessage)  gameStatusMessage.textContent  = '';
    updateStartButton();
}

/**
 * Shows the game screen.
 */
function showGameScreen() {
    startScreen.style.display = 'none';
    if (lobbyScreen) lobbyScreen.style.display = 'none';
    gameScreen.style.display  = 'block';
}

/**
 * Updates round and timer labels.
 */
function updateHUD() {
    if (roundNumber) roundNumber.textContent = currentRound;
    if (timeLabel)   timeLabel.textContent   = timeRemaining.toFixed(1);
}

/**
 * Returns the number of logical cells per side for the given round.
 * Grows by one cell every `roundsPerStage` rounds, capped at 7.
 *
 * @param {number} round - The current round number.
 * @returns {number} The number of logical cells per side.
 */
function getGridSizeForRound(round) {
    const stage = Math.floor((round - 1) / roundsPerStage);
    return Math.min(7, 4 + stage);
}

/**
 * Calculates timer duration for round with minimum 6 seconds.
 *
 * @param {number} round - The current round number.
 * @returns {number} The calculated timer duration in seconds.
 */
function getTimerForRound(round) {
    const timer = Math.max(6, 12 - Math.floor((round - 1) / 2));
    console.log('Debug | Timer for round', round, ':', timer, 's');
    return timer;
}

/**
 * Fisher-Yates in-place shuffle.
 *
 * @param {Array} arr - The array to shuffle.
 */
function shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = randomInt(i + 1);
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
}

/**
 * Returns a random integer in [0, max).
 *
 * @param {number} max - The exclusive upper bound.
 * @returns {number} A random integer.
 */
function randomInt(max) {
    return Math.floor(Math.random() * max);
}

/**
 * Creates a fully walled pixel grid.
 *
 * @param {number} size - Pixel grid side length.
 * @returns {number[][]} A fully walled pixel grid.
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
    const stack   = [{ x: startX, y: startY }];
    visited[startY][startX] = true;
    grid[startY * 2 + 1][startX * 2 + 1] = 0;

    const dirs = [
        { dx: 0, dy: -1 }, { dx: 1, dy: 0 },
        { dx: 0, dy:  1 }, { dx: -1, dy: 0 },
    ];

    while (stack.length > 0) {
        const cell  = stack[stack.length - 1];
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
 * Injects `count` extra openings by removing walls that currently separate
 * two already-open pixels. Creates convincing false routes and short loops
 * without destroying the overall maze structure.
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
 * @param {{ x: number, y: number }} startPx - Pixel-space start.
 * @returns {Map<string, number>} A map of pixel keys to BFS distances.
 */
function bfsDistances(startPx) {
    const dist = new Map();
    const key  = (x, y) => `${x},${y}`;
    const dirs = [
        { dx: 1, dy: 0 }, { dx: -1, dy: 0 },
        { dx: 0, dy: 1 }, { dx: 0,  dy: -1 },
    ];

    dist.set(key(startPx.x, startPx.y), 0);
    const queue = [startPx];

    while (queue.length > 0) {
        const cur = queue.shift();
        const d   = dist.get(key(cur.x, cur.y));

        for (const dir of dirs) {
            const nx = cur.x + dir.dx;
            const ny = cur.y + dir.dy;
            if (!maze[ny] || maze[ny][nx] !== 0) continue;
            const nk = key(nx, ny);
            if (dist.has(nk)) continue;
            dist.set(nk, d + 1);
            queue.push({ x: nx, y: ny });
        }
    }

    return dist;
}

/**
 * Picks a goal pixel that lies at the end of a long corridor.
 * Selects randomly from the top 25 % of reachable cells by BFS distance,
 * restricted to cells that map to logical cell centres so the goal always
 * sits on a proper cell, not a passage pixel.
 *
 * @param {{ x: number, y: number }} startPx - Player start in pixel space.
 * @returns {{ x: number, y: number }} The goal position.
 */
function pickGoalFarthest(startPx) {
    const dist = bfsDistances(startPx);

    const cells = [];
    dist.forEach((d, k) => {
        const [x, y] = k.split(',').map(Number);
        if (x % 2 === 1 && y % 2 === 1) cells.push({ x, y, d });
    });

    if (cells.length === 0) {
        return { x: maze[0].length - 2, y: maze.length - 2 };
    }

    cells.sort((a, b) => b.d - a.d);

    const topN = Math.max(1, Math.floor(cells.length * 0.25));
    const pick = cells[randomInt(topN)];
    return { x: pick.x, y: pick.y };
}

/**
 * Builds the maze for the current round.
 * Carves a perfect maze, injects false routes, and places the goal.
 */
function buildMaze() {
    const lSize     = getGridSizeForRound(currentRound);
    const pixelSize = lSize * 2 + 1;
    gridSize        = pixelSize;

    const grid = createGrid(pixelSize);

    const startLX = randomInt(lSize);
    const startLY = randomInt(lSize);
    carveMazeDFS(grid, lSize, startLX, startLY);

    const falseRouteCount = Math.floor(lSize * 1.8);
    injectFalseRoutes(grid, pixelSize, falseRouteCount);

    maze      = grid;
    playerPos = { x: startLX * 2 + 1, y: startLY * 2 + 1 };
    goalPos   = pickGoalFarthest(playerPos);
    visited   = new Set([`${playerPos.x},${playerPos.y}`]);

    console.log(
        'Debug | Maze built | lSize:', lSize, '| pixelSize:', pixelSize,
        '| start:', playerPos, '| goal:', goalPos
    );
}

/**
 * Renders the maze to the grid.
 */
function renderMaze() {
    if (!mazeGrid) return;
    if (!maze || !maze.length) {
        mazeGrid.innerHTML = '';
        return;
    }

    mazeGrid.innerHTML = '';
    mazeGrid.style.gridTemplateColumns = `repeat(${gridSize}, var(--maze-cell-size))`;

    for (let y = 0; y < gridSize; y++) {
        for (let x = 0; x < gridSize; x++) {
            const cell = document.createElement('div');
            cell.className   = 'maze-cell';
            cell.dataset.x   = x;
            cell.dataset.y   = y;

            cell.classList.add(maze[y][x] === 1 ? 'wall' : 'path');
            if (visited.has(`${x},${y}`))               cell.classList.add('visited');
            if (x === playerPos.x && y === playerPos.y) cell.classList.add('player');
            if (x === goalPos.x && y === goalPos.y)     cell.classList.add('goal');

            mazeGrid.appendChild(cell);
        }
    }
}

/**
 * Starts the round timer.
 */
function startTimer() {
    clearInterval(timerInterval);
    timeRemaining = getTimerForRound(currentRound);
    updateTimer();

    timerInterval = setInterval(() => {
        timeRemaining -= 0.1;
        if (timeRemaining <= 0) {
            clearInterval(timerInterval);
            handleTimeout();
        }
        updateTimer();
    }, 100);
}

/**
 * Updates timer UI and warning styles.
 */
function updateTimer() {
    if (!timerElement) return;
    if (timeRemaining < 0) timeRemaining = 0;

    timerElement.textContent = timeRemaining.toFixed(1);
    if (timeLabel) timeLabel.textContent = timeRemaining.toFixed(1);

    const warn = timeRemaining <= 3;
    const crit = timeRemaining <= 1.5;
    timerElement.classList.toggle('warning',  warn);
    timerElement.classList.toggle('critical', crit);
    if (timerWrapper) {
        timerWrapper.classList.toggle('warning',  warn);
        timerWrapper.classList.toggle('critical', crit);
    }
}

/**
 * Attempts to move the player to a new position.
 *
 * @param {number} dx - Delta x.
 * @param {number} dy - Delta y.
 * @param {boolean} fromAI - True when called by AI movement.
 */
function movePlayer(dx, dy, fromAI = false) {
    if (!gameActive) return;
    if (!fromAI && players[currentPlayerIndex].isAI) return;

    const nx = playerPos.x + dx;
    const ny = playerPos.y + dy;
    if (!maze[ny] || maze[ny][nx] !== 0) return;

    playerPos = { x: nx, y: ny };
    visited.add(`${nx},${ny}`);
    renderMaze();

    if (nx === goalPos.x && ny === goalPos.y) handleWin();
}

/**
 * Handles clicking on a maze cell.
 *
 * @param {MouseEvent} event - Click event.
 */
function handleCellClick(event) {
    if (selectedMode === 'multiplayer') return;
    const target = event.target;
    if (!target.classList.contains('maze-cell') || target.classList.contains('wall')) return;

    const dx = parseInt(target.dataset.x, 10) - playerPos.x;
    const dy = parseInt(target.dataset.y, 10) - playerPos.y;
    if (Math.abs(dx) + Math.abs(dy) !== 1) return;

    movePlayer(dx, dy);
}

/**
 * Handles keyboard movement.
 *
 * @param {KeyboardEvent} event - Keydown event.
 */
function handleKeyDown(event) {
    const map = {
        arrowup: [0, -1], w: [0, -1],
        arrowdown: [0, 1], s: [0, 1],
        arrowleft: [-1, 0], a: [-1, 0],
        arrowright: [1, 0], d: [1, 0],
    };
    const move = map[event.key.toLowerCase()];
    if (!move) return;

    if (selectedMode === 'multiplayer') {
        handleMultiKeyDown(move[0], move[1]);
        event.preventDefault();
        return;
    }

    if (!gameActive || players[currentPlayerIndex].isAI) return;
    movePlayer(move[0], move[1]);
    event.preventDefault();
}

/**
 * Handles round completion.
 */
function handleWin() {
    gameActive = false;
    clearInterval(timerInterval);
    clearInterval(aiMoveInterval);
    if (gameStatusMessage) gameStatusMessage.textContent = `${players[currentPlayerIndex].name} solved it!`;

    clearTimeout(roundTimeout);
    roundTimeout = setTimeout(() => {
        turnsCompletedThisRound++;
        if (turnsCompletedThisRound >= remainingPlayers().length) {
            currentRound++;
            turnsCompletedThisRound = 0;
        }
        advanceToNextPlayer();
    }, 1200);
}

/**
 * Handles timer timeout.
 */
function handleTimeout() {
    gameActive = false;
    const currentPlayer = players[currentPlayerIndex];
    clearInterval(aiMoveInterval);
    currentPlayer.eliminated = true;
    renderPlayers();
    if (gameStatusMessage) gameStatusMessage.textContent = `${currentPlayer.name} ran out of time.`;

    clearTimeout(roundTimeout);
    roundTimeout = setTimeout(() => {
        if (!currentPlayer.isAI || remainingPlayers().length <= 1) {
            endGame();
            return;
        }

        turnsCompletedThisRound++;
        if (turnsCompletedThisRound >= remainingPlayers().length) {
            currentRound++;
            turnsCompletedThisRound = 0;
        }
        advanceToNextPlayer();
    }, 2500);
}

/**
 * Builds the maze and starts a new round for the current player.
 */
function startRound() {
    gameActive = true;
    if (gameStatusMessage) gameStatusMessage.textContent = '';
    if (mazeLoading) mazeLoading.classList.add('visible');

    requestAnimationFrame(() => {
        try {
            buildMaze();
            renderMaze();
        } catch (err) {
            console.log('Error | Maze generation failed', err);
            const fb = getGridSizeForRound(currentRound) * 2 + 1;
            maze      = Array.from({ length: fb }, () => Array(fb).fill(0));
            gridSize  = fb;
            playerPos = { x: 1, y: 1 };
            goalPos   = { x: fb - 2, y: fb - 2 };
            visited   = new Set(['1,1']);
            renderMaze();
        } finally {
            if (mazeLoading) mazeLoading.classList.remove('visible');
        }

        updateHUD();
        startTimer();

        const cur = players[currentPlayerIndex];
        if (turnIndicator) turnIndicator.textContent = `${cur.name} is playing`;
        if (cur.isAI) runAITurn(cur);
    });
}

/**
 * Initialises and starts a fresh game.
 */
function startGame() {
    console.group('Info | Starting Maze Run');
    currentRound            = 1;
    turnsCompletedThisRound = 0;
    players                 = buildPlayers(selectedAICount);
    currentPlayerIndex      = 0;
    showGameScreen();
    renderPlayers();
    startRound();
    console.groupEnd();
}

/**
 * Exits the current game and returns to the start screen.
 */
function leaveGame() {
    if (selectedMode === 'multiplayer') {
        handleLeaveMultiplayerGame();
        return;
    }
    gameActive = false;
    clearInterval(timerInterval);
    clearInterval(aiMoveInterval);
    clearTimeout(roundTimeout);
    showStartScreen();
}

/**
 * Manhattan distance between two pixel positions.
 *
 * @param {number} x1 - The first x position.
 * @param {number} y1 - The first y position.
 * @param {number} x2 - The second x position.
 * @param {number} y2 - The second y position.
 * @returns {number} The Manhattan distance.
 */
function heuristic(x1, y1, x2, y2) {
    return Math.abs(x1 - x2) + Math.abs(y1 - y2);
}

/**
 * Returns the pixel immediately after `start` on the A*-shortest path to
 * `goal`, or null if no path exists.
 *
 * @param {{ x: number, y: number }} start - The start position.
 * @param {{ x: number, y: number }} goal - The goal position.
 * @returns {{ x: number, y: number } | null} The next step or null.
 */
function aStarNextStep(start, goal) {
    const key      = (x, y) => `${x},${y}`;
    const startKey = key(start.x, start.y);
    const goalKey  = key(goal.x, goal.y);
    const dirs     = [
        { dx: 1, dy: 0 }, { dx: -1, dy: 0 },
        { dx: 0, dy: 1 }, { dx: 0,  dy: -1 },
    ];

    const open     = [{ x: start.x, y: start.y, g: 0, f: heuristic(start.x, start.y, goal.x, goal.y) }];
    const gScore   = new Map([[startKey, 0]]);
    const cameFrom = new Map([[startKey, null]]);

    while (open.length > 0) {
        let bi = 0;
        for (let i = 1; i < open.length; i++) {
            if (open[i].f < open[bi].f) bi = i;
        }
        const cur = open.splice(bi, 1)[0];
        if (key(cur.x, cur.y) === goalKey) break;

        for (const dir of dirs) {
            const nx = cur.x + dir.dx;
            const ny = cur.y + dir.dy;
            if (!maze[ny] || maze[ny][nx] !== 0) continue;

            const nk    = key(nx, ny);
            const tentG = cur.g + 1;
            if (!gScore.has(nk) || tentG < gScore.get(nk)) {
                gScore.set(nk, tentG);
                cameFrom.set(nk, cur);
                open.push({ x: nx, y: ny, g: tentG, f: tentG + heuristic(nx, ny, goal.x, goal.y) });
            }
        }
    }

    if (!cameFrom.has(goalKey)) return null;

    let cur  = goal;
    let prev = cameFrom.get(goalKey);
    while (prev && (prev.x !== start.x || prev.y !== start.y)) {
        cur  = prev;
        prev = cameFrom.get(key(cur.x, cur.y));
    }
    return prev ? cur : goal;
}

/**
 * Returns the open pixel-grid neighbours of a position.
 *
 * @param {number} x - The current x position.
 * @param {number} y - The current y position.
 * @returns {Array<{ x: number, y: number }>} The neighbouring positions.
 */
function getNeighbors(x, y) {
    return [{ dx: 1, dy: 0 }, { dx: -1, dy: 0 }, { dx: 0, dy: 1 }, { dx: 0, dy: -1 }]
        .map(d => ({ x: x + d.dx, y: y + d.dy }))
        .filter(p => maze[p.y] && maze[p.y][p.x] === 0);
}

/**
 * Returns the behaviour profile for the selected difficulty.
 *
 * @returns {{ mistakeChance: number, wanderChance: number, moveDelay: number }} The AI profile.
 */
function getAIDifficultyProfile() {
    if (selectedDifficulty === 'easy') return { mistakeChance: 0.40, wanderChance: 0.25, moveDelay: 480 };
    if (selectedDifficulty === 'hard') return { mistakeChance: 0.06, wanderChance: 0.04, moveDelay: 260 };
    return                                    { mistakeChance: 0.20, wanderChance: 0.12, moveDelay: 360 };
}

/**
 * Starts the AI move loop for `player`.
 * Each tick either follows A* or makes a difficulty-scaled mistake.
 *
 * @param {Object} player - The AI player.
 */
function runAITurn(player) {
    clearInterval(aiMoveInterval);
    const { mistakeChance, wanderChance, moveDelay } = getAIDifficultyProfile();

    aiMoveInterval = setInterval(() => {
        if (!gameActive || players[currentPlayerIndex] !== player) {
            clearInterval(aiMoveInterval);
            return;
        }

        const neighbours = getNeighbors(playerPos.x, playerPos.y);
        if (!neighbours.length) return;

        let next;
        if (Math.random() < mistakeChance) {
            const unvisited = neighbours.filter(n => !visited.has(`${n.x},${n.y}`));
            next = (Math.random() < wanderChance && unvisited.length)
                ? unvisited[randomInt(unvisited.length)]
                : neighbours[randomInt(neighbours.length)];
        } else {
            next = aStarNextStep(playerPos, goalPos) ?? neighbours[randomInt(neighbours.length)];
        }

        movePlayer(next.x - playerPos.x, next.y - playerPos.y, true);
    }, moveDelay);
}

/**
 * Builds the initial player list: one human + `aiCount` AI players.
 *
 * @param {number} aiCount - The number of AI players.
 * @returns {Array} The player list.
 */
function buildPlayers(aiCount) {
    const list = [{ id: 1, name: 'You', eliminated: false, isAI: false }];
    for (let i = 1; i <= aiCount; i++) list.push({ id: i + 1, name: `AI ${i}`, eliminated: false, isAI: true });
    return list;
}

/**
 * Returns all players not yet eliminated.
 *
 * @returns {Array} The remaining players.
 */
function remainingPlayers() {
    return players.filter(p => !p.eliminated);
}

/**
 * Advances to the next non-eliminated player, or ends the game if only one remains.
 */
function advanceToNextPlayer() {
    if (remainingPlayers().length <= 1) {
        endGame();
        return;
    }

    let next = currentPlayerIndex;
    do {
        next = (next + 1) % players.length;
    } while (players[next].eliminated);

    currentPlayerIndex = next;
    renderPlayers();
    startRound();
}

/**
 * Shows the end-of-game result and returns to the start screen after a delay.
 */
function endGame() {
    const winner = remainingPlayers()[0];
    if (gameStatusMessage) {
        gameStatusMessage.textContent = winner
            ? (winner.isAI ? `${winner.name} wins the match!` : 'You won the match!')
            : 'Game over!';
    }
    clearInterval(timerInterval);
    clearInterval(aiMoveInterval);
    clearTimeout(roundTimeout);
    setTimeout(showStartScreen, 3000);
}

/**
 * Re-renders the player list sidebar.
 */
function renderPlayers() {
    if (!playersList) return;
    playersList.innerHTML = '';

    const list = selectedMode === 'multiplayer' ? players : players;

    list.forEach((player, index) => {
        const li = document.createElement('li');
        li.className = 'player-item';

        const isActive = selectedMode === 'multiplayer'
            ? player.id === multiCurrentPlayerId
            : index === currentPlayerIndex && !player.eliminated;

        if (isActive && !player.eliminated) li.classList.add('active');
        if (player.eliminated) li.classList.add('eliminated');
        li.textContent = player.name;
        playersList.appendChild(li);
    });
}

/**
 * Handles selecting the number of AI opponents and updates UI accordingly.
 *
 * @param {number} count - The number of AI opponents to select.
 */
function selectAICount(count) {
    selectedAICount = count;
    aiCountBtns.forEach(btn => btn.classList.toggle('selected', parseInt(btn.dataset.count) === count));
    updateStartButton();
}

/**
 * Handles selecting the difficulty level for AI opponents and updates UI accordingly.
 *
 * @param {string} level - The difficulty level to select ('easy', 'medium', 'hard').
 */
function selectDifficulty(level) {
    selectedDifficulty = level;
    difficultyBtns.forEach(btn => btn.classList.toggle('selected', (btn.dataset.difficulty || btn.value) === level));
    updateStartButton();
}

/**
 * Updates the start button state based on current selections and game mode.
 * Enables the button only if the required selections for singleplayer mode are made.
 */
function updateStartButton() {
    const ready = selectedMode === 'singleplayer' && selectedAICount > 0 && !!selectedDifficulty;
    startGameBtn.classList.toggle('enabled', ready);
    startGameBtn.style.display = selectedMode === 'multiplayer' ? 'none' : '';
}

/**
 * Handles selecting the game mode (singleplayer or multiplayer) and updates UI accordingly.
 *
 * @param {string} mode - The game mode to select ('singleplayer' or 'multiplayer').
 */
function selectGameMode(mode) {
    selectedMode = mode;
    singleplayerOption.classList.toggle('selected', mode === 'singleplayer');
    multiplayerOption.classList.toggle('selected',  mode === 'multiplayer');

    if (mode === 'singleplayer') {
        aiSelector.classList.add('visible');
        difficultySelector.classList.add('visible');
        if (multiplayerSetup) multiplayerSetup.style.display = 'none';
        if (!document.querySelector('.ai-count-btn.selected'))  selectAICount(2);
        if (!document.querySelector('.difficulty-btn.selected')) selectDifficulty('medium');
        if (startStatusMessage) startStatusMessage.textContent = '';
    } else {
        aiSelector.classList.remove('visible');
        difficultySelector.classList.remove('visible');
        if (multiplayerSetup) multiplayerSetup.style.display = 'flex';
        if (startStatusMessage) startStatusMessage.textContent = '';
    }

    updateStartButton();
}

/**
 * Opens a WebSocket connection to the game server.
 * Resolves once the connected handshake is received.
 *
 * @returns {Promise<void>} Resolves on successful connection.
 */
function connectWebSocket() {
    return new Promise((resolve, reject) => {
        console.log('Info | Connecting to WebSocket server:', WS_URL);

        ws = new WebSocket(WS_URL);

        ws.addEventListener('open', () => {
            console.log('Info | WebSocket connection open');
        });

        ws.addEventListener('message', (event) => {
            let msg;
            try {
                msg = JSON.parse(event.data);
            } catch {
                console.log('Error | Failed to parse server message');
                return;
            }

            if (msg.type === 'connected') {
                myPlayerId = msg.playerId;
                console.log('Success | Assigned player ID:', myPlayerId);
                resolve();
            }

            handleServerMessage(msg);
        });

        ws.addEventListener('error', (err) => {
            console.log('Error | WebSocket error:', err);
            reject(err);
        });

        ws.addEventListener('close', () => {
            console.log('Info | WebSocket connection closed');
            handleDisconnect();
        });
    });
}

/**
 * Safely sends a JSON message to the server if the socket is open.
 *
 * @param {Object} payload - Data to serialise and send.
 */
function wsSend(payload) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(payload));
    } else {
        console.log('Warning | Cannot send - WebSocket not open');
    }
}

/**
 * Handles unexpected WebSocket disconnection mid-game or in lobby.
 */
function handleDisconnect() {
    if (gameScreen.style.display !== 'none') {
        if (gameStatusMessage) gameStatusMessage.textContent = 'Disconnected from server. Returning to menu...';
        setTimeout(() => {
            resetMultiplayerState();
            showStartScreen();
        }, 3000);
    } else if (lobbyScreen && lobbyScreen.style.display !== 'none') {
        setMultiStatus('Disconnected from server.');
        setTimeout(() => {
            resetMultiplayerState();
            showStartScreen();
        }, 2000);
    }
}

/**
 * Clears all multiplayer state variables and closes the socket if open.
 */
function resetMultiplayerState() {
    console.log('Info | Resetting multiplayer state');

    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close();
    }

    ws                   = null;
    myPlayerId           = null;
    mySessionCode        = null;
    isHost               = false;
    multiCurrentPlayerId = null;
    players              = [];
}

/**
 * Central dispatch for all messages received from the server.
 *
 * @param {Object} msg - Parsed message object with a type field.
 */
function handleServerMessage(msg) {
    switch (msg.type) {
        case 'connected':
            break;

        case 'session_created':
            onSessionCreated(msg);
            break;

        case 'session_joined':
            onSessionJoined(msg);
            break;

        case 'lobby_state':
            onLobbyState(msg);
            break;

        case 'game_started':
            onGameStarted(msg);
            break;

        case 'turn_start':
            onTurnStart(msg);
            break;

        case 'player_moved':
            onPlayerMoved(msg);
            break;

        case 'turn_complete':
            onTurnComplete(msg);
            break;

        case 'player_eliminated':
            onPlayerEliminated(msg);
            break;

        case 'next_round':
            onNextRound(msg);
            break;

        case 'game_over':
            onGameOver(msg);
            break;

        case 'player_left':
            onPlayerLeft(msg);
            break;

        case 'timer_tick':
            onTimerTick(msg);
            break;

        case 'player_moved':
            onPlayerMoved(msg);
            break;

        case 'error':
            console.log('Error | Server error:', msg.message);
            setMultiStatus(`Error: ${msg.message}`);
            break;

        default:
            console.log('Warning | Unknown message type from server:', msg.type);
    }
}

/**
 * Called every 100ms by the server to keep the multiplayer timer in sync.
 *
 * @param {Object} msg - Server message with the current timeRemaining.
 */
function onTimerTick(msg) {
    timeRemaining = msg.timeRemaining;
    updateTimer();
}

/**
 * Called after the server confirms session creation.
 * Transitions into the lobby screen as host.
 *
 * @param {Object} msg - Server message with code and player list.
 */
function onSessionCreated(msg) {
    console.log('Info | Session created:', msg.code);
    mySessionCode = msg.code;
    isHost        = true;
    players       = msg.players;

    showLobbyScreen(msg.code, msg.players);
    if (startMultiBtn) {
        startMultiBtn.style.display = 'block';
        startMultiBtn.disabled = players.length < 2;
    }
    setMultiStatus('Waiting for players to join...');
}

/**
 * Called after the server confirms the player has joined a session.
 * Transitions into the lobby screen as a non-host player.
 *
 * @param {Object} msg - Server message with code, player list, and hostId.
 */
function onSessionJoined(msg) {
    console.log('Info | Joined session:', msg.code);
    mySessionCode = msg.code;
    isHost        = msg.hostId === myPlayerId;
    players       = msg.players;

    showLobbyScreen(msg.code, msg.players);
    if (startMultiBtn) {
        startMultiBtn.style.display = isHost ? 'block' : 'none';
        startMultiBtn.disabled = !isHost || players.length < 2;
    }
    setMultiStatus(isHost ? 'Waiting for players...' : 'Waiting for host to start...');
}

/**
 * Called when the server broadcasts a lobby state update.
 * Refreshes the player list for all lobby participants.
 *
 * @param {Object} msg - Server message with updated player list.
 */
function onLobbyState(msg) {
    console.log('Debug | Lobby state update:', msg.players.map(p => p.name));
    players = msg.players;
    renderLobbyPlayers(msg.players);

    isHost = msg.hostId === myPlayerId;
    if (startMultiBtn) {
        startMultiBtn.style.display = isHost ? 'block' : 'none';
        startMultiBtn.disabled = !isHost || msg.players.length < 2;
    }

    if (isHost) {
        setMultiStatus(msg.players.length < 2
            ? 'Need at least 2 players to start.'
            : 'Ready to start!');
    } else {
        setMultiStatus('Waiting for host to start...');
    }
}

/**
 * Shows the lobby screen with the session code and player list.
 *
 * @param {string} code - The 6-digit session code.
 * @param {Array} playerList - Array of player objects.
 */
function showLobbyScreen(code, playerList) {
    startScreen.style.display = 'none';
    gameScreen.style.display  = 'none';
    if (lobbyScreen) lobbyScreen.style.display = 'flex';

    if (lobbyCodeDisplay) {
        lobbyCodeDisplay.textContent = code;
    }

    renderLobbyPlayers(playerList);
}

/**
 * Renders the lobby player list.
 *
 * @param {Array} playerList - Array of player objects.
 */
function renderLobbyPlayers(playerList) {
    if (!lobbyPlayersList) return;
    lobbyPlayersList.innerHTML = '';

    playerList.forEach(p => {
        const li = document.createElement('li');
        li.className = 'lobby-player-item';

        const nameSpan = document.createElement('span');
        nameSpan.textContent = p.name;
        if (p.id === myPlayerId) nameSpan.classList.add('lobby-self');
        li.appendChild(nameSpan);

        if (p.isHost) {
            const badge = document.createElement('span');
            badge.className   = 'lobby-host-badge';
            badge.textContent = 'Host';
            li.appendChild(badge);
        }

        lobbyPlayersList.appendChild(li);
    });
}

/**
 * Sets the multiplayer status message text.
 *
 * @param {string} text - Status text to display.
 */
function setMultiStatus(text) {
    if (multiStatusMsg) {
        multiStatusMsg.textContent   = text;
        multiStatusMsg.style.display = text ? 'block' : 'none';
    }
    if (lobbyStatusMsg) {
        lobbyStatusMsg.textContent   = text;
        lobbyStatusMsg.style.display = text ? 'block' : 'none';
    }
}

/**
 * Called when the server signals the game has started.
 * Transitions all clients from lobby to game screen.
 *
 * @param {Object} msg - Server message with player list and round info.
 */
function onGameStarted(msg) {
    console.log('Info | Multiplayer game started');
    players = msg.players;

    showGameScreen();
    renderPlayers();

    if (roundNumber) roundNumber.textContent = msg.round;
    if (gameStatusMessage) gameStatusMessage.textContent = 'Game starting...';
}

/**
 * Called when it is a new player's turn to navigate the maze.
 * Loads the server-provided maze and enables input only for the active player.
 *
 * @param {Object} msg - Server message with maze data, positions, and currentPlayerId.
 */
function onTurnStart(msg) {
    console.log('Info | Turn start - current player:', msg.currentPlayerId);

    multiCurrentPlayerId = msg.currentPlayerId;
    players              = msg.players;
    currentRound         = msg.round;
    maze                 = msg.maze;
    gridSize             = msg.gridSize;
    playerPos            = msg.playerPos;
    goalPos              = msg.goalPos;
    visited              = new Set(msg.visited);

    if (roundNumber) roundNumber.textContent = msg.round;
    if (timeLabel)   timeLabel.textContent   = msg.timerSeconds.toFixed(1);
    timeRemaining = msg.timerSeconds;
    updateTimer();

    renderPlayers();
    renderMaze();

    const isMyTurn = msg.currentPlayerId === myPlayerId;
    const currentPlayerData = players.find(p => p.id === msg.currentPlayerId);
    const name = currentPlayerData ? currentPlayerData.name : 'Unknown';

    if (turnIndicator) {
        turnIndicator.textContent = isMyTurn ? 'Your turn!' : `${name} is playing`;
    }
    if (gameStatusMessage) gameStatusMessage.textContent = '';

    gameActive = isMyTurn;
}

/**
 * Called when any player moves in the maze.
 * Updates the shared maze state and re-renders for all clients.
 *
 * @param {Object} msg - Server message with updated playerPos and visited set.
 */
function onPlayerMoved(msg) {
    playerPos = msg.playerPos;
    visited   = new Set(msg.visited);
    players   = msg.players;
    renderMaze();
    renderPlayers();
}

/**
 * Called when the active player completes the maze.
 * Updates status and waits for the server to send the next turn_start.
 *
 * @param {Object} msg - Server message with completedBy name.
 */
function onTurnComplete(msg) {
    console.log('Info | Turn complete by:', msg.completedBy);
    players   = msg.players;
    gameActive = false;
    renderPlayers();

    if (gameStatusMessage) {
        gameStatusMessage.textContent = msg.completedBy
            ? `${msg.completedBy} reached the exit!`
            : '';
    }
}

/**
 * Called when any player is eliminated by the timer.
 * Marks the player eliminated in the local list and re-renders.
 *
 * @param {Object} msg - Server message with eliminatedId and player list.
 */
function onPlayerEliminated(msg) {
    console.log('Info | Player eliminated:', msg.eliminatedName);
    players   = msg.players;
    gameActive = false;
    renderPlayers();

    if (gameStatusMessage) {
        if (msg.eliminatedId === myPlayerId) {
            gameStatusMessage.textContent = 'You ran out of time!';
        } else {
            gameStatusMessage.textContent = msg.reason === 'disconnected'
                ? `${msg.eliminatedName} disconnected and was eliminated.`
                : `${msg.eliminatedName} ran out of time.`;
        }
    }
}

/**
 * Called at the start of a new server-side round after an elimination.
 *
 * @param {Object} msg - Server message with round and playersRemaining.
 */
function onNextRound(msg) {
    console.log('Info | Next round:', msg.round);
    if (roundNumber) roundNumber.textContent = msg.round;
    if (gameStatusMessage) gameStatusMessage.textContent = `${msg.playersRemaining} players remaining. Round ${msg.round} starting...`;
}

/**
 * Called when the game ends with a winner.
 * Shows result and returns to start screen after a delay.
 *
 * @param {Object} msg - Server message with winnerId and winnerName.
 */
function onGameOver(msg) {
    console.log('Info | Game over - winner:', msg.winnerName);
    gameActive = false;

    let text;
    if (!msg.winnerId) {
        text = 'Game over!';
    } else if (msg.winnerId === myPlayerId) {
        text = 'You won the match!';
    } else {
        text = `${msg.winnerName} wins the match!`;
    }

    if (msg.reason) text += ` (${msg.reason})`;
    if (gameStatusMessage) gameStatusMessage.textContent = text;

    setTimeout(() => {
        resetMultiplayerState();
        showStartScreen();
    }, 5000);
}

/**
 * Called when a player leaves voluntarily during a game.
 * Updates the player list and migrates host role if needed.
 *
 * @param {Object} msg - Server message with playerId, playerName, newHostId.
 */
function onPlayerLeft(msg) {
    console.log('Info | Player left:', msg.playerName);
    players = msg.players;
    renderPlayers();

    if (msg.newHostId === myPlayerId && !isHost) {
        isHost = true;
        console.log('Info | Host role migrated to this client');
    }

    if (gameStatusMessage) gameStatusMessage.textContent = `${msg.playerName} left the game.`;
}

/**
 * Handles keyboard movement for multiplayer, sending move_player to the server.
 *
 * @param {number} dx - Delta x.
 * @param {number} dy - Delta y.
 */
function handleMultiKeyDown(dx, dy) {
    if (!gameActive) return;
    if (multiCurrentPlayerId !== myPlayerId) return;
    wsSend({ type: 'move_player', dx, dy });
}

/**
 * Handles Create Session button click.
 * Connects to the server and sends a create_session message.
 */
async function handleCreateSession() {
    const name = (playerNameInput?.value || '').trim() || 'Player 1';
    console.log('Info | Creating session as:', name);

    try {
        setMultiStatus('Connecting...');
        await connectWebSocket();
        wsSend({ type: 'create_session', playerName: name });
    } catch {
        setMultiStatus('Could not connect to multiplayer server.');
        console.log('Error | WebSocket connection failed');
    }
}

/**
 * Handles Join Session button click.
 * Connects to the server and sends a join_session message.
 */
async function handleJoinSession() {
    const name = (playerNameInput?.value || '').trim() || 'Player';
    const code = (sessionCodeInput?.value || '').trim();

    if (!code || code.length !== 6) {
        setMultiStatus('Please enter a valid 6-digit session code.');
        return;
    }

    console.log('Info | Joining session:', code, 'as:', name);

    try {
        setMultiStatus('Connecting...');
        await connectWebSocket();
        wsSend({ type: 'join_session', code, playerName: name });
    } catch {
        setMultiStatus('Could not connect to server. Is maze.js running?');
        console.log('Error | WebSocket connection failed');
    }
}

/**
 * Handles Start Game button click from the lobby host.
 */
function handleStartMultiplayer() {
    if (!isHost) return;
    if (players.length < 2) {
        setMultiStatus('Need at least 2 players to start.');
        console.log('Error | Not enough players to start multiplayer game');
        return;
    }
    console.log('Info | Host starting multiplayer game');
    wsSend({ type: 'start_game' });
}

/**
 * Handles Leave Lobby button click.
 * Sends leave message and resets to start screen.
 */
function handleLeaveLobby() {
    console.log('Info | Leaving lobby');
    wsSend({ type: 'leave_session' });
    resetMultiplayerState();
    showStartScreen();
}

/**
 * Handles Leave Game button click during a multiplayer game.
 * Sends leave message and returns to start screen.
 */
function handleLeaveMultiplayerGame() {
    console.log('Info | Leaving multiplayer game');
    wsSend({ type: 'leave_session' });
    resetMultiplayerState();
    showStartScreen();
}

if (singleplayerOption) singleplayerOption.addEventListener('click', () => selectGameMode('singleplayer'));
if (multiplayerOption)  multiplayerOption.addEventListener('click',  () => selectGameMode('multiplayer'));

if (startGameBtn) {
    startGameBtn.addEventListener('click', () => {
        if (startGameBtn.classList.contains('enabled')) startGame();
    });
}

if (leaveGameBtn) leaveGameBtn.addEventListener('click', leaveGame);
if (mazeGrid)     mazeGrid.addEventListener('click', handleCellClick);
window.addEventListener('keydown', handleKeyDown);

aiCountBtns.forEach(btn => btn.addEventListener('click', () => selectAICount(parseInt(btn.dataset.count))));
difficultyBtns.forEach(btn => btn.addEventListener('click', () => selectDifficulty(btn.dataset.difficulty || btn.value)));

if (createSessionBtn) createSessionBtn.addEventListener('click', handleCreateSession);
if (joinSessionBtn)   joinSessionBtn.addEventListener('click', handleJoinSession);
if (startMultiBtn)    startMultiBtn.addEventListener('click', handleStartMultiplayer);
if (leaveLobbyBtn)    leaveLobbyBtn.addEventListener('click', handleLeaveLobby);

if (copyCodeBtn) {
    copyCodeBtn.addEventListener('click', async () => {
        const code = (lobbyCodeDisplay?.textContent || '').trim();
        if (!code || code === '------') {
            setMultiStatus('No session code to copy yet.');
            return;
        }

        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(code);
            } else {
                const tempInput = document.createElement('input');
                tempInput.value = code;
                document.body.appendChild(tempInput);
                tempInput.select();
                document.execCommand('copy');
                document.body.removeChild(tempInput);
            }
            setMultiStatus('Session code copied to clipboard.');
        } catch {
            setMultiStatus('Unable to copy. Please select and copy manually.');
        }
    });
}

if (sessionCodeInput) {
    sessionCodeInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleJoinSession();
    });
}

showStartScreen();