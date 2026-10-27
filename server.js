const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Chess } = require('chess.js');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: 'https://chess-u88o.onrender.com' }
});

app.use(express.static(path.join(__dirname, 'public')));

// Game state storage
const waitingPlayers = new Map(); // socketId -> { socket, color }
const activeGames = new Map();    // gameId -> { white, black, chess, spectators }
const playerGameMap = new Map();  // socketId -> gameId

// Helper: create a new game
function createGame(player1, player2) {
  const gameId = uuidv4().slice(0, 8);
  const chess = new Chess();

  // Randomly assign colors
  const [white, black] = Math.random() > 0.5
    ? [player1, player2]
    : [player2, player1];

  const game = {
    id: gameId,
    white: { socket: white.socket, color: 'w' },
    black: { socket: black.socket, color: 'b' },
    chess,
    spectators: new Set(),
    createdAt: Date.now()
  };

  activeGames.set(gameId, game);
  playerGameMap.set(white.socket.id, gameId);
  playerGameMap.set(black.socket.id, gameId);

  // Notify both players
  white.socket.emit('gameFound', {
    gameId,
    color: 'w',
    opponent: black.socket.id,
    fen: chess.fen()
  });
  black.socket.emit('gameFound', {
    gameId,
    color: 'b',
    opponent: white.socket.id,
    fen: chess.fen()
  });

  return game;
}

// Handle new connection
io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);

  // Join matchmaking queue
  socket.on('findMatch', () => {
    // Check if already in a game
    if (playerGameMap.has(socket.id)) {
      socket.emit('error', { message: 'Already in a game' });
      return;
    }

    // Check if there's a waiting player
    if (waitingPlayers.size > 0) {
      // Get first waiting player (not ourselves)
      for (const [waitingId, player] of waitingPlayers) {
        if (waitingId !== socket.id) {
          waitingPlayers.delete(waitingId);
          createGame(player, { socket });
          return;
        }
      }
    }

    // No match found, add to waiting
    waitingPlayers.set(socket.id, { socket });
    socket.emit('waiting', { message: 'Waiting for opponent...' });
  });

  // Make a move
  socket.on('makeMove', ({ gameId, move }) => {
    const game = activeGames.get(gameId);
    if (!game) return;

    const player = game.white.socket.id === socket.id ? game.white : game.black;
    if (!player) return;

    // Check if it's player's turn
    const isWhiteTurn = game.chess.turn() === 'w';
    if ((isWhiteTurn && player.color !== 'w') || (!isWhiteTurn && player.color !== 'b')) {
      socket.emit('illegalMove', { message: 'Not your turn' });
      return;
    }

    // Try to make the move
    try {
      const result = game.chess.move(move);
      if (!result) {
        socket.emit('illegalMove', { message: 'Illegal move' });
        return;
      }

      // Broadcast move to both players
      io.to(game.white.socket.id).emit('moveMade', {
        move,
        fen: game.chess.fen(),
        turn: game.chess.turn(),
        gameOver: game.chess.isGameOver(),
        result: game.chess.isGameOver() ? getGameResult(game.chess) : null
      });
      io.to(game.black.socket.id).emit('moveMade', {
        move,
        fen: game.chess.fen(),
        turn: game.chess.turn(),
        gameOver: game.chess.isGameOver(),
        result: game.chess.isGameOver() ? getGameResult(game.chess) : null
      });

      // Notify spectators
      game.spectators.forEach(specId => {
        io.to(specId).emit('moveMade', {
          move,
          fen: game.chess.fen(),
          turn: game.chess.turn(),
          gameOver: game.chess.isGameOver(),
          result: game.chess.isGameOver() ? getGameResult(game.chess) : null
        });
      });

    } catch (e) {
      socket.emit('illegalMove', { message: 'Invalid move format' });
    }
  });

  // Resign
  socket.on('resign', ({ gameId }) => {
    const game = activeGames.get(gameId);
    if (!game) return;

    const winner = game.white.socket.id === socket.id ? game.black : game.white;
    const loser = game.white.socket.id === socket.id ? game.white : game.black;

    io.to(winner.socket.id).emit('gameEnd', {
      result: 'win',
      reason: 'opponent_resigned'
    });
    io.to(loser.socket.id).emit('gameEnd', {
      result: 'loss',
      reason: 'resigned'
    });

    cleanupGame(gameId);
  });

  // Offer draw
  socket.on('offerDraw', ({ gameId }) => {
    const game = activeGames.get(gameId);
    if (!game) return;

    const opponent = game.white.socket.id === socket.id ? game.black : game.white;
    io.to(opponent.socket.id).emit('drawOffered', { from: socket.id });
  });

  // Accept draw
  socket.on('acceptDraw', ({ gameId }) => {
    const game = activeGames.get(gameId);
    if (!game) return;

    io.to(game.white.socket.id).emit('gameEnd', {
      result: 'draw',
      reason: 'agreed'
    });
    io.to(game.black.socket.id).emit('gameEnd', {
      result: 'draw',
      reason: 'agreed'
    });

    cleanupGame(gameId);
  });

  // Decline draw
  socket.on('declineDraw', ({ gameId }) => {
    const game = activeGames.get(gameId);
    if (!game) return;

    const opponent = game.white.socket.id === socket.id ? game.black : game.white;
    io.to(opponent.socket.id).emit('drawDeclined');
  });

  // Spectate a game
  socket.on('spectate', ({ gameId }) => {
    const game = activeGames.get(gameId);
    if (!game) {
      socket.emit('error', { message: 'Game not found' });
      return;
    }

    game.spectators.add(socket.id);
    socket.emit('gameState', {
      fen: game.chess.fen(),
      turn: game.chess.turn(),
      gameOver: game.chess.isGameOver()
    });
  });

  // Disconnect handling
  socket.on('disconnect', () => {
    console.log(`Player disconnected: ${socket.id}`);

    // Remove from waiting queue
    waitingPlayers.delete(socket.id);

    // Handle active game
    const gameId = playerGameMap.get(socket.id);
    if (gameId) {
      const game = activeGames.get(gameId);
      if (game) {
        // Notify opponent
        const opponent = game.white.socket.id === socket.id ? game.black : game.white;
        io.to(opponent.socket.id).emit('gameEnd', {
          result: 'win',
          reason: 'opponent_disconnected'
        });
        cleanupGame(gameId);
      }
    }
  });
});

function getGameResult(chess) {
  if (chess.isCheckmate()) return chess.turn() === 'w' ? 'black_wins' : 'white_wins';
  if (chess.isDraw()) return 'draw';
  if (chess.isStalemate()) return 'draw';
  if (chess.isThreefoldRepetition()) return 'draw';
  if (chess.isInsufficientMaterial()) return 'draw';
  return 'ongoing';
}

function cleanupGame(gameId) {
  const game = activeGames.get(gameId);
  if (game) {
    playerGameMap.delete(game.white.socket.id);
    playerGameMap.delete(game.black.socket.id);
    game.spectators.forEach(id => playerGameMap.delete(id));
    activeGames.delete(gameId);
  }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Chess server running on http://localhost:${PORT}`);
});
