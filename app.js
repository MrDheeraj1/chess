import React, { useState, useEffect, useRef } from 'react';
import { Chessboard } from 'react-chessboard';
import { Chess } from 'chess.js';
import { io } from 'socket.io-client';
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } from 'firebase/auth';
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, setDoc, onSnapshot } from 'firebase/firestore';

// --- Firebase Configuration ---
// IMPORTANT: Replace these with your actual Firebase project configuration
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_AUTH_DOMAIN",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_STORAGE_BUCKET",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// --- Backend URL ---
// IMPORTANT: Replace this with your backend server URL
const BACKEND_URL = 'http://localhost:3001';

// --- Main App Component ---
export default function App() {
  const [user, setUser] = useState(null);
  const [game, setGame] = useState(new Chess());
  const [opponent, setOpponent] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [elo, setElo] = useState(1200); // Mock ELO
  const [gameId, setGameId] = useState(null);
  const [gameHistory, setGameHistory] = useState([]); // To store game moves for commentary
  const [commentary, setCommentary] = useState(null);
  const [isGeneratingCommentary, setIsGeneratingCommentary] = useState(false);
  const [puzzle, setPuzzle] = useState(null);
  const [isGeneratingPuzzle, setIsGeneratingPuzzle] = useState(false);
  const socketRef = useRef(null);

  // --- Authentication Handlers ---
  const handleGoogleSignIn = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Google sign-in error:", error);
    }
  };

  const handleSignOut = () => {
    signOut(auth);
  };

  // --- Game Logic ---
  const safeGameMutate = (modify) => {
    setGame((g) => {
      const newGame = new Chess(g.fen());
      modify(newGame);
      return newGame;
    });
  };

  function onDrop(sourceSquare, targetSquare) {
    if (!gameId) return false; // Don't allow moves if not in a game
    const move = {
      from: sourceSquare,
      to: targetSquare,
      promotion: 'q', // Always promote to queen for simplicity
    };
    let newGame = new Chess(game.fen());
    const result = newGame.move(move);
    if (result === null) return false;

    // Send the move to the server
    socketRef.current.emit('makeMove', { gameId, move: result.san });
    setGame(newGame);
    // Add the move to game history for AI features
    setGameHistory((prevHistory) => [...prevHistory, result.san]);
    return true;
  }
  
  // --- Chat Logic ---
  const handleSendMessage = (e) => {
    e.preventDefault();
    if (newMessage.trim() === '' || !gameId) return;

    const messagePayload = {
      gameId,
      senderId: user.uid,
      text: newMessage,
    };

    socketRef.current.emit('sendMessage', messagePayload);
    setNewMessage('');
  };

  // --- Gemini API Features ---
  const handleGenerateCommentary = async () => {
    setIsGeneratingCommentary(true);
    setCommentary(null);
    const gameMoves = gameHistory.join(' ');
    const prompt = `Provide a friendly, conversational summary of the following chess game. Highlight key moments, a turning point, and who played well. The moves are in Standard Algebraic Notation (SAN): ${gameMoves}`;

    try {
      const chatHistory = [];
      chatHistory.push({ role: "user", parts: [{ text: prompt }] });
      const payload = { contents: chatHistory };
      const apiKey = "";
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`;
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const result = await response.json();
      if (result.candidates && result.candidates.length > 0 &&
          result.candidates[0].content && result.candidates[0].content.parts &&
          result.candidates[0].content.parts.length > 0) {
        const text = result.candidates[0].content.parts[0].text;
        setCommentary(text);
      } else {
        setCommentary('Failed to generate commentary. Please try again.');
        console.error('API response error:', result);
      }
    } catch (error) {
      console.error('Error calling Gemini API for commentary:', error);
      setCommentary('An error occurred while generating commentary.');
    } finally {
      setIsGeneratingCommentary(false);
    }
  };

  const handleGeneratePuzzle = async () => {
    setIsGeneratingPuzzle(true);
    setPuzzle(null);
    const currentFen = game.fen();
    const prompt = `Create a chess puzzle from the following FEN string. Provide a short description of the tactical theme and the first winning move to find. Respond in a clear format: "Description: [description] Winning Move: [winning move]". FEN: ${currentFen}`;
  
    try {
      const chatHistory = [];
      chatHistory.push({ role: "user", parts: [{ text: prompt }] });
      const payload = { contents: chatHistory };
      const apiKey = "";
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`;
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const result = await response.json();
      if (result.candidates && result.candidates.length > 0 &&
          result.candidates[0].content && result.candidates[0].content.parts &&
          result.candidates[0].content.parts.length > 0) {
        const text = result.candidates[0].content.parts[0].text;
        setPuzzle(text);
      } else {
        setPuzzle('Failed to generate puzzle. Please try again.');
        console.error('API response error:', result);
      }
    } catch (error) {
      console.error('Error calling Gemini API for puzzle:', error);
      setPuzzle('An error occurred while generating a puzzle.');
    } finally {
      setIsGeneratingPuzzle(false);
    }
  };

  // --- Real-time & Auth Hooks ---
  useEffect(() => {
    // Listen for auth state changes
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        // Set up socket connection and user presence
        const socket = io(BACKEND_URL, {
          auth: { token: `Bearer ${currentUser.accessToken}` },
        });
        socketRef.current = socket;

        // Listen for game updates from the server
        socket.on('gameUpdate', ({ fen, chatMessages, moves }) => {
          safeGameMutate((g) => g.load(fen));
          setMessages(chatMessages);
          setGameHistory(moves);
        });

        // Listen for move evaluations
        socket.on('moveEvaluation', ({ move, label }) => {
          console.log(`Move: ${move}, Evaluation: ${label}`);
          // You would display this on the UI, e.g., next to the move history
        });

        // Listen for ELO updates
        socket.on('eloUpdate', ({ newElo }) => {
          setElo(newElo);
          console.log(`Your new ELO is: ${newElo}`);
        });

        // Listen for a game to be created
        socket.on('gameCreated', ({ gameId: newGameId, fen, opponentId }) => {
          console.log(`Game created! ID: ${newGameId}`);
          setGameId(newGameId);
          safeGameMutate((g) => g.load(fen));
          // Mock finding opponent info from a simple Firestore query
          onSnapshot(doc(db, "users", opponentId), (doc) => {
            if (doc.exists()) {
              setOpponent(doc.data());
            }
          });
        });

        // Clean up on component unmount or user change
        return () => {
          socket.disconnect();
        };
      }
    });

    return () => unsubscribe();
  }, []);

  // --- UI Layout ---
  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-100 dark:bg-gray-900">
        <div className="p-8 rounded-lg shadow-lg bg-white dark:bg-gray-800 text-center">
          <h1 className="text-3xl font-bold text-gray-800 dark:text-gray-100 mb-4">Chess App</h1>
          <p className="text-gray-600 dark:text-gray-400 mb-6">Sign in to start playing!</p>
          <button
            onClick={handleGoogleSignIn}
            className="w-full px-4 py-2 text-white bg-blue-600 rounded-md hover:bg-blue-700 transition-colors"
          >
            Sign in with Google
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4 bg-gray-100 dark:bg-gray-900">
      <div className="max-w-4xl w-full flex flex-col md:flex-row gap-8 p-6 rounded-xl shadow-2xl bg-white dark:bg-gray-800">
        {/* Chessboard & Game Info */}
        <div className="flex-1">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center">
              <img src={user.photoURL} alt="User Avatar" className="w-10 h-10 rounded-full" />
              <div className="ml-3">
                <p className="font-semibold text-gray-800 dark:text-gray-100">{user.displayName}</p>
                <p className="text-sm text-gray-500 dark:text-gray-400">ELO: {elo}</p>
              </div>
            </div>
            <button
              onClick={handleSignOut}
              className="px-4 py-2 text-sm text-white bg-red-600 rounded-md hover:bg-red-700 transition-colors"
            >
              Sign Out
            </button>
          </div>
          <div className="relative w-full aspect-square rounded-lg overflow-hidden shadow-lg border-2 border-gray-300 dark:border-gray-700">
            <Chessboard position={game.fen()} onPieceDrop={onDrop} />
          </div>
          <div className="mt-4 flex flex-col items-center">
            <h3 className="font-bold text-gray-800 dark:text-gray-100">
              {game.turn() === 'w' ? 'White to move' : 'Black to move'}
            </h3>
            <p className="text-gray-600 dark:text-gray-400">
              {opponent ? `Playing against: ${opponent.displayName}` : 'Waiting for a game...'}
            </p>
            {!gameId && (
              <button
                onClick={() => socketRef.current.emit('createGame')}
                className="mt-4 px-6 py-3 bg-green-600 text-white font-bold rounded-lg hover:bg-green-700 transition-colors shadow-md"
              >
                Create New Game
              </button>
            )}
            <div className="flex gap-2 mt-4">
              <button
                onClick={handleGenerateCommentary}
                disabled={gameHistory.length === 0 || isGeneratingCommentary}
                className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {isGeneratingCommentary ? 'Generating...' : '✨ Game Commentary'}
              </button>
              <button
                onClick={handleGeneratePuzzle}
                disabled={isGeneratingPuzzle}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {isGeneratingPuzzle ? 'Generating...' : '✨ AI Puzzle'}
              </button>
            </div>
          </div>
          {commentary && (
            <div className="mt-6 p-4 bg-gray-200 dark:bg-gray-700 rounded-lg shadow-inner">
              <h4 className="font-bold text-gray-800 dark:text-gray-100 mb-2">Game Commentary</h4>
              <p className="text-gray-700 dark:text-gray-200 whitespace-pre-wrap">{commentary}</p>
            </div>
          )}
          {puzzle && (
            <div className="mt-6 p-4 bg-gray-200 dark:bg-gray-700 rounded-lg shadow-inner">
              <h4 className="font-bold text-gray-800 dark:text-gray-100 mb-2">AI Puzzle</h4>
              <p className="text-gray-700 dark:text-gray-200 whitespace-pre-wrap">{puzzle}</p>
            </div>
          )}
        </div>

        {/* Chat Panel */}
        <div className="flex-1 flex flex-col rounded-lg shadow-lg p-4 bg-gray-50 dark:bg-gray-700">
          <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100 mb-3">In-Game Chat</h2>
          <div className="flex-grow flex flex-col overflow-y-auto space-y-2 p-2 rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-600">
            {messages.length > 0 ? (
              messages.map((msg, index) => (
                <div key={index} className={`p-2 rounded-lg max-w-xs ${msg.senderId === user.uid ? 'ml-auto bg-blue-500 text-white' : 'mr-auto bg-gray-200 dark:bg-gray-600 text-gray-800 dark:text-white'}`}>
                  <span className="block text-xs font-semibold">{msg.senderId === user.uid ? 'You' : 'Opponent'}</span>
                  {msg.text}
                </div>
              ))
            ) : (
              <p className="text-gray-500 dark:text-gray-400 text-center text-sm italic">
                No messages yet.
              </p>
            )}
          </div>
          <form onSubmit={handleSendMessage} className="mt-4 flex gap-2">
            <input
              type="text"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              className="flex-grow p-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100"
              placeholder="Type a message..."
              disabled={!gameId}
            />
            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50"
              disabled={!gameId}
            >
              Send
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
