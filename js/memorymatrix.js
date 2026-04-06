"use strict";

/* DOM elements */
const startGameBtn       = document.querySelector('#start-game-btn');
const leaveGameBtn       = document.querySelector('#leave-game-btn');
const startStatusMessage = document.querySelector('#start-status-message');
const gameStatusMessage  = document.querySelector('#game-status-message');
const startScreen        = document.querySelector('#start-screen');
const gameScreen         = document.querySelector('#game-screen');
const singleplayerOption = document.querySelector('#singleplayer-option');
const aiSelector         = document.querySelector('#ai-selector');
const aiCountBtns        = document.querySelectorAll('.ai-count-btn');
const difficultySelector = document.querySelector('#difficulty-selector');
const difficultyBtns     = document.querySelectorAll('.difficulty-btn');
const playersList        = document.querySelector('#players-list');
const roundNumber        = document.querySelector('#round-number');
const gridSizeLabel      = document.querySelector('#grid-size');
const patternLengthLabel = document.querySelector('#pattern-length');
const timerElement       = document.querySelector('#game-timer');
const timerWrapper       = document.querySelector('.timer-wrapper');
const memoryGrid         = document.querySelector('#memory-grid');
const sequenceSlots      = document.querySelector('#sequence-slots');

/* Game state variables */
let players               = [];
let selectedAICount       = 2;
let selectedDifficulty    = 'medium';
let currentRound          = 1;
let currentTurnIndex      = 0;
let turnOrderIds          = [];
let currentSequence       = [];
let expectedInputIndex    = 0;
let timerInterval         = null;
let timeRemaining         = 12;
let gameActive            = false;
let acceptingInput        = false;
let activeCellTimeout     = null;
let playbackTimeoutIds    = [];
let transitionTimeoutId   = null;
let pendingTurnResolver   = null;

const ROUNDS_PER_GRID_SIZE = 5;
const BASE_GRID_SIZE       = 3;
const MAX_GRID_SIZE        = 6;

console.group('Info | Memory Matrix Game Initialized');
console.log('Info | DOM elements loaded');
console.log('Info | Game variables initialized');
console.groupEnd();

/**
 * Shows start screen and resets game state.
 */
function showStartScreen() {
    console.log('Info | Showing start screen');

    startScreen.style.display = 'flex';
    gameScreen.style.display  = 'none';

    selectedAICount    = 2;
    selectedDifficulty = 'medium';
    gameActive         = false;
    acceptingInput     = false;

    clearAllTimers();

    aiSelector.classList.add('visible');
    difficultySelector.classList.add('visible');

    aiCountBtns.forEach(btn => {
        btn.classList.toggle('selected', Number(btn.dataset.count) === selectedAICount);
    });

    difficultyBtns.forEach(btn => {
        btn.classList.toggle('selected', btn.dataset.difficulty === selectedDifficulty);
    });

    if (startStatusMessage) startStatusMessage.textContent = '';
    if (gameStatusMessage) gameStatusMessage.textContent = '';

    updateStartButton();
}

/**
 * Shows the game screen.
 */
function showGameScreen() {
    console.log('Info | Switching to game screen');
    startScreen.style.display = 'none';
    gameScreen.style.display  = 'block';
}

/**
 * Enables or disables the start game button.
 */
function updateStartButton() {
    const isReady = selectedAICount > 0 && !!selectedDifficulty;
    startGameBtn.classList.toggle('enabled', isReady);
}

/**
 * Clears all running timeouts and intervals.
 */
function clearAllTimers() {
    clearInterval(timerInterval);
    clearTimeout(activeCellTimeout);
    clearTimeout(transitionTimeoutId);

    playbackTimeoutIds.forEach(id => clearTimeout(id));
    playbackTimeoutIds = [];
}

/**
 * Returns all players that are still alive.
 *
 * @returns {Array} The players still in the game.
 */
function getRemainingPlayers() {
    return players.filter(player => !player.eliminated);
}

/**
 * Returns player object by ID.
 *
 * @param {number} playerId - The player ID.
 * @returns {Object|undefined} Matching player object.
 */
function getPlayerById(playerId) {
    return players.find(player => player.id === playerId);
}

/**
 * Creates players array with one human and AI opponents.
 *
 * @param {number} aiCount - Number of AI players.
 */
function createPlayersArray(aiCount) {
    console.group('Info | Creating players array');

    players = [{ id: 1, name: 'You', lives: 3, eliminated: false, isAI: false }];

    for (let i = 1; i <= aiCount; i++) {
        players.push({ id: i + 1, name: `AI ${i}`, lives: 3, eliminated: false, isAI: true });
    }

    console.log('Info | Players created:', players.map(player => player.name));
    console.groupEnd();
}

/**
 * Returns grid size for round, capped at 6x6.
 * Grid size increases every 5 rounds.
 *
 * @param {number} round - Current round number.
 * @returns {number} Grid side length.
 */
function getGridSizeForRound(round) {
    const stage = Math.floor((round - 1) / ROUNDS_PER_GRID_SIZE);
    return Math.min(MAX_GRID_SIZE, BASE_GRID_SIZE + stage);
}

/**
 * Returns pattern length for round.
 * Sequence growth is intentionally slower so bigger grids are not paired
 * with overly long patterns.
 *
 * @param {number} round - Current round number.
 * @returns {number} Pattern length.
 */
function getPatternLengthForRound(round) {
    const stage = Math.floor((round - 1) / ROUNDS_PER_GRID_SIZE);
    const inStageRound = (round - 1) % ROUNDS_PER_GRID_SIZE;

    return 3 + stage + Math.floor(inStageRound / 2);
}

/**
 * Returns timer duration for round, minimum 4 seconds.
 *
 * @param {number} round - Current round number.
 * @returns {number} Timer in seconds.
 */
function getTimerForRound(round) {
    return Math.max(4, 12 - Math.floor((round - 1) / 2));
}

/**
 * Returns playback speed for sequence steps.
 *
 * @param {number} round - Current round number.
 * @returns {number} Step duration in milliseconds.
 */
function getPlaybackStepMs(round) {
    return Math.max(240, 550 - Math.floor((round - 1) / 2) * 35);
}

/**
 * Updates the round HUD values.
 */
function updateHUD() {
    const gridSize = getGridSizeForRound(currentRound);
    const patternLength = getPatternLengthForRound(currentRound);

    if (roundNumber) roundNumber.textContent = currentRound;
    if (gridSizeLabel) gridSizeLabel.textContent = `${gridSize}x${gridSize}`;
    if (patternLengthLabel) patternLengthLabel.textContent = patternLength;
}

/**
 * Renders players and highlights active player.
 *
 * @param {number|null} activePlayerId - Current active player ID.
 */
function renderPlayers(activePlayerId = null) {
    if (!playersList) return;

    playersList.innerHTML = '';

    players.forEach(player => {
        const li = document.createElement('li');
        const livesText = player.lives === 1 ? '1 life' : `${player.lives} lives`;
        li.textContent = `${player.name} (${livesText})`;

        if (player.id === activePlayerId && !player.eliminated) {
            li.classList.add('active');
        }

        if (player.eliminated) {
            li.classList.add('eliminated');
        }

        playersList.appendChild(li);
    });
}

/**
 * Renders the memory grid for current round size.
 *
 * @param {number} size - Side length of the grid.
 */
function renderGrid(size) {
    if (!memoryGrid) return;

    memoryGrid.innerHTML = '';
    memoryGrid.style.gridTemplateColumns = `repeat(${size}, minmax(0, 1fr))`;

    for (let i = 0; i < size * size; i++) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'memory-cell';
        button.dataset.cellIndex = String(i);
        button.setAttribute('role', 'gridcell');

        button.addEventListener('click', function() {
            handleCellClick(i);
        });

        memoryGrid.appendChild(button);
    }
}

/**
 * Enables or disables all grid buttons.
 *
 * @param {boolean} enabled - Whether input should be enabled.
 */
function setGridEnabled(enabled) {
    const cells = memoryGrid.querySelectorAll('.memory-cell');
    cells.forEach(cell => {
        cell.disabled = !enabled;
    });
}

/**
 * Renders sequence tracker slots.
 *
 * @param {number} length - Number of slots to render.
 */
function renderSequenceSlots(length) {
    if (!sequenceSlots) return;

    sequenceSlots.innerHTML = '';

    for (let i = 0; i < length; i++) {
        const slot = document.createElement('div');
        slot.className = 'sequence-slot';
        sequenceSlots.appendChild(slot);
    }
}

/**
 * Marks a sequence slot as shown/correct/wrong.
 *
 * @param {number} index - Slot index.
 * @param {string} className - Slot class to apply.
 * @param {string} text - Optional slot text.
 */
function markSequenceSlot(index, className, text = '') {
    const slots = sequenceSlots.querySelectorAll('.sequence-slot');
    const slot = slots[index];
    if (!slot) return;

    slot.classList.add(className);
    if (text) slot.textContent = text;
}

/**
 * Starts timer and handles timeout.
 */
function startTimer() {
    clearInterval(timerInterval);
    timeRemaining = getTimerForRound(currentRound);
    updateTimer();

    timerInterval = setInterval(function() {
        timeRemaining -= 0.1;

        if (timeRemaining <= 0) {
            timeRemaining = 0;
            updateTimer();
            clearInterval(timerInterval);
            completeHumanTurn(false, 'Time ran out!');
            return;
        }

        updateTimer();
    }, 100);
}

/**
 * Updates timer visual state.
 */
function updateTimer() {
    if (!timerElement) return;

    timerElement.textContent = timeRemaining.toFixed(1);

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
 * Waits for a specific amount of time.
 *
 * @param {number} ms - Duration to wait in milliseconds.
 * @returns {Promise<void>} Resolves after timeout.
 */
function wait(ms) {
    return new Promise(resolve => {
        const timeoutId = setTimeout(resolve, ms);
        playbackTimeoutIds.push(timeoutId);
    });
}

/**
 * Highlights one grid cell briefly.
 *
 * @param {number} cellIndex - Grid cell index.
 * @param {string} className - Class to apply.
 * @param {number} duration - Highlight duration in milliseconds.
 */
function flashCell(cellIndex, className, duration) {
    const cell = memoryGrid.querySelector(`[data-cell-index="${cellIndex}"]`);
    if (!cell) return;

    cell.classList.add(className);

    clearTimeout(activeCellTimeout);
    activeCellTimeout = setTimeout(function() {
        cell.classList.remove(className);
    }, duration);
}

/**
 * Generates a random sequence for given grid and length.
 *
 * @param {number} gridSize - Grid side length.
 * @param {number} sequenceLength - Number of sequence steps.
 * @returns {number[]} Generated sequence.
 */
function generateSequence(gridSize, sequenceLength) {
    const maxCell = gridSize * gridSize;
    const sequence = [];

    for (let i = 0; i < sequenceLength; i++) {
        sequence.push(Math.floor(Math.random() * maxCell));
    }

    return sequence;
}

/**
 * Plays sequence on the grid and updates shown slots.
 *
 * @returns {Promise<void>} Resolves when sequence playback finishes.
 */
async function playSequence() {
    const stepMs = getPlaybackStepMs(currentRound);

    for (let i = 0; i < currentSequence.length; i++) {
        if (!gameActive) return;

        const cellIndex = currentSequence[i];
        markSequenceSlot(i, 'shown');
        flashCell(cellIndex, 'playback', Math.floor(stepMs * 0.65));

        await wait(stepMs);
    }
}

/**
 * Starts human replay phase and waits for result.
 *
 * @returns {Promise<Object>} Replay result.
 */
function startHumanReplay() {
    expectedInputIndex = 0;
    acceptingInput = true;
    setGridEnabled(true);
    startTimer();

    return new Promise(resolve => {
        pendingTurnResolver = resolve;
    });
}

/**
 * Completes human replay phase.
 *
 * @param {boolean} success - Whether replay was successful.
 * @param {string} failReason - Optional fail reason for status updates.
 */
function completeHumanTurn(success, failReason = '') {
    if (!acceptingInput) return;

    acceptingInput = false;
    clearInterval(timerInterval);
    setGridEnabled(false);

    if (!success && failReason) {
        gameStatusMessage.textContent = failReason;
    }

    if (pendingTurnResolver) {
        pendingTurnResolver({ success });
        pendingTurnResolver = null;
    }
}

/**
 * Handles clicks on memory cells during human replay.
 *
 * @param {number} clickedIndex - Clicked cell index.
 */
function handleCellClick(clickedIndex) {
    if (!gameActive || !acceptingInput) return;

    const expectedIndex = currentSequence[expectedInputIndex];

    if (clickedIndex === expectedIndex) {
        markSequenceSlot(expectedInputIndex, 'correct', '\u2713');
        flashCell(clickedIndex, 'correct', 180);
        expectedInputIndex++;

        if (expectedInputIndex >= currentSequence.length) {
            completeHumanTurn(true);
        }
    } else {
        markSequenceSlot(expectedInputIndex, 'wrong', '\u2715');
        flashCell(clickedIndex, 'wrong', 280);
        completeHumanTurn(false, 'Wrong square!');
    }
}

/**
 * Simulates AI replay with success chance based on difficulty and round.
 *
 * @param {Object} player - Current AI player.
 * @returns {Promise<Object>} AI replay result.
 */
function simulateAITurn(player) {
    return new Promise(resolve => {
        const settings = {
            easy: { baseSuccess: 0.74, perRoundDrop: 0.015 },
            medium: { baseSuccess: 0.85, perRoundDrop: 0.013 },
            hard: { baseSuccess: 0.92, perRoundDrop: 0.011 },
        };

        const selectedSettings = settings[selectedDifficulty] || settings.medium;
        const successChance = Math.max(0.35, selectedSettings.baseSuccess - (currentRound - 1) * selectedSettings.perRoundDrop);
        const shouldSucceed = Math.random() <= successChance;
        const failAt = shouldSucceed ? -1 : Math.floor(Math.random() * currentSequence.length);
        const pace = Math.max(180, getPlaybackStepMs(currentRound) - 120);

        let index = 0;

        function step() {
            if (!gameActive) {
                resolve({ success: false });
                return;
            }

            if (index >= currentSequence.length) {
                resolve({ success: true });
                return;
            }

            if (index === failAt) {
                markSequenceSlot(index, 'wrong', '\u2715');
                flashCell(currentSequence[index], 'wrong', 260);
                resolve({ success: false });
                return;
            }

            markSequenceSlot(index, 'correct', '\u2713');
            flashCell(currentSequence[index], 'correct', 220);
            index++;

            const timeoutId = setTimeout(step, pace);
            playbackTimeoutIds.push(timeoutId);
        }

        const firstTimeout = setTimeout(step, 400);
        playbackTimeoutIds.push(firstTimeout);
    });
}

/**
 * Handles elimination, win checks, and next turn flow.
 *
 * @param {Object} player - Current player object.
 * @param {boolean} success - Whether player completed sequence.
 */
function finishTurn(player, success) {
    if (!success) {
        player.lives = Math.max(0, (player.lives || 0) - 1);

        if (player.lives <= 0) {
            player.eliminated = true;
            gameStatusMessage.textContent = `${player.name} failed and was eliminated.`;
        } else {
            gameStatusMessage.textContent = `${player.name} failed. ${player.lives} lives remaining.`;
        }
    } else {
        gameStatusMessage.textContent = `${player.name} completed the sequence.`;
    }

    renderPlayers();

    if (!success && !player.isAI && player.eliminated) {
        gameActive = false;
        acceptingInput = false;
        clearAllTimers();
        gameStatusMessage.textContent = 'You failed the sequence. Game over.';

        transitionTimeoutId = setTimeout(() => {
            showStartScreen();
        }, 3500);
        return;
    }

    const remainingPlayers = getRemainingPlayers();
    if (remainingPlayers.length <= 1) {
        const winner = remainingPlayers[0];
        const winnerText = winner ? `${winner.name} wins the game!` : 'No winner this time.';
        gameStatusMessage.textContent = winnerText;
        gameActive = false;

        transitionTimeoutId = setTimeout(() => {
            showStartScreen();
        }, 4500);
        return;
    }

    currentTurnIndex++;

    if (currentTurnIndex >= turnOrderIds.length) {
        currentRound++;
        transitionTimeoutId = setTimeout(() => {
            startRound();
        }, 1200);
    } else {
        transitionTimeoutId = setTimeout(() => {
            runTurn();
        }, 950);
    }
}

/**
 * Runs one active player's turn.
 */
async function runTurn() {
    if (!gameActive) return;

    const playerId = turnOrderIds[currentTurnIndex];
    const currentPlayer = getPlayerById(playerId);

    if (!currentPlayer || currentPlayer.eliminated) {
        currentTurnIndex++;
        if (currentTurnIndex >= turnOrderIds.length) {
            currentRound++;
            transitionTimeoutId = setTimeout(() => {
                startRound();
            }, 900);
        } else {
            transitionTimeoutId = setTimeout(() => {
                runTurn();
            }, 500);
        }
        return;
    }

    const gridSize = getGridSizeForRound(currentRound);
    const patternLength = getPatternLengthForRound(currentRound);

    updateHUD();
    renderPlayers(currentPlayer.id);
    renderGrid(gridSize);
    setGridEnabled(false);

    currentSequence = generateSequence(gridSize, patternLength);
    renderSequenceSlots(patternLength);

    gameStatusMessage.textContent = `${currentPlayer.name}, watch the sequence.`;
    await wait(550);
    await playSequence();

    if (!gameActive) return;

    if (currentPlayer.isAI) {
        gameStatusMessage.textContent = `${currentPlayer.name} is replaying...`;
        const result = await simulateAITurn(currentPlayer);
        finishTurn(currentPlayer, result.success);
        return;
    }

    gameStatusMessage.textContent = 'Your turn: replay the sequence.';
    const result = await startHumanReplay();
    finishTurn(currentPlayer, result.success);
}

/**
 * Starts one full round and creates turn order for remaining players.
 */
function startRound() {
    if (!gameActive) return;

    const remainingPlayers = getRemainingPlayers();
    if (remainingPlayers.length <= 1) {
        finishTurn(remainingPlayers[0] || { name: 'Nobody' }, true);
        return;
    }

    turnOrderIds = remainingPlayers.map(player => player.id);
    currentTurnIndex = 0;

    updateHUD();
    runTurn();
}

/**
 * Starts a fresh singleplayer game.
 */
function startSingleplayerGame() {
    console.group('Info | Starting new Memory Matrix game');

    gameActive = true;
    acceptingInput = false;
    currentRound = 1;

    clearAllTimers();
    createPlayersArray(selectedAICount);

    showGameScreen();
    renderPlayers();
    updateHUD();

    startRound();

    console.log('Success | Game started');
    console.groupEnd();
}

/**
 * Handles AI count selection and updates button styles.
 *
 * @param {number} count - Selected AI count.
 */
function selectAICount(count) {
    selectedAICount = count;

    aiCountBtns.forEach(btn => {
        btn.classList.toggle('selected', Number(btn.dataset.count) === count);
    });

    updateStartButton();
}

/**
 * Handles difficulty selection and updates button styles.
 *
 * @param {string} difficulty - Selected difficulty.
 */
function selectDifficulty(difficulty) {
    selectedDifficulty = difficulty;

    difficultyBtns.forEach(btn => {
        btn.classList.toggle('selected', btn.dataset.difficulty === difficulty);
    });

    updateStartButton();
}

/* Event listeners */
if (singleplayerOption) {
    singleplayerOption.addEventListener('click', function() {
        startStatusMessage.textContent = 'Singleplayer mode selected.';
    });
}

aiCountBtns.forEach(btn => {
    btn.addEventListener('click', function() {
        selectAICount(Number(btn.dataset.count));
    });
});

difficultyBtns.forEach(btn => {
    btn.addEventListener('click', function() {
        selectDifficulty(btn.dataset.difficulty);
    });
});

startGameBtn.addEventListener('click', function() {
    if (!startGameBtn.classList.contains('enabled')) return;
    startSingleplayerGame();
});

leaveGameBtn.addEventListener('click', function() {
    gameActive = false;
    acceptingInput = false;
    clearAllTimers();
    showStartScreen();
});

window.addEventListener('beforeunload', function() {
    clearAllTimers();
});

showStartScreen();
