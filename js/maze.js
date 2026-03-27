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
    if (!gameActive || players[currentPlayerIndex].isAI) return;

    const map = {
        arrowup: [0, -1], w: [0, -1],
        arrowdown: [0, 1], s: [0, 1],
        arrowleft: [-1, 0], a: [-1, 0],
        arrowright: [1, 0], d: [1, 0],
    };
    const move = map[event.key.toLowerCase()];
    if (!move) return;

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
    players.forEach((player, index) => {
        const li = document.createElement('li');
        li.className = 'player-item';
        if (index === currentPlayerIndex && !player.eliminated) li.classList.add('active');
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
        if (!document.querySelector('.ai-count-btn.selected'))  selectAICount(2);
        if (!document.querySelector('.difficulty-btn.selected')) selectDifficulty('medium');
        if (startStatusMessage) startStatusMessage.textContent = '';
    } else {
        aiSelector.classList.remove('visible');
        difficultySelector.classList.remove('visible');
        if (startStatusMessage) startStatusMessage.textContent = 'Multiplayer coming soon.';
    }

    updateStartButton();
}

if (singleplayerOption) singleplayerOption.addEventListener('click', () => selectGameMode('singleplayer'));
if (multiplayerOption)  multiplayerOption.addEventListener('click',  () => selectGameMode('multiplayer'));

if (startGameBtn) {
    startGameBtn.addEventListener('click', () => {
        if (selectedMode !== 'singleplayer') {
            if (startStatusMessage) startStatusMessage.textContent = 'Multiplayer coming soon.';
            return;
        }
        if (startGameBtn.classList.contains('enabled')) startGame();
    });
}

if (leaveGameBtn) leaveGameBtn.addEventListener('click', leaveGame);
if (mazeGrid)     mazeGrid.addEventListener('click', handleCellClick);
window.addEventListener('keydown', handleKeyDown);

aiCountBtns.forEach(btn => btn.addEventListener('click', () => selectAICount(parseInt(btn.dataset.count))));
difficultyBtns.forEach(btn => btn.addEventListener('click', () => selectDifficulty(btn.dataset.difficulty || btn.value)));

showStartScreen();
