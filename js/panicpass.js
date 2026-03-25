"use strict";

/* DOM elements */
const startGameBtn       = document.querySelector('#start-game-btn');
const leaveGameBtn       = document.querySelector('#leave-game-btn');
const playersCircle      = document.querySelector('#players-circle');
const wordDisplay        = document.querySelector('#word-display');
const wordInput          = document.querySelector('#word-input');
const timerElement       = document.querySelector('#game-timer');
const statusMessage      = document.querySelector('#status-message');
const roundNumber        = document.querySelector('#round-number');
const playersCount       = document.querySelector('#players-count');
const startScreen        = document.querySelector('#start-screen');
const gameScreen         = document.querySelector('#game-screen');
const singleplayerOption = document.querySelector('#singleplayer-option');
const multiplayerOption  = document.querySelector('#multiplayer-option');
const aiSelector         = document.querySelector('#ai-selector');
const aiCountBtns        = document.querySelectorAll('.ai-count-btn');
const difficultySelector = document.querySelector('#difficulty-selector');
const difficultyBtns     = document.querySelectorAll('.difficulty-btn');

/* Multiplayer DOM elements */
const multiplayerSetup = document.querySelector('#multiplayer-setup');
const sessionCodeInput = document.querySelector('#session-code-input');
const playerNameInput  = document.querySelector('#player-name-input');
const createSessionBtn = document.querySelector('#create-session-btn');
const joinSessionBtn   = document.querySelector('#join-session-btn');
const lobbyScreen      = document.querySelector('#lobby-screen');
const lobbyPlayersList = document.querySelector('#lobby-players-list');
const lobbyCodeDisplay = document.querySelector('#lobby-code-display');
const lobbyStatusMsg  = document.querySelector('#lobby-status-msg');
const startMultiBtn    = document.querySelector('#start-multi-btn');
const leaveLobbyBtn    = document.querySelector('#leave-lobby-btn');
const multiStatusMsg   = document.querySelector('#multi-status-msg');

/* Game state variables */
let currentWord               = '';
let timerInterval             = null;
let timeRemaining             = 10;
let fallbackWords             = [];
let currentPlayerIndex        = 0;
let gameActive                = false;
let aiTypingTimeout           = null;
let currentRound              = 1;
let baseTimer                 = 10;
let aiCompletedWord           = false;
let playersCompletedThisRound = 0;
let selectedGameMode          = null;
let selectedAICount           = 2;
let selectedDifficulty        = null;
let returnToStartTimeout      = null;
let gameFlowTimeout           = null;
let roundTransitionTimeout    = null;
let uiRefreshTimeout          = null;
let players                   = [];

/* Multiplayer state variables */
let ws                   = null;
let myPlayerId           = null;
let mySessionCode        = null;
let isHost               = false;
let multiCurrentWord     = '';
let multiCurrentPlayerId = null;
let lastSubmittedInput   = '';

/* WebSocket server URL - auto-select based on environment */
const WS_URL = (() => {
    const hostname = window.location.hostname;
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
        return 'ws://localhost:8080';
    } else {
        return 'wss://api.tristanbudd.com/minigames/panicpass';
    }
})();

console.group('Info | Panic Pass Game Initialized');
console.log('Info | DOM elements loaded');
console.log('Info | Game variables initialized');
console.groupEnd();

/**
 * Fetches a random word from the API with timeout.
 *
 * @returns {Promise<string>} The fetched word in lowercase.
 * @throws Will throw an error if the API request fails or times out.
 */
async function fetchWordFromAPI() {
    console.log('Debug | Fetching word from API');
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
        console.log('Warning | API request timeout after 3 seconds');
        controller.abort();
    }, 3000);

    try {
        const response = await fetch('https://random-word-api.herokuapp.com/word', {
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
            console.log('Error | API request failed');
            throw new Error('API failed');
        }

        const data = await response.json();
        if (!Array.isArray(data) || !data[0]) {
            console.log('Error | Invalid API response format');
            throw new Error('Invalid API format');
        }

        console.log('Success | Word fetched from API:', data[0]);
        return data[0].toLowerCase();
    } catch (error) {
        clearTimeout(timeoutId);

        if (error.name === 'AbortError') {
            console.log('Error | API request timed out');
            throw new Error('API timeout');
        }

        throw error;
    }
}

/**
 * Loads fallback words from file or uses hardcoded list.
 *
 * @returns {Promise<void>} Resolves when fallback words are loaded.
 * @throws Will throw an error if the fallback word loading fails.
 */
async function loadFallbackWords() {
    if (fallbackWords.length) {
        console.log('Debug | Fallback words already loaded');
        return;
    }
    console.log('Debug | Loading fallback words');
    const response = await fetch('data/words.txt');
    if (!response.ok) {
        console.log('Error | Fallback word loading failed');
        throw new Error('Fallback failed');
    }
    const text = await response.text();
    fallbackWords = text.split('\n').map(w => w.trim().toLowerCase()).filter(Boolean);
    console.log('Success | Fallback words loaded:', fallbackWords.length, 'words');
}

/**
 * Returns a random word from the fallback list.
 *
 * @returns {string} A random fallback word.
 */
function getRandomFallbackWord() {
    if (!fallbackWords.length) {
        console.log('Debug | No fallback words, using default');
        return 'error';
    }
    const word = fallbackWords[Math.floor(Math.random() * fallbackWords.length)];
    console.log('Debug | Fallback word selected:', word);
    return word;
}

/**
 * Gets a random word from API or fallback sources.
 *
 * @returns {Promise<string>} The selected random word.
 */
async function getRandomWord() {
    console.group('Debug | Getting random word');

    try {
        const word = await fetchWordFromAPI();
        console.groupEnd();
        return word;
    } catch {
        console.log('Debug | API failed, trying fallback');

        try {
            await loadFallbackWords();
            const word = getRandomFallbackWord();
            console.groupEnd();
            return word;
        } catch {
            console.log('Error | All word sources failed, using default');
            console.groupEnd();
            return 'error';
        }
    }
}

/**
 * Creates players array with human and AI players.
 *
 * @param {number} aiCount - The number of AI players to create.
 */
function createPlayersArray(aiCount) {
    console.group('Info | Creating players array');
    players = [{ id: 1, name: 'You', eliminated: false, isAI: false }];

    for (let i = 1; i <= aiCount; i++) {
        players.push({ id: i + 1, name: `AI ${i}`, eliminated: false, isAI: true });
    }

    console.log('Info | Players created:', players.map(p => p.name));
    console.log('Info | Total players:', players.length);
    console.groupEnd();
}

/**
 * Shows start screen and resets game state.
 */
function showStartScreen() {
    console.group('Info | Showing start screen');
    startScreen.style.display      = 'flex';
    gameScreen.style.display       = 'none';
    lobbyScreen.style.display      = 'none';
    multiplayerSetup.style.display = 'none';
    selectedGameMode = null;

    singleplayerOption.classList.remove('selected');
    multiplayerOption.classList.remove('selected');
    aiSelector.classList.remove('visible');
    aiCountBtns.forEach(btn => btn.classList.remove('selected'));
    difficultySelector.classList.remove('visible');
    difficultyBtns.forEach(btn => btn.classList.remove('selected'));

    selectedDifficulty = null;

    updateStartButton();
    clearTimeout(returnToStartTimeout);

    console.log('Success | Start screen displayed and reset');
    console.groupEnd();
}

/**
 * Shows the game screen.
 */
function showGameScreen() {
    console.log('Info | Switching to game screen');
    startScreen.style.display = 'none';
    lobbyScreen.style.display = 'none';
    gameScreen.style.display  = 'block';
}

/**
 * Handles game mode selection and updates UI.
 *
 * @param {string} mode - The game mode selected by the player.
 */
function selectGameMode(mode) {
    console.log('Info | Game mode selected:', mode);
    selectedGameMode = mode;

    singleplayerOption.classList.toggle('selected', mode === 'singleplayer');
    multiplayerOption.classList.toggle('selected', mode === 'multiplayer');

    if (mode === 'singleplayer') {
        aiSelector.classList.add('visible');
        difficultySelector.classList.add('visible');
        multiplayerSetup.style.display = 'none';

        if (!document.querySelector('.ai-count-btn.selected')) selectAICount(2);
        if (!document.querySelector('.difficulty-btn.selected')) selectDifficulty('medium');
    } else {
        aiSelector.classList.remove('visible');
        difficultySelector.classList.remove('visible');
        selectedDifficulty = null;
        difficultyBtns.forEach(btn => btn.classList.remove('selected'));
        multiplayerSetup.style.display = 'flex';
    }

    updateStartButton();
}

/**
 * Sets AI count and updates UI.
 *
 * @param {number} count - The number of AI players selected.
 */
function selectAICount(count) {
    console.log('Info | AI count selected:', count);
    selectedAICount = count;

    aiCountBtns.forEach(btn => {
        btn.classList.toggle('selected', parseInt(btn.dataset.count) === count);
    });

    updateStartButton();
}

/**
 * Sets difficulty and updates UI.
 *
 * @param {string} difficulty - The difficulty level of the game.
 */
function selectDifficulty(difficulty) {
    console.log('Info | Difficulty selected:', difficulty);
    selectedDifficulty = difficulty;

    difficultyBtns.forEach(btn => {
        const btnDifficulty = btn.dataset.difficulty || btn.value;
        btn.classList.toggle('selected', btnDifficulty === difficulty);
    });

    updateStartButton();
}

/**
 * Enables or disables the start game button.
 */
function updateStartButton() {
    const readyForSingleplayer =
        selectedGameMode === 'singleplayer' &&
        selectedAICount > 0 &&
        !!selectedDifficulty;

    const isReady = readyForSingleplayer;
    startGameBtn.classList.toggle('enabled', isReady);
    startGameBtn.style.display = selectedGameMode === 'multiplayer' ? 'none' : '';
}

/**
 * Returns to start screen and clears timers.
 */
function returnToStartScreen() {
    console.log('Info | Returning to start screen');
    showStartScreen();
    statusMessage.textContent = '';
    clearInterval(timerInterval);
    clearTimeout(aiTypingTimeout);
    clearTimeout(returnToStartTimeout);
}

/**
 * Calculates timer duration for round with minimum 3 seconds.
 *
 * @param {number} round - The current round number.
 * @returns {number} The calculated timer duration in seconds.
 */
function getTimerForRound(round) {
    const reduction = Math.floor((round - 1) / 2) * 1;
    const timer = Math.max(3, baseTimer - reduction);
    console.log('Debug | Timer for round', round, ':', timer, 'seconds');
    return timer;
}

/**
 * Calculates AI difficulty multiplier based on round.
 *
 * @param {number} round - The current round number.
 * @returns {number} The calculated AI difficulty multiplier.
 */
function getAIDifficultyMultiplier(round) {
    let multiplier;
    if (round <= 2) multiplier = 1.0;
    else if (round <= 4) multiplier = 1.2;
    else if (round <= 6) multiplier = 1.5;
    else multiplier = 2.0;
    console.log('Debug | AI difficulty for round', round, ':', multiplier + 'x');
    return multiplier;
}

/**
 * Updates round display with number and timer.
 */
function updateRoundDisplay() {
    if (roundNumber) {
        roundNumber.textContent = currentRound;
    }

    console.log('Info | Round display updated:', currentRound);
}

/**
 * Updates the players count display.
 */
function updatePlayersCount() {
    const remainingPlayers = players.filter(p => !p.eliminated);

    if (playersCount) {
        playersCount.textContent = remainingPlayers.length;
    }

    console.log('Debug | Players remaining:', remainingPlayers.length);
}

/**
 * Renders players in circular layout.
 *
 * @param {Array} list - The list of player objects to render.
 */
function renderPlayers(list) {
    if (!playersCircle) return;

    console.log('Debug | Rendering players:', list.map(p => p.name));
    playersCircle.innerHTML = '';
    playersCircle.offsetHeight;

    const size   = playersCircle.offsetWidth;
    const radius = size / 2.5;
    const center = size / 2;

    list.forEach(function(player, index) {
        const angle = (index / list.length) * (2 * Math.PI) - Math.PI / 2;
        const x = center + radius * Math.cos(angle);
        const y = center + radius * Math.sin(angle);

        const li = document.createElement('li');
        li.textContent = player.name;
        li.style.left  = x + 'px';
        li.style.top   = y + 'px';

        const isActive = selectedGameMode === 'multiplayer'
            ? player.id === multiCurrentPlayerId
            : index === currentPlayerIndex && !player.eliminated;

        if (isActive && !player.eliminated) li.classList.add('active');
        if (player.eliminated) li.classList.add('eliminated');

        if (!player.isAI) {
            li.classList.add('self');
        }

        playersCircle.appendChild(li);
    });
}

/**
 * Starts the round timer and handles expiration.
 */
function startTimer() {
    console.log('Info | Starting timer for round', currentRound);
    clearInterval(timerInterval);
    timeRemaining = getTimerForRound(currentRound);
    updateTimer();

    timerInterval = setInterval(function() {
        timeRemaining -= 0.1;

        if (timeRemaining <= 0) {
            console.log('Warning | Timer expired!');
            clearInterval(timerInterval);
            explode();
        }

        updateTimer();
    }, 100);
}

/**
 * Updates timer display and applies warning style.
 */
function updateTimer() {
    if (!timerElement) return;
    if (timeRemaining < 0) timeRemaining = 0;

    timerElement.textContent = timeRemaining.toFixed(1);

    if (timeRemaining <= 3) {
        timerElement.classList.add('warning');
    } else {
        timerElement.classList.remove('warning');
    }
}

/**
 * Handles the explosion event when a player fails to type the word in time, eliminating the player, updating the game state, and determining if the game has been won or should continue to the next round.
 */
function explode() {
    console.group('Info | Player eliminated!');
    gameActive = false;
    clearTimeout(aiTypingTimeout);
    clearInterval(timerInterval);

    const currentPlayer = players[currentPlayerIndex];
    console.log('Info | Player eliminated:', currentPlayer.name);
    statusMessage.textContent = `Boom! ${currentPlayer.name} lost.`;
    currentPlayer.eliminated = true;

    wordInput.disabled = true;
    wordInput.value = '';
    wordInput.style.opacity = '1';
    wordInput.placeholder = 'Type here...';

    renderPlayers(players);
    updatePlayersCount();

    const remainingPlayers = players.filter(p => !p.eliminated);
    console.log('Info | Remaining players:', remainingPlayers.length);

    if (remainingPlayers.length <= 1) {
        const winner = remainingPlayers[0];
        const winnerText = winner ? (winner.name === 'You' ? 'You won the game!' : `${winner.name} wins the game!`) : "Game over!";
        statusMessage.textContent = winnerText;

        console.log('Success | Game completed. Winner:', winner?.name || 'None');
        console.groupEnd();

        returnToStartTimeout = setTimeout(() => {
            returnToStartScreen();
        }, 5000);
    } else {
        if (!currentPlayer.isAI) {
            console.log('Info | Player eliminated - ending game and returning to homepage');

            statusMessage.textContent = `Boom! You lost. Returning to home...`;

            gameActive = false;
            clearInterval(timerInterval);

            clearTimeout(aiTypingTimeout);
            clearTimeout(returnToStartTimeout);
            clearTimeout(gameFlowTimeout);
            clearTimeout(roundTransitionTimeout);
            clearTimeout(uiRefreshTimeout);

            returnToStartTimeout = setTimeout(() => {
                returnToStartScreen();
            }, 3000);

            console.groupEnd();
            return;
        }

        console.log('Info | Continuing game with remaining players');
        console.groupEnd();

        clearTimeout(gameFlowTimeout);
        gameFlowTimeout = setTimeout(async function() {
            gameActive = true;
            statusMessage.textContent = '';

            let nextPlayerIndex = currentPlayerIndex;
            nextPlayerIndex = (nextPlayerIndex + 1) % players.length;
            while (players[nextPlayerIndex].eliminated) {
                nextPlayerIndex = (nextPlayerIndex + 1) % players.length;
            }

            currentPlayerIndex = nextPlayerIndex;
            currentRound++;
            playersCompletedThisRound = 0;
            updateRoundDisplay();

            clearTimeout(roundTransitionTimeout);
            roundTransitionTimeout = setTimeout(async function() {
                if (gameActive) {
                    currentWord = await getRandomWord();
                    updateWordDisplay('');

                    const currentPlayer = players[currentPlayerIndex];
                    if (currentPlayer.isAI) {
                        statusMessage.textContent = '';
                        wordInput.disabled = true;
                        wordInput.value = '';
                        wordInput.style.opacity = '0.5';
                        wordInput.placeholder = `${currentPlayer.name} is typing...`;
                        startTimer();
                        startAITurn();
                    } else {
                        statusMessage.textContent = '';
                        wordInput.disabled = false;
                        wordInput.style.opacity = '1';
                        wordInput.placeholder = 'Type here...';
                        wordInput.value = '';
                        wordInput.focus();
                        updateWordDisplay('');
                        startTimer();
                    }
                }
            }, 1500);
        }, 2000);
    }
}

/**
 * Passes bomb to next player and updates UI.
 */
function passBomb() {
    console.group('Debug | Passing bomb');

    let nextPlayerIndex = currentPlayerIndex;
    nextPlayerIndex = (nextPlayerIndex + 1) % players.length;
    while (players[nextPlayerIndex].eliminated && nextPlayerIndex !== currentPlayerIndex) {
        nextPlayerIndex = (nextPlayerIndex + 1) % players.length;
    }

    currentPlayerIndex = nextPlayerIndex;
    const currentPlayer = players[currentPlayerIndex];
    console.log('Info | Bomb passed to:', currentPlayer.name, 'isAI:', currentPlayer.isAI);
    renderPlayers(players);

    if (currentPlayer.isAI) {
        statusMessage.textContent = '';
        wordInput.disabled = true;
        wordInput.value = '';
        wordInput.style.opacity = '0.5';
        wordInput.placeholder = `${currentPlayer.name} is typing...`;
        startAITurn();
    } else {
        statusMessage.textContent = '';
        wordInput.disabled = false;
        wordInput.style.opacity = '1';
        wordInput.placeholder = 'Type here...';
        wordInput.value = '';
        wordInput.focus();
        updateWordDisplay('');
    }

    console.groupEnd();
}

/**
 * Calculates estimated AI typing time for current word.
 *
 * @return {number} The estimated time in milliseconds for the AI to type the current word.
 */
function simulateAITyping() {
    const currentPlayer = players[currentPlayerIndex];
    const wordLength = currentWord.length;
    const baseDelay = 80 + Math.random() * 120;
    const mistakeProbability = Math.min(0.25, 0.05 + (wordLength - 3) * 0.03);
    let totalTime = wordLength * baseDelay;
    for (let i = 0; i < wordLength; i++) {
        if (Math.random() < mistakeProbability) {
            totalTime += 300 + Math.random() * 500;
        }
    }
    totalTime *= 0.8 + Math.random() * 0.4;
    const finalTime = Math.max(1000, Math.min(totalTime, timeRemaining * 800));
    console.log('Debug | AI typing simulation for', currentPlayer.name, '- estimated time:', Math.round(finalTime), 'ms');
    return finalTime;
}

/**
 * Animates AI typing with realistic timing and mistakes.
 */
function animateAITyping() {
    if (!gameActive || !players[currentPlayerIndex].isAI) {
        console.log('Error | animateAITyping called for non-AI player');
        return;
    }

    console.group('Debug | AI typing animation');
    console.log('Info | AI player:', players[currentPlayerIndex].name, 'typing word:', currentWord);

    let currentInput = '';
    let charIndex = 0;
    const wordLength = currentWord.length;

    // Use selectedDifficulty to set AI mistake probability
    let difficultyMultiplier = 1.0;
    let adjustedMistakeProbability = 0.1;
    if (selectedDifficulty === 'easy') {
        difficultyMultiplier = 1.5;
        adjustedMistakeProbability = 0.25;
    } else if (selectedDifficulty === 'medium') {
        difficultyMultiplier = 1.0;
        adjustedMistakeProbability = 0.15;
    } else if (selectedDifficulty === 'hard') {
        difficultyMultiplier = 0.7;
        adjustedMistakeProbability = 0.05;
    }

    /**
     * Types the next character for the AI, handling mistakes and corrections.
     */
    function typeNextChar() {
        if (!gameActive || charIndex >= wordLength || players[currentPlayerIndex].eliminated) {
            if (gameActive && players[currentPlayerIndex].isAI && !players[currentPlayerIndex].eliminated) {
                const currentPlayer = players[currentPlayerIndex];
                console.log('Success | AI completed word:', currentPlayer.name);
                console.groupEnd();
                aiCompletedWord = true;
                playersCompletedThisRound++;

                const remainingPlayers = players.filter(p => !p.eliminated);
                const allPlayersCompleted = playersCompletedThisRound >= remainingPlayers.length;

                if (allPlayersCompleted) {
                    statusMessage.textContent = `${currentPlayer.name} typed correctly! Round ${currentRound} complete!`;
                    playersCompletedThisRound = 0;
                    currentRound++;
                    updateRoundDisplay();
                } else {
                    statusMessage.textContent = `${currentPlayer.name} typed correctly! Bomb passed.`;
                }

                clearInterval(timerInterval);
                setTimeout(function() {
                    if (gameActive) {
                        setTimeout(function() {
                            if (gameActive) {
                                aiCompletedWord = false;
                                startTimer();
                                getNewWordAndPassBomb();
                            }
                        }, 1500);
                    }
                }, 1000);
            }
            return;
        }

        if (!gameActive || !players[currentPlayerIndex].isAI || players[currentPlayerIndex].eliminated) {
            console.log('Warning | AI typing interrupted');
            console.groupEnd();
            return;
        }

        const correctChar = currentWord[charIndex];
        let typedChar = correctChar;
        let baseDelay = 80 + Math.random() * 120;
        let delay = baseDelay * difficultyMultiplier;

        if (Math.random() < adjustedMistakeProbability) {
            const wrongChars = 'abcdefghijklmnopqrstuvwxyz'.replace(correctChar, '');
            typedChar = wrongChars[Math.floor(Math.random() * wrongChars.length)];
            currentInput += typedChar;
            updateWordDisplay(currentInput);

            const mistakeDelay = (200 + Math.random() * 300) * difficultyMultiplier;
            aiTypingTimeout = setTimeout(function() {
                if (!gameActive || !players[currentPlayerIndex].isAI) return;
                currentInput = currentInput.slice(0, -1);
                updateWordDisplay(currentInput);

                const correctionDelay = (100 + Math.random() * 200) * difficultyMultiplier;
                aiTypingTimeout = setTimeout(function() {
                    if (!gameActive || !players[currentPlayerIndex].isAI) return;
                    currentInput += correctChar;
                    updateWordDisplay(currentInput);
                    charIndex++;
                    aiTypingTimeout = setTimeout(typeNextChar, 50 + Math.random() * 100);
                }, correctionDelay);
            }, mistakeDelay);
            return;
        }

        currentInput += typedChar;
        updateWordDisplay(currentInput);
        charIndex++;
        aiTypingTimeout = setTimeout(typeNextChar, delay);
    }

    typeNextChar();
}

/**
 * Starts AI turn with UI updates.
 */
function startAITurn() {
    if (!gameActive || !players[currentPlayerIndex].isAI) {
        console.log('Warning | startAITurn called but conditions not met');
        return;
    }

    console.log('Info | Starting AI turn for:', players[currentPlayerIndex].name);

    wordInput.style.opacity = '0.5';
    wordInput.placeholder = `${players[currentPlayerIndex].name} is typing...`;

    updateWordDisplay('');
    animateAITyping();
}

/**
 * Gets new word and passes bomb to next player.
 */
async function getNewWordAndPassBomb() {
    console.log('Debug | Getting new word and passing bomb');
    currentWord = await getRandomWord();
    updateWordDisplay('');
    passBomb();
}

/**
 * Sets new random word and updates display.
 */
async function setNewWord() {
    console.log('Debug | Setting new word');
    currentWord = await getRandomWord();
    updateWordDisplay('');
}

/**
 * Updates word display with input comparison and handles singleplayer completion.
 *
 * @param {string} input - The current input from the player to compare against the current word.
 */
function updateWordDisplay(input) {
    if (!wordDisplay) return;

    wordDisplay.innerHTML = '';

    const word = selectedGameMode === 'multiplayer' ? multiCurrentWord : currentWord;

    for (let i = 0; i < word.length; i++) {
        const span = document.createElement('span');
        const inputChar = input[i];
        const correctChar = word[i];

        span.textContent = correctChar;

        if (inputChar) {
            if (inputChar === correctChar) {
                span.classList.add('correct');
            } else {
                span.classList.add('incorrect');
            }
        } else if (i === input.length) {
            span.classList.add('current');
        }

        wordDisplay.appendChild(span);
    }

    if (selectedGameMode !== 'multiplayer' && input === currentWord && currentWord.length > 0 && gameActive && !aiCompletedWord) {
        const currentPlayer = players[currentPlayerIndex];
        console.log('Success | Word completed by:', currentPlayer.name, 'isAI:', currentPlayer.isAI);

        if (!currentPlayer.isAI) {
            playersCompletedThisRound++;
            const remainingPlayers = players.filter(p => !p.eliminated);
            const allPlayersCompleted = playersCompletedThisRound >= remainingPlayers.length;

            if (allPlayersCompleted) {
                statusMessage.textContent = `${currentPlayer.name} typed correctly! Round ${currentRound} complete!`;
                playersCompletedThisRound = 0;
                currentRound++;
                updateRoundDisplay();
            } else {
                statusMessage.textContent = `${currentPlayer.name} typed correctly! Bomb passed.`;
            }

            clearInterval(timerInterval);

            setTimeout(function() {
                if (gameActive) {
                    setTimeout(function() {
                        if (gameActive) {
                            startTimer();
                            getNewWordAndPassBomb();
                        }
                    }, 1500);
                }
            }, 1000);
        }
    }
}

/**
 * Starts new singleplayer game with selected options and initializes state.
 */
async function startGame() {
    console.group('Info | Starting new game');

    if (selectedGameMode !== 'singleplayer') {
        console.log('Error | No valid game mode selected');
        console.groupEnd();
        return;
    }

    if (!selectedDifficulty) {
        console.log('Error | No difficulty selected');
        statusMessage.textContent = 'Please select a difficulty before starting.';
        console.groupEnd();
        return;
    }

    createPlayersArray(selectedAICount);
    gameActive = true;
    currentPlayerIndex = 0;
    currentRound = 1;
    playersCompletedThisRound = 0;

    console.log('Info | Game started with:', players.length, 'players');
    console.log('Info | Starting player:', players[currentPlayerIndex].name);

    showGameScreen();
    clearTimeout(aiTypingTimeout);
    clearInterval(timerInterval);
    clearTimeout(returnToStartTimeout);

    players.forEach(player => {
        player.eliminated = false;
    });

    updateRoundDisplay();
    updatePlayersCount();

    wordInput.disabled = false;
    wordInput.value = '';
    wordInput.style.opacity = '1';
    wordInput.placeholder = 'Type here...';

    renderPlayers(players);

    currentWord = await getRandomWord();
    updateWordDisplay('');

    statusMessage.textContent = '';

    wordInput.focus();
    startTimer();

    console.groupEnd();
}

/**
 * Resets game state and returns to start screen.
 */
function resetGame() {
    console.log('Info | Resetting game');
    gameActive = false;

    clearInterval(timerInterval);
    clearTimeout(aiTypingTimeout);
    clearTimeout(returnToStartTimeout);

    currentPlayerIndex = 0;
    currentRound = 1;
    playersCompletedThisRound = 0;
    timeRemaining = getTimerForRound(1);
    updateTimer();

    wordInput.disabled = true;
    wordInput.value = '';
    wordInput.style.opacity = '1';
    wordInput.placeholder = 'Type here...';
    wordDisplay.innerHTML = '';

    if (players.length > 0) {
        players.forEach(player => {
            player.eliminated = false;
        });

        if (roundNumber) roundNumber.textContent = '1';
        updatePlayersCount();
        playersCircle.innerHTML = '';
    }

    returnToStartScreen();
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
        statusMessage.textContent = 'Disconnected from server. Returning to menu...';
        setTimeout(() => {
            resetMultiplayerState();
            returnToStartScreen();
        }, 3000);
    } else if (lobbyScreen.style.display !== 'none') {
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
    multiCurrentWord     = '';
    multiCurrentPlayerId = null;
    lastSubmittedInput   = '';
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

        case 'word_complete':
            onWordComplete(msg);
            break;

        case 'round_complete':
            onRoundComplete(msg);
            break;

        case 'player_eliminated':
            onPlayerEliminated(msg);
            break;

        case 'game_over':
            onGameOver(msg);
            break;

        case 'typing_update':
            onTypingUpdate(msg);
            break;

        case 'timer_tick':
            onTimerTick(msg);
            break;

        case 'player_left':
            onPlayerLeft(msg);
            break;

        case 'next_round':
            onNextRound(msg);
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
    startMultiBtn.style.display = 'block';
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
    startMultiBtn.style.display = isHost ? 'block' : 'none';
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
    startMultiBtn.style.display = isHost ? 'block' : 'none';

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
    lobbyScreen.style.display = 'flex';

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
        multiStatusMsg.textContent = text;
        multiStatusMsg.style.display = text ? 'block' : 'none';
    }

    if (lobbyStatusMsg) {
        lobbyStatusMsg.textContent = text;
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

    if (roundNumber) roundNumber.textContent = msg.round;
    if (playersCount) playersCount.textContent = players.filter(p => !p.eliminated).length;

    statusMessage.textContent = 'Game starting...';
    wordInput.disabled        = true;
    wordInput.value           = '';
    wordDisplay.innerHTML     = '';
}

/**
 * Called when it is a new player's turn to type.
 * Enables input only for the active player; others watch.
 *
 * @param {Object} msg - Server message with currentPlayerId, word, round, and timer.
 */
function onTurnStart(msg) {
    console.log('Info | Turn start - current player:', msg.currentPlayerId, 'word:', msg.word);

    multiCurrentWord     = msg.word;
    multiCurrentPlayerId = msg.currentPlayerId;
    players              = msg.players;
    lastSubmittedInput   = '';

    if (roundNumber) roundNumber.textContent = msg.round;
    if (playersCount) playersCount.textContent = msg.playersRemaining;

    timeRemaining = msg.timerSeconds;
    updateTimer();
    renderPlayers(players);
    updateWordDisplay('');

    const isMyTurn = msg.currentPlayerId === myPlayerId;

    if (isMyTurn) {
        wordInput.disabled      = false;
        wordInput.style.opacity = '1';
        wordInput.placeholder   = 'Type here...';
        wordInput.value         = '';
        wordInput.focus();
        statusMessage.textContent = '';
    } else {
        const currentPlayerData = players.find(p => p.id === msg.currentPlayerId);
        wordInput.disabled      = true;
        wordInput.style.opacity = '0.5';
        wordInput.placeholder   = currentPlayerData
            ? `${currentPlayerData.name} is typing...`
            : 'Waiting...';
        wordInput.value = '';
        statusMessage.textContent = '';
    }
}

/**
 * Called when a player completes the word.
 * Updates status; the server will follow up with a turn_start.
 *
 * @param {Object} msg - Server message with completedBy name.
 */
function onWordComplete(msg) {
    console.log('Info | Word complete by:', msg.completedBy);
    players = msg.players;
    renderPlayers(players);
    statusMessage.textContent = `${msg.completedBy} typed correctly! Passing bomb...`;
    wordInput.disabled = true;
    wordInput.value    = '';
}

/**
 * Called when all players have completed the word in a round.
 * Updates the round counter and status message.
 *
 * @param {Object} msg - Server message with new round number.
 */
function onRoundComplete(msg) {
    console.log('Info | Round complete. New round:', msg.round);
    if (roundNumber) roundNumber.textContent = msg.round;
    statusMessage.textContent = `Round complete! Round ${msg.round} starting...`;
}

/**
 * Called when any player is eliminated by the timer.
 * Marks the player eliminated in the local list and re-renders.
 *
 * @param {Object} msg - Server message with eliminatedId and player list.
 */
function onPlayerEliminated(msg) {
    console.log('Info | Player eliminated:', msg.eliminatedName);
    players = msg.players;

    renderPlayers(players);
    if (playersCount) playersCount.textContent = msg.playersRemaining;

    if (msg.eliminatedId === myPlayerId) {
        wordInput.disabled = true;
        wordInput.value    = '';
        statusMessage.textContent = 'Boom! You were eliminated!';
    } else {
        statusMessage.textContent = msg.reason === 'disconnected'
            ? `${msg.eliminatedName} disconnected and was eliminated.`
            : `Boom! ${msg.eliminatedName} was eliminated.`;
    }
}

/**
 * Called at the start of a new server-side round after an elimination.
 *
 * @param {Object} msg - Server message with round, timer, and playersRemaining.
 */
function onNextRound(msg) {
    console.log('Info | Next round:', msg.round);
    if (roundNumber) roundNumber.textContent = msg.round;
    if (playersCount) playersCount.textContent = msg.playersRemaining;
    statusMessage.textContent = `${msg.playersRemaining} players remaining. Round ${msg.round} starting...`;
}

/**
 * Called when the game ends with a winner.
 * Shows result and returns to start screen after a delay.
 *
 * @param {Object} msg - Server message with winnerId and winnerName.
 */
function onGameOver(msg) {
    console.log('Info | Game over - winner:', msg.winnerName);

    wordInput.disabled = true;
    wordInput.value    = '';

    let text;
    if (!msg.winnerId) {
        text = 'Game over!';
    } else if (msg.winnerId === myPlayerId) {
        text = 'You won the game!';
    } else {
        text = `${msg.winnerName} wins the game!`;
    }

    if (msg.reason) text += ` (${msg.reason})`;
    statusMessage.textContent = text;

    setTimeout(() => {
        resetMultiplayerState();
        returnToStartScreen();
    }, 5000);
}

/**
 * Called when a non-active player's typing update is received.
 * Shows their partial progress on the word display for spectators.
 *
 * @param {Object} msg - Server message with playerId and partial input.
 */
function onTypingUpdate(msg) {
    if (msg.playerId !== multiCurrentPlayerId) return;
    if (msg.playerId === myPlayerId) return;

    updateWordDisplay(msg.input || '');
}

/**
 * Called every 100ms with the authoritative server time remaining.
 * Updates the local timer display without running a local interval.
 *
 * @param {Object} msg - Server message with timeRemaining value.
 */
function onTimerTick(msg) {
    timeRemaining = msg.timeRemaining;
    updateTimer();
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
    renderPlayers(players);

    if (msg.newHostId === myPlayerId && !isHost) {
        isHost = true;
        console.log('Info | Host role migrated to this client');
    }

    statusMessage.textContent = `${msg.playerName} left the game.`;
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
        setMultiStatus('Could not connect to server. Is server.js running?');
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
    returnToStartScreen();
}

if (wordInput) {
    wordInput.addEventListener('input', function() {
        if (selectedGameMode !== 'multiplayer') {
            if (!gameActive || players.length === 0 || players[currentPlayerIndex].isAI || wordInput.disabled) {
                wordInput.value = '';
                return;
            }
            const value = wordInput.value;
            if (value.length > currentWord.length) {
                wordInput.value = value.slice(0, currentWord.length);
            }
            updateWordDisplay(wordInput.value);
            return;
        }

        if (wordInput.disabled) return;

        const value = wordInput.value;

        if (value.length > multiCurrentWord.length) {
            wordInput.value = value.slice(0, multiCurrentWord.length);
        }

        updateWordDisplay(wordInput.value);

        wsSend({ type: 'typing_update', input: wordInput.value });

        if (wordInput.value === multiCurrentWord && wordInput.value !== lastSubmittedInput) {
            lastSubmittedInput = wordInput.value;
            console.log('Info | Submitting completed word:', wordInput.value);
            wsSend({ type: 'submit_word', word: wordInput.value });
            wordInput.disabled = true;
        }
    });
}

if (singleplayerOption) {
    singleplayerOption.addEventListener('click', () => selectGameMode('singleplayer'));
    singleplayerOption.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            selectGameMode('singleplayer');
        }
    });
}

if (multiplayerOption) {
    multiplayerOption.addEventListener('click', () => selectGameMode('multiplayer'));
    multiplayerOption.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            selectGameMode('multiplayer');
        }
    });
}

aiCountBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        const count = parseInt(btn.dataset.count);
        selectAICount(count);
    });
});

difficultyBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        const difficulty = btn.dataset.difficulty || btn.value;
        selectDifficulty(difficulty);
    });
});

if (startGameBtn) {
    startGameBtn.addEventListener('click', startGame);
}

if (leaveGameBtn) {
    leaveGameBtn.addEventListener('click', () => {
        if (selectedGameMode === 'multiplayer') {
            handleLeaveMultiplayerGame();
        } else {
            resetGame();
        }
    });
}

if (createSessionBtn) createSessionBtn.addEventListener('click', handleCreateSession);
if (joinSessionBtn)   joinSessionBtn.addEventListener('click', handleJoinSession);
if (startMultiBtn)    startMultiBtn.addEventListener('click', handleStartMultiplayer);
if (leaveLobbyBtn)    leaveLobbyBtn.addEventListener('click', handleLeaveLobby);

if (sessionCodeInput) {
    sessionCodeInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleJoinSession();
    });
}

showStartScreen();

/**
 * Re-renders players on window resize.
 */
let resizeTimeout;
window.addEventListener('resize', function() {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(function() {
        if (gameActive || selectedGameMode === 'multiplayer' || players.some(p => p.eliminated)) {
            console.log('Debug | Window resized, re-rendering players');
            renderPlayers(players);
        }
    }, 100);
});
