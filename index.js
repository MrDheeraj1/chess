// A simple package.json for the backend
/*
{
  "name": "chess-app-backend",
  "version": "1.0.0",
  "main": "index.js",
  "scripts": {
    "start": "node index.js"
  },
  "dependencies": {
    "cors": "^2.8.5",
    "express": "^4.18.2",
    "firebase-admin": "^11.11.0",
    "socket.io": "^4.7.2"
  }
}
*/

// index.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { Chess } = require('chess.js');

// --- Firebase Admin setup ---
// IMPORTANT: Replace with your Firebase Admin SDK configuration.
// Create a service account key JSON file and point to it here.
const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*', // Allow all origins for development
    methods: ['GET', 'POST'],
  },
});

app.use(cors());
app.use(express.json());

// --- Simple in-memory "database" for demonstration ---
const games = new Map();
const users = new Map(); // Tracks connected users and their UIDs

// --- Helper Functions ---
function calculateElo(playerARating, playerBRating, result) {
  // result: 1 = A wins, 0.5 = Draw, 0 = B wins
  const K = 40; // New player K-factor
  const expectedScoreA = 1 / (1 + 10 ** ((playerBRating - playerARating) / 400));
  const newRatingA = playerARating + K * (result - expectedScoreA);
  return Math.round(newRatingA);
}

function getEvaluationLabel(score) {
  if (score > 150) return 'Brilliant';
  if (score > 50) return 'Good';
  if (score > -30 && score < 30) return 'Neutral';
  if (score > -150) return 'Inaccuracy';
  return 'Blunder';
}

// --- Socket.io Middleware for Authentication ---
io.use(async (socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) {
    console.log('Authentication failed: No token provided');
    return next(new Error('Authentication error: Token not provided.'));
  }
  
  try {
    // Verify the token using Firebase Admin
    const decodedToken = await admin.auth().verifyIdToken(token.split(' ')[1]);
    socket.uid = decodedToken.uid;
    console.log(`User connected with UID: ${socket.uid}`);
    next();
  } catch (error) {
    console.error('Firebase token verification failed:', error);
    next(new Error('Authentication error: Invalid token.'));
  }
});

// --- Socket.io Game Logic ---
io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);
  users.set(socket.uid, { socketId: socket.id, status: 'online' });

  // Handle game creation
  socket.on('createGame', () => {
    const gameId = `game-${Date.now()}`;
    const newGame = new Chess();
    const chatMessages = [];
    
    // For simplicity, we'll auto-match with a mock player
    const mockOpponentId = 'mock-ai-player';
    games.set(gameId, {
      fen: newGame.fen(),
      players: { white: socket.uid, black: mockOpponentId },
      chat: chatMessages,
      history: [],
      turn: 'w'
    });

    socket.join(gameId); // Join the new game room
    socket.emit('gameCreated', { gameId, fen: newGame.fen(), opponentId: mockOpponentId });
    console.log(`Game created with ID: ${gameId} for user ${socket.uid}`);
  });

  // Handle player moves
  socket.on('makeMove', ({ gameId, move }) => {
    const gameData = games.get(gameId);
    if (!gameData) return;

    const game = new Chess(gameData.fen);
    const result = game.move(move);

    if (result) {
      // Update game state
      gameData.fen = game.fen();
      gameData.history.push({ move, evaluation: { score: 0, label: 'Neutral' } });
      
      // Emit the updated game state to the room
      io.to(gameId).emit('gameUpdate', {
        fen: gameData.fen,
        chatMessages: gameData.chat,
      });

      // Simple mock for move evaluation
      const mockEvaluationScore = Math.floor(Math.random() * 300) - 150;
      const evaluationLabel = getEvaluationLabel(mockEvaluationScore);
      io.to(gameId).emit('moveEvaluation', { move, label: evaluationLabel });

      // Check for game end
      if (game.isGameOver()) {
        const result = game.isDraw() ? 0.5 : (game.turn() === 'w' ? 0 : 1);
        const playerRating = 1200; // Mock rating
        const opponentRating = 1200; // Mock rating
        const newRating = calculateElo(playerRating, opponentRating, result);
        
        io.to(gameId).emit('eloUpdate', { newElo: newRating });
        console.log(`Game over. New ELO for player: ${newRating}`);
        // Clean up the game
        games.delete(gameId);
      }
    }
  });

  // Handle chat messages
  socket.on('sendMessage', ({ gameId, senderId, text }) => {
    const gameData = games.get(gameId);
    if (!gameData) return;

    const message = { senderId, text, timestamp: new Date().toISOString() };
    gameData.chat.push(message);
    
    io.to(gameId).emit('gameUpdate', {
      fen: gameData.fen,
      chatMessages: gameData.chat,
    });
  });

  // Handle disconnections
  socket.on('disconnect', () => {
    console.log('A user disconnected:', socket.id);
    users.delete(socket.uid);
    // Logic to handle user leaving a game
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
