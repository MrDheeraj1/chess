const { spawn } = require('child_process');
const path = require('path');

// NOTE: You must have the Stockfish executable installed and accessible.
// This path assumes a local installation.
const stockfishPath = path.join(__dirname, 'stockfish'); // Adjust this path as needed

// A simple in-memory cache for repeated FEN positions to prevent redundant work
const cache = new Map();

/**
 * Spawns a Stockfish process and communicates with it.
 * @param {string} fen The FEN string of the current board position.
 * @returns {Promise<object>} An object containing the best move and the evaluation.
 */
function getStockfishEvaluation(fen) {
  return new Promise((resolve, reject) => {
    // Check cache first
    if (cache.has(fen)) {
      console.log('Evaluation from cache:', fen);
      return resolve(cache.get(fen));
    }

    const stockfish = spawn(stockfishPath, { stdio: ['pipe', 'pipe', 'inherit'] });
    let evaluation = null;
    let bestMove = null;
    const timeout = setTimeout(() => {
      stockfish.kill();
      reject(new Error('Stockfish process timed out.'));
    }, 5000); // 5-second timeout

    // Listen for Stockfish output
    stockfish.stdout.on('data', (data) => {
      const output = data.toString();
      // Check for 'info' lines to get the centipawn score (cp) or mate score (mate)
      const cpMatch = output.match(/score cp (-?\d+)/);
      const mateMatch = output.match(/score mate (-?\d+)/);
      const bestMoveMatch = output.match(/bestmove (\S+)/);

      if (cpMatch) {
        evaluation = { type: 'cp', value: parseInt(cpMatch[1], 10) };
      } else if (mateMatch) {
        evaluation = { type: 'mate', value: parseInt(mateMatch[1], 10) };
      }

      if (bestMoveMatch) {
        bestMove = bestMoveMatch[1];
      }

      // Check for the end of the search
      if (output.includes('bestmove')) {
        clearTimeout(timeout);
        stockfish.stdin.end(); // End the input stream to close the process
        stockfish.kill(); // Ensure the process is terminated
        const result = { bestMove, evaluation };
        cache.set(fen, result);
        resolve(result);
      }
    });

    stockfish.stderr.on('data', (data) => {
      console.error('Stockfish stderr:', data.toString());
    });

    stockfish.on('close', (code) => {
      if (code !== 0 && code !== null) {
        console.error(`Stockfish process exited with code ${code}`);
      }
    });

    // Send commands to Stockfish
    stockfish.stdin.write('uci\n');
    stockfish.stdin.write('isready\n');
    stockfish.stdin.write(`position fen ${fen}\n`);
    stockfish.stdin.write('go depth 15\n'); // Adjust depth for performance vs. accuracy
  });
}

// Example usage
// getStockfishEvaluation('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')
//   .then(result => console.log('Initial position evaluation:', result))
//   .catch(err => console.error(err));

// To integrate this into your backend, you would import this function
// and call it within your `makeMove` Socket.io handler.
// For production, you would want to use a pool of these workers
// to prevent one slow evaluation from blocking others.
