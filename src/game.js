// =============================================================
// CHECKMATE VOICE  —  game.js
// =============================================================

// ─── PIECE IMAGE URLs (Lichess open-source "cburnett" set) ──────
// Hosted publicly by Lichess — high quality, consistent style
const PIECE_URLS = {
  wK: 'https://lichess1.org/assets/piece/cburnett/wK.svg',
  wQ: 'https://lichess1.org/assets/piece/cburnett/wQ.svg',
  wR: 'https://lichess1.org/assets/piece/cburnett/wR.svg',
  wB: 'https://lichess1.org/assets/piece/cburnett/wB.svg',
  wN: 'https://lichess1.org/assets/piece/cburnett/wN.svg',
  wP: 'https://lichess1.org/assets/piece/cburnett/wP.svg',
  bK: 'https://lichess1.org/assets/piece/cburnett/bK.svg',
  bQ: 'https://lichess1.org/assets/piece/cburnett/bQ.svg',
  bR: 'https://lichess1.org/assets/piece/cburnett/bR.svg',
  bB: 'https://lichess1.org/assets/piece/cburnett/bB.svg',
  bN: 'https://lichess1.org/assets/piece/cburnett/bN.svg',
  bP: 'https://lichess1.org/assets/piece/cburnett/bP.svg',
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
let moveHistory = [];   // { san, color, from, to }
let fenHistory = [];   // FEN after each move
let viewingIndex = -1;   // -1 = live; 0..N = past move
let isMuted = false;
let isListening = false;
let dragSrc = null;
let lastAmbiguity = null;  // { pieceType, to } — remembers last ambiguous move for follow-up
let openingSnapshot = null; // saved game state while showing opening demo

// ─── BUILD BOARD (once on load) ──────────────────────────────
function buildBoard() {
  const board = document.getElementById('board');
  const rankCoords = document.getElementById('rank-coords');
  const fileCoords = document.getElementById('file-coords');
  board.innerHTML = '';

  rankCoords.innerHTML = '';
  for (let r = 8; r >= 1; r--) {
    const d = document.createElement('div');
    d.textContent = r;
    rankCoords.appendChild(d);
  }

  fileCoords.innerHTML = '';
  ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].forEach(f => {
    const d = document.createElement('div');
    d.className = 'coord-file-label';
    d.textContent = f;
    fileCoords.appendChild(d);
  });

  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const sq = String.fromCharCode(97 + col) + (8 - row);
      const div = document.createElement('div');
      div.className = 'square ' + ((row + col) % 2 === 0 ? 'light' : 'dark');
      div.dataset.sq = sq;

      div.addEventListener('dragover', e => e.preventDefault());
      div.addEventListener('drop', e => { e.preventDefault(); handleDrop(sq); });
      div.addEventListener('click', () => handleSquareClick(sq));
      board.appendChild(div);
    }
  }

  updateBoard();
}

// ─── RENDER BOARD ────────────────────────────────────────────
function updateBoard() {
  document.querySelectorAll('.square').forEach(sq => {
    const sqName = sq.dataset.sq;

    sq.classList.remove(
      'selected', 'legal-move', 'legal-capture',
      'last-from', 'last-to', 'in-check', 'dragging'
    );

    if (lastMove) {
      if (sqName === lastMove.from) sq.classList.add('last-from');
      if (sqName === lastMove.to) sq.classList.add('last-to');
    }

    if (sqName === selectedSq) sq.classList.add('selected');

    const lm = legalMoves.find(m => m.to === sqName);
    if (lm) sq.classList.add(chess.get(sqName) ? 'legal-capture' : 'legal-move');

    if (chess.in_check()) {
      const t = chess.turn();
      ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].forEach(file => {
        for (let rank = 1; rank <= 8; rank++) {
          const p = chess.get(file + rank);
          if (p && p.type === 'k' && p.color === t && (file + rank) === sqName)
            sq.classList.add('in-check');
        }
      });
    }

    // Render piece
    sq.innerHTML = '';
    const piece = chess.get(sqName);
    if (piece) {
      const span = document.createElement('span');
      span.className = 'piece';
      const img = document.createElement('img');
      img.src = PIECE_URLS[pieceKey(piece)] || '';
      img.draggable = false;
      span.appendChild(img);

      // Drag source must be on the square (pointer-events: none on .piece)
      sq.draggable = true;
      sq.addEventListener('dragstart', e => {
        dragSrc = sqName;

        // Use only the piece image as drag ghost — no square background
        const pieceImg = sq.querySelector('.piece img');
        if (pieceImg && e.dataTransfer.setDragImage) {
          // Create an off-screen canvas to render just the piece
          const size = sq.getBoundingClientRect().width;
          const ghost = document.createElement('img');
          ghost.src = pieceImg.src;
          ghost.style.cssText = `
            position: fixed; top: -9999px; left: -9999px;
            width: ${size}px; height: ${size}px;
            pointer-events: none;
          `;
          document.body.appendChild(ghost);
          e.dataTransfer.setDragImage(ghost, size / 2, size / 2);
          // Remove ghost after drag starts
          setTimeout(() => ghost.remove(), 0);
        }

        setTimeout(() => sq.classList.add('dragging'), 0);
        e.dataTransfer.effectAllowed = 'move';
      }, { once: true });
      sq.addEventListener('dragend', () => {
        sq.classList.remove('dragging');
        dragSrc = null;
      }, { once: true });

      sq.appendChild(span);
    } else {
      sq.draggable = false;
    }
  });

  updateStatus();
}

// ─── DRAG & DROP ─────────────────────────────────────────────
function handleDrop(targetSq) {
  if (!dragSrc) return;
  if (viewingIndex !== -1) {
    setMessage("Viewing past position — click ▶ Return to Live to play.");
    dragSrc = null; return;
  }
  tryMove(dragSrc, targetSq);
  dragSrc = null;
}

// ─── CLICK TO MOVE ───────────────────────────────────────────
function handleSquareClick(sq) {
  if (viewingIndex !== -1) {
    setMessage("Viewing past position — click ▶ Return to Live to play.");
    return;
  }
  if (chess.turn() !== 'w') return;

  const piece = chess.get(sq);

  if (!selectedSq) {
    if (piece && piece.color === 'w') {
      selectedSq = sq;
      legalMoves = chess.moves({ square: sq, verbose: true });
      updateBoard();
    }
    return;
  }

  if (sq === selectedSq) { selectedSq = null; legalMoves = []; updateBoard(); return; }

  if (piece && piece.color === 'w') {
    selectedSq = sq;
    legalMoves = chess.moves({ square: sq, verbose: true });
    updateBoard(); return;
  }

  tryMove(selectedSq, sq);
}

// ─── EXECUTE MOVE ────────────────────────────────────────────
function tryMove(from, to, promotion) {
  if (viewingIndex !== -1) returnToLive();

  const piece = chess.get(from);
  const isPromotion = piece && piece.type === 'p' &&
    ((piece.color === 'w' && to[1] === '8') || (piece.color === 'b' && to[1] === '1'));

  const result = chess.move({ from, to, promotion: promotion || (isPromotion ? 'q' : undefined) });
  if (!result) { selectedSq = null; legalMoves = []; updateBoard(); return false; }

  lastMove = { from: result.from, to: result.to };
  lastAmbiguity = null;
  selectedSq = null; legalMoves = []; viewingIndex = -1;
  moveHistory.push({ san: result.san, color: result.color, from: result.from, to: result.to });
  fenHistory.push(chess.fen());

  updateHistory(true);
  updateBoard();
  checkGameOver();
  if (!chess.game_over() && chess.turn() === 'b') setTimeout(blackMove, 650);
  return true;
}

// ─── BLACK ENGINE (random legal) ─────────────────────────────
function blackMove() {
  const moves = chess.moves({ verbose: true });
  if (!moves.length) return;
  const result = chess.move(moves[Math.floor(Math.random() * moves.length)]);
  if (result) {
    lastMove = { from: result.from, to: result.to };
    moveHistory.push({ san: result.san, color: result.color, from: result.from, to: result.to });
    fenHistory.push(chess.fen());
    viewingIndex = -1;
    updateHistory(true);
    updateBoard();
    checkGameOver();
  }
}

// ─── GAME OVER ───────────────────────────────────────────────
function checkGameOver() {
  if (!chess.game_over()) return;
  const overlay = document.getElementById('gameover-overlay');
  const title = document.getElementById('gameover-title');
  const sub = document.getElementById('gameover-sub');
  overlay.classList.add('visible');
  if (chess.in_checkmate()) {
    title.textContent = 'Checkmate';
    sub.textContent = `${chess.turn() === 'w' ? 'Black' : 'White'} wins.`;
  } else {
    title.textContent = 'Draw';
    sub.textContent = chess.in_stalemate() ? 'Stalemate.' : 'Draw by repetition or 50-move rule.';
  }
}

// ─── STATUS BAR ──────────────────────────────────────────────
function updateStatus() {
  const turn = chess.turn();
  document.getElementById('turn-dot').className = 'turn-dot ' + (turn === 'w' ? 'white' : 'black');
  document.getElementById('turn-label').textContent = turn === 'w' ? "White's Turn" : "Black's Turn (Engine)";
  document.getElementById('check-label').classList.toggle('visible', chess.in_check());
}

// ─── HISTORY PANEL ───────────────────────────────────────────
function updateHistory(scrollToBottom) {
  const list = document.getElementById('history-list');
  const count = document.getElementById('move-count');
  list.innerHTML = '';
  count.textContent = moveHistory.length + ' moves';

  if (!moveHistory.length) {
    list.innerHTML = '<div class="empty-history">No moves yet. White to move.</div>';
    updateRewindBanner(); return;
  }

  const activeIdx = viewingIndex === -1 ? moveHistory.length - 1 : viewingIndex;

  moveHistory.forEach((m, i) => {
    const div = document.createElement('div');
    const isWhite = m.color === 'w';
    div.className = 'history-move' + (i === activeIdx ? ' active-move' : '');
    div.title = 'Jump to this position';
    div.innerHTML = `
      <span class="move-num">${isWhite ? Math.floor(i / 2) + 1 + '.' : '…'}</span>
      <span class="move-san ${isWhite ? 'white-move' : 'black-move'}">${m.san}</span>`;
    div.addEventListener('click', () => jumpToMove(i));
    list.appendChild(div);
  });

  const activeEl = list.querySelector('.active-move');
  if (activeEl) {
    if (scrollToBottom) list.scrollTop = list.scrollHeight;
    else activeEl.scrollIntoView({ block: 'nearest' });
  }
  updateRewindBanner();
}

// ─── HISTORY NAVIGATION ──────────────────────────────────────
function jumpToMove(index) {
  if (index < 0 || index >= moveHistory.length || index === viewingIndex) return;
  viewingIndex = index;
  chess = new Chess(fenHistory[index]);
  const m = moveHistory[index];
  lastMove = m.from ? { from: m.from, to: m.to } : null;
  selectedSq = null; legalMoves = [];
  updateBoard(); updateHistory(); updateRewindBanner();
  setMessage(`Viewing move ${Math.floor(index / 2) + 1}: ${m.san}`);
}

function returnToLive() {
  viewingIndex = -1;
  if (fenHistory.length > 0) {
    chess = new Chess(fenHistory[fenHistory.length - 1]);
    const last = moveHistory[moveHistory.length - 1];
    lastMove = last ? { from: last.from, to: last.to } : null;
  }
  selectedSq = null; legalMoves = [];
  updateBoard(); updateHistory(true); updateRewindBanner();
  setMessage("Back to live position.");
}

function updateRewindBanner() {
  const banner = document.getElementById('rewind-banner');
  if (!banner) return;
  if (viewingIndex !== -1 && moveHistory.length > 0) {
    banner.style.display = 'flex';
    document.getElementById('rewind-label').textContent =
      `Move ${Math.floor(viewingIndex / 2) + 1} of ${Math.ceil(moveHistory.length / 2)}`;
  } else {
    banner.style.display = 'none';
  }
}

// ─── RESET ───────────────────────────────────────────────────
function resetGame() {
  chess = new Chess();
  selectedSq = null; legalMoves = []; lastMove = null;
  moveHistory = []; fenHistory = []; viewingIndex = -1; dragSrc = null; lastAmbiguity = null;
  document.getElementById('gameover-overlay').classList.remove('visible');
  setMessage("Game reset. White to move.");
  updateHistory(); updateBoard(); updateRewindBanner();
}

// ─── VOICE — SPEECH RECOGNITION ──────────────────────────────
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

function initSpeech() {
  if (!SR) {
    document.getElementById('mic-btn').disabled = true;
    setMessage("Use Chrome for voice support."); return;
  }
  const btn = document.getElementById('mic-btn');
  btn.addEventListener('mousedown', startListening);
  btn.addEventListener('touchstart', startListening, { passive: true });
  btn.addEventListener('mouseup', stopListening);
  btn.addEventListener('mouseleave', stopListening);
  btn.addEventListener('touchend', stopListening);
  btn.onclick = null;
}

function startListening() {
  if (!SR) return;
  if (viewingIndex !== -1) { setMessage("Return to live position before using voice."); return; }
  if (chess.turn() !== 'w') { setMessage("Voice is only for White. Wait for Black's move."); return; }
  if (chess.game_over() || isListening) return;

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
    const transcripts = [];
    for (let i = 0; i < e.results[0].length; i++)
      transcripts.push(e.results[0][i].transcript.trim());
    setMessage(`Heard: "${transcripts[0]}"`);
    processVoiceCommand(transcripts[0], transcripts);
  };

  recognition.onerror = e => {
    if (e.error === 'not-allowed')
      setMessage("Microphone blocked. Allow mic access in browser settings.");
    else if (e.error !== 'no-speech' && e.error !== 'aborted')
      setMessage(`Error: ${e.error}. Try again.`);
    resetMicBtn();
  };

  recognition.onend = () => resetMicBtn();

  try {
    recognition.start();
    window._activeRecognition = recognition;
  } catch (err) {
    setMessage("Could not start mic. Try again.");
    resetMicBtn();
  }
}

function stopListening() {
  if (!isListening) return;
  try { if (window._activeRecognition) window._activeRecognition.stop(); } catch (_) { }
  resetMicBtn();
}

function resetMicBtn() {
  isListening = false;
  const btn = document.getElementById('mic-btn');
  btn.classList.remove('listening');
  btn.textContent = '🎤 Hold to Speak';
}

// ─── VOICE COMMAND PARSER ────────────────────────────────────
const WORD_TO_FILE = {
  'alpha': 'a', 'a': 'a',
  'bravo': 'b', 'b': 'b',
  'charlie': 'c', 'c': 'c', 'see': 'c', 'sea': 'c',
  'delta': 'd', 'd': 'd', 'dee': 'd',
  'echo': 'e', 'e': 'e', 'ee': 'e',
  'foxtrot': 'f', 'f': 'f', 'ef': 'f',
  'golf': 'g', 'g': 'g', 'gee': 'g',
  'hotel': 'h', 'h': 'h', 'aitch': 'h'
};

const PIECE_WORDS = {
  'pawn': 'p', 'pawns': 'p', 'pond': 'p', 'phone': 'p',
  'knight': 'n', 'night': 'n', 'horse': 'n', 'knife': 'n', 'nights': 'n', 'nite': 'n',
  'bishop': 'b', 'bishops': 'b',
  'rook': 'r', 'rooks': 'r', 'castle': 'r',
  'queen': 'q', 'queens': 'q',
  'king': 'k'
};

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const RANKS = ['1', '2', '3', '4', '5', '6', '7', '8'];

function normalizeSquare(word) {
  // word must be exactly 2 chars (e.g. "e4") OR a known word prefix + digit
  word = word.toLowerCase().replace(/[-\s]/g, '');

  // Direct match: exactly "e4", "d2" etc — must be exactly 2 chars
  if (word.length === 2 && FILES.includes(word[0]) && RANKS.includes(word[1]))
    return word;

  // Word prefix match: "echo4", "delta2" etc — word must be longer than 1 char
  // (single-letter words like "d" alone are NOT squares — they need a digit attached)
  if (word.length > 1) {
    for (const [key, file] of Object.entries(WORD_TO_FILE)) {
      if (word.startsWith(key)) {
        const rest = word.substring(key.length).trim();
        if (RANKS.includes(rest)) return file + rest;
      }
    }
  }
  return null;
}

function parseVoiceMove(text) {
  const original = text;
  text = text.toLowerCase().replace(/[.,!?]/g, '');

  // ── Step 1: Collapse any spaces between SAN-style tokens ──────────
  // Browser often hears "Nfd4" as "NFD 4", "N F D 4", "nf d4" etc.
  // Join all tokens first, then try to parse the joined string.
  const words = text.split(/\s+/);
  const joined = words.join(''); // e.g. "nfd4", "nfd4", "knight f d 4"

  let pieceType = null;
  let fileHint = null;
  let promotion = 'q';

  // ── Step 2: Detect piece word from individual tokens ─────────────
  for (const w of words) {
    if (PIECE_WORDS[w] && !pieceType) {
      pieceType = PIECE_WORDS[w];
    }
  }

  // ── Step 3: Try to detect SAN patterns in joined string ──────────
  // Handles: "nfd4", "ned4", "bbd5", "rfe1" etc.
  // Also: "fd4" with no piece letter (browser drops the N)
  const SAN_REGEX = /^([pnbrqk])([a-h])([a-h][1-8])$/;
  const sanMatch = joined.match(SAN_REGEX);
  if (sanMatch) {
    pieceType = PIECE_WORDS[sanMatch[1]] || sanMatch[1];
    fileHint = sanMatch[2];
    return { to: sanMatch[3], pieceType, fileHint, promotion };
  }

  // "fd4", "ed4" — file hint + square, no piece letter (browser dropped it)
  // Return fileHint so processVoiceCommand can use lastAmbiguity context
  const FILE_SQ_REGEX = /^([a-h])([a-h][1-8])$/;
  const fileSqMatch = joined.match(FILE_SQ_REGEX);
  if (fileSqMatch) {
    return { to: fileSqMatch[2], pieceType: null, fileHint: fileSqMatch[1], promotion };
  }

  // Full piece word prefix: "knightfd4", "knightfd4", "bishopbd5"
  for (const [pword, ptype] of Object.entries(PIECE_WORDS)) {
    if (joined.startsWith(pword)) {
      const rest = joined.slice(pword.length);
      const fileSquare = rest.match(/^([a-h])([a-h][1-8])$/);
      if (fileSquare) {
        return { to: fileSquare[2], pieceType: ptype, fileHint: fileSquare[1], promotion };
      }
      const justSquare = rest.match(/^([a-h][1-8])$/);
      if (justSquare) {
        return { to: justSquare[1], pieceType: ptype, fileHint: null, promotion };
      }
    }
  }

  // ── Step 4: Castling ─────────────────────────────────────────────
  if (text.includes('castle kingside') || text.includes('king side') || text.includes('short castle') || joined === 'oo')
    return { special: 'castle-kingside' };
  if (text.includes('castle queenside') || text.includes('queen side') || text.includes('long castle') || joined === 'ooo')
    return { special: 'castle-queenside' };

  // ── Step 5: Normal square-based parsing ──────────────────────────
  const squares = [];

  for (let i = 0; i < words.length; i++) {
    const w = words[i];

    // Skip filler and piece words
    if (PIECE_WORDS[w] || ['to', 'from', 'the', 'my', 'a', 'at'].includes(w)) continue;

    // Bare file hint right after piece word (e.g. "knight F d4" → skip "f")
    if (FILES.includes(w) && w.length === 1 && i > 0 && PIECE_WORDS[words[i - 1]]) {
      fileHint = w;
      continue;
    }

    // SAN word like "nfd4" as single token
    const sanW = w.match(/^([pnbrqk])([a-h])([a-h][1-8])$/);
    if (sanW) {
      if (!pieceType) pieceType = PIECE_WORDS[sanW[1]] || sanW[1];
      fileHint = sanW[2];
      const sq = sanW[3];
      if (!squares.includes(sq)) squares.push(sq);
      continue;
    }

    // Normal 2-char square "e4", "d4"
    const sq = normalizeSquare(w);
    if (sq) { if (!squares.includes(sq)) squares.push(sq); continue; }

    // Two-word square: "echo 4" → "e4"
    if (i + 1 < words.length) {
      const sq2 = normalizeSquare(w + words[i + 1]);
      if (sq2) { if (!squares.includes(sq2)) squares.push(sq2); i++; continue; }
    }
  }

  // Two squares = from + to
  if (squares.length >= 2) return { from: squares[0], to: squares[1], promotion };

  // One square = destination
  if (squares.length === 1) {
    return { to: squares[0], pieceType, fileHint, promotion };
  }

  return null;
}


// ─── OPENING DETECTION ───────────────────────────────────────

async function detectAndShowOpening() {
  if (moveHistory.length === 0) {
    setMessage("Play some moves first, then ask which opening this is.");
    speak("Play some moves first.");
    return;
  }

  setMessage("Analyzing opening…");
  speak("Analyzing opening.");
  showOpeningBanner('loading');

  // Build a compact move list for Gemini
  const moves = moveHistory.map((m, i) => {
    const num = Math.floor(i / 2) + 1;
    return i % 2 === 0 ? `${num}.${m.san}` : m.san;
  }).join(' ');

  const fen = chess.fen();

  // Extract White's moves only (indices 0, 2, 4, 6...) from first 6 full moves
  const whiteMoves = moveHistory
    .filter((_, i) => i % 2 === 0)
    .slice(0, 6)
    .map((m, i) => `${i + 1}.${m.san}`)
    .join(' ');

  // First 6 full moves for context
  const earlyMoves = moveHistory.slice(0, 12).map((m, i) => {
    const num = Math.floor(i / 2) + 1;
    return i % 2 === 0 ? `${num}.${m.san}` : m.san;
  }).join(' ');

  const prompt = `You are a chess opening expert. I need you to identify what opening WHITE is playing.

White's moves (focus ONLY on these): ${whiteMoves}
Full game for context: ${earlyMoves}

CRITICAL RULES:
- Identify the opening from WHITE's point of view ONLY
- The opening name describes what WHITE is doing, not Black
- Examples:
  * White plays 1.e4 → it's an "e4 opening" (King's Pawn)
  * White plays 1.d4 Nf3 c4 → English/Queen's Pawn system
  * White plays 1.e4 and then Nf3 Bc4 → Italian Game (regardless of what Black plays)
  * White plays 1.e4 then d4 → Center Game
  * Caro-Kann is BLACK's opening response, NEVER name it as White's opening
  * Sicilian is BLACK's response, NEVER name it as White's opening
- Name the opening by what WHITE is building: Italian, Ruy Lopez, King's Gambit, London System, Queen's Gambit, English, Catalan, etc.
- Be specific with the variation name

Respond with ONLY valid JSON, no markdown, no explanation:
{
  "name": "Opening Name from White's perspective",
  "moves": ["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5"]
}

The "moves" array = canonical first 5-6 moves of this opening (both colors) in SAN notation.
Return ONLY the JSON object, nothing else.`;

  try {
    const response = await fetch('/api/gemini', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt })
    });

    const data = await response.json();

    if (!response.ok) {
      // Show the actual server error so we can debug
      const errMsg = data.error || 'Server error';
      // Rate limit — give friendly message
      if (errMsg.includes('429') || errMsg.includes('quota') || errMsg.includes('Too Many')) {
        hideOpeningBanner();
        setMessage("Gemini rate limit hit. Wait 60 seconds and try again.");
        speak("Rate limit hit. Please wait a moment.");
        return;
      }
      throw new Error(errMsg);
    }

    // Parse JSON from Gemini response
    let parsed;
    try {
      const clean = data.text.replace(/```json|```/g, '').trim();
      parsed = JSON.parse(clean);
    } catch {
      throw new Error('Could not parse opening data: ' + data.text?.substring(0, 100));
    }

    const { name, moves: openingMoves } = parsed;
    if (!name || !openingMoves || !Array.isArray(openingMoves)) throw new Error('Invalid response format');

    // Save current game state before demo
    openingSnapshot = {
      fen: chess.fen(),
      moveHistory: [...moveHistory],
      fenHistory: [...fenHistory],
      lastMove: lastMove ? { ...lastMove } : null,
      viewingIndex: viewingIndex
    };

    // Ensure we have moves to show — pad or trim to exactly 6
    const movesToShow = openingMoves.slice(0, 6);
    if (movesToShow.length === 0) throw new Error('No moves returned');

    // Show the opening name in banner
    showOpeningBanner('demo', name);
    speak(`${name}`);

    // Reset board to starting position for demo
    chess = new Chess();
    lastMove = null;
    selectedSq = null;
    legalMoves = [];
    viewingIndex = -1;
    updateBoard();

    // Small pause so user sees the reset before moves start
    await new Promise(r => setTimeout(r, 600));
    if (!openingSnapshot) return; // user cancelled during pause

    setMessage(`"${name}" — watching ${movesToShow.length} moves.`);

    // Helper: speak and wait until speech finishes before resolving
    function speakAndWait(text) {
      return new Promise(resolve => {
        if (isMuted) { resolve(); return; }
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.rate = 1.1;
        u.onend = () => resolve();
        // Fallback in case onend never fires (some browsers)
        setTimeout(resolve, 3000);
        window.speechSynthesis.speak(u);
      });
    }

    // Play moves one by one — speak first, then make the move, then pause
    for (let i = 0; i < movesToShow.length; i++) {
      if (!openingSnapshot) return; // user hit "Return to My Game"

      const san = movesToShow[i];
      const moveNum = Math.floor(i / 2) + 1;
      const color = i % 2 === 0 ? 'White' : 'Black';

      // 1. Announce the move first
      const bannerName = document.getElementById('opening-name');
      if (bannerName) {
        bannerName.textContent = `${name}  ·  Move ${moveNum}: ${color} plays ${san}`;
      }
      setMessage(`Move ${moveNum}: ${color} plays ${san}`);

      // 2. Wait for speech to finish
      await speakAndWait(`${color} plays ${san}`);
      if (!openingSnapshot) return;

      // 3. Now make the move on the board
      try {
        const result = chess.move(san);
        if (result) {
          lastMove = { from: result.from, to: result.to };
          updateBoard();
        }
      } catch (_) { }

      // 4. Short pause after the move so user can see it before next announcement
      if (i < movesToShow.length - 1) {
        await new Promise(r => setTimeout(r, 800));
      }
    }

    // All moves played — final state
    if (openingSnapshot) {
      const bannerName = document.getElementById('opening-name');
      if (bannerName) bannerName.textContent = name;
      setMessage(`"${name}" — ${movesToShow.length} moves shown. Click ▶ Return to My Game when ready.`);
      speak("Opening complete. Click return to my game when ready.");
    }

  } catch (err) {
    hideOpeningBanner();
    setMessage(`Couldn't detect opening. Try again.`);
    speak("Couldn't detect the opening.");
  }
}

function returnToGame() {
  if (!openingSnapshot) return;

  // Restore the saved game state
  chess = new Chess(openingSnapshot.fen);
  moveHistory = openingSnapshot.moveHistory;
  fenHistory = openingSnapshot.fenHistory;
  lastMove = openingSnapshot.lastMove;
  viewingIndex = openingSnapshot.viewingIndex;
  openingSnapshot = null;

  selectedSq = null;
  legalMoves = [];

  hideOpeningBanner();
  updateBoard();
  updateHistory(true);
  setMessage("Back to your game.");
  speak("Back to your game.");
}

function showOpeningBanner(state, name) {
  const banner = document.getElementById('opening-banner');
  const nameEl = document.getElementById('opening-name');
  const loadEl = document.getElementById('opening-loading');
  const returnBtn = document.getElementById('opening-return-btn');

  if (state === 'loading') {
    banner.style.display = 'flex';
    nameEl.style.display = 'none';
    loadEl.style.display = 'flex';
    returnBtn.style.display = 'none';
  } else {
    banner.style.display = 'flex';
    nameEl.textContent = name;
    nameEl.style.display = 'block';
    loadEl.style.display = 'none';
    returnBtn.style.display = 'inline-flex';
  }
}

function hideOpeningBanner() {
  document.getElementById('opening-banner').style.display = 'none';
}

// ─── VOICE HISTORY NAVIGATION ───────────────────────────────
// Returns true if the text was a navigation command (so caller can skip move parsing)
function tryVoiceNavigation(text) {
  const t = text.toLowerCase().replace(/[.,!?]/g, '');

  // ── Opening detection ─────────────────────────────────────
  if (/(?:which|what|show me|identify|name|tell me).*opening|show.*opening|opening.*this|what opening/.test(t)) {
    detectAndShowOpening(); return true;
  }

  // ── Return to game ────────────────────────────────────────
  if (/return to (?:my )?game|back to (?:my )?game|exit opening|close opening/.test(t)) {
    if (openingSnapshot) { returnToGame(); return true; }
  }

  // ── "go back N moves" / "back N" / "rewind N" ────────────
  const backMatch = t.match(/(?:go\s+)?(?:back|rewind|undo|previous|prev)\s+(\w+)\s*(?:move|moves|step|steps)?/)
    || t.match(/(\w+)\s+(?:move|moves|step|steps)?\s*(?:back|ago)/);
  if (backMatch) {
    const n = wordToNumber(backMatch[1]);
    if (n !== null && n > 0) {
      const target = (viewingIndex === -1 ? moveHistory.length - 1 : viewingIndex) - n;
      const clamped = Math.max(0, target);
      jumpToMove(clamped);
      const msg = `Went back ${n} move${n > 1 ? 's' : ''}.`;
      setMessage(msg); speak(msg); return true;
    }
  }

  // ── "go back" / "back" / "previous move" (1 step) ────────
  if (/^(?:go\s+)?(?:back|rewind|previous\s+move|prev\s+move|one\s+back|step\s+back)$/.test(t)) {
    const cur = viewingIndex === -1 ? moveHistory.length - 1 : viewingIndex;
    if (cur > 0) { jumpToMove(cur - 1); setMessage("One move back."); speak("One move back."); }
    else { setMessage("Already at the beginning."); speak("Already at the beginning."); }
    return true;
  }

  // ── "go forward" / "next move" / "forward N" ─────────────
  const fwdMatch = t.match(/(?:go\s+)?(?:forward|next)\s+(\w+)\s*(?:move|moves|step|steps)?/);
  if (fwdMatch) {
    const n = wordToNumber(fwdMatch[1]);
    if (n !== null && n > 0) {
      const target = (viewingIndex === -1 ? moveHistory.length - 1 : viewingIndex) + n;
      const clamped = Math.min(moveHistory.length - 1, target);
      if (viewingIndex === -1) { setMessage("Already at the latest move."); speak("Already at latest."); }
      else { jumpToMove(clamped); const msg = `Went forward ${n} move${n > 1 ? 's' : ''}.`; setMessage(msg); speak(msg); }
      return true;
    }
  }

  if (/^(?:go\s+)?(?:forward|next\s+move|one\s+forward|step\s+forward)$/.test(t)) {
    if (viewingIndex === -1) { setMessage("Already at the latest move."); speak("Already at latest move."); }
    else {
      const next = viewingIndex + 1;
      if (next >= moveHistory.length) returnToLive();
      else jumpToMove(next);
      setMessage("One move forward."); speak("One move forward.");
    }
    return true;
  }

  // ── "show move 10" / "go to move 10" / "move 10" ─────────
  const showMatch = t.match(/(?:show(?:\s+me)?|go\s+to|jump\s+to)?\s*move\s+(\w+)/)
    || t.match(/^(\w+)(?:st|nd|rd|th)?\s+move$/);
  if (showMatch) {
    const n = wordToNumber(showMatch[1]);
    if (n !== null && n >= 1) {
      // Move N = index (N*2 - 2) for white, or nearby — find closest half-move index
      const halfMoveIdx = (n - 1) * 2;  // white's move N is index (N-1)*2
      const clamped = Math.min(moveHistory.length - 1, halfMoveIdx);
      jumpToMove(clamped);
      const msg = `Showing move ${n}.`;
      setMessage(msg); speak(msg); return true;
    }
  }

  // ── "first move" / "beginning" / "start" ─────────────────
  if (/(?:first\s+move|beginning|start\s+over|go\s+to\s+start|go\s+to\s+beginning)/.test(t)) {
    if (moveHistory.length > 0) { jumpToMove(0); setMessage("At the first move."); speak("At the first move."); }
    else { setMessage("No moves yet."); speak("No moves yet."); }
    return true;
  }

  // ── "last move" / "latest" / "return to live" / "live" ───
  if (/(?:last\s+move|latest|return\s+to\s+live|go\s+live|resume|current\s+position)/.test(t)) {
    returnToLive(); return true;
  }

  return false; // not a navigation command
}

// Convert number words AND digits to integer
function wordToNumber(word) {
  if (!word) return null;
  const num = parseInt(word, 10);
  if (!isNaN(num)) return num;
  const MAP = {
    'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
    'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10,
    'eleven': 11, 'twelve': 12, 'thirteen': 13, 'fourteen': 14, 'fifteen': 15,
    'sixteen': 16, 'seventeen': 17, 'eighteen': 18, 'nineteen': 19, 'twenty': 20,
    'a': 1, 'an': 1, 'the': null
  };
  return MAP[word.toLowerCase()] ?? null;
}

function processVoiceCommand(text, alternatives) {
  // ── Check navigation commands first (work regardless of turn) ──
  const allTexts = alternatives && alternatives.length > 1 ? [text, ...alternatives] : [text];
  for (const t of allTexts) {
    if (tryVoiceNavigation(t)) return;
  }

  if (chess.turn() !== 'w') { setMessage("It's not White's turn."); return; }

  const toTry = (alternatives && alternatives.length > 1) ? alternatives : [text];

  // Sort: put transcripts that contain a piece word first
  toTry.sort((a, b) => {
    const aHasPiece = a.toLowerCase().split(/\s+/).some(w => PIECE_WORDS[w]);
    const bHasPiece = b.toLowerCase().split(/\s+/).some(w => PIECE_WORDS[w]);
    if (aHasPiece && !bHasPiece) return -1;
    if (!aHasPiece && bHasPiece) return 1;
    return 0;
  });

  for (const transcript of toTry) {
    const parsed = parseVoiceMove(transcript);
    if (!parsed) continue;

    if (parsed.special === 'castle-kingside') {
      if (tryMove('e1', 'g1')) { setMessage("Castled kingside!"); speak("Castled kingside"); return; }
      continue;
    }
    if (parsed.special === 'castle-queenside') {
      if (tryMove('e1', 'c1')) { setMessage("Castled queenside!"); speak("Castled queenside"); return; }
      continue;
    }

    if (parsed.from && parsed.to) {
      if (tryMove(parsed.from, parsed.to, parsed.promotion)) {
        const last = moveHistory[moveHistory.length - 1];
        const msg = `Moved ${last ? last.san : 'piece'}.`;
        setMessage(msg); speak(msg); return;
      }
      continue;
    }

    if (parsed.to) {
      // ── If we have a fileHint but no pieceType, try to resolve using lastAmbiguity ──
      let resolvedPieceType = parsed.pieceType;
      if (!resolvedPieceType && parsed.fileHint && lastAmbiguity && lastAmbiguity.to === parsed.to) {
        resolvedPieceType = lastAmbiguity.pieceType;
      }
      // Also: if fileHint+to resolves to exactly one candidate from lastAmbiguity, use it
      if (!resolvedPieceType && parsed.fileHint && lastAmbiguity) {
        const fromFile = lastAmbiguity.candidates &&
          lastAmbiguity.candidates.find(m => m.from[0] === parsed.fileHint);
        if (fromFile) {
          resolvedPieceType = fromFile.piece;
          // If the to squares differ, it might be a different move entirely — let it fall through
        }
      }

      // Get all legal moves to this square, verified against actual board state
      let allToSquare = chess.moves({ verbose: true })
        .filter(m => m.to === parsed.to)
        .filter(m => {
          const p = chess.get(m.from);
          return p && p.type === m.piece && p.color === chess.turn();
        });

      // Deduplicate by from+piece
      const seen = new Set();
      allToSquare = allToSquare.filter(m => {
        const key = m.from + m.piece;
        if (seen.has(key)) return false;
        seen.add(key); return true;
      });

      let candidates = allToSquare;

      // Apply piece type filter
      if (resolvedPieceType) {
        candidates = allToSquare.filter(m => m.piece === resolvedPieceType);
      } else {
        // No piece word — remove pawns
        const nonPawn = allToSquare.filter(m => m.piece !== 'p');
        if (nonPawn.length > 0) candidates = nonPawn;
      }

      // Apply file hint — "fd4" → only pieces coming from f-file
      if (parsed.fileHint && candidates.length > 1) {
        const hinted = candidates.filter(m => m.from[0] === parsed.fileHint);
        if (hinted.length > 0) candidates = hinted;
      }

      if (candidates.length === 1) {
        const m = candidates[0];
        if (tryMove(m.from, m.to, parsed.promotion)) {
          const pName = { p: 'Pawn', n: 'Knight', b: 'Bishop', r: 'Rook', q: 'Queen', k: 'King' }[m.piece] || m.piece;
          const msg = `${pName} to ${parsed.to}.`;
          setMessage(msg); speak(msg); return;
        }
      } else if (candidates.length > 1) {
        const PNAME = { p: 'Pawn', n: 'Knight', b: 'Bishop', r: 'Rook', q: 'Queen', k: 'King' };
        const PSHORT = { p: 'P', n: 'N', b: 'B', r: 'R', q: 'Q', k: 'K' };
        const pName = PNAME[candidates[0].piece] || 'piece';
        const pShort = PSHORT[candidates[0].piece] || '';
        const dest = parsed.to;  // e.g. "d4"

        // Build examples: "Nfd4 or Ned4" and "Knight fd4 or Knight ed4"
        const shortExamples = candidates.map(m => pShort + m.from[0] + dest).join(' or ');
        const longExamples = candidates.map(m => pName + ' ' + m.from[0] + dest).join(' or ');

        const spokenMsg = `Ambiguous. Two ${pName}s can go to ${dest}. Say ${longExamples}.`;
        const displayMsg = `Two ${pName}s can reach ${dest}.
Say: "${shortExamples}" or "${longExamples}"`;
        setMessage(displayMsg); speak(spokenMsg); return;
      } else {
        continue;
      }
    }
  }

  setMessage(`Didn't understand: "${text}". Try "pawn to e4" or "knight to f3".`);
  speak("Sorry, I didn't understand that.");
}

// ─── SPEECH SYNTHESIS ────────────────────────────────────────
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

// ─── MUTE ────────────────────────────────────────────────────
document.getElementById('mute-btn').addEventListener('click', function () {
  isMuted = !isMuted;
  this.textContent = isMuted ? '🔇' : '🔊';
  if (isMuted) window.speechSynthesis.cancel();
});

// ─── INIT ────────────────────────────────────────────────────
buildBoard();
initSpeech();// ─── BUILD BOARD (once on load) ──────────────────────────────
function buildBoard() {
  const board = document.getElementById('board');
  const rankCoords = document.getElementById('rank-coords');
  const fileCoords = document.getElementById('file-coords');
  board.innerHTML = '';

  rankCoords.innerHTML = '';
  for (let r = 8; r >= 1; r--) {
    const d = document.createElement('div');
    d.textContent = r;
    rankCoords.appendChild(d);
  }

  fileCoords.innerHTML = '';
  ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].forEach(f => {
    const d = document.createElement('div');
    d.className = 'coord-file-label';
    d.textContent = f;
    fileCoords.appendChild(d);
  });

  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const sq = String.fromCharCode(97 + col) + (8 - row);
      const div = document.createElement('div');
      div.className = 'square ' + ((row + col) % 2 === 0 ? 'light' : 'dark');
      div.dataset.sq = sq;

      div.addEventListener('dragover', e => e.preventDefault());
      div.addEventListener('drop', e => { e.preventDefault(); handleDrop(sq); });
      div.addEventListener('click', () => handleSquareClick(sq));
      board.appendChild(div);
    }
  }

  updateBoard();
}

// ─── RENDER BOARD ────────────────────────────────────────────
function updateBoard() {
  document.querySelectorAll('.square').forEach(sq => {
    const sqName = sq.dataset.sq;

    sq.classList.remove(
      'selected', 'legal-move', 'legal-capture',
      'last-from', 'last-to', 'in-check', 'dragging'
    );

    if (lastMove) {
      if (sqName === lastMove.from) sq.classList.add('last-from');
      if (sqName === lastMove.to) sq.classList.add('last-to');
    }

    if (sqName === selectedSq) sq.classList.add('selected');

    const lm = legalMoves.find(m => m.to === sqName);
    if (lm) sq.classList.add(chess.get(sqName) ? 'legal-capture' : 'legal-move');

    if (chess.in_check()) {
      const t = chess.turn();
      ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].forEach(file => {
        for (let rank = 1; rank <= 8; rank++) {
          const p = chess.get(file + rank);
          if (p && p.type === 'k' && p.color === t && (file + rank) === sqName)
            sq.classList.add('in-check');
        }
      });
    }

    // Render piece
    sq.innerHTML = '';
    const piece = chess.get(sqName);
    if (piece) {
      const span = document.createElement('span');
      span.className = 'piece';
      const img = document.createElement('img');
      img.src = PIECE_URLS[pieceKey(piece)] || '';
      img.draggable = false;
      span.appendChild(img);

      // Drag source must be on the square (pointer-events: none on .piece)
      sq.draggable = true;
      sq.addEventListener('dragstart', e => {
        dragSrc = sqName;

        // Use only the piece image as drag ghost — no square background
        const pieceImg = sq.querySelector('.piece img');
        if (pieceImg && e.dataTransfer.setDragImage) {
          // Create an off-screen canvas to render just the piece
          const size = sq.getBoundingClientRect().width;
          const ghost = document.createElement('img');
          ghost.src = pieceImg.src;
          ghost.style.cssText = `
            position: fixed; top: -9999px; left: -9999px;
            width: ${size}px; height: ${size}px;
            pointer-events: none;
          `;
          document.body.appendChild(ghost);
          e.dataTransfer.setDragImage(ghost, size / 2, size / 2);
          // Remove ghost after drag starts
          setTimeout(() => ghost.remove(), 0);
        }

        setTimeout(() => sq.classList.add('dragging'), 0);
        e.dataTransfer.effectAllowed = 'move';
      }, { once: true });
      sq.addEventListener('dragend', () => {
        sq.classList.remove('dragging');
        dragSrc = null;
      }, { once: true });

      sq.appendChild(span);
    } else {
      sq.draggable = false;
    }
  });

  updateStatus();
}

// ─── DRAG & DROP ─────────────────────────────────────────────
function handleDrop(targetSq) {
  if (!dragSrc) return;
  if (viewingIndex !== -1) {
    setMessage("Viewing past position — click ▶ Return to Live to play.");
    dragSrc = null; return;
  }
  tryMove(dragSrc, targetSq);
  dragSrc = null;
}

// ─── CLICK TO MOVE ───────────────────────────────────────────
function handleSquareClick(sq) {
  if (viewingIndex !== -1) {
    setMessage("Viewing past position — click ▶ Return to Live to play.");
    return;
  }
  if (chess.turn() !== 'w') return;

  const piece = chess.get(sq);

  if (!selectedSq) {
    if (piece && piece.color === 'w') {
      selectedSq = sq;
      legalMoves = chess.moves({ square: sq, verbose: true });
      updateBoard();
    }
    return;
  }

  if (sq === selectedSq) { selectedSq = null; legalMoves = []; updateBoard(); return; }

  if (piece && piece.color === 'w') {
    selectedSq = sq;
    legalMoves = chess.moves({ square: sq, verbose: true });
    updateBoard(); return;
  }

  tryMove(selectedSq, sq);
}

// ─── EXECUTE MOVE ────────────────────────────────────────────
function tryMove(from, to, promotion) {
  if (viewingIndex !== -1) returnToLive();

  const piece = chess.get(from);
  const isPromotion = piece && piece.type === 'p' &&
    ((piece.color === 'w' && to[1] === '8') || (piece.color === 'b' && to[1] === '1'));

  const result = chess.move({ from, to, promotion: promotion || (isPromotion ? 'q' : undefined) });
  if (!result) { selectedSq = null; legalMoves = []; updateBoard(); return false; }

  lastMove = { from: result.from, to: result.to };
  lastAmbiguity = null;
  selectedSq = null; legalMoves = []; viewingIndex = -1;
  moveHistory.push({ san: result.san, color: result.color, from: result.from, to: result.to });
  fenHistory.push(chess.fen());

  updateHistory(true);
  updateBoard();
  checkGameOver();
  if (!chess.game_over() && chess.turn() === 'b') setTimeout(blackMove, 650);
  return true;
}

// ─── BLACK ENGINE (random legal) ─────────────────────────────
function blackMove() {
  const moves = chess.moves({ verbose: true });
  if (!moves.length) return;
  const result = chess.move(moves[Math.floor(Math.random() * moves.length)]);
  if (result) {
    lastMove = { from: result.from, to: result.to };
    moveHistory.push({ san: result.san, color: result.color, from: result.from, to: result.to });
    fenHistory.push(chess.fen());
    viewingIndex = -1;
    updateHistory(true);
    updateBoard();
    checkGameOver();
  }
}

// ─── GAME OVER ───────────────────────────────────────────────
function checkGameOver() {
  if (!chess.game_over()) return;
  const overlay = document.getElementById('gameover-overlay');
  const title = document.getElementById('gameover-title');
  const sub = document.getElementById('gameover-sub');
  overlay.classList.add('visible');
  if (chess.in_checkmate()) {
    title.textContent = 'Checkmate';
    sub.textContent = `${chess.turn() === 'w' ? 'Black' : 'White'} wins.`;
  } else {
    title.textContent = 'Draw';
    sub.textContent = chess.in_stalemate() ? 'Stalemate.' : 'Draw by repetition or 50-move rule.';
  }
}

// ─── STATUS BAR ──────────────────────────────────────────────
function updateStatus() {
  const turn = chess.turn();
  document.getElementById('turn-dot').className = 'turn-dot ' + (turn === 'w' ? 'white' : 'black');
  document.getElementById('turn-label').textContent = turn === 'w' ? "White's Turn" : "Black's Turn (Engine)";
  document.getElementById('check-label').classList.toggle('visible', chess.in_check());
}

// ─── HISTORY PANEL ───────────────────────────────────────────
function updateHistory(scrollToBottom) {
  const list = document.getElementById('history-list');
  const count = document.getElementById('move-count');
  list.innerHTML = '';
  count.textContent = moveHistory.length + ' moves';

  if (!moveHistory.length) {
    list.innerHTML = '<div class="empty-history">No moves yet. White to move.</div>';
    updateRewindBanner(); return;
  }

  const activeIdx = viewingIndex === -1 ? moveHistory.length - 1 : viewingIndex;

  moveHistory.forEach((m, i) => {
    const div = document.createElement('div');
    const isWhite = m.color === 'w';
    div.className = 'history-move' + (i === activeIdx ? ' active-move' : '');
    div.title = 'Jump to this position';
    div.innerHTML = `
      <span class="move-num">${isWhite ? Math.floor(i / 2) + 1 + '.' : '…'}</span>
      <span class="move-san ${isWhite ? 'white-move' : 'black-move'}">${m.san}</span>`;
    div.addEventListener('click', () => jumpToMove(i));
    list.appendChild(div);
  });

  const activeEl = list.querySelector('.active-move');
  if (activeEl) {
    if (scrollToBottom) list.scrollTop = list.scrollHeight;
    else activeEl.scrollIntoView({ block: 'nearest' });
  }
  updateRewindBanner();
}

// ─── HISTORY NAVIGATION ──────────────────────────────────────
function jumpToMove(index) {
  if (index < 0 || index >= moveHistory.length || index === viewingIndex) return;
  viewingIndex = index;
  chess = new Chess(fenHistory[index]);
  const m = moveHistory[index];
  lastMove = m.from ? { from: m.from, to: m.to } : null;
  selectedSq = null; legalMoves = [];
  updateBoard(); updateHistory(); updateRewindBanner();
  setMessage(`Viewing move ${Math.floor(index / 2) + 1}: ${m.san}`);
}

function returnToLive() {
  viewingIndex = -1;
  if (fenHistory.length > 0) {
    chess = new Chess(fenHistory[fenHistory.length - 1]);
    const last = moveHistory[moveHistory.length - 1];
    lastMove = last ? { from: last.from, to: last.to } : null;
  }
  selectedSq = null; legalMoves = [];
  updateBoard(); updateHistory(true); updateRewindBanner();
  setMessage("Back to live position.");
}

function updateRewindBanner() {
  const banner = document.getElementById('rewind-banner');
  if (!banner) return;
  if (viewingIndex !== -1 && moveHistory.length > 0) {
    banner.style.display = 'flex';
    document.getElementById('rewind-label').textContent =
      `Move ${Math.floor(viewingIndex / 2) + 1} of ${Math.ceil(moveHistory.length / 2)}`;
  } else {
    banner.style.display = 'none';
  }
}

// ─── RESET ───────────────────────────────────────────────────
function resetGame() {
  chess = new Chess();
  selectedSq = null; legalMoves = []; lastMove = null;
  moveHistory = []; fenHistory = []; viewingIndex = -1; dragSrc = null; lastAmbiguity = null;
  document.getElementById('gameover-overlay').classList.remove('visible');
  setMessage("Game reset. White to move.");
  updateHistory(); updateBoard(); updateRewindBanner();
}

// ─── VOICE — SPEECH RECOGNITION ──────────────────────────────

function initSpeech() {
  if (!SR) {
    document.getElementById('mic-btn').disabled = true;
    setMessage("Use Chrome for voice support."); return;
  }
  const btn = document.getElementById('mic-btn');
  btn.addEventListener('mousedown', startListening);
  btn.addEventListener('touchstart', startListening, { passive: true });
  btn.addEventListener('mouseup', stopListening);
  btn.addEventListener('mouseleave', stopListening);
  btn.addEventListener('touchend', stopListening);
  btn.onclick = null;
}

function startListening() {
  if (!SR) return;
  if (viewingIndex !== -1) { setMessage("Return to live position before using voice."); return; }
  if (chess.turn() !== 'w') { setMessage("Voice is only for White. Wait for Black's move."); return; }
  if (chess.game_over() || isListening) return;

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
    const transcripts = [];
    for (let i = 0; i < e.results[0].length; i++)
      transcripts.push(e.results[0][i].transcript.trim());
    setMessage(`Heard: "${transcripts[0]}"`);
    processVoiceCommand(transcripts[0], transcripts);
  };

  recognition.onerror = e => {
    if (e.error === 'not-allowed')
      setMessage("Microphone blocked. Allow mic access in browser settings.");
    else if (e.error !== 'no-speech' && e.error !== 'aborted')
      setMessage(`Error: ${e.error}. Try again.`);
    resetMicBtn();
  };

  recognition.onend = () => resetMicBtn();

  try {
    recognition.start();
    window._activeRecognition = recognition;
  } catch (err) {
    setMessage("Could not start mic. Try again.");
    resetMicBtn();
  }
}

function stopListening() {
  if (!isListening) return;
  try { if (window._activeRecognition) window._activeRecognition.stop(); } catch (_) { }
  resetMicBtn();
}

function resetMicBtn() {
  isListening = false;
  const btn = document.getElementById('mic-btn');
  btn.classList.remove('listening');
  btn.textContent = '🎤 Hold to Speak';
}

// ─── VOICE COMMAND PARSER ────────────────────────────────────
function normalizeSquare(word) {
  // word must be exactly 2 chars (e.g. "e4") OR a known word prefix + digit
  word = word.toLowerCase().replace(/[-\s]/g, '');

  // Direct match: exactly "e4", "d2" etc — must be exactly 2 chars
  if (word.length === 2 && FILES.includes(word[0]) && RANKS.includes(word[1]))
    return word;

  // Word prefix match: "echo4", "delta2" etc — word must be longer than 1 char
  // (single-letter words like "d" alone are NOT squares — they need a digit attached)
  if (word.length > 1) {
    for (const [key, file] of Object.entries(WORD_TO_FILE)) {
      if (word.startsWith(key)) {
        const rest = word.substring(key.length).trim();
        if (RANKS.includes(rest)) return file + rest;
      }
    }
  }
  return null;
}

function parseVoiceMove(text) {
  const original = text;
  text = text.toLowerCase().replace(/[.,!?]/g, '');

  // ── Step 1: Collapse any spaces between SAN-style tokens ──────────
  // Browser often hears "Nfd4" as "NFD 4", "N F D 4", "nf d4" etc.
  // Join all tokens first, then try to parse the joined string.
  const words = text.split(/\s+/);
  const joined = words.join(''); // e.g. "nfd4", "nfd4", "knight f d 4"

  let pieceType = null;
  let fileHint = null;
  let promotion = 'q';

  // ── Step 2: Detect piece word from individual tokens ─────────────
  for (const w of words) {
    if (PIECE_WORDS[w] && !pieceType) {
      pieceType = PIECE_WORDS[w];
    }
  }

  // ── Step 3: Try to detect SAN patterns in joined string ──────────
  // Handles: "nfd4", "ned4", "bbd5", "rfe1" etc.
  // Also: "fd4" with no piece letter (browser drops the N)
  const SAN_REGEX = /^([pnbrqk])([a-h])([a-h][1-8])$/;
  const sanMatch = joined.match(SAN_REGEX);
  if (sanMatch) {
    pieceType = PIECE_WORDS[sanMatch[1]] || sanMatch[1];
    fileHint = sanMatch[2];
    return { to: sanMatch[3], pieceType, fileHint, promotion };
  }

  // "fd4", "ed4" — file hint + square, no piece letter (browser dropped it)
  // Return fileHint so processVoiceCommand can use lastAmbiguity context
  const FILE_SQ_REGEX = /^([a-h])([a-h][1-8])$/;
  const fileSqMatch = joined.match(FILE_SQ_REGEX);
  if (fileSqMatch) {
    return { to: fileSqMatch[2], pieceType: null, fileHint: fileSqMatch[1], promotion };
  }

  // Full piece word prefix: "knightfd4", "knightfd4", "bishopbd5"
  for (const [pword, ptype] of Object.entries(PIECE_WORDS)) {
    if (joined.startsWith(pword)) {
      const rest = joined.slice(pword.length);
      const fileSquare = rest.match(/^([a-h])([a-h][1-8])$/);
      if (fileSquare) {
        return { to: fileSquare[2], pieceType: ptype, fileHint: fileSquare[1], promotion };
      }
      const justSquare = rest.match(/^([a-h][1-8])$/);
      if (justSquare) {
        return { to: justSquare[1], pieceType: ptype, fileHint: null, promotion };
      }
    }
  }

  // ── Step 4: Castling ─────────────────────────────────────────────
  if (text.includes('castle kingside') || text.includes('king side') || text.includes('short castle') || joined === 'oo')
    return { special: 'castle-kingside' };
  if (text.includes('castle queenside') || text.includes('queen side') || text.includes('long castle') || joined === 'ooo')
    return { special: 'castle-queenside' };

  // ── Step 5: Normal square-based parsing ──────────────────────────
  const squares = [];

  for (let i = 0; i < words.length; i++) {
    const w = words[i];

    // Skip filler and piece words
    if (PIECE_WORDS[w] || ['to', 'from', 'the', 'my', 'a', 'at'].includes(w)) continue;

    // Bare file hint right after piece word (e.g. "knight F d4" → skip "f")
    if (FILES.includes(w) && w.length === 1 && i > 0 && PIECE_WORDS[words[i - 1]]) {
      fileHint = w;
      continue;
    }

    // SAN word like "nfd4" as single token
    const sanW = w.match(/^([pnbrqk])([a-h])([a-h][1-8])$/);
    if (sanW) {
      if (!pieceType) pieceType = PIECE_WORDS[sanW[1]] || sanW[1];
      fileHint = sanW[2];
      const sq = sanW[3];
      if (!squares.includes(sq)) squares.push(sq);
      continue;
    }

    // Normal 2-char square "e4", "d4"
    const sq = normalizeSquare(w);
    if (sq) { if (!squares.includes(sq)) squares.push(sq); continue; }

    // Two-word square: "echo 4" → "e4"
    if (i + 1 < words.length) {
      const sq2 = normalizeSquare(w + words[i + 1]);
      if (sq2) { if (!squares.includes(sq2)) squares.push(sq2); i++; continue; }
    }
  }

  // Two squares = from + to
  if (squares.length >= 2) return { from: squares[0], to: squares[1], promotion };

  // One square = destination
  if (squares.length === 1) {
    return { to: squares[0], pieceType, fileHint, promotion };
  }

  return null;
}


// ─── OPENING DETECTION ───────────────────────────────────────

async function detectAndShowOpening() {
  if (moveHistory.length === 0) {
    setMessage("Play some moves first, then ask which opening this is.");
    speak("Play some moves first.");
    return;
  }

  setMessage("Analyzing opening…");
  speak("Analyzing opening.");
  showOpeningBanner('loading');

  // Build a compact move list for Gemini
  const moves = moveHistory.map((m, i) => {
    const num = Math.floor(i / 2) + 1;
    return i % 2 === 0 ? `${num}.${m.san}` : m.san;
  }).join(' ');

  const fen = chess.fen();

  // Extract White's moves only (indices 0, 2, 4, 6...) from first 6 full moves
  const whiteMoves = moveHistory
    .filter((_, i) => i % 2 === 0)
    .slice(0, 6)
    .map((m, i) => `${i + 1}.${m.san}`)
    .join(' ');

  // First 6 full moves for context
  const earlyMoves = moveHistory.slice(0, 12).map((m, i) => {
    const num = Math.floor(i / 2) + 1;
    return i % 2 === 0 ? `${num}.${m.san}` : m.san;
  }).join(' ');

  const prompt = `You are a chess opening expert. I need you to identify what opening WHITE is playing.

White's moves (focus ONLY on these): ${whiteMoves}
Full game for context: ${earlyMoves}

CRITICAL RULES:
- Identify the opening from WHITE's point of view ONLY
- The opening name describes what WHITE is doing, not Black
- Examples:
  * White plays 1.e4 → it's an "e4 opening" (King's Pawn)
  * White plays 1.d4 Nf3 c4 → English/Queen's Pawn system
  * White plays 1.e4 and then Nf3 Bc4 → Italian Game (regardless of what Black plays)
  * White plays 1.e4 then d4 → Center Game
  * Caro-Kann is BLACK's opening response, NEVER name it as White's opening
  * Sicilian is BLACK's response, NEVER name it as White's opening
- Name the opening by what WHITE is building: Italian, Ruy Lopez, King's Gambit, London System, Queen's Gambit, English, Catalan, etc.
- Be specific with the variation name

Respond with ONLY valid JSON, no markdown, no explanation:
{
  "name": "Opening Name from White's perspective",
  "moves": ["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5"]
}

The "moves" array = canonical first 5-6 moves of this opening (both colors) in SAN notation.
Return ONLY the JSON object, nothing else.`;

  try {
    const response = await fetch('/api/gemini', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt })
    });

    const data = await response.json();

    if (!response.ok) {
      // Show the actual server error so we can debug
      const errMsg = data.error || 'Server error';
      // Rate limit — give friendly message
      if (errMsg.includes('429') || errMsg.includes('quota') || errMsg.includes('Too Many')) {
        hideOpeningBanner();
        setMessage("Gemini rate limit hit. Wait 60 seconds and try again.");
        speak("Rate limit hit. Please wait a moment.");
        return;
      }
      throw new Error(errMsg);
    }

    // Parse JSON from Gemini response
    let parsed;
    try {
      const clean = data.text.replace(/```json|```/g, '').trim();
      parsed = JSON.parse(clean);
    } catch {
      throw new Error('Could not parse opening data: ' + data.text?.substring(0, 100));
    }

    const { name, moves: openingMoves } = parsed;
    if (!name || !openingMoves || !Array.isArray(openingMoves)) throw new Error('Invalid response format');

    // Save current game state before demo
    openingSnapshot = {
      fen: chess.fen(),
      moveHistory: [...moveHistory],
      fenHistory: [...fenHistory],
      lastMove: lastMove ? { ...lastMove } : null,
      viewingIndex: viewingIndex
    };

    // Ensure we have moves to show — pad or trim to exactly 6
    const movesToShow = openingMoves.slice(0, 6);
    if (movesToShow.length === 0) throw new Error('No moves returned');

    // Show the opening name in banner
    showOpeningBanner('demo', name);
    speak(`${name}`);

    // Reset board to starting position for demo
    chess = new Chess();
    lastMove = null;
    selectedSq = null;
    legalMoves = [];
    viewingIndex = -1;
    updateBoard();

    // Small pause so user sees the reset before moves start
    await new Promise(r => setTimeout(r, 600));
    if (!openingSnapshot) return; // user cancelled during pause

    setMessage(`"${name}" — watching ${movesToShow.length} moves.`);

    // Helper: speak and wait until speech finishes before resolving
    function speakAndWait(text) {
      return new Promise(resolve => {
        if (isMuted) { resolve(); return; }
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.rate = 1.1;
        u.onend = () => resolve();
        // Fallback in case onend never fires (some browsers)
        setTimeout(resolve, 3000);
        window.speechSynthesis.speak(u);
      });
    }

    // Play moves one by one — speak first, then make the move, then pause
    for (let i = 0; i < movesToShow.length; i++) {
      if (!openingSnapshot) return; // user hit "Return to My Game"

      const san = movesToShow[i];
      const moveNum = Math.floor(i / 2) + 1;
      const color = i % 2 === 0 ? 'White' : 'Black';

      // 1. Announce the move first
      const bannerName = document.getElementById('opening-name');
      if (bannerName) {
        bannerName.textContent = `${name}  ·  Move ${moveNum}: ${color} plays ${san}`;
      }
      setMessage(`Move ${moveNum}: ${color} plays ${san}`);

      // 2. Wait for speech to finish
      await speakAndWait(`${color} plays ${san}`);
      if (!openingSnapshot) return;

      // 3. Now make the move on the board
      try {
        const result = chess.move(san);
        if (result) {
          lastMove = { from: result.from, to: result.to };
          updateBoard();
        }
      } catch (_) { }

      // 4. Short pause after the move so user can see it before next announcement
      if (i < movesToShow.length - 1) {
        await new Promise(r => setTimeout(r, 800));
      }
    }

    // All moves played — final state
    if (openingSnapshot) {
      const bannerName = document.getElementById('opening-name');
      if (bannerName) bannerName.textContent = name;
      setMessage(`"${name}" — ${movesToShow.length} moves shown. Click ▶ Return to My Game when ready.`);
      speak("Opening complete. Click return to my game when ready.");
    }

  } catch (err) {
    hideOpeningBanner();
    setMessage(`Couldn't detect opening. Try again.`);
    speak("Couldn't detect the opening.");
  }
}

function returnToGame() {
  if (!openingSnapshot) return;

  // Restore the saved game state
  chess = new Chess(openingSnapshot.fen);
  moveHistory = openingSnapshot.moveHistory;
  fenHistory = openingSnapshot.fenHistory;
  lastMove = openingSnapshot.lastMove;
  viewingIndex = openingSnapshot.viewingIndex;
  openingSnapshot = null;

  selectedSq = null;
  legalMoves = [];

  hideOpeningBanner();
  updateBoard();
  updateHistory(true);
  setMessage("Back to your game.");
  speak("Back to your game.");
}

function showOpeningBanner(state, name) {
  const banner = document.getElementById('opening-banner');
  const nameEl = document.getElementById('opening-name');
  const loadEl = document.getElementById('opening-loading');
  const returnBtn = document.getElementById('opening-return-btn');

  if (state === 'loading') {
    banner.style.display = 'flex';
    nameEl.style.display = 'none';
    loadEl.style.display = 'flex';
    returnBtn.style.display = 'none';
  } else {
    banner.style.display = 'flex';
    nameEl.textContent = name;
    nameEl.style.display = 'block';
    loadEl.style.display = 'none';
    returnBtn.style.display = 'inline-flex';
  }
}

function hideOpeningBanner() {
  document.getElementById('opening-banner').style.display = 'none';
}

// ─── VOICE HISTORY NAVIGATION ───────────────────────────────
// Returns true if the text was a navigation command (so caller can skip move parsing)
function tryVoiceNavigation(text) {
  const t = text.toLowerCase().replace(/[.,!?]/g, '');

  // ── Opening detection ─────────────────────────────────────
  if (/(?:which|what|show me|identify|name|tell me).*opening|show.*opening|opening.*this|what opening/.test(t)) {
    detectAndShowOpening(); return true;
  }

  // ── Return to game ────────────────────────────────────────
  if (/return to (?:my )?game|back to (?:my )?game|exit opening|close opening/.test(t)) {
    if (openingSnapshot) { returnToGame(); return true; }
  }

  // ── "go back N moves" / "back N" / "rewind N" ────────────
  const backMatch = t.match(/(?:go\s+)?(?:back|rewind|undo|previous|prev)\s+(\w+)\s*(?:move|moves|step|steps)?/)
    || t.match(/(\w+)\s+(?:move|moves|step|steps)?\s*(?:back|ago)/);
  if (backMatch) {
    const n = wordToNumber(backMatch[1]);
    if (n !== null && n > 0) {
      const target = (viewingIndex === -1 ? moveHistory.length - 1 : viewingIndex) - n;
      const clamped = Math.max(0, target);
      jumpToMove(clamped);
      const msg = `Went back ${n} move${n > 1 ? 's' : ''}.`;
      setMessage(msg); speak(msg); return true;
    }
  }

  // ── "go back" / "back" / "previous move" (1 step) ────────
  if (/^(?:go\s+)?(?:back|rewind|previous\s+move|prev\s+move|one\s+back|step\s+back)$/.test(t)) {
    const cur = viewingIndex === -1 ? moveHistory.length - 1 : viewingIndex;
    if (cur > 0) { jumpToMove(cur - 1); setMessage("One move back."); speak("One move back."); }
    else { setMessage("Already at the beginning."); speak("Already at the beginning."); }
    return true;
  }

  // ── "go forward" / "next move" / "forward N" ─────────────
  const fwdMatch = t.match(/(?:go\s+)?(?:forward|next)\s+(\w+)\s*(?:move|moves|step|steps)?/);
  if (fwdMatch) {
    const n = wordToNumber(fwdMatch[1]);
    if (n !== null && n > 0) {
      const target = (viewingIndex === -1 ? moveHistory.length - 1 : viewingIndex) + n;
      const clamped = Math.min(moveHistory.length - 1, target);
      if (viewingIndex === -1) { setMessage("Already at the latest move."); speak("Already at latest."); }
      else { jumpToMove(clamped); const msg = `Went forward ${n} move${n > 1 ? 's' : ''}.`; setMessage(msg); speak(msg); }
      return true;
    }
  }

  if (/^(?:go\s+)?(?:forward|next\s+move|one\s+forward|step\s+forward)$/.test(t)) {
    if (viewingIndex === -1) { setMessage("Already at the latest move."); speak("Already at latest move."); }
    else {
      const next = viewingIndex + 1;
      if (next >= moveHistory.length) returnToLive();
      else jumpToMove(next);
      setMessage("One move forward."); speak("One move forward.");
    }
    return true;
  }

  // ── "show move 10" / "go to move 10" / "move 10" ─────────
  const showMatch = t.match(/(?:show(?:\s+me)?|go\s+to|jump\s+to)?\s*move\s+(\w+)/)
    || t.match(/^(\w+)(?:st|nd|rd|th)?\s+move$/);
  if (showMatch) {
    const n = wordToNumber(showMatch[1]);
    if (n !== null && n >= 1) {
      // Move N = index (N*2 - 2) for white, or nearby — find closest half-move index
      const halfMoveIdx = (n - 1) * 2;  // white's move N is index (N-1)*2
      const clamped = Math.min(moveHistory.length - 1, halfMoveIdx);
      jumpToMove(clamped);
      const msg = `Showing move ${n}.`;
      setMessage(msg); speak(msg); return true;
    }
  }

  // ── "first move" / "beginning" / "start" ─────────────────
  if (/(?:first\s+move|beginning|start\s+over|go\s+to\s+start|go\s+to\s+beginning)/.test(t)) {
    if (moveHistory.length > 0) { jumpToMove(0); setMessage("At the first move."); speak("At the first move."); }
    else { setMessage("No moves yet."); speak("No moves yet."); }
    return true;
  }

  // ── "last move" / "latest" / "return to live" / "live" ───
  if (/(?:last\s+move|latest|return\s+to\s+live|go\s+live|resume|current\s+position)/.test(t)) {
    returnToLive(); return true;
  }

  return false; // not a navigation command
}

// Convert number words AND digits to integer
function wordToNumber(word) {
  if (!word) return null;
  const num = parseInt(word, 10);
  if (!isNaN(num)) return num;
  const MAP = {
    'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
    'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10,
    'eleven': 11, 'twelve': 12, 'thirteen': 13, 'fourteen': 14, 'fifteen': 15,
    'sixteen': 16, 'seventeen': 17, 'eighteen': 18, 'nineteen': 19, 'twenty': 20,
    'a': 1, 'an': 1, 'the': null
  };
  return MAP[word.toLowerCase()] ?? null;
}

function processVoiceCommand(text, alternatives) {
  // ── Check navigation commands first (work regardless of turn) ──
  const allTexts = alternatives && alternatives.length > 1 ? [text, ...alternatives] : [text];
  for (const t of allTexts) {
    if (tryVoiceNavigation(t)) return;
  }

  if (chess.turn() !== 'w') { setMessage("It's not White's turn."); return; }

  const toTry = (alternatives && alternatives.length > 1) ? alternatives : [text];

  // Sort: put transcripts that contain a piece word first
  toTry.sort((a, b) => {
    const aHasPiece = a.toLowerCase().split(/\s+/).some(w => PIECE_WORDS[w]);
    const bHasPiece = b.toLowerCase().split(/\s+/).some(w => PIECE_WORDS[w]);
    if (aHasPiece && !bHasPiece) return -1;
    if (!aHasPiece && bHasPiece) return 1;
    return 0;
  });

  for (const transcript of toTry) {
    const parsed = parseVoiceMove(transcript);
    if (!parsed) continue;

    if (parsed.special === 'castle-kingside') {
      if (tryMove('e1', 'g1')) { setMessage("Castled kingside!"); speak("Castled kingside"); return; }
      continue;
    }
    if (parsed.special === 'castle-queenside') {
      if (tryMove('e1', 'c1')) { setMessage("Castled queenside!"); speak("Castled queenside"); return; }
      continue;
    }

    if (parsed.from && parsed.to) {
      if (tryMove(parsed.from, parsed.to, parsed.promotion)) {
        const last = moveHistory[moveHistory.length - 1];
        const msg = `Moved ${last ? last.san : 'piece'}.`;
        setMessage(msg); speak(msg); return;
      }
      continue;
    }

    if (parsed.to) {
      // ── If we have a fileHint but no pieceType, try to resolve using lastAmbiguity ──
      let resolvedPieceType = parsed.pieceType;
      if (!resolvedPieceType && parsed.fileHint && lastAmbiguity && lastAmbiguity.to === parsed.to) {
        resolvedPieceType = lastAmbiguity.pieceType;
      }
      // Also: if fileHint+to resolves to exactly one candidate from lastAmbiguity, use it
      if (!resolvedPieceType && parsed.fileHint && lastAmbiguity) {
        const fromFile = lastAmbiguity.candidates &&
          lastAmbiguity.candidates.find(m => m.from[0] === parsed.fileHint);
        if (fromFile) {
          resolvedPieceType = fromFile.piece;
          // If the to squares differ, it might be a different move entirely — let it fall through
        }
      }

      // Get all legal moves to this square, verified against actual board state
      let allToSquare = chess.moves({ verbose: true })
        .filter(m => m.to === parsed.to)
        .filter(m => {
          const p = chess.get(m.from);
          return p && p.type === m.piece && p.color === chess.turn();
        });

      // Deduplicate by from+piece
      const seen = new Set();
      allToSquare = allToSquare.filter(m => {
        const key = m.from + m.piece;
        if (seen.has(key)) return false;
        seen.add(key); return true;
      });

      let candidates = allToSquare;

      // Apply piece type filter
      if (resolvedPieceType) {
        candidates = allToSquare.filter(m => m.piece === resolvedPieceType);
      } else {
        // No piece word — remove pawns
        const nonPawn = allToSquare.filter(m => m.piece !== 'p');
        if (nonPawn.length > 0) candidates = nonPawn;
      }

      // Apply file hint — "fd4" → only pieces coming from f-file
      if (parsed.fileHint && candidates.length > 1) {
        const hinted = candidates.filter(m => m.from[0] === parsed.fileHint);
        if (hinted.length > 0) candidates = hinted;
      }

      if (candidates.length === 1) {
        const m = candidates[0];
        if (tryMove(m.from, m.to, parsed.promotion)) {
          const pName = { p: 'Pawn', n: 'Knight', b: 'Bishop', r: 'Rook', q: 'Queen', k: 'King' }[m.piece] || m.piece;
          const msg = `${pName} to ${parsed.to}.`;
          setMessage(msg); speak(msg); return;
        }
      } else if (candidates.length > 1) {
        const PNAME = { p: 'Pawn', n: 'Knight', b: 'Bishop', r: 'Rook', q: 'Queen', k: 'King' };
        const PSHORT = { p: 'P', n: 'N', b: 'B', r: 'R', q: 'Q', k: 'K' };
        const pName = PNAME[candidates[0].piece] || 'piece';
        const pShort = PSHORT[candidates[0].piece] || '';
        const dest = parsed.to;  // e.g. "d4"

        // Build examples: "Nfd4 or Ned4" and "Knight fd4 or Knight ed4"
        const shortExamples = candidates.map(m => pShort + m.from[0] + dest).join(' or ');
        const longExamples = candidates.map(m => pName + ' ' + m.from[0] + dest).join(' or ');

        const spokenMsg = `Ambiguous. Two ${pName}s can go to ${dest}. Say ${longExamples}.`;
        const displayMsg = `Two ${pName}s can reach ${dest}.
Say: "${shortExamples}" or "${longExamples}"`;
        setMessage(displayMsg); speak(spokenMsg); return;
      } else {
        continue;
      }
    }
  }

  setMessage(`Didn't understand: "${text}". Try "pawn to e4" or "knight to f3".`);
  speak("Sorry, I didn't understand that.");
}

// ─── SPEECH SYNTHESIS ────────────────────────────────────────
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

// ─── MUTE ────────────────────────────────────────────────────
document.getElementById('mute-btn').addEventListener('click', function () {
  isMuted = !isMuted;
  this.textContent = isMuted ? '🔇' : '🔊';
  if (isMuted) window.speechSynthesis.cancel();
});

// ─── INIT ────────────────────────────────────────────────────
buildBoard();
initSpeech();