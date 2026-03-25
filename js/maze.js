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
let gridSize         = 6;
let maze             = [];
let playerPos        = { x: 1, y: 1 };
let goalPos          = { x: 1, y: 1 };
let visited          = new Set();
let currentRound     = 1;
let timeRemaining    = 12;
let timerInterval    = null;
let gameActive       = false;
let roundTimeout     = null;
let selectedMode     = null;
let aiMoveInterval   = null;
let selectedAICount  = null;
let selectedDifficulty = null;
let currentPlayerIndex = 0;
let players = [];
let roundsPerStage = 3;
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
    if (multiplayerOption) multiplayerOption.classList.remove('selected');
    if (aiSelector) aiSelector.classList.remove('visible');
    if (difficultySelector) difficultySelector.classList.remove('visible');
    aiCountBtns.forEach(btn => btn.classList.remove('selected'));
    difficultyBtns.forEach(btn => btn.classList.remove('selected'));
    selectedAICount = null;
    selectedDifficulty = null;
    if (startStatusMessage) startStatusMessage.textContent = '';
    if (gameStatusMessage) gameStatusMessage.textContent = '';
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
    if (timeLabel) timeLabel.textContent = timeRemaining.toFixed(1);
}

/**
 * Calculates maze size for current round.
 *
 * @param {number} round - The current round number.
 * @returns {number} The calculated maze size.
 */
function getGridSizeForRound(round) {
    const stage = Math.floor((round - 1) / roundsPerStage);
    const size = 6 + stage;
    return Math.min(10, size);
}

/**
 * Calculates timer duration for round with minimum 6 seconds.
 *
 * @param {number} round - The current round number.
 * @returns {number} The calculated timer duration in seconds.
 */
function getTimerForRound(round) {
    const reduction = Math.floor((round - 1) / 2);
    const timer = Math.max(6, 12 - reduction);
    console.log('Debug | Timer for round', round, ':', timer, 'seconds');
    return timer;
}

/**
 * Creates an empty maze grid filled with walls.
 *
 * @param {number} size - Maze dimension.
 * @returns {number[][]} The maze grid.
 */
function createGrid(size) {
    return Array.from({ length: size }, () => Array(size).fill(1));
}

function createOpenGrid(size) {
    return Array.from({ length: size }, () => Array(size).fill(0));
}

function addFalseBranches(grid, path, branches) {
    const pathCells = Array.from(path);
    const dirs = [
        { dx: 1, dy: 0 },
        { dx: -1, dy: 0 },
        { dx: 0, dy: 1 },
        { dx: 0, dy: -1 }
    ];

    for (let i = 0; i < branches; i++) {
        const [px, py] = pathCells[randomInt(pathCells.length)].split(',').map(Number);
        shuffleArray(dirs);

        for (let j = 0; j < dirs.length; j++) {
            const nx = px + dirs[j].dx;
            const ny = py + dirs[j].dy;
            if (!grid[ny] || grid[ny][nx] !== 1) continue;
            grid[ny][nx] = 0;
            if (Math.random() < 0.6) {
                const bx = nx + dirs[j].dx;
                const by = ny + dirs[j].dy;
                if (grid[by] && grid[by][bx] === 1) {
                    grid[by][bx] = 0;
                }
            }
            break;
        }
    }
}

function carveExtraOpenings(grid, count) {
    for (let i = 0; i < count; i++) {
        const x = randomInt(grid.length);
        const y = randomInt(grid.length);
        grid[y][x] = 0;
    }
}

/**
 * Builds a valid maze for the current round with fewer walls.
 */
function buildMaze() {
    gridSize = getGridSizeForRound(currentRound);
    const start = { x: 0, y: 0 };
    const goal = { x: gridSize - 1, y: gridSize - 1 };

    const grid = createGrid(gridSize);
    const path = carveGuaranteedPath(grid, start, goal);

    const totalCells = gridSize * gridSize;
    const openRatio = Math.min(0.52, 0.26 + (currentRound - 1) * 0.02);
    const targetOpen = Math.max(path.size, Math.floor(totalCells * openRatio));
    let openCount = path.size;

    while (openCount < targetOpen) {
        const x = randomInt(gridSize);
        const y = randomInt(gridSize);
        if (grid[y][x] === 1) {
            grid[y][x] = 0;
            openCount++;
        }
    }

    addFalseBranches(grid, path, Math.floor(gridSize * 1.5));

    maze = grid;
    playerPos = { x: start.x, y: start.y };
    goalPos = { x: goal.x, y: goal.y };
    maze[playerPos.y][playerPos.x] = 0;
    maze[goalPos.y][goalPos.x] = 0;
    visited = new Set([`${playerPos.x},${playerPos.y}`]);
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
            cell.className = 'maze-cell';
            cell.dataset.x = x;
            cell.dataset.y = y;

            if (maze[y][x] === 1) cell.classList.add('wall');
            else cell.classList.add('path');

            if (visited.has(`${x},${y}`)) cell.classList.add('visited');
            if (x === playerPos.x && y === playerPos.y) cell.classList.add('player');
            if (x === goalPos.x && y === goalPos.y) cell.classList.add('goal');

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

    timerInterval = setInterval(function() {
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

    const isWarning = timeRemaining <= 3;
    const isCritical = timeRemaining <= 1.5;

    timerElement.classList.toggle('warning', isWarning);
    timerElement.classList.toggle('critical', isCritical);

    if (timerWrapper) {
        timerWrapper.classList.toggle('warning', isWarning);
        timerWrapper.classList.toggle('critical', isCritical);
    }
}

/**
 * Attempts to move the player to a new position.
 *
 * @param {number} dx - Delta x.
 * @param {number} dy - Delta y.
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

    if (nx === goalPos.x && ny === goalPos.y) {
        handleWin();
    }
}

/**
 * Handles clicking on a maze cell.
 *
 * @param {MouseEvent} event - Click event.
 */
function handleCellClick(event) {
    const target = event.target;
    if (!target.classList.contains('maze-cell')) return;
    if (target.classList.contains('wall')) return;

    const x = parseInt(target.dataset.x, 10);
    const y = parseInt(target.dataset.y, 10);
    const dx = x - playerPos.x;
    const dy = y - playerPos.y;
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

    switch (event.key.toLowerCase()) {
        case 'arrowup':
        case 'w':
            movePlayer(0, -1);
            break;
        case 'arrowdown':
        case 's':
            movePlayer(0, 1);
            break;
        case 'arrowleft':
        case 'a':
            movePlayer(-1, 0);
            break;
        case 'arrowright':
        case 'd':
            movePlayer(1, 0);
            break;
        default:
            return;
    }

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
        if (!currentPlayer.isAI) {
            endGame();
            return;
        }

        if (remainingPlayers().length <= 1) {
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
 * Starts a new round.
 */
function startRound() {
    gameActive = true;
    if (gameStatusMessage) gameStatusMessage.textContent = '';

    if (mazeLoading) mazeLoading.classList.add('visible');

    requestAnimationFrame(() => {
        try {
            buildMaze();
            renderMaze();
        } catch (error) {
            console.log('Error | Maze generation failed', error);
            maze = createOpenGrid(getGridSizeForRound(currentRound));
            renderMaze();
        } finally {
            if (mazeLoading) mazeLoading.classList.remove('visible');
        }

        updateHUD();
        startTimer();

        const currentPlayer = players[currentPlayerIndex];
        if (turnIndicator) {
            turnIndicator.textContent = `${currentPlayer.name} is playing`;
        }

        if (currentPlayer.isAI) {
            runAITurn(currentPlayer);
        }
    });
}

/**
 * Starts a new game.
 */
function startGame() {
    console.group('Info | Starting Maze Run');
    currentRound = 1;
    turnsCompletedThisRound = 0;
    players = buildPlayers(selectedAICount);
    currentPlayerIndex = 0;
    showGameScreen();
    renderPlayers();
    startRound();
    console.groupEnd();
}

/**
 * Leaves the current game.
 */
function leaveGame() {
    gameActive = false;
    clearInterval(timerInterval);
    clearInterval(aiMoveInterval);
    clearTimeout(roundTimeout);
    showStartScreen();
}

/**
 * Shuffles array in place.
 *
 * @param {Array} arr - Array to shuffle.
 */
function shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
}

/**
 * Returns a random odd number between 1 and max.
 *
 * @param {number} max - Maximum value.
 * @returns {number} Random odd number.
 */
function randomInt(max) {
    return Math.floor(Math.random() * max);
}

function carveGuaranteedPath(grid, start, goal) {
    let x = start.x;
    let y = start.y;
    const path = new Set([`${x},${y}`]);
    grid[y][x] = 0;
    while (x !== goal.x || y !== goal.y) {
        const moves = [];
        if (x < goal.x) moves.push({ dx: 1, dy: 0 });
        if (y < goal.y) moves.push({ dx: 0, dy: 1 });
        if (x > goal.x) moves.push({ dx: -1, dy: 0 });
        if (y > goal.y) moves.push({ dx: 0, dy: -1 });
        const choice = moves[randomInt(moves.length)];
        x += choice.dx;
        y += choice.dy;
        grid[y][x] = 0;
        path.add(`${x},${y}`);
    }
    return path;
}

function placeRandomWalls(grid, count, start, goal) {
    let placed = 0;
    for (let i = 0; i < count; i++) {
        const x = randomInt(grid.length);
        const y = randomInt(grid.length);
        if (x === start.x && y === start.y) continue;
        if (x === goal.x && y === goal.y) continue;
        if (grid[y][x] === 1) continue;
        grid[y][x] = 1;
        placed++;
        if (placed >= count) break;
    }
}

function hasPath(grid, start, goal) {
    const queue = [start];
    const seen = new Set([`${start.x},${start.y}`]);
    const dirs = [
        { dx: 1, dy: 0 },
        { dx: -1, dy: 0 },
        { dx: 0, dy: 1 },
        { dx: 0, dy: -1 }
    ];

    while (queue.length) {
        const current = queue.shift();
        if (current.x === goal.x && current.y === goal.y) return true;

        dirs.forEach(dir => {
            const nx = current.x + dir.dx;
            const ny = current.y + dir.dy;
            if (!grid[ny] || grid[ny][nx] === 1) return;
            const key = `${nx},${ny}`;
            if (seen.has(key)) return;
            seen.add(key);
            queue.push({ x: nx, y: ny });
        });
    }

    return false;
}

function buildPlayers(aiCount) {
    const list = [{ id: 1, name: 'You', eliminated: false, isAI: false }];
    for (let i = 1; i <= aiCount; i++) {
        list.push({ id: i + 1, name: `AI ${i}`, eliminated: false, isAI: true });
    }
    return list;
}

function remainingPlayers() {
    return players.filter(p => !p.eliminated);
}

function advanceToNextPlayer() {
    const alive = remainingPlayers();
    if (alive.length <= 1) {
        endGame();
        return;
    }

    let nextIndex = currentPlayerIndex;
    do {
        nextIndex = (nextIndex + 1) % players.length;
    } while (players[nextIndex].eliminated);

    currentPlayerIndex = nextIndex;
    renderPlayers();
    startRound();
}

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
    setTimeout(() => {
        showStartScreen();
    }, 3000);
}

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

function getNeighbors(x, y) {
    const dirs = [
        { dx: 1, dy: 0 },
        { dx: -1, dy: 0 },
        { dx: 0, dy: 1 },
        { dx: 0, dy: -1 }
    ];
    return dirs
        .map(dir => ({ x: x + dir.dx, y: y + dir.dy }))
        .filter(pos => maze[pos.y] && maze[pos.y][pos.x] === 0);
}

function shortestPathNextStep(start, goal) {
    const queue = [start];
    const cameFrom = new Map();
    cameFrom.set(`${start.x},${start.y}`, null);
    const dirs = [
        { dx: 1, dy: 0 },
        { dx: -1, dy: 0 },
        { dx: 0, dy: 1 },
        { dx: 0, dy: -1 }
    ];

    while (queue.length) {
        const current = queue.shift();
        if (current.x === goal.x && current.y === goal.y) break;

        dirs.forEach(dir => {
            const nx = current.x + dir.dx;
            const ny = current.y + dir.dy;
            if (!maze[ny] || maze[ny][nx] === 1) return;
            const key = `${nx},${ny}`;
            if (cameFrom.has(key)) return;
            cameFrom.set(key, current);
            queue.push({ x: nx, y: ny });
        });
    }

    const goalKey = `${goal.x},${goal.y}`;
    if (!cameFrom.has(goalKey)) return null;

    let current = goal;
    let prev = cameFrom.get(goalKey);
    while (prev && (prev.x !== start.x || prev.y !== start.y)) {
        current = prev;
        prev = cameFrom.get(`${current.x},${current.y}`);
    }

    return current;
}

function getAIDifficultyProfile() {
    if (selectedDifficulty === 'easy') {
        return { mistakeChance: 0.35, moveDelay: 450 };
    }
    if (selectedDifficulty === 'hard') {
        return { mistakeChance: 0.1, moveDelay: 280 };
    }
    return { mistakeChance: 0.2, moveDelay: 350 };
}

function runAITurn(player) {
    clearInterval(aiMoveInterval);
    const profile = getAIDifficultyProfile();

    aiMoveInterval = setInterval(() => {
        if (!gameActive || !player.isAI || players[currentPlayerIndex] !== player) {
            clearInterval(aiMoveInterval);
            return;
        }

        const neighbors = getNeighbors(playerPos.x, playerPos.y);
        if (!neighbors.length) return;

        let nextStep = shortestPathNextStep(playerPos, goalPos);
        if (!nextStep || Math.random() < profile.mistakeChance) {
            nextStep = neighbors[randomInt(neighbors.length)];
        }

        movePlayer(nextStep.x - playerPos.x, nextStep.y - playerPos.y, true);
    }, profile.moveDelay);
}

function selectAICount(count) {
    selectedAICount = count;
    aiCountBtns.forEach(btn => {
        btn.classList.toggle('selected', parseInt(btn.dataset.count) === count);
    });
    updateStartButton();
}

function selectDifficulty(level) {
    selectedDifficulty = level;
    difficultyBtns.forEach(btn => {
        const btnDifficulty = btn.dataset.difficulty || btn.value;
        btn.classList.toggle('selected', btnDifficulty === level);
    });
    updateStartButton();
}

function updateStartButton() {
    const readyForSingleplayer =
        selectedMode === 'singleplayer' &&
        selectedAICount > 0 &&
        !!selectedDifficulty;

    startGameBtn.classList.toggle('enabled', readyForSingleplayer);
}

function selectGameMode(mode) {
    selectedMode = mode;
    singleplayerOption.classList.toggle('selected', mode === 'singleplayer');
    multiplayerOption.classList.toggle('selected', mode === 'multiplayer');

    if (mode === 'singleplayer') {
        aiSelector.classList.add('visible');
        difficultySelector.classList.add('visible');
        if (!document.querySelector('.ai-count-btn.selected')) selectAICount(2);
        if (!document.querySelector('.difficulty-btn.selected')) selectDifficulty('medium');
        if (startStatusMessage) startStatusMessage.textContent = '';
    } else {
        aiSelector.classList.remove('visible');
        difficultySelector.classList.remove('visible');
        if (startStatusMessage) startStatusMessage.textContent = 'Multiplayer coming soon.';
    }

    updateStartButton();
}

if (singleplayerOption) {
    singleplayerOption.addEventListener('click', () => selectGameMode('singleplayer'));
}

if (multiplayerOption) {
    multiplayerOption.addEventListener('click', () => selectGameMode('multiplayer'));
}

if (startGameBtn) {
    startGameBtn.addEventListener('click', () => {
        if (selectedMode !== 'singleplayer') {
            if (startStatusMessage) startStatusMessage.textContent = 'Multiplayer coming soon.';
            return;
        }
        if (!startGameBtn.classList.contains('enabled')) return;
        startGame();
    });
}

if (leaveGameBtn) leaveGameBtn.addEventListener('click', leaveGame);
if (mazeGrid) mazeGrid.addEventListener('click', handleCellClick);
window.addEventListener('keydown', handleKeyDown);

aiCountBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        const count = parseInt(btn.dataset.count);
        selectAICount(count);
    });
});

difficultyBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        const level = btn.dataset.difficulty || btn.value;
        selectDifficulty(level);
    });
});

showStartScreen();
