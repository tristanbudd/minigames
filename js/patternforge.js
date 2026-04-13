"use strict";

/* DOM elements */
const startScreen = document.querySelector('#start-screen');
const gameScreen = document.querySelector('#game-screen');
const summaryScreen = document.querySelector('#summary-screen');
const startGameBtn = document.querySelector('#start-game-btn');
const leaveGameBtn = document.querySelector('#leave-game-btn');
const checkPatternBtn = document.querySelector('#check-pattern-btn');
const clearPatternBtn = document.querySelector('#clear-pattern-btn');
const summaryReplayBtn = document.querySelector('#summary-replay-btn');
const summaryMenuBtn = document.querySelector('#summary-menu-btn');
const roundNumber = document.querySelector('#round-number');
const gridSizeLabel = document.querySelector('#grid-size');
const patternSizeLabel = document.querySelector('#pattern-size');
const timerElement = document.querySelector('#game-timer');
const timerPanel = document.querySelector('.timer-wrapper');
const drawGrid = document.querySelector('#draw-grid');
const playersList = document.querySelector('#players-list');
const summaryWinner = document.querySelector('#summary-winner');
const summaryList = document.querySelector('#summary-list');
const turnsRemainingLabel = document.querySelector('#turns-remaining');
const startStatusMessage = document.querySelector('#start-status-message');
const gameStatusMessage = document.querySelector('#game-status-message');
const aiCountBtns = document.querySelectorAll('.ai-count-btn');
const difficultyBtns = document.querySelectorAll('.difficulty-btn');
const lengthBtns = document.querySelectorAll('.length-btn');
const singleplayerOption = document.querySelector('#singleplayer-option');
const multiplayerOption = document.querySelector('#multiplayer-option');
const aiSelector = document.querySelector('#ai-selector');
const difficultySelector = document.querySelector('#difficulty-selector');
const lengthSelector = document.querySelector('#length-selector');

/* Match configuration */
const BASE_GRID_SIZE = 3;
const MAX_GRID_SIZE = 8;
const ROUNDS_PER_GRID_INCREASE = 3;
const PREVIEW_MS = 1400;
const LENGTH_MINUTES = {
  short: 2,
  medium: 3,
  long: 5
};

/* Game state variables */
let currentRound = 1;
let gridSize = BASE_GRID_SIZE;
let targetPattern = [];
let drawPattern = [];
let isRoundActive = false;
let timerInterval = null;
let timeRemaining = 12;
let selectedAICount = 2;
let selectedDifficulty = 'medium';
let selectedLength = 'medium';
let selectedMode = null;
let players = [];
let currentTurnIndex = 0;
let currentTurnNumber = 1;
let scoreEffect = null;
let gameStartTime = 0;
let gameDurationMs = 0;

/**
 * Resets the UI to the start screen and clears transient state.
 */
function showStartScreen() {
  clearInterval(timerInterval);
  startScreen.style.display = 'flex';
  gameScreen.style.display = 'none';
  if (summaryScreen) {
    summaryScreen.style.display = 'none';
  }
  startStatusMessage.textContent = '';
  gameStatusMessage.textContent = '';
  selectedMode = null;
  singleplayerOption.classList.remove('selected');
  if (multiplayerOption) {
    multiplayerOption.classList.remove('selected');
  }
  aiSelector.classList.remove('visible');
  difficultySelector.classList.remove('visible');
  lengthSelector.classList.remove('visible');
  players = [];
  if (playersList) {
    playersList.innerHTML = '';
  }
  updateStartButton();
}

/**
 * Enables the start button when the singleplayer setup is valid.
 */
function updateStartButton() {
  const readyForSingle = selectedMode === 'singleplayer' && selectedAICount > 0 && !!selectedDifficulty && !!selectedLength;
  startGameBtn.classList.toggle('enabled', readyForSingle);
}

/**
 * Converts the selected match length into milliseconds.
 *
 * @returns {number} Match duration in milliseconds.
 */
function getDurationMsFromSelection() {
  const minutes = LENGTH_MINUTES[selectedLength] || LENGTH_MINUTES.medium;
  return minutes * 60 * 1000;
}

/**
 * Shows the game screen.
 */
function showGameScreen() {
  startScreen.style.display = 'none';
  gameScreen.style.display = 'block';
  if (summaryScreen) {
    summaryScreen.style.display = 'none';
  }
}

/**
 * Returns the grid size for the current round.
 *
 * @param {number} round - The current round number.
 * @returns {number} The grid side length.
 */
function getGridSizeForRound(round) {
  const increases = Math.floor((round - 1) / ROUNDS_PER_GRID_INCREASE);
  return Math.min(MAX_GRID_SIZE, BASE_GRID_SIZE + increases);
}

/**
 * Returns how many cells should be lit in the target pattern.
 *
 * @param {number} size - The grid side length.
 * @param {number} round - The current round number.
 * @returns {number} The number of lit cells in the pattern.
 */
function getPatternCellCount(size, round) {
  const min = Math.max(3, Math.floor(size * 0.7));
  const extra = Math.floor((round - 1) / 2);
  const difficultyBonus = selectedDifficulty === 'hard' ? 1 : (selectedDifficulty === 'easy' ? -1 : 0);
  const max = Math.min(size * size - 1, min + size + extra + difficultyBonus);
  return Math.max(min, max);
}

/**
 * Returns the per-turn countdown for the current round.
 *
 * @param {number} round - The current round number.
 * @returns {number} The turn time in seconds.
 */
function getRoundTime(round) {
  const baseTime = Math.max(6, 12 - Math.floor((round - 1) / 2));
  const difficultyOffset = selectedDifficulty === 'hard' ? -1 : (selectedDifficulty === 'easy' ? 2 : 0);
  return Math.max(5, baseTime + difficultyOffset);
}

/**
 * Updates the timer visuals and warning states.
 */
function updateTimerVisual() {
  timerElement.textContent = timeRemaining.toFixed(1);
  timerElement.classList.remove('warning', 'critical');
  if (timerPanel) {
    timerPanel.classList.remove('warning', 'critical');
  }

  if (timeRemaining <= 3) {
    timerElement.classList.add('critical');
    if (timerPanel) {
      timerPanel.classList.add('critical');
    }
  } else if (timeRemaining <= 5) {
    timerElement.classList.add('warning');
    if (timerPanel) {
      timerPanel.classList.add('warning');
    }
  }
}

/**
 * Creates the human player and AI players for a new run.
 *
 * @param {number} aiCount - The number of AI opponents.
 */
function createPlayersArray(aiCount) {
  players = [{ id: 'you', name: 'You', points: 0, isAI: false }];

  for (let i = 1; i <= aiCount; i++) {
    players.push({ id: `ai-${i}`, name: `AI ${i}`, points: 0, isAI: true });
  }
}

/**
 * Returns the current player array.
 *
 * @returns {Array<Object>} The current player list.
 */
function getRemainingPlayers() {
  return players;
}

/**
 * Returns the player whose turn is active.
 *
 * @returns {Object|null} The active player, or null if there are no players.
 */
function getActivePlayer() {
  const remaining = getRemainingPlayers();

  if (remaining.length === 0) {
    return null;
  }

  const normalizedIndex = currentTurnIndex % remaining.length;
  return remaining[normalizedIndex];
}

/**
 * Advances to the next player in turn order.
 */
function advanceTurn() {
  const remaining = getRemainingPlayers();

  if (remaining.length === 0) {
    currentTurnIndex = 0;
    return;
  }

  currentTurnIndex = (currentTurnIndex + 1) % remaining.length;
}

/**
 * Renders the player sidebar and highlights the active turn.
 *
 * @param {string} [activePlayerId='you'] - The active player ID.
 */
function renderPlayers(activePlayerId = 'you') {
  if (!playersList) return;

  playersList.innerHTML = '';

  players.forEach(player => {
    const li = document.createElement('li');
    li.textContent = `${player.name} (${player.points} pts)`;

    if (player.id === activePlayerId) {
      li.classList.add('active');
    }

    if (scoreEffect && scoreEffect.playerId === player.id) {
      li.classList.add(scoreEffect.delta >= 0 ? 'score-up' : 'score-down');

      const change = document.createElement('span');
      change.className = `score-change ${scoreEffect.delta >= 0 ? 'up' : 'down'}`;
      change.textContent = `${scoreEffect.delta >= 0 ? '+' : ''}${scoreEffect.delta}`;
      li.appendChild(change);
    }

    playersList.appendChild(li);
  });
}

/**
 * Returns the AI success chance for the current difficulty and round.
 *
 * @param {number} round - The current round number.
 * @returns {number} The AI success chance as a decimal between 0 and 1.
 */
function getAISuccessChance(round) {
  const base = selectedDifficulty === 'hard' ? 0.96 : (selectedDifficulty === 'easy' ? 0.72 : 0.82);
  const roundPenalty = Math.min(0.14, (round - 1) * 0.01);
  return Math.max(0.35, base - roundPenalty);
}

/**
 * Builds a simulated AI attempt from the target pattern.
 *
 * @param {Object} aiPlayer - The active AI player.
 * @param {number} round - The current round number.
 * @returns {{ attemptPattern: boolean[], stepMs: number }} The simulated attempt data.
 */
function simulateSingleAITurn(aiPlayer, round) {
  const successChance = getAISuccessChance(round);
  const errorChance = Math.max(0.03, Math.min(0.3, 1 - successChance));
  const attemptPattern = targetPattern.slice();

  for (let i = 0; i < attemptPattern.length; i++) {
    if (Math.random() < errorChance) {
      attemptPattern[i] = !attemptPattern[i];
    }
  }

  return {
    attemptPattern,
    stepMs: Math.max(65, 165 - (round * 4))
  };
}

/**
 * Resets the match state for a new run.
 */
function resetRunState() {
  currentRound = 1;
  currentTurnIndex = 0;
  currentTurnNumber = 1;
  gameDurationMs = getDurationMsFromSelection();
  gameStartTime = Date.now();
  createPlayersArray(selectedAICount);
  renderPlayers('you');
}

/**
 * Builds an empty boolean pattern array.
 *
 * @param {number} size - The grid side length.
 * @returns {boolean[]} The empty pattern array.
 */
function buildEmptyPattern(size) {
  return Array.from({ length: size * size }, () => false);
}

/**
 * Shuffles an array in place using Fisher-Yates.
 *
 * @template T
 * @param {T[]} items - The array to shuffle.
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
 * Animates an AI attempt on the drawing grid.
 *
 * @param {boolean[]} attemptPattern - The AI's pattern attempt.
 * @param {number} stepMs - The delay between each AI step.
 * @param {Function} onComplete - Callback fired after the animation ends.
 */
function animateAIAttempt(attemptPattern, stepMs, onComplete) {
  resetDrawBoard();

  const drawCells = drawGrid.querySelectorAll('.pattern-cell');
  const fillOrder = [];

  for (let i = 0; i < attemptPattern.length; i++) {
    if (attemptPattern[i]) {
      fillOrder.push(i);
    }
  }

  shuffleArray(fillOrder);

  if (fillOrder.length === 0) {
    setTimeout(onComplete, Math.max(180, stepMs));
    return;
  }

  fillOrder.forEach((index, step) => {
    setTimeout(() => {
      const cell = drawCells[index];
      if (!cell) return;

      cell.classList.remove('ai-attempt');
      cell.classList.add('ai-attempt');

      setTimeout(() => {
        cell.classList.remove('ai-attempt');
        drawPattern[index] = true;
        cell.classList.add('filled');
      }, Math.max(60, Math.floor(stepMs * 0.6)));
    }, step * stepMs);
  });

  setTimeout(onComplete, fillOrder.length * stepMs + Math.max(120, stepMs));
}

/**
 * Converts a flat cell index into row and column coordinates.
 *
 * @param {number} index - The flat cell index.
 * @param {number} size - The grid side length.
 * @returns {{ row: number, col: number }} The row and column coordinates.
 */
function indexToPoint(index, size) {
  return { row: Math.floor(index / size), col: index % size };
}

/**
 * Converts row and column coordinates into a flat cell index.
 *
 * @param {number} row - The row index.
 * @param {number} col - The column index.
 * @param {number} size - The grid side length.
 * @returns {number} The flat cell index.
 */
function pointToIndex(row, col, size) {
  return (row * size) + col;
}

/**
 * Generates a connected target pattern for the current grid.
 *
 * @param {number} size - The grid side length.
 * @param {number} count - The number of filled cells to generate.
 * @returns {boolean[]} The generated pattern.
 */
function generateConnectedPattern(size, count) {
  const pattern = buildEmptyPattern(size);
  const visited = new Set();
  const neighbors = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1]
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
        col: anchorPoint.col + delta[1]
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
      const randomCell = Math.floor(Math.random() * size * size);
      visited.add(randomCell);
    }
  }

  visited.forEach(index => {
    pattern[index] = true;
  });

  return pattern;
}

/**
 * Renders the drawing grid and wires click handling when enabled.
 *
 * @param {HTMLElement} gridElement - The grid container element.
 * @param {number} size - The grid side length.
 * @param {boolean} isInteractive - Whether the grid should accept clicks.
 */
function renderGrid(gridElement, size, isInteractive) {
  gridElement.innerHTML = '';
  gridElement.style.gridTemplateColumns = `repeat(${size}, minmax(0, 1fr))`;

  for (let i = 0; i < size * size; i++) {
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'pattern-cell';
    cell.dataset.cellIndex = String(i);
    cell.disabled = !isInteractive;

    if (isInteractive) {
      cell.addEventListener('click', function() {
        if (!isRoundActive) return;

        const idx = Number(cell.dataset.cellIndex);
        drawPattern[idx] = !drawPattern[idx];
        cell.classList.toggle('filled', drawPattern[idx]);
      });
    }

    gridElement.appendChild(cell);
  }
}

/**
 * Paints a pattern onto the given grid using the provided class name.
 *
 * @param {HTMLElement} gridElement - The grid container element.
 * @param {boolean[]} pattern - The pattern to paint.
 * @param {string} className - The CSS class to apply to filled cells.
 */
function paintPattern(gridElement, pattern, className) {
  const cells = gridElement.querySelectorAll('.pattern-cell');

  for (let i = 0; i < cells.length; i++) {
    cells[i].classList.remove('filled', 'preview', 'player-correct', 'player-wrong');
    if (pattern[i]) {
      cells[i].classList.add(className);
    }
  }
}

/**
 * Marks cells as correct or wrong after a turn is checked.
 */
function markPlayerDifferences() {
  const cells = drawGrid.querySelectorAll('.pattern-cell');

  for (let i = 0; i < cells.length; i++) {
    cells[i].classList.remove('player-correct', 'player-wrong');

    if (drawPattern[i] === targetPattern[i]) {
      if (drawPattern[i]) {
        cells[i].classList.add('player-correct');
      }
    } else {
      cells[i].classList.add('player-wrong');
    }
  }
}

/**
 * Clears the player's drawing board.
 */
function resetDrawBoard() {
  drawPattern = buildEmptyPattern(gridSize);
  paintPattern(drawGrid, drawPattern, 'filled');
}

/**
 * Enables or disables the drawing grid.
 *
 * @param {boolean} enabled - Whether the grid should be interactive.
 */
function setGridEnabled(enabled) {
  const cells = drawGrid.querySelectorAll('.pattern-cell');
  cells.forEach(cell => {
    cell.disabled = !enabled;
  });
}

/**
 * Returns whether the current drawing exactly matches the target.
 *
 * @returns {boolean} True when the patterns are identical.
 */
function patternsMatch() {
  if (drawPattern.length !== targetPattern.length) {
    return false;
  }

  for (let i = 0; i < targetPattern.length; i++) {
    if (drawPattern[i] !== targetPattern[i]) {
      return false;
    }
  }

  return true;
}

/**
 * Calculates the signed accuracy and point score for a turn.
 *
 * @returns {{ accuracy: number, points: number }} The turn result.
 */
function calculateTurnResult() {
  let matches = 0;
  let wrong = 0;

  for (let i = 0; i < targetPattern.length; i++) {
    if (targetPattern[i] === drawPattern[i]) {
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
    points
  };
}

/**
 * Applies a point change to a player and stores the score effect.
 *
 * @param {Object} player - The player to update.
 * @param {number} turnPoints - The points earned on the turn.
 * @returns {number} The points applied to the player.
 */
function addPoints(player, turnPoints) {
  player.points += turnPoints;
  scoreEffect = { playerId: player.id, delta: turnPoints };
  return turnPoints;
}

/**
 * Returns whether the overall match timer has expired.
 *
 * @returns {boolean} True when the match time is over.
 */
function isGameOver() {
  if (!gameStartTime || !gameDurationMs) {
    return false;
  }

  return (Date.now() - gameStartTime) >= gameDurationMs;
}

/**
 * Builds the winner message for the summary screen.
 *
 * @returns {string} The winner summary text.
 */
function getWinnerSummary() {
  const maxPoints = Math.max(...players.map(player => player.points));
  const winners = players.filter(player => Math.abs(player.points - maxPoints) < 0.0001);

  if (winners.length === 1) {
    return `${winners[0].name} wins with ${maxPoints} points.`;
  }

  const names = winners.map(player => player.name).join(', ');
  return `Tie between ${names} at ${maxPoints} points.`;
}

/**
 * Renders the final standings list.
 */
function renderSummary() {
  if (!summaryList || !summaryWinner) return;

  const standings = [...players].sort((a, b) => b.points - a.points);
  summaryWinner.textContent = getWinnerSummary();
  summaryList.innerHTML = '';

  standings.forEach((player, index) => {
    const li = document.createElement('li');
    li.className = 'summary-item';
    li.textContent = `${index + 1}. ${player.name} - ${player.points} pts`;
    summaryList.appendChild(li);
  });
}

/**
 * Shows the summary screen and hides the main game view.
 */
function showSummaryScreen() {
  gameScreen.style.display = 'none';
  if (summaryScreen) {
    summaryScreen.style.display = 'flex';
  }
  renderSummary();
}

/**
 * Advances to the next turn or ends the match.
 */
function moveToNextTurn() {
  if (isGameOver()) {
    isRoundActive = false;
    stopRoundTimer();
    renderPlayers();
    showSummaryScreen();
    return;
  }

  advanceTurn();
  currentTurnNumber += 1;
  if (currentTurnIndex === 0) {
    currentRound += 1;
  }

  setTimeout(() => {
    beginRound();
  }, 950);
}

/**
 * Stops the active per-turn timer.
 */
function stopRoundTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
}

/**
 * Starts the active per-turn timer.
 */
function startRoundTimer() {
  stopRoundTimer();

  timerInterval = setInterval(() => {
    timeRemaining = Math.max(0, timeRemaining - 0.1);
    updateTimerVisual();
    updateHud();

    if (timeRemaining <= 0) {
      completeRound(true);
    }
  }, 100);
}

/**
 * Formats a duration in milliseconds as MM:SS.
 *
 * @param {number} ms - The duration in milliseconds.
 * @returns {string} The formatted duration.
 */
function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Updates the round HUD with the current match values.
 */
function updateHud() {
  roundNumber.textContent = String(currentRound);
  gridSizeLabel.textContent = `${gridSize}x${gridSize}`;
  patternSizeLabel.textContent = String(targetPattern.filter(Boolean).length);
  const elapsedMs = gameStartTime ? (Date.now() - gameStartTime) : 0;
  const remainingMs = Math.max(0, gameDurationMs - elapsedMs);
  turnsRemainingLabel.textContent = formatDuration(remainingMs);
}

/**
 * Completes the current turn and scores the attempt.
 *
 * @param {boolean} [autoChecked=false] - Whether the turn was auto-checked.
 */
function completeRound(autoChecked = false) {
  isRoundActive = false;
  stopRoundTimer();
  markPlayerDifferences();

  const activePlayer = getActivePlayer();
  const result = calculateTurnResult();
  const turnPoints = addPoints(activePlayer, result.points);
  const autoText = autoChecked ? ' (auto-checked)' : '';
  gameStatusMessage.textContent = `${activePlayer.name}: ${turnPoints} pts (${(result.accuracy * 100).toFixed(1)}% accurate)${autoText}.`;
  renderPlayers(activePlayer.id);

  setTimeout(() => {
    scoreEffect = null;
    renderPlayers(activePlayer.id);
  }, 900);

  moveToNextTurn();
}

/**
 * Prepares the next turn, including the preview and input phase.
 */
function beginRound() {
  isRoundActive = false;
  stopRoundTimer();

  const activePlayer = getActivePlayer();

  if (!activePlayer) {
    resetRunState();
  }

  gridSize = getGridSizeForRound(currentRound);
  const patternCellCount = getPatternCellCount(gridSize, currentRound);
  targetPattern = generateConnectedPattern(gridSize, patternCellCount);
  drawPattern = buildEmptyPattern(gridSize);
  timeRemaining = getRoundTime(currentRound);

  updateHud();
  updateTimerVisual();
  renderPlayers(activePlayer ? activePlayer.id : null);
  renderGrid(drawGrid, gridSize, true);
  setGridEnabled(false);

  paintPattern(drawGrid, targetPattern, 'preview');

  gameStatusMessage.textContent = 'Memorize the pattern...';

  setTimeout(() => {
    drawGrid.querySelectorAll('.pattern-cell').forEach(cell => {
      cell.classList.remove('preview');
    });

    if (!activePlayer) {
      return;
    }

    if (activePlayer.isAI) {
      gameStatusMessage.textContent = `${activePlayer.name} is attempting the pattern...`;

      const aiTurn = simulateSingleAITurn(activePlayer, currentRound);

      setTimeout(() => {
        animateAIAttempt(aiTurn.attemptPattern, aiTurn.stepMs, () => {
          markPlayerDifferences();

          const result = calculateTurnResult();
          const turnPoints = addPoints(activePlayer, result.points);
          gameStatusMessage.textContent = `${activePlayer.name}: ${turnPoints} pts (${(result.accuracy * 100).toFixed(1)}% accurate).`;

          renderPlayers(activePlayer.id);

          setTimeout(() => {
            scoreEffect = null;
            renderPlayers(getActivePlayer() ? getActivePlayer().id : null);
          }, 900);

          moveToNextTurn();
        });
      }, 900);

      return;
    }

    resetDrawBoard();
    setGridEnabled(true);
    gameStatusMessage.textContent = 'Draw the pattern and check before time runs out.';
    isRoundActive = true;
    startRoundTimer();
  }, PREVIEW_MS);
}

/* Event listeners */
startGameBtn.addEventListener('click', function() {
  if (selectedMode !== 'singleplayer') {
    return;
  }

  resetRunState();
  showGameScreen();
  beginRound();
});

leaveGameBtn.addEventListener('click', function() {
  showStartScreen();
});

if (summaryReplayBtn) {
  summaryReplayBtn.addEventListener('click', function() {
    resetRunState();
    showGameScreen();
    beginRound();
  });
}

if (summaryMenuBtn) {
  summaryMenuBtn.addEventListener('click', function() {
    showStartScreen();
  });
}

checkPatternBtn.addEventListener('click', function() {
  if (!isRoundActive) return;

  completeRound(false);
});

clearPatternBtn.addEventListener('click', function() {
  if (!isRoundActive) return;

  resetDrawBoard();
});

aiCountBtns.forEach(btn => {
  btn.addEventListener('click', function() {
    aiCountBtns.forEach(otherBtn => otherBtn.classList.remove('selected'));
    btn.classList.add('selected');
    selectedAICount = Number(btn.dataset.count) || 2;
    updateStartButton();
  });
});

difficultyBtns.forEach(btn => {
  btn.addEventListener('click', function() {
    difficultyBtns.forEach(otherBtn => otherBtn.classList.remove('selected'));
    btn.classList.add('selected');
    selectedDifficulty = btn.dataset.difficulty || 'medium';
    updateStartButton();
  });
});

lengthBtns.forEach(btn => {
  btn.addEventListener('click', function() {
    lengthBtns.forEach(otherBtn => otherBtn.classList.remove('selected'));
    btn.classList.add('selected');
    selectedLength = btn.dataset.length || 'medium';
    updateStartButton();
  });
});

singleplayerOption.addEventListener('click', function() {
  selectedMode = 'singleplayer';
  singleplayerOption.classList.add('selected');
  if (multiplayerOption) {
    multiplayerOption.classList.remove('selected');
    multiplayerOption.setAttribute('aria-pressed', 'false');
  }
  aiSelector.classList.add('visible');
  difficultySelector.classList.add('visible');
  lengthSelector.classList.add('visible');
  singleplayerOption.setAttribute('aria-pressed', 'true');
  startStatusMessage.textContent = '';
  updateStartButton();
});

singleplayerOption.addEventListener('keydown', function(event) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    singleplayerOption.click();
  }
});

if (multiplayerOption) {
  multiplayerOption.addEventListener('click', function() {
    selectedMode = 'multiplayer';
    multiplayerOption.classList.add('selected');
    multiplayerOption.setAttribute('aria-pressed', 'true');
    singleplayerOption.classList.remove('selected');
    singleplayerOption.setAttribute('aria-pressed', 'false');
    aiSelector.classList.remove('visible');
    difficultySelector.classList.remove('visible');
    lengthSelector.classList.remove('visible');
    startStatusMessage.textContent = 'Multiplayer is coming soon for Pattern Forge.';
    updateStartButton();
  });

  multiplayerOption.addEventListener('keydown', function(event) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      multiplayerOption.click();
    }
  });
}

showStartScreen();
