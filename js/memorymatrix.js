"use strict";

/* DOM elements */
const startGameBtn       = document.querySelector('#start-game-btn');
const leaveGameBtn       = document.querySelector('#leave-game-btn');
const startStatusMessage = document.querySelector('#start-status-message');
const gameStatusMessage  = document.querySelector('#game-status-message');
const startScreen        = document.querySelector('#start-screen');
const gameScreen         = document.querySelector('#game-screen');
const singleplayerOption = document.querySelector('#singleplayer-option');
const multiplayerOption  = document.querySelector('#multiplayer-option');
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
let players               = [];
let selectedMode          = null;
let selectedAICount       = 2;
let selectedDifficulty    = 'medium';
let currentRound          = 1;
let currentTurnIndex      = 0;
let turnOrderIds          = [];
let currentSequence       = [];
let currentInputSequence  = [];
let expectedInputIndex    = 0;
let timerInterval         = null;
let timeRemaining         = 12;
let gameActive            = false;
let acceptingInput        = false;
let activeCellTimeout     = null;
let playbackTimeoutIds    = [];
let transitionTimeoutId   = null;
let pendingTurnResolver   = null;
let currentGridSize       = 3;

/* Multiplayer state variables */
let ws                   = null;
let myPlayerId           = null;
let mySessionCode        = null;
let isHost               = false;
let multiCurrentPlayerId = null;

const ROUNDS_PER_GRID_SIZE = 5;
const BASE_GRID_SIZE       = 3;
const MAX_GRID_SIZE        = 6;

/* WebSocket server URL - auto-select based on environment */
const WS_URL = (() => {
    const hostname = window.location.hostname;
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
        return 'ws://localhost:8082';
    }
    return 'wss://api.tristanbudd.com/minigames/memorymatrix';
})();

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
    if (lobbyScreen) lobbyScreen.style.display = 'none';
    if (multiplayerSetup) multiplayerSetup.style.display = 'none';

    selectedMode = null;
    gameActive = false;
    acceptingInput = false;

    clearAllTimers();

    if (singleplayerOption) singleplayerOption.classList.remove('selected');
    if (multiplayerOption) multiplayerOption.classList.remove('selected');

    aiSelector.classList.remove('visible');
    difficultySelector.classList.remove('visible');

    aiCountBtns.forEach(btn => btn.classList.remove('selected'));
    difficultyBtns.forEach(btn => btn.classList.remove('selected'));

    selectedAICount = 2;
    selectedDifficulty = 'medium';

    if (startStatusMessage) startStatusMessage.textContent = '';
    if (gameStatusMessage) gameStatusMessage.textContent = '';

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
 * Enables or disables the start game button.
 */
function updateStartButton() {
    const readyForSingle = selectedMode === 'singleplayer' && selectedAICount > 0 && !!selectedDifficulty;
    startGameBtn.classList.toggle('enabled', readyForSingle);
    startGameBtn.style.display = selectedMode === 'multiplayer' ? 'none' : '';
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
 * @param {number|string} playerId - The player ID.
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
    players = [{ id: 1, name: 'You', lives: 3, eliminated: false, isAI: false }];

    for (let i = 1; i <= aiCount; i++) {
        players.push({ id: i + 1, name: `AI ${i}`, lives: 3, eliminated: false, isAI: true });
    }
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
    const gridSize = currentGridSize || getGridSizeForRound(currentRound);
    const patternLength = currentSequence.length || getPatternLengthForRound(currentRound);

    if (roundNumber) roundNumber.textContent = currentRound;
    if (gridSizeLabel) gridSizeLabel.textContent = `${gridSize}x${gridSize}`;
    if (patternLengthLabel) patternLengthLabel.textContent = patternLength;
}

/**
 * Renders players and highlights active player.
 *
 * @param {string|number|null} activePlayerId - Current active player ID.
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

    currentGridSize = size;
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
 * Starts timer and handles timeout for singleplayer.
 */
function startTimer() {
    if (selectedMode === 'multiplayer') return;

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

    timerElement.textContent = Math.max(0, timeRemaining).toFixed(1);

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
        const cellIndex = currentSequence[i];
        markSequenceSlot(i, 'shown');
        flashCell(cellIndex, 'playback', Math.floor(stepMs * 0.65));
        await wait(stepMs);
    }
}

/**
 * Starts human replay phase and waits for result.
 *
 * @param {boolean} useLocalTimer - Whether to run local timer countdown.
 * @returns {Promise<Object>} Replay result.
 */
function startHumanReplay(useLocalTimer = true) {
    expectedInputIndex = 0;
    currentInputSequence = [];
    acceptingInput = true;
    setGridEnabled(true);

    if (useLocalTimer) {
        startTimer();
    } else {
        clearInterval(timerInterval);
    }

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

    if (!success && failReason && gameStatusMessage) {
        gameStatusMessage.textContent = failReason;
    }

    if (pendingTurnResolver) {
        pendingTurnResolver({ success, sequence: currentInputSequence.slice() });
        pendingTurnResolver = null;
    }

    if (selectedMode === 'multiplayer' && multiCurrentPlayerId === myPlayerId) {
        wsSend({ type: 'submit_sequence', sequence: currentInputSequence.slice() });
    }
}

/**
 * Handles clicks on memory cells during human replay.
 *
 * @param {number} clickedIndex - Clicked cell index.
 */
function handleCellClick(clickedIndex) {
    if (!gameActive || !acceptingInput) return;

    currentInputSequence.push(clickedIndex);
    const expectedIndex = currentSequence[expectedInputIndex];

    if (clickedIndex === expectedIndex) {
        markSequenceSlot(expectedInputIndex, 'correct', 'Y');
        flashCell(clickedIndex, 'correct', 180);
        expectedInputIndex++;

        if (expectedInputIndex >= currentSequence.length) {
            completeHumanTurn(true);
        }
    } else {
        markSequenceSlot(expectedInputIndex, 'wrong', 'X');
        flashCell(clickedIndex, 'wrong', 280);
        completeHumanTurn(false, 'Wrong square!');
    }
}

/**
 * Simulates AI replay with success chance based on difficulty and round.
 *
 * @returns {Promise<Object>} AI replay result.
 */
function simulateAITurn() {
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
                markSequenceSlot(index, 'wrong', 'X');
                flashCell(currentSequence[index], 'wrong', 260);
                resolve({ success: false });
                return;
            }

            markSequenceSlot(index, 'correct', 'Y');
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
 * Handles elimination, win checks, and next turn flow for singleplayer.
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
 * Runs one active player's turn for singleplayer.
 */
async function runTurn() {
    if (!gameActive || selectedMode !== 'singleplayer') return;

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
        const result = await simulateAITurn();
        finishTurn(currentPlayer, result.success);
        return;
    }

    gameStatusMessage.textContent = 'Your turn: replay the sequence.';
    const result = await startHumanReplay(true);
    finishTurn(currentPlayer, result.success);
}

/**
 * Starts one full round and creates turn order for remaining players.
 */
function startRound() {
    if (!gameActive || selectedMode !== 'singleplayer') return;

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
    gameActive = true;
    acceptingInput = false;
    currentRound = 1;

    clearAllTimers();
    createPlayersArray(selectedAICount);

    showGameScreen();
    renderPlayers();
    updateHUD();

    startRound();
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

/**
 * Handles game mode selection and updates UI.
 *
 * @param {string} mode - The selected mode.
 */
function selectGameMode(mode) {
    selectedMode = mode;

    singleplayerOption.classList.toggle('selected', mode === 'singleplayer');
    multiplayerOption.classList.toggle('selected', mode === 'multiplayer');

    if (mode === 'singleplayer') {
        aiSelector.classList.add('visible');
        difficultySelector.classList.add('visible');
        if (multiplayerSetup) multiplayerSetup.style.display = 'none';

        if (!document.querySelector('.ai-count-btn.selected')) selectAICount(2);
        if (!document.querySelector('.difficulty-btn.selected')) selectDifficulty('medium');
    } else {
        aiSelector.classList.remove('visible');
        difficultySelector.classList.remove('visible');
        if (multiplayerSetup) multiplayerSetup.style.display = 'flex';
    }

    if (startStatusMessage) startStatusMessage.textContent = '';
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
        if (ws && ws.readyState === WebSocket.OPEN) {
            resolve();
            return;
        }

        ws = new WebSocket(WS_URL);

        ws.addEventListener('message', (event) => {
            let msg;
            try {
                msg = JSON.parse(event.data);
            } catch {
                return;
            }

            if (msg.type === 'connected') {
                myPlayerId = msg.playerId;
                resolve();
            }

            handleServerMessage(msg);
        });

        ws.addEventListener('error', () => {
            reject(new Error('socket_error'));
        });

        ws.addEventListener('close', () => {
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
    }
}

/**
 * Handles unexpected WebSocket disconnection mid-game or in lobby.
 */
function handleDisconnect() {
    if (!selectedMode || selectedMode !== 'multiplayer') return;

    if (gameScreen.style.display !== 'none') {
        if (gameStatusMessage) gameStatusMessage.textContent = 'Disconnected from server. Returning to menu...';
        setTimeout(() => {
            resetMultiplayerState();
            showStartScreen();
        }, 2500);
    } else if (lobbyScreen && lobbyScreen.style.display !== 'none') {
        setMultiStatus('Disconnected from server.');
        setTimeout(() => {
            resetMultiplayerState();
            showStartScreen();
        }, 1500);
    }
}

/**
 * Clears all multiplayer state variables and closes the socket if open.
 */
function resetMultiplayerState() {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close();
    }

    ws = null;
    myPlayerId = null;
    mySessionCode = null;
    isHost = false;
    multiCurrentPlayerId = null;
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
        case 'timer_tick':
            onTimerTick(msg);
            break;
        case 'turn_result':
            onTurnResult(msg);
            break;
        case 'player_eliminated':
            onPlayerEliminated(msg);
            break;
        case 'next_round':
            onNextRound(msg);
            break;
        case 'player_left':
            onPlayerLeft(msg);
            break;
        case 'game_over':
            onGameOver(msg);
            break;
        case 'error':
            setMultiStatus(`Error: ${msg.message}`);
            break;
        default:
            break;
    }
}

/**
 * Called every 100ms by the server to keep the multiplayer timer in sync.
 *
 * @param {Object} msg - Server message with current timeRemaining.
 */
function onTimerTick(msg) {
    timeRemaining = msg.timeRemaining;
    updateTimer();
}

/**
 * Called after the server confirms session creation.
 *
 * @param {Object} msg - Server message with code and players.
 */
function onSessionCreated(msg) {
    mySessionCode = msg.code;
    isHost = true;
    players = msg.players;

    showLobbyScreen(msg.code, msg.players);
    if (startMultiBtn) {
        startMultiBtn.style.display = 'block';
        startMultiBtn.disabled = players.length < 2;
    }
    setMultiStatus('Waiting for players to join...');
}

/**
 * Called after joining an existing session.
 *
 * @param {Object} msg - Session joined payload.
 */
function onSessionJoined(msg) {
    mySessionCode = msg.code;
    isHost = msg.hostId === myPlayerId;
    players = msg.players;

    showLobbyScreen(msg.code, msg.players);
    if (startMultiBtn) {
        startMultiBtn.style.display = isHost ? 'block' : 'none';
        startMultiBtn.disabled = !isHost || players.length < 2;
    }
    setMultiStatus(isHost ? 'Waiting for players...' : 'Waiting for host to start...');
}

/**
 * Called when lobby state changes.
 *
 * @param {Object} msg - Lobby state payload.
 */
function onLobbyState(msg) {
    players = msg.players;
    renderLobbyPlayers(msg.players);

    isHost = msg.hostId === myPlayerId;
    if (startMultiBtn) {
        startMultiBtn.style.display = isHost ? 'block' : 'none';
        startMultiBtn.disabled = !isHost || msg.players.length < 2;
    }

    if (isHost) {
        setMultiStatus(msg.players.length < 2 ? 'Need at least 2 players to start.' : 'Ready to start!');
    } else {
        setMultiStatus('Waiting for host to start...');
    }
}

/**
 * Shows the lobby screen.
 *
 * @param {string} code - Session code.
 * @param {Array} playerList - Lobby player list.
 */
function showLobbyScreen(code, playerList) {
    startScreen.style.display = 'none';
    gameScreen.style.display = 'none';
    if (lobbyScreen) lobbyScreen.style.display = 'flex';

    if (lobbyCodeDisplay) lobbyCodeDisplay.textContent = code;
    renderLobbyPlayers(playerList);
}

/**
 * Renders lobby player list.
 *
 * @param {Array} playerList - Lobby players.
 */
function renderLobbyPlayers(playerList) {
    if (!lobbyPlayersList) return;
    lobbyPlayersList.innerHTML = '';

    playerList.forEach(player => {
        const li = document.createElement('li');
        li.className = 'lobby-player-item';

        const name = document.createElement('span');
        name.textContent = player.name;
        li.appendChild(name);

        if (player.isHost) {
            const badge = document.createElement('span');
            badge.className = 'lobby-host-badge';
            badge.textContent = 'Host';
            li.appendChild(badge);
        }

        lobbyPlayersList.appendChild(li);
    });
}

/**
 * Sets multiplayer status text.
 *
 * @param {string} text - Status text.
 */
function setMultiStatus(text) {
    if (multiStatusMsg) {
        multiStatusMsg.textContent = text;
        multiStatusMsg.style.display = text ? 'block' : 'none';
    }
    if (lobbyStatusMsg) {
        lobbyStatusMsg.textContent = text;
        lobbyStatusMsg.style.display = text ? 'block' : 'none';
    }
}

/**
 * Called when multiplayer game starts.
 *
 * @param {Object} msg - Game started payload.
 */
function onGameStarted(msg) {
    players = msg.players;
    currentRound = msg.round;
    gameActive = true;

    showGameScreen();
    renderPlayers();
    updateHUD();

    if (gameStatusMessage) gameStatusMessage.textContent = 'Game starting...';
}

/**
 * Called when a turn starts in multiplayer.
 *
 * @param {Object} msg - Turn payload.
 */
async function onTurnStart(msg) {
    players = msg.players;
    currentRound = msg.round;
    multiCurrentPlayerId = msg.currentPlayerId;
    currentGridSize = msg.gridSize;
    currentSequence = msg.sequence.slice();
    currentInputSequence = [];

    timeRemaining = msg.timerSeconds;
    updateTimer();

    renderPlayers(msg.currentPlayerId);
    renderGrid(msg.gridSize);
    renderSequenceSlots(currentSequence.length);
    setGridEnabled(false);

    gameActive = true;
    acceptingInput = false;

    const currentPlayer = players.find(player => player.id === msg.currentPlayerId);
    const currentName = currentPlayer ? currentPlayer.name : 'Player';

    if (gameStatusMessage) gameStatusMessage.textContent = `${currentName}, watch the sequence.`;
    await wait(450);
    await playSequence();

    if (!gameActive) return;

    const isMyTurn = msg.currentPlayerId === myPlayerId;
    if (isMyTurn) {
        if (gameStatusMessage) gameStatusMessage.textContent = 'Your turn: replay the sequence.';
        startHumanReplay(false);
    } else {
        if (gameStatusMessage) gameStatusMessage.textContent = `${currentName} is replaying...`;
    }
}

/**
 * Called when server reports a processed turn result.
 *
 * @param {Object} msg - Turn result payload.
 */
function onTurnResult(msg) {
    players = msg.players;
    renderPlayers(multiCurrentPlayerId);

    if (msg.success) {
        if (gameStatusMessage) gameStatusMessage.textContent = `${msg.playerName} completed the sequence.`;
    } else {
        if (gameStatusMessage) gameStatusMessage.textContent = `${msg.playerName} failed. ${msg.livesRemaining} lives remaining.`;
    }

    if (msg.playerId === myPlayerId && acceptingInput) {
        acceptingInput = false;
        setGridEnabled(false);
        if (pendingTurnResolver) {
            pendingTurnResolver({ success: false, sequence: currentInputSequence.slice() });
            pendingTurnResolver = null;
        }
    }
}

/**
 * Called when a player is eliminated.
 *
 * @param {Object} msg - Elimination payload.
 */
function onPlayerEliminated(msg) {
    players = msg.players;
    renderPlayers();

    if (msg.eliminatedId === myPlayerId) {
        acceptingInput = false;
        setGridEnabled(false);
        if (pendingTurnResolver) {
            pendingTurnResolver({ success: false, sequence: currentInputSequence.slice() });
            pendingTurnResolver = null;
        }
        if (gameStatusMessage) gameStatusMessage.textContent = 'You were eliminated.';
    } else if (gameStatusMessage) {
        gameStatusMessage.textContent = `${msg.eliminatedName} was eliminated.`;
    }
}

/**
 * Called when next round starts.
 *
 * @param {Object} msg - Round update payload.
 */
function onNextRound(msg) {
    currentRound = msg.round;
    updateHUD();
    if (gameStatusMessage) gameStatusMessage.textContent = `Round ${msg.round} starting...`;
}

/**
 * Called when a player leaves during a game.
 *
 * @param {Object} msg - Player left payload.
 */
function onPlayerLeft(msg) {
    players = msg.players;
    renderPlayers();

    if (msg.newHostId === myPlayerId && !isHost) {
        isHost = true;
    }

    if (gameStatusMessage) gameStatusMessage.textContent = `${msg.playerName} left the game.`;
}

/**
 * Called when multiplayer game ends.
 *
 * @param {Object} msg - Game over payload.
 */
function onGameOver(msg) {
    gameActive = false;
    acceptingInput = false;
    setGridEnabled(false);

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
    }, 4500);
}

/**
 * Handles Create Session button click.
 */
async function handleCreateSession() {
    const name = (playerNameInput?.value || '').trim() || 'Player 1';

    try {
        setMultiStatus('Connecting...');
        await connectWebSocket();
        wsSend({ type: 'create_session', playerName: name });
    } catch {
        setMultiStatus('Could not connect to multiplayer server.');
    }
}

/**
 * Handles Join Session button click.
 */
async function handleJoinSession() {
    const name = (playerNameInput?.value || '').trim() || 'Player';
    const code = (sessionCodeInput?.value || '').trim();

    if (!code || code.length !== 6) {
        setMultiStatus('Please enter a valid 6-digit session code.');
        return;
    }

    try {
        setMultiStatus('Connecting...');
        await connectWebSocket();
        wsSend({ type: 'join_session', code, playerName: name });
    } catch {
        setMultiStatus('Could not connect to server.');
    }
}

/**
 * Handles Start Game button click in multiplayer lobby.
 */
function handleStartMultiplayer() {
    if (!isHost) return;
    if (players.length < 2) {
        setMultiStatus('Need at least 2 players to start.');
        return;
    }
    wsSend({ type: 'start_game' });
}

/**
 * Handles leaving lobby.
 */
function handleLeaveLobby() {
    wsSend({ type: 'leave_session' });
    resetMultiplayerState();
    showStartScreen();
}

/**
 * Handles leaving multiplayer game.
 */
function handleLeaveMultiplayerGame() {
    wsSend({ type: 'leave_session' });
    resetMultiplayerState();
    showStartScreen();
}

/**
 * Handles leaving the current game.
 */
function leaveGame() {
    if (selectedMode === 'multiplayer') {
        handleLeaveMultiplayerGame();
        return;
    }

    gameActive = false;
    acceptingInput = false;
    clearAllTimers();
    showStartScreen();
}

/* Event listeners */
if (singleplayerOption) {
    singleplayerOption.addEventListener('click', function() {
        selectGameMode('singleplayer');
    });
}

if (multiplayerOption) {
    multiplayerOption.addEventListener('click', function() {
        selectGameMode('multiplayer');
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

if (leaveGameBtn) leaveGameBtn.addEventListener('click', leaveGame);
if (createSessionBtn) createSessionBtn.addEventListener('click', handleCreateSession);
if (joinSessionBtn) joinSessionBtn.addEventListener('click', handleJoinSession);
if (startMultiBtn) startMultiBtn.addEventListener('click', handleStartMultiplayer);
if (leaveLobbyBtn) leaveLobbyBtn.addEventListener('click', handleLeaveLobby);

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
    sessionCodeInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') handleJoinSession();
    });
}

window.addEventListener('beforeunload', function() {
    clearAllTimers();
    if (ws && ws.readyState === WebSocket.OPEN) {
        wsSend({ type: 'leave_session' });
    }
});

showStartScreen();
