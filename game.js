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
  document.getElementById('fen-preview').textContent = chess.fen().substring(0, 18) + '…';
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
  moveHistory = []; fenHistory = []; viewingIndex = -1; dragSrc = null;
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
    console.log("Voice heard:", transcripts);
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
  'pawn': 'p', 'pawns': 'p',
  'knight': 'n', 'horse': 'n',
  'bishop': 'b',
  'rook': 'r', 'castle': 'r',
  'queen': 'q',
  'king': 'k'
};

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const RANKS = ['1', '2', '3', '4', '5', '6', '7', '8'];

function normalizeSquare(word) {
  word = word.toLowerCase().replace(/[-\s]/g, '');
  if (FILES.includes(word[0]) && RANKS.includes(word[1])) return word.substring(0, 2);
  for (const [key, file] of Object.entries(WORD_TO_FILE)) {
    if (word.startsWith(key)) {
      const rest = word.substring(key.length).trim();
      if (RANKS.includes(rest)) return file + rest;
    }
  }
  return null;
}

function parseVoiceMove(text) {
  text = text.toLowerCase().replace(/[.,!?]/g, '');
  const words = text.split(/\s+/);
  const squares = [];
  let promotion = 'q';

  for (const w of words)
    if (PIECE_WORDS[w] && ['q', 'r', 'b', 'n'].includes(PIECE_WORDS[w])) promotion = PIECE_WORDS[w];

  for (let i = 0; i < words.length; i++) {
    const sq = normalizeSquare(words[i]);
    if (sq) { squares.push(sq); continue; }
    if (i + 1 < words.length) {
      const sq2 = normalizeSquare(words[i] + words[i + 1]);
      if (sq2) { squares.push(sq2); i++; continue; }
    }
  }

  if (squares.length >= 2) return { from: squares[0], to: squares[1], promotion };

  if (text.includes('castle kingside') || text.includes('king side') || text.includes('short castle'))
    return { special: 'castle-kingside' };
  if (text.includes('castle queenside') || text.includes('queen side') || text.includes('long castle'))
    return { special: 'castle-queenside' };

  if (squares.length === 1) {
    let pieceType = null;
    for (const w of words) if (PIECE_WORDS[w]) { pieceType = PIECE_WORDS[w]; break; }
    return { to: squares[0], pieceType, promotion };
  }

  return null;
}

function processVoiceCommand(text, alternatives) {
  if (chess.turn() !== 'w') { setMessage("It's not White's turn."); return; }

  const toTry = (alternatives && alternatives.length > 1) ? alternatives : [text];

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
      let candidates = chess.moves({ verbose: true }).filter(m => m.to === parsed.to);
      if (parsed.pieceType) candidates = candidates.filter(m => m.piece === parsed.pieceType);

      if (candidates.length === 1) {
        const m = candidates[0];
        if (tryMove(m.from, m.to, parsed.promotion)) {
          const pName = { p: 'Pawn', n: 'Knight', b: 'Bishop', r: 'Rook', q: 'Queen', k: 'King' }[m.piece] || m.piece;
          const msg = `${pName} to ${parsed.to}.`;
          setMessage(msg); speak(msg); return;
        }
      } else if (candidates.length > 1) {
        const msg = `Which piece? From ${candidates.map(m => m.from).join(' or ')}?`;
        setMessage(msg); speak(msg); return;
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