// ─── PIECES ───────────────────────────────────────────────────
const PIECES = {
  wK:'♔', wQ:'♕', wR:'♖', wB:'♗', wN:'♘', wP:'♙',
  bK:'♚', bQ:'♛', bR:'♜', bB:'♝', bN:'♞', bP:'♟'
};

function pieceKey(piece) {
  if (!piece) return null;
  return (piece.color === 'w' ? 'w' : 'b') + piece.type.toUpperCase();
}

// ─── GAME STATE ───────────────────────────────────────────────
let chess = new Chess();
let selectedSq = null;
let legalMoves = [];
let lastMove = null;
let moveHistory = [];
let isMuted = false;
let isListening = false;
let isProcessing = false;
let dragSrc = null;

// ─── BOARD RENDER ─────────────────────────────────────────────
function buildBoard() {
  const board = document.getElementById('board');
  board.innerHTML = '';
  const rankCoords = document.getElementById('rank-coords');
  const fileCoords = document.getElementById('file-coords');

  // rank labels (8 down to 1)
  rankCoords.innerHTML = '';
  for (let r = 8; r >= 1; r--) {
    const d = document.createElement('div');
    d.textContent = r;
    rankCoords.appendChild(d);
  }

  // file labels
  fileCoords.innerHTML = '';
  ['a','b','c','d','e','f','g','h'].forEach(f => {
    const d = document.createElement('div');
    d.className = 'coord-file-label';
    d.textContent = f;
    fileCoords.appendChild(d);
  });

  // squares
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const sq = String.fromCharCode(97 + col) + (8 - row);
      const div = document.createElement('div');
      div.className = 'square ' + ((row + col) % 2 === 0 ? 'light' : 'dark');
      div.dataset.sq = sq;

      // drag & drop
      div.addEventListener('dragover', e => { e.preventDefault(); });
      div.addEventListener('drop', e => { e.preventDefault(); handleDrop(sq); });

      div.addEventListener('click', () => handleSquareClick(sq));
      board.appendChild(div);
    }
  }

  updateBoard();
}

function updateBoard() {
  document.querySelectorAll('.square').forEach(sq => {
    const sqName = sq.dataset.sq;

    // clear classes except light/dark
    sq.classList.remove('selected','legal-move','legal-capture','last-from','last-to','in-check','drag-over-valid');

    // last move highlight
    if (lastMove) {
      if (sqName === lastMove.from) sq.classList.add('last-from');
      if (sqName === lastMove.to)   sq.classList.add('last-to');
    }

    // selected + legal moves
    if (sqName === selectedSq) sq.classList.add('selected');
    const lm = legalMoves.find(m => m.to === sqName);
    if (lm) {
      if (chess.get(sqName)) sq.classList.add('legal-capture');
      else sq.classList.add('legal-move');
    }

    // king in check
    if (chess.in_check()) {
      const turn = chess.turn();
      // find king
      for (let r = 1; r <= 8; r++) {
        for (let c of ['a','b','c','d','e','f','g','h']) {
          const p = chess.get(c + r);
          if (p && p.type === 'k' && p.color === turn && (c + r) === sqName) {
            sq.classList.add('in-check');
          }
        }
      }
    }

    // piece
    sq.innerHTML = '';
    const piece = chess.get(sqName);
    if (piece) {
      const span = document.createElement('span');
      span.className = 'piece';
      span.textContent = PIECES[pieceKey(piece)];
      span.draggable = true;
      span.addEventListener('dragstart', e => {
        dragSrc = sqName;
        setTimeout(() => sq.classList.add('dragging'), 0);
        e.dataTransfer.effectAllowed = 'move';
      });
      span.addEventListener('dragend', () => {
        sq.classList.remove('dragging');
        dragSrc = null;
      });
      sq.appendChild(span);
    }
  });

  updateStatus();
}

function handleDrop(targetSq) {
  if (!dragSrc) return;
  tryMove(dragSrc, targetSq);
  dragSrc = null;
}

function handleSquareClick(sq) {
  if (chess.turn() !== 'w') return; // only white clicks

  const piece = chess.get(sq);

  if (!selectedSq) {
    if (piece && piece.color === 'w') {
      selectedSq = sq;
      legalMoves = chess.moves({ square: sq, verbose: true });
      updateBoard();
    }
    return;
  }

  // clicking same square deselects
  if (sq === selectedSq) {
    selectedSq = null;
    legalMoves = [];
    updateBoard();
    return;
  }

  // clicking another white piece re-selects
  if (piece && piece.color === 'w') {
    selectedSq = sq;
    legalMoves = chess.moves({ square: sq, verbose: true });
    updateBoard();
    return;
  }

  tryMove(selectedSq, sq);
}

function tryMove(from, to, promotion) {
  // check if this is a promotion
  const piece = chess.get(from);
  const isPromotion = piece && piece.type === 'p' &&
    ((piece.color === 'w' && to[1] === '8') || (piece.color === 'b' && to[1] === '1'));

  const moveObj = {
    from,
    to,
    promotion: promotion || (isPromotion ? 'q' : undefined)
  };

  const result = chess.move(moveObj);
  if (!result) {
    selectedSq = null;
    legalMoves = [];
    updateBoard();
    return false;
  }

  // success
  lastMove = { from, to };
  selectedSq = null;
  legalMoves = [];
  moveHistory.push({ san: result.san, color: result.color });
  updateHistory();
  updateBoard();
  checkGameOver();

  // black plays after white
  if (!chess.game_over() && chess.turn() === 'b') {
    setTimeout(blackMove, 600);
  }

  return true;
}

function blackMove() {
  const moves = chess.moves({ verbose: true });
  if (!moves.length) return;
  const move = moves[Math.floor(Math.random() * moves.length)];
  const result = chess.move(move);
  if (result) {
    lastMove = { from: result.from, to: result.to };
    moveHistory.push({ san: result.san, color: result.color });
    updateHistory();
    updateBoard();
    checkGameOver();
  }
}

function checkGameOver() {
  if (!chess.game_over()) return;
  const overlay = document.getElementById('gameover-overlay');
  const title = document.getElementById('gameover-title');
  const sub = document.getElementById('gameover-sub');
  overlay.classList.add('visible');

  if (chess.in_checkmate()) {
    const winner = chess.turn() === 'w' ? 'Black' : 'White';
    title.textContent = 'Checkmate';
    sub.textContent = `${winner} wins the game.`;
  } else if (chess.in_draw()) {
    title.textContent = 'Draw';
    sub.textContent = chess.in_stalemate() ? 'Stalemate.' : 'Draw by repetition or 50-move rule.';
  }
}

function updateStatus() {
  const turn = chess.turn();
  const dot = document.getElementById('turn-dot');
  const label = document.getElementById('turn-label');
  const checkLabel = document.getElementById('check-label');
  const fenPreview = document.getElementById('fen-preview');

  dot.className = 'turn-dot ' + (turn === 'w' ? 'white' : 'black');
  label.textContent = turn === 'w' ? "White's Turn" : "Black's Turn (Engine)";
  checkLabel.classList.toggle('visible', chess.in_check());
  fenPreview.textContent = chess.fen().substring(0, 18) + '…';
}

function updateHistory() {
  const list = document.getElementById('history-list');
  const count = document.getElementById('move-count');
  list.innerHTML = '';
  count.textContent = moveHistory.length + ' moves';

  if (!moveHistory.length) {
    list.innerHTML = '<div class="empty-history">No moves yet. White to move.</div>';
    return;
  }

  moveHistory.forEach((m, i) => {
    const div = document.createElement('div');
    div.className = 'history-move';
    const isWhite = m.color === 'w';
    div.innerHTML = `
      <span class="move-num">${isWhite ? Math.floor(i/2)+1+'.' : '…'}</span>
      <span class="move-san ${isWhite ? 'white-move' : 'black-move'}">${m.san}</span>
    `;
    list.appendChild(div);
  });

  // scroll to bottom
  list.scrollTop = list.scrollHeight;
}

function resetGame() {
  chess = new Chess();
  selectedSq = null;
  legalMoves = [];
  lastMove = null;
  moveHistory = [];
  dragSrc = null;
  document.getElementById('gameover-overlay').classList.remove('visible');
  setMessage("Game reset. White to move.");
  updateHistory();
  updateBoard();
}

// ─── VOICE ────────────────────────────────────────────────────
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

function initSpeech() {
  if (!SR) {
    document.getElementById('mic-btn').disabled = true;
    setMessage("Use Chrome for voice support.");
    return;
  }
  // Wire button as true press-and-hold
  const btn = document.getElementById('mic-btn');
  btn.addEventListener('mousedown',  startListening);
  btn.addEventListener('touchstart', startListening, { passive: true });
  btn.addEventListener('mouseup',    stopListening);
  btn.addEventListener('mouseleave', stopListening);
  btn.addEventListener('touchend',   stopListening);
  // Remove the onclick so it doesn't double-fire
  btn.onclick = null;
}

function startListening() {
  if (!SR) return;
  if (chess.turn() !== 'w') { setMessage("Voice is only for White. Wait for Black's move."); return; }
  if (chess.game_over()) return;
  if (isListening) return;

  // Always create a fresh instance — avoids stale state bugs
  const recognition = new SR();
  recognition.continuous = false;
  recognition.lang = 'en-US';
  recognition.interimResults = false;
  recognition.maxAlternatives = 3;

  recognition.onstart = () => {
    isListening = true;
    const btn = document.getElementById('mic-btn');
    btn.classList.add('listening');
    btn.textContent = '🔴 Listening…';
    setMessage("Listening… speak now.");
  };

  recognition.onresult = e => {
    // Try all alternatives for best match
    const transcripts = [];
    for (let i = 0; i < e.results[0].length; i++) {
      transcripts.push(e.results[0][i].transcript.trim());
    }
    console.log("Voice heard:", transcripts);
    const best = transcripts[0];
    setMessage(`Heard: "${best}"`);
    processVoiceCommand(best, transcripts);
  };

  recognition.onerror = e => {
    console.warn("Speech error:", e.error);
    if (e.error === 'not-allowed') {
      setMessage("Microphone blocked. Allow mic access in browser settings.");
    } else if (e.error !== 'no-speech' && e.error !== 'aborted') {
      setMessage(`Error: ${e.error}. Try again.`);
    }
    resetMicBtn();
  };

  recognition.onend = () => {
    resetMicBtn();
  };

  try {
    recognition.start();
    window._activeRecognition = recognition;
  } catch(err) {
    console.error("Could not start recognition:", err);
    setMessage("Could not start mic. Try clicking again.");
    resetMicBtn();
  }
}

function stopListening() {
  if (!isListening) return;
  try { if (window._activeRecognition) window._activeRecognition.stop(); } catch(_) {}
  resetMicBtn();
}

function resetMicBtn() {
  isListening = false;
  const btn = document.getElementById('mic-btn');
  btn.classList.remove('listening');
  btn.textContent = '🎤 Hold to Speak';
}

// ─── PARSE VOICE → MOVE ───────────────────────────────────────
const FILES = ['a','b','c','d','e','f','g','h'];
const RANKS = ['1','2','3','4','5','6','7','8'];

const WORD_TO_FILE = {
  'alpha':'a', 'a':'a',
  'bravo':'b','b':'b',
  'charlie':'c','c':'c','see':'c','sea':'c',
  'delta':'d','d':'d','dee':'d',
  'echo':'e','e':'e','ee':'e',
  'foxtrot':'f','f':'f','ef':'f',
  'golf':'g','g':'g','gee':'g','ji':'g','jay':'g',
  'hotel':'h','h':'h','aitch':'h','ach':'h'
};

const PIECE_WORDS = {
  'pawn':'p','pawns':'p',
  'knight':'n','horse':'n',
  'bishop':'b',
  'rook':'r','castle':'r','castles':'r',
  'queen':'q',
  'king':'k'
};

function normalizeSquare(word) {
  // e.g. "e4", "e-4", "echo4"
  word = word.toLowerCase().replace(/[-\s]/g,'');
  if (FILES.includes(word[0]) && RANKS.includes(word[1])) return word.substring(0,2);
  // Try word→file mapping + digit
  for (const [key, file] of Object.entries(WORD_TO_FILE)) {
    if (word.startsWith(key)) {
      const rest = word.substring(key.length).trim();
      if (RANKS.includes(rest)) return file + rest;
    }
  }
  return null;
}

function parseVoiceMove(text) {
  text = text.toLowerCase().replace(/[.,!?]/g,'');
  const words = text.split(/\s+/);

  // Try to find two squares in the text (e.g. "e2 to e4", "e2 e4")
  const squares = [];
  let promotion = 'q';

  // detect promotion piece
  for (const w of words) {
    if (PIECE_WORDS[w] && w !== 'pawn') {
      if (['q','r','b','n'].includes(PIECE_WORDS[w])) promotion = PIECE_WORDS[w];
    }
  }

  // find all squares mentioned
  for (let i = 0; i < words.length; i++) {
    // single word like "e4"
    const sq = normalizeSquare(words[i]);
    if (sq) { squares.push(sq); continue; }
    // two-word like "echo 4"
    if (i + 1 < words.length) {
      const sq2 = normalizeSquare(words[i] + words[i+1]);
      if (sq2) { squares.push(sq2); i++; continue; }
    }
  }

  if (squares.length >= 2) {
    return { from: squares[0], to: squares[1], promotion };
  }

  // Castle detection
  if (text.includes('castle kingside') || text.includes('king side') || text.includes('short castle') || text.includes('o-o')) {
    return { special: 'castle-kingside' };
  }
  if (text.includes('castle queenside') || text.includes('queen side') || text.includes('long castle') || text.includes('o-o-o')) {
    return { special: 'castle-queenside' };
  }

  // single destination: "pawn to e4", "knight f3"
  if (squares.length === 1) {
    const target = squares[0];
    // find which piece the user mentioned
    let pieceType = null;
    for (const w of words) {
      if (PIECE_WORDS[w]) { pieceType = PIECE_WORDS[w]; break; }
    }
    return { to: target, pieceType, promotion };
  }

  return null;
}

function processVoiceCommand(text, alternatives) {
  if (chess.turn() !== 'w') {
    setMessage("It's not White's turn.");
    return;
  }

  // Try each alternative transcript until one produces a valid move
  const toTry = alternatives && alternatives.length > 1 ? alternatives : [text];
  
  for (const transcript of toTry) {
    const parsed = parseVoiceMove(transcript);
    if (!parsed) continue;

    // Castle
    if (parsed.special === 'castle-kingside') {
      const result = tryMove('e1', 'g1');
      if (result) { setMessage("Castled kingside!"); speak("Castled kingside"); return; }
      continue;
    }
    if (parsed.special === 'castle-queenside') {
      const result = tryMove('e1', 'c1');
      if (result) { setMessage("Castled queenside!"); speak("Castled queenside"); return; }
      continue;
    }

    // from + to explicit
    if (parsed.from && parsed.to) {
      const result = tryMove(parsed.from, parsed.to, parsed.promotion);
      if (result) {
        const last = moveHistory[moveHistory.length - 1];
        const msg = `Moved ${last ? last.san : 'piece'} to ${parsed.to}.`;
        setMessage(msg); speak(msg); return;
      }
      continue;
    }

    // destination only — find matching piece
    if (parsed.to) {
      const allMoves = chess.moves({ verbose: true });
      let candidates = allMoves.filter(m => m.to === parsed.to);
      if (parsed.pieceType) candidates = candidates.filter(m => m.piece === parsed.pieceType);

      if (candidates.length === 1) {
        const m = candidates[0];
        const result = tryMove(m.from, m.to, parsed.promotion);
        if (result) {
          const last = moveHistory[moveHistory.length - 1];
          const pieceName = { p:'Pawn',n:'Knight',b:'Bishop',r:'Rook',q:'Queen',k:'King' }[m.piece] || m.piece;
          const msg = `${pieceName} to ${parsed.to}.`;
          setMessage(msg); speak(msg); return;
        }
      } else if (candidates.length > 1) {
        const from_list = candidates.map(m => m.from).join(' or ');
        const msg = `Which piece? From ${from_list}?`;
        setMessage(msg); speak(msg); return;
      }
    }
  }

  // Nothing worked
  setMessage(`Didn't understand: "${text}". Try "pawn to e4" or "knight to f3".`);
  speak("Sorry, I didn't understand that.");
}

// ─── SPEECH SYNTH ─────────────────────────────────────────────
function speak(text) {
  if (isMuted) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1.1;
  window.speechSynthesis.speak(u);
}

function setMessage(text) {
  document.getElementById('assistant-msg').textContent = `"${text}"`;
}

// ─── MUTE ─────────────────────────────────────────────────────
document.getElementById('mute-btn').addEventListener('click', function() {
  isMuted = !isMuted;
  this.textContent = isMuted ? '🔇' : '🔊';
  if (isMuted) window.speechSynthesis.cancel();
});

// ─── INIT ─────────────────────────────────────────────────────
buildBoard();
initSpeech();
