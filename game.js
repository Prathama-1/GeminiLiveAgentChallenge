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
  lastAmbiguity = null;  // clear after successful move
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


function processVoiceCommand(text, alternatives) {
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