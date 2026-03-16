# ♚ Checkmate Voice

A voice-enabled chess web app built with Vanilla HTML, CSS, and JavaScript. Play as White using your voice or by dragging and dropping pieces, while the engine controls Black.

---

## ✅ Implemented Features

### 🎤 Voice Movement (White Only)
- Hold the **"Hold to Speak"** button and say your move in natural language
- Supports multiple formats:
  - `"pawn to e4"` — move by piece type and destination
  - `"e2 to e4"` — move by explicit square coordinates
  - `"knight to f3"` — move a specific piece to a square
  - `"castle kingside"` / `"castle queenside"` — castling
- If multiple pieces can reach the destination, it asks for clarification
- Voice feedback via speech synthesis (can be muted)

### 🖱️ Drag & Drop Movement (White Only)
- Click a white piece to select it and see legal moves highlighted
- Drag and drop pieces to make moves
- Visual indicators for selected squares, legal moves, and captures

### 🤖 Computer Opponent (Black)
- Black plays automatically with random legal moves
- Moves are made 600ms after White's turn for a natural feel

### 📜 Move History
- All moves are logged in the right panel in SAN notation
- White moves shown in light text, Black moves in green

### ⏪ History Navigation (Browse Without Losing Game)
- **Click any move** in the history list to jump to that board position
- The clicked move is **highlighted in green**
- A **rewind banner** appears below the board showing:
  - Which move you're viewing (e.g. "Move 10 of 20")
  - **‹ Prev / Next ›** buttons to step through moves one at a time
  - **▶ Return to Live** button to jump back to the current game
- All history is **preserved** — navigating back does not erase future moves
- Dragging, clicking, and voice are **blocked** while rewinding, with a helpful message

### 📜 History Navigation (Using voice)
- Say *"go back 3 moves"* or *"show me move 10"* to navigate history by voice

### 📜 Opening Book Display
- Show the name of the opening being played (e.g. "Sicilian Defense")

### 🤖 Computer Opponent (Black)
- [ ] **Stockfish and Difficulty Levels integration** — Easy, Medium, Hard, Random
---

## 🚀 Running Locally

No build step needed. Serve the folder with any local server:

```bash
node server.js
```



