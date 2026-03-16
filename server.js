require('dotenv').config();

const express = require('express');
const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static('src'));

const bedrock = new BedrockRuntimeClient({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId:     process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  }
});

async function callNovaLite(prompt, maxTokens) {
  const cmd = new InvokeModelCommand({
    modelId:     'us.amazon.nova-lite-v1:0',
    contentType: 'application/json',
    accept:      'application/json',
    body: JSON.stringify({
      messages: [{ role: 'user', content: [{ text: prompt }] }],
      inferenceConfig: { maxTokens: maxTokens || 512, temperature: 0.4 }
    })
  });
  const resp = await bedrock.send(cmd);
  const body = JSON.parse(Buffer.from(resp.body).toString('utf-8'));
  return body.output?.message?.content?.[0]?.text || '';
}

// ── GET /api/test ─────────────────────────────────────────────
app.get('/api/test', async (req, res) => {
  try {
    const text = await callNovaLite('Say exactly: NOVA_OK', 10);
    res.json({ status: 'ok', response: text });
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════
// POST /api/nova/move
// Pure JS move matching — Nova only used for coaching questions
// ══════════════════════════════════════════════════════════════
app.post('/api/nova/move', async (req, res) => {
  const { transcript, fen, turn, moveHistory, legalMoves } = req.body;
  if (!transcript) return res.status(400).json({ error: 'No transcript' });

  const moves = legalMoves || [];
  const t     = transcript.toLowerCase().trim();

  // ── Castling ─────────────────────────────────────────────────
  if (/castle kingside|king side|short castle/.test(t) || t === 'o-o' || t === '0-0') {
    return res.json({ move: { from: 'e1', to: 'g1', promotion: 'q' }, speech: '' });
  }
  if (/castle queenside|queen side|long castle/.test(t) || t === 'o-o-o' || t === '0-0-0') {
    return res.json({ move: { from: 'e1', to: 'c1', promotion: 'q' }, speech: '' });
  }

  // ── Extract destination square ────────────────────────────────
  const squareMatch = t.match(/\b([a-h][1-8])\b/);
  const destSquare  = squareMatch ? squareMatch[1] : null;

  // ── Extract piece type ────────────────────────────────────────
  const PIECE_WORDS = {
    rook: 'r', bishop: 'b', knight: 'n', queen: 'q', king: 'k', pawn: 'p',
    horse: 'n', night: 'n'
  };
  let pieceType = null;
  for (const [word, code] of Object.entries(PIECE_WORDS)) {
    if (t.includes(word)) { pieceType = code; break; }
  }
  // SAN notation e.g. "Nf3", "Bc4", "Re1", "Qd1"
  const sanNotation = transcript.match(/^([KQRBN])([a-h]?\d?[a-h][1-8])$/);
  if (sanNotation) {
    pieceType = sanNotation[1].toLowerCase();
  }

  // ── Match against legal moves ─────────────────────────────────
  if (destSquare) {
    let candidates = moves.filter(m => m.to === destSquare);

    // Filter by piece type
    if (pieceType && pieceType !== 'p') {
      const SAN_LETTER = pieceType.toUpperCase();
      const byPiece = candidates.filter(m => m.san.startsWith(SAN_LETTER));
      // If no piece of that type can reach this square → no match at all
      if (byPiece.length === 0) {
        const PNAMES = { r:'Rook', b:'Bishop', n:'Knight', q:'Queen', k:'King' };
        const pName = PNAMES[pieceType] || 'That piece';
        return res.json({ move: null, speech: pName + ' cannot move to ' + destSquare + '.' });
      }
      candidates = byPiece;
    } else if (pieceType === 'p') {
      // Explicit pawn move
      const byPawn = candidates.filter(m => /^[a-h]/.test(m.san));
      if (byPawn.length > 0) candidates = byPawn;
    } else {
      // No piece word mentioned — prefer non-pawns
      const nonPawn = candidates.filter(m => !/^[a-h]/.test(m.san));
      if (nonPawn.length > 0) candidates = nonPawn;
    }

    // File hint (e.g. "rook f1 to e1", "Rfe1")
    const fileHint = transcript.match(/[KQRBN]([a-h])[a-h][1-8]/) ||
                     t.match(/\b([a-h])\s+(?:rook|bishop|knight|queen|king)\b/) ||
                     t.match(/(?:rook|bishop|knight|queen|king)\s+(?:on\s+)?([a-h])\d/);
    if (fileHint && candidates.length > 1) {
      const byFile = candidates.filter(m => m.from[0] === fileHint[1]);
      if (byFile.length > 0) candidates = byFile;
    }

    if (candidates.length === 1) {
      const m = candidates[0];
      console.log('[move] "' + transcript + '" → ' + m.san + ' (' + m.from + '-' + m.to + ')');
      return res.json({ move: { from: m.from, to: m.to, promotion: 'q' }, speech: '' });
    }

    if (candidates.length > 1) {
      const PNAMES = { r:'Rook', b:'Bishop', n:'Knight', q:'Queen', k:'King', p:'Pawn' };
      const pName  = PNAMES[pieceType] || 'Piece';
      const opts   = candidates.map(m => m.from[0].toUpperCase()).join(' or ');
      const msg    = 'Two ' + pName + 's can go to ' + destSquare + '. Which file — ' + opts + '?';
      return res.json({ move: null, speech: msg });
    }
  }

  // ── Coaching question → Nova Lite ─────────────────────────────
  const isQuestion = /what|why|how|should|suggest|best|explain|analyse|analyze|coach|help|plan|advise/i.test(t);
  if (isQuestion) {
    const recentMoves = (moveHistory || []).slice(-6).join(', ') || 'none';
    const prompt = 'You are a chess coach. Board FEN: ' + fen + '. Turn: ' + turn + '. Recent moves: ' + recentMoves + '.\nPlayer asked: "' + transcript + '"\nGive a helpful 1-2 sentence answer. No markdown.';
    try {
      const text = await callNovaLite(prompt, 200);
      console.log('[coach] "' + transcript + '" → "' + text.slice(0, 80) + '"');
      return res.json({ move: null, speech: text.trim() });
    } catch (err) {
      console.error('[coach error]', err.message);
      return res.json({ move: null, speech: 'Could not reach Nova. Try again.' });
    }
  }

  // ── No match ──────────────────────────────────────────────────
  console.log('[no match] "' + transcript + '"');
  return res.json({ move: null, speech: 'Try saying the piece and square, like "rook to e1" or "Re1".' });
});

// ══════════════════════════════════════════════════════════════
// POST /api/nova — Opening analysis
// ══════════════════════════════════════════════════════════════
app.post('/api/nova', async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: 'No prompt' });
  try {
    const text = await callNovaLite(prompt, 1024);
    res.json({ text });
  } catch (err) {
    console.error('[nova error]', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log('\n♟  Checkmate Voice → http://localhost:' + PORT);
  console.log('   POST /api/nova/move  — voice moves');
  console.log('   POST /api/nova       — opening analysis\n');
});