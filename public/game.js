// Chess Multiplayer Client - Fixed for chess.js 0.13.4
const socket = io();

let chess = new Chess();
let myColor = null;
let gameId = null;
let selectedSquare = null;
let validMoves = [];
let boardOrientation = 'white';
let pendingPromotion = null;
let myTurn = false;

// DOM Elements
const screens = {
    landing: document.getElementById('landingScreen'),
    game: document.getElementById('gameScreen')
};

const landingElements = {
    findMatchBtn: document.getElementById('findMatchBtn'),
    playLocalBtn: document.getElementById('playLocalBtn'),
    matchmakingStatus: document.getElementById('matchmakingStatus'),
    cancelMatchBtn: document.getElementById('cancelMatchBtn'),
    onlineCount: document.getElementById('onlineCount')
};

const gameElements = {
    board: document.getElementById('chessBoard'),
    promotionModal: document.getElementById('promotionModal'),
    gameStatus: document.getElementById('gameStatus'),
    opponentName: document.getElementById('opponentName'),
    myName: document.getElementById('myName'),
    moveList: document.getElementById('moveList'),
    offerDrawBtn: document.getElementById('offerDrawBtn'),
    resignBtn: document.getElementById('resignBtn'),
    chatMessages: document.getElementById('chatMessages'),
    chatInput: document.getElementById('chatInput'),
    sendChatBtn: document.getElementById('sendChatBtn')
};

const modals = {
    gameOver: document.getElementById('gameOverModal'),
    gameOverTitle: document.getElementById('gameOverTitle'),
    gameOverMessage: document.getElementById('gameOverMessage'),
    playAgainBtn: document.getElementById('playAgainBtn'),
    backToMenuBtn: document.getElementById('backToMenuBtn'),
    drawOffer: document.getElementById('drawOfferModal'),
    acceptDrawBtn: document.getElementById('acceptDrawBtn'),
    declineDrawBtn: document.getElementById('declineDrawBtn')
};

// Piece Unicode - chess.js 0.13.4 uses lowercase type
const PIECES = {
    'wk': '♔', 'wq': '♕', 'wr': '♖', 'wb': '♗', 'wn': '♘', 'wp': '♙',
    'bk': '♚', 'bq': '♛', 'br': '♜', 'bb': '♝', 'bn': '♞', 'bp': '♟'
};

// Initialize
function init() {
    setupEventListeners();
    renderBoard();
    updateOnlineCount();
    setInterval(updateOnlineCount, 30000);
}

function setupEventListeners() {
    landingElements.findMatchBtn.addEventListener('click', () => findMatch());
    landingElements.playLocalBtn.addEventListener('click', () => startLocalGame());
    landingElements.cancelMatchBtn.addEventListener('click', () => cancelMatchmaking());

    gameElements.offerDrawBtn.addEventListener('click', () => offerDraw());
    gameElements.resignBtn.addEventListener('click', () => resign());
    gameElements.sendChatBtn.addEventListener('click', () => sendChat());
    gameElements.chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendChat();
    });

    modals.playAgainBtn.addEventListener('click', () => playAgain());
    modals.backToMenuBtn.addEventListener('click', () => backToMenu());
    modals.acceptDrawBtn.addEventListener('click', () => acceptDraw());
    modals.declineDrawBtn.addEventListener('click', () => declineDraw());

    document.querySelectorAll('.promotion-options button').forEach(btn => {
        btn.addEventListener('click', () => handlePromotion(btn.dataset.piece));
    });

    socket.on('connect', () => console.log('Connected to server'));
    socket.on('disconnect', () => console.log('Disconnected from server'));
    socket.on('waiting', handleWaiting);
    socket.on('gameFound', handleGameFound);
    socket.on('moveMade', handleMoveMade);
    socket.on('illegalMove', handleIllegalMove);
    socket.on('gameEnd', handleGameEnd);
    socket.on('drawOffered', handleDrawOffered);
    socket.on('drawDeclined', handleDrawDeclined);
    socket.on('error', handleError);
    socket.on('onlineCount', updateOnlineCountDisplay);
}

function showScreen(screenName) {
    Object.values(screens).forEach(s => s.classList.remove('active'));
    screens[screenName].classList.add('active');
}

// ============ MATCHMAKING ============
function findMatch() {
    landingElements.findMatchBtn.classList.add('hidden');
    landingElements.playLocalBtn.classList.add('hidden');
    landingElements.matchmakingStatus.classList.remove('hidden');
    socket.emit('findMatch');
}

function cancelMatchmaking() {
    socket.emit('cancelMatchmaking');
    landingElements.matchmakingStatus.classList.add('hidden');
    landingElements.findMatchBtn.classList.remove('hidden');
    landingElements.playLocalBtn.classList.remove('hidden');
}

function handleWaiting(data) {
    console.log(data.message);
}

function handleGameFound(data) {
    gameId = data.gameId;
    myColor = data.color;
    boardOrientation = myColor;
    myTurn = (myColor === 'w');

    showScreen('game');
    chess = new Chess(data.fen);
    renderBoard();
    updateGameStatus();

    gameElements.opponentName.textContent = 'Opponent';
    gameElements.myName.textContent = 'You (' + (myColor === 'w' ? 'White' : 'Black') + ')';
}

function startLocalGame() {
    gameId = 'local-' + Date.now();
    myColor = 'w';
    boardOrientation = 'white';
    myTurn = true;

    showScreen('game');
    chess = new Chess();
    renderBoard();
    updateGameStatus();

    gameElements.opponentName.textContent = 'Player 2 (Black)';
    gameElements.myName.textContent = 'Player 1 (White)';
    window.localGame = true;
}

function updateOnlineCount() {
    socket.emit('getOnlineCount');
}

function updateOnlineCountDisplay(count) {
    landingElements.onlineCount.textContent = `${count} player${count !== 1 ? 's' : ''} online`;
}

// ============ BOARD RENDERING ============
function renderBoard() {
    const board = gameElements.board;
    board.innerHTML = '';

    for (let rank = 7; rank >= 0; rank--) {
        for (let file = 0; file < 8; file++) {
            const square = document.createElement('div');
            const algebraic = String.fromCharCode(97 + file) + (rank + 1);

            square.className = `square ${(file + rank) % 2 === 0 ? 'white' : 'black'}`;
            square.dataset.square = algebraic;

            // Add piece - chess.js 0.13.4 get() returns {type, color} with lowercase type
            const piece = chess.get(algebraic);
            if (piece) {
                const pieceEl = document.createElement('span');
                pieceEl.className = 'piece';
                pieceEl.textContent = PIECES[piece.color + piece.type];
                pieceEl.draggable = true;
                pieceEl.dataset.piece = piece.color + piece.type;
                pieceEl.dataset.square = algebraic;
                square.appendChild(pieceEl);
            }

            if (algebraic === selectedSquare) {
                square.classList.add('selected');
            }

            if (validMoves.includes(algebraic)) {
                const dot = document.createElement('div');
                dot.className = 'valid-move';
                square.appendChild(dot);
            }

            const history = chess.history({ verbose: true });
            if (history.length > 0) {
                const lastMove = history[history.length - 1];
                if (lastMove.from === algebraic || lastMove.to === algebraic) {
                    square.classList.add('last-move');
                }
            }

            if (chess.in_check() && piece && piece.type === 'k' && piece.color === chess.turn()) {
                square.classList.add('check');
            }

            square.addEventListener('dragover', handleDragOver);
            square.addEventListener('drop', handleDrop);
            square.addEventListener('dragleave', handleDragLeave);
            square.addEventListener('click', () => handleSquareClick(algebraic));

            board.appendChild(square);
        }
    }

    addBoardLabels();

    document.querySelectorAll('.piece').forEach(piece => {
        piece.addEventListener('dragstart', handleDragStart);
        piece.addEventListener('dragend', handleDragEnd);
    });
}

function addBoardLabels() {
    const board = gameElements.board;
    const files = boardOrientation === 'white' ? 'abcdefgh' : 'hgfedcba';
    const ranks = boardOrientation === 'white' ? '87654321' : '12345678';

    files.split('').forEach((file, i) => {
        const label = document.createElement('div');
        label.className = 'file-label';
        label.textContent = file;
        label.style.cssText = `position:absolute;bottom:-20px;left:${i/8*100+50/8}%;font-size:0.7rem;color:var(--text-secondary);pointer-events:none;`;
        board.style.position = 'relative';
        board.appendChild(label);
    });

    ranks.split('').forEach((rank, i) => {
        const label = document.createElement('div');
        label.className = 'rank-label';
        label.textContent = rank;
        label.style.cssText = `position:absolute;left:-20px;top:${i/8*100+50/8}%;font-size:0.7rem;color:var(--text-secondary);pointer-events:none;`;
        board.appendChild(label);
    });
}

// ============ DRAG AND DROP ============
function handleDragStart(e) {
    const square = e.target.dataset.square;
    const piece = e.target.dataset.piece;

    const pieceColor = piece[0];
    if ((myColor === 'w' && pieceColor !== 'w') || (myColor === 'b' && pieceColor !== 'b')) {
        e.preventDefault();
        return;
    }
    if (!myTurn && !window.localGame) {
        e.preventDefault();
        return;
    }

    e.target.classList.add('dragging');
    selectedSquare = square;
    validMoves = getValidMoves(square);
    renderBoard();

    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', square);
}

function handleDragEnd(e) {
    e.target.classList.remove('dragging');
}

function handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const square = e.currentTarget;
    if (!square.classList.contains('selected') && validMoves.includes(square.dataset.square)) {
        square.style.opacity = '0.7';
    }
}

function handleDragLeave(e) {
    e.currentTarget.style.opacity = '';
}

function handleDrop(e) {
    e.preventDefault();
    e.currentTarget.style.opacity = '';

    const fromSquare = e.dataTransfer.getData('text/plain');
    const toSquare = e.currentTarget.dataset.square;

    if (fromSquare && toSquare && fromSquare !== toSquare) {
        attemptMove(fromSquare, toSquare);
    }
}

function handleSquareClick(square) {
    if (!myTurn && !window.localGame) return;

    const piece = chess.get(square);

    if (selectedSquare === square) {
        selectedSquare = null;
        validMoves = [];
    } else if (piece && ((myColor === 'w' && piece.color === 'w') || (myColor === 'b' && piece.color === 'b'))) {
        selectedSquare = square;
        validMoves = getValidMoves(square);
    } else if (selectedSquare && validMoves.includes(square)) {
        attemptMove(selectedSquare, square);
    } else {
        selectedSquare = null;
        validMoves = [];
    }

    renderBoard();
}

function getValidMoves(square) {
    const moves = chess.moves({ square, verbose: true });
    return moves.map(m => m.to);
}

function attemptMove(from, to) {
    const piece = chess.get(from);
    const rank = to[1];
    const isPromotion = piece && piece.type === 'p' && ((piece.color === 'w' && rank === '8') || (piece.color === 'b' && rank === '1'));

    if (isPromotion) {
        pendingPromotion = { from, to };
        showPromotionModal(from, to);
        return;
    }

    makeMove(from, to);
}

function showPromotionModal(from, to) {
    const modal = gameElements.promotionModal;
    const fromSquare = document.querySelector(`[data-square="${from}"]`);
    const boardRect = gameElements.board.getBoundingClientRect();
    const squareRect = fromSquare.getBoundingClientRect();

    modal.style.left = `${squareRect.left - boardRect.left}px`;
    modal.style.top = `${squareRect.top - boardRect.top - 220}px`;
    modal.classList.remove('hidden');
}

function handlePromotion(piece) {
    if (!pendingPromotion) return;

    const { from, to } = pendingPromotion;
    pendingPromotion = null;
    gameElements.promotionModal.classList.add('hidden');

    makeMove(from, to, piece);
}

function makeMove(from, to, promotion = 'q') {
    const move = { from, to, promotion };

    if (window.localGame) {
        tryMoveLocally(move);
    } else {
        socket.emit('makeMove', { gameId, move });
    }
}

function tryMoveLocally(move) {
    // chess.js 0.13.4 uses .move() with object or SAN string
    const result = chess.move(move);
    if (!result) {
        showIllegalMove('Illegal move');
        return;
    }

    myTurn = !myTurn;
    renderBoard();
    updateMoveHistory();
    updateGameStatus();
    checkGameEnd();
}

function handleMoveMade(data) {
    chess.load(data.fen);
    myTurn = (chess.turn() === (myColor === 'w' ? 'w' : 'b'));

    renderBoard();
    updateMoveHistory();
    updateGameStatus();

    if (data.gameOver) {
        handleGameEndLocally(data.result);
    }
}

function handleIllegalMove(data) {
    showIllegalMove(data.message);
    selectedSquare = null;
    validMoves = [];
    renderBoard();
}

function showIllegalMove(message) {
    gameElements.gameStatus.textContent = message;
    gameElements.gameStatus.style.color = '#e74c3c';
    setTimeout(() => updateGameStatus(), 1500);
}

// ============ GAME STATE ============
function updateGameStatus() {
    if (chess.game_over()) return;

    if (myTurn) {
        gameElements.gameStatus.textContent = 'Your turn';
        gameElements.gameStatus.style.color = '#4ecdc4';
    } else {
        gameElements.gameStatus.textContent = "Opponent's turn";
        gameElements.gameStatus.style.color = '#e94560';
    }
}

function updateMoveHistory() {
    const history = chess.history({ verbose: true });
    const moveList = gameElements.moveList;
    moveList.innerHTML = '';

    for (let i = 0; i < history.length; i += 2) {
        const movePair = document.createElement('div');
        movePair.className = 'move-pair';

        const moveNum = document.createElement('span');
        moveNum.className = 'move-number';
        moveNum.textContent = `${Math.floor(i/2) + 1}.`;

        const whiteMove = document.createElement('span');
        whiteMove.className = 'move-white';
        whiteMove.textContent = history[i] ? history[i].san : '';

        const blackMove = document.createElement('span');
        blackMove.className = 'move-black';
        blackMove.textContent = history[i + 1] ? history[i + 1].san : '';

        movePair.append(moveNum, whiteMove, blackMove);
        moveList.appendChild(movePair);
    }

    moveList.scrollTop = moveList.scrollHeight;
}

function checkGameEnd() {
    if (chess.game_over()) {
        const result = getGameResult();
        handleGameEndLocally(result);
    }
}

function getGameResult() {
    if (chess.in_checkmate()) return chess.turn() === 'w' ? 'black_wins' : 'white_wins';
    return 'draw';
}

function handleGameEndLocally(result) {
    let title, message;

    const isWhite = myColor === 'w';
    const iWon = (result === 'white_wins' && isWhite) || (result === 'black_wins' && !isWhite);

    if (result === 'draw') {
        title = 'Draw!';
        message = 'The game ended in a draw.';
    } else if (iWon) {
        title = 'Victory! 🎉';
        message = 'You won the game!';
    } else {
        title = 'Defeat 😔';
        message = 'You lost the game.';
    }

    modals.gameOverTitle.textContent = title;
    modals.gameOverMessage.textContent = message;
    modals.gameOver.classList.remove('hidden');
}

function handleGameEnd(data) {
    let title, message;

    if (data.result === 'win') {
        title = 'Victory! 🎉';
        message = data.reason === 'opponent_resigned' ? 'Your opponent resigned.' :
                  data.reason === 'opponent_disconnected' ? 'Your opponent disconnected.' : 'You won!';
    } else if (data.result === 'loss') {
        title = 'Defeat 😔';
        message = data.reason === 'resigned' ? 'You resigned.' : 'You lost the game.';
    } else {
        title = 'Draw!';
        message = data.reason === 'agreed' ? 'Draw agreed.' : 'The game ended in a draw.';
    }

    modals.gameOverTitle.textContent = title;
    modals.gameOverMessage.textContent = message;
    modals.gameOver.classList.remove('hidden');
}

function handleDrawOffered() {
    modals.drawOffer.classList.remove('hidden');
}

function handleDrawDeclined() {
    gameElements.gameStatus.textContent = 'Draw declined';
    setTimeout(updateGameStatus, 1500);
}

function handleError(data) {
    alert(data.message);
}

// ============ GAME ACTIONS ============
function offerDraw() {
    if (!gameId || window.localGame) return;
    socket.emit('offerDraw', { gameId });
    gameElements.gameStatus.textContent = 'Draw offered...';
}

function acceptDraw() {
    if (!gameId) return;
    socket.emit('acceptDraw', { gameId });
    modals.drawOffer.classList.add('hidden');
}

function declineDraw() {
    if (!gameId) return;
    socket.emit('declineDraw', { gameId });
    modals.drawOffer.classList.add('hidden');
}

function resign() {
    if (confirm('Are you sure you want to resign?')) {
        if (window.localGame) {
            handleGameEndLocally(myColor === 'w' ? 'black_wins' : 'white_wins');
        } else {
            socket.emit('resign', { gameId });
        }
    }
}

function sendChat() {
    const message = gameElements.chatInput.value.trim();
    if (!message) return;

    addChatMessage(message, true);
    gameElements.chatInput.value = '';
}

function addChatMessage(message, own = false) {
    const div = document.createElement('div');
    div.className = `chat-message ${own ? 'own' : ''}`;
    div.innerHTML = `<span class="sender">${own ? 'You' : 'Opponent'}:</span> ${escapeHtml(message)}`;
    gameElements.chatMessages.appendChild(div);
    gameElements.chatMessages.scrollTop = gameElements.chatMessages.scrollHeight;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function playAgain() {
    modals.gameOver.classList.add('hidden');
    if (window.localGame) {
        startLocalGame();
    } else {
        findMatch();
    }
}

function backToMenu() {
    modals.gameOver.classList.add('hidden');
    showScreen('landing');
    landingElements.findMatchBtn.classList.remove('hidden');
    landingElements.playLocalBtn.classList.remove('hidden');
    landingElements.matchmakingStatus.classList.add('hidden');

    gameId = null;
    myColor = null;
    myTurn = false;
    selectedSquare = null;
    validMoves = [];
    chess = new Chess();
}

init();