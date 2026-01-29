import express from 'express';
import http from 'http';
import { Server as SocketServer } from 'socket.io';
import path from 'path';
import crypto from 'crypto';
import { getDb, initSchema } from './database';

// ─── Init ────────────────────────────────────────────────────────────────
const app = express();
const server = http.createServer(app);
const io = new SocketServer(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

initSchema();

// ─── Admin auth ──────────────────────────────────────────────────────────
const ADMIN_KEY = 'Lethanhtai';

function adminAuth(req: express.Request, res: express.Response, next: express.NextFunction): void {
  const key = req.headers['x-admin-key'] as string;
  if (key !== ADMIN_KEY) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}

// ─── Rate limiter đơn giản ───────────────────────────────────────────────
const flipTimestamps = new Map<string, number>(); // token → last flip time (ms)
const FLIP_COOLDOWN_MS = 400;

// Theo dõi 2 card đang mở của mỗi team (trong memory, không cần DB)
const teamFlipState = new Map<string, number[]>(); // token → [cardId, ...]
const teamFlipLock = new Set<string>(); // token đang xử lý delay úp lại

// ─── Helpers ─────────────────────────────────────────────────────────────

function getConfig() {
  return getDb().prepare('SELECT * FROM config WHERE id = 1').get() as {
    timeLimitSec: number;
    matchPoints: number;
    missPenalty: number;
    gameStarted: number;
    gameStartTime: number | null;
  };
}

function getRemainingTime(token?: string): number {
  const cfg = getConfig();
  if (!cfg.gameStarted || !cfg.gameStartTime) return 0;
  const elapsed = Date.now() - cfg.gameStartTime;
  const remaining = cfg.timeLimitSec * 1000 - elapsed;
  return Math.max(0, Math.floor(remaining / 1000));
}

function isGameActive(): boolean {
  return getRemainingTime() > 0 && getConfig().gameStarted === 1;
}

/** Tạo board card cho 1 team từ deck đang enabled */
function createBoardForTeam(teamId: number): void {
  const db = getDb();
  const deckRows = db.prepare('SELECT * FROM deck WHERE enabled = 1').all() as Array<{
    pairId: number; faceA: string; faceB: string;
  }>;

  // Mỗi pair tạo 2 card: faceA và faceB
  const cards: Array<{ pairId: number; content: string; side: string }> = [];
  for (const row of deckRows) {
    cards.push({ pairId: row.pairId, content: row.faceA, side: 'A' });
    cards.push({ pairId: row.pairId, content: row.faceB, side: 'B' });
  }

  // Shuffle (Fisher-Yates)
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }

  const insert = db.prepare(
    'INSERT INTO cards (teamId, pairId, content, side, state, position) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const tx = db.transaction(() => {
    for (let i = 0; i < cards.length; i++) {
      insert.run(teamId, cards[i].pairId, cards[i].content, cards[i].side, 'hidden', i);
    }
  });
  tx();
}

/** Lấy board SAFE cho client (không có pairId) */
function getSafeBoard(teamId: number) {
  const rows = getDb().prepare(
    'SELECT id, state, position, content, side FROM cards WHERE teamId = ? ORDER BY position'
  ).all(teamId) as Array<{ id: number; state: string; position: number; content: string; side: string }>;

  return rows.map(r => ({
    cardId: r.id,
    position: r.position,
    state: r.state,
    // Chỉ gửi content nếu card đang flipped hoặc matched
    content: (r.state === 'flipped' || r.state === 'matched') ? r.content : null,
  }));
}

/** Scoreboard data */
function getScoreboard() {
  const db = getDb();
  const teams = db.prepare('SELECT id, name, score FROM teams ORDER BY score DESC').all() as Array<{
    id: number; name: string; score: number;
  }>;

  return teams.map(t => {
    const matchCount = db.prepare(
      "SELECT COUNT(*) as c FROM cards WHERE teamId = ? AND state = 'matched'"
    ).get(t.id) as { c: number };
    return {
      teamName: t.name,
      score: t.score,
      matchesFound: Math.floor(matchCount.c / 2), // 2 card = 1 match
      remainingTime: getRemainingTime(),
    };
  });
}

function broadcastScoreboard() {
  io.emit('scoreboard', getScoreboard());
}

// ─── REST API: Join ──────────────────────────────────────────────────────

app.post('/api/join', (req, res) => {
  const { teamName } = req.body;
  if (!teamName || typeof teamName !== 'string' || teamName.trim().length === 0) {
    return res.status(400).json({ error: 'teamName is required' });
  }

  const name = teamName.trim().substring(0, 30);
  const db = getDb();

  // Kiểm tra tên đã tồn tại
  const existing = db.prepare('SELECT token FROM teams WHERE name = ?').get(name) as { token: string } | undefined;
  if (existing) {
    // Trả lại token cũ (rejoin)
    const team = db.prepare('SELECT * FROM teams WHERE name = ?').get(name) as { id: number; token: string; score: number };
    return res.json({
      teamToken: team.token,
      teamName: name,
      board: getSafeBoard(team.id),
      score: team.score,
      remainingTime: getRemainingTime(),
      gameActive: isGameActive(),
    });
  }

  const token = crypto.randomUUID();
  const result = db.prepare('INSERT INTO teams (name, token, score) VALUES (?, ?, 0)').run(name, token);
  const teamId = result.lastInsertRowid as number;

  // Tạo board cho team
  createBoardForTeam(teamId);

  broadcastScoreboard();

  res.json({
    teamToken: token,
    teamName: name,
    board: getSafeBoard(teamId),
    score: 0,
    remainingTime: getRemainingTime(),
    gameActive: isGameActive(),
  });
});

// ─── REST API: Admin ─────────────────────────────────────────────────────

// Lấy config + deck
app.get('/api/admin', adminAuth, (_req, res) => {
  const cfg = getConfig();
  const deck = getDb().prepare('SELECT * FROM deck ORDER BY pairId').all();
  const teams = getDb().prepare('SELECT id, name, score FROM teams').all();
  res.json({ config: cfg, deck, teams });
});

// Cập nhật config
app.post('/api/admin/config', adminAuth, (req, res) => {
  const { timeLimitSec, matchPoints, missPenalty } = req.body;
  const db = getDb();
  if (timeLimitSec != null) db.prepare('UPDATE config SET timeLimitSec = ? WHERE id = 1').run(Number(timeLimitSec));
  if (matchPoints != null) db.prepare('UPDATE config SET matchPoints = ? WHERE id = 1').run(Number(matchPoints));
  if (missPenalty != null) db.prepare('UPDATE config SET missPenalty = ? WHERE id = 1').run(Number(missPenalty));
  res.json({ ok: true, config: getConfig() });
});

// Cập nhật deck
app.post('/api/admin/deck', adminAuth, (req, res) => {
  const { pairs } = req.body; // Array<{ pairId, faceA, faceB, enabled }>
  if (!Array.isArray(pairs)) return res.status(400).json({ error: 'pairs array required' });

  const db = getDb();
  db.prepare('DELETE FROM deck').run();
  const insert = db.prepare('INSERT INTO deck (pairId, faceA, faceB, enabled) VALUES (?, ?, ?, ?)');
  for (const p of pairs) {
    insert.run(p.pairId, p.faceA, p.faceB, p.enabled ? 1 : 0);
  }
  res.json({ ok: true });
});

// Start game
app.post('/api/admin/start', adminAuth, (_req, res) => {
  const db = getDb();
  // Reset tất cả team: score = 0, xóa cards cũ, tạo board mới
  db.prepare('UPDATE teams SET score = 0').run();
  db.prepare('DELETE FROM cards').run();

  const teams = db.prepare('SELECT id FROM teams').all() as Array<{ id: number }>;
  for (const t of teams) {
    createBoardForTeam(t.id);
  }

  // Clear flip state
  teamFlipState.clear();
  teamFlipLock.clear();

  db.prepare('UPDATE config SET gameStarted = 1, gameStartTime = ? WHERE id = 1').run(Date.now());

  broadcastScoreboard();
  io.emit('gameStarted', { remainingTime: getConfig().timeLimitSec });

  res.json({ ok: true });
});

// Reset game (dừng + xóa teams)
app.post('/api/admin/reset', adminAuth, (_req, res) => {
  const db = getDb();
  db.prepare('UPDATE config SET gameStarted = 0, gameStartTime = NULL WHERE id = 1').run();
  db.prepare('DELETE FROM cards').run();
  db.prepare('DELETE FROM teams').run();
  teamFlipState.clear();
  teamFlipLock.clear();

  broadcastScoreboard();
  io.emit('gameReset');

  res.json({ ok: true });
});

// ─── Socket.IO: flipCard ────────────────────────────────────────────────

io.on('connection', (socket) => {
  // Gửi scoreboard ngay khi connect
  socket.emit('scoreboard', getScoreboard());

  socket.on('flipCard', ({ teamToken, cardId }: { teamToken: string; cardId: number }) => {
    if (!teamToken || cardId == null) return;

    // 1. Game đang chạy?
    if (!isGameActive()) {
      socket.emit('flipResult', { error: 'Game is not active' });
      return;
    }

    // 2. Token hợp lệ?
    const db = getDb();
    const team = db.prepare('SELECT id, score FROM teams WHERE token = ?').get(teamToken) as
      { id: number; score: number } | undefined;
    if (!team) {
      socket.emit('flipResult', { error: 'Invalid token' });
      return;
    }

    // 3. Rate limit
    const now = Date.now();
    const lastFlip = flipTimestamps.get(teamToken) || 0;
    if (now - lastFlip < FLIP_COOLDOWN_MS) {
      socket.emit('flipResult', { error: 'Too fast' });
      return;
    }
    flipTimestamps.set(teamToken, now);

    // 4. Đang bị lock (đang delay úp lại)?
    if (teamFlipLock.has(teamToken)) {
      socket.emit('flipResult', { error: 'Wait for cards to flip back' });
      return;
    }

    // 5. Card thuộc team này? Chưa matched? Chưa flipped?
    const card = db.prepare(
      'SELECT id, pairId, content, state FROM cards WHERE id = ? AND teamId = ?'
    ).get(cardId, team.id) as { id: number; pairId: number; content: string; state: string } | undefined;

    if (!card) {
      socket.emit('flipResult', { error: 'Card not found' });
      return;
    }
    if (card.state === 'matched') {
      socket.emit('flipResult', { error: 'Already matched' });
      return;
    }
    if (card.state === 'flipped') {
      socket.emit('flipResult', { error: 'Already flipped' });
      return;
    }

    // 6. Đã mở bao nhiêu card rồi?
    const flipped = teamFlipState.get(teamToken) || [];
    if (flipped.length >= 2) {
      socket.emit('flipResult', { error: 'Two cards already open' });
      return;
    }

    // 7. Flip card
    db.prepare("UPDATE cards SET state = 'flipped' WHERE id = ?").run(cardId);
    flipped.push(cardId);
    teamFlipState.set(teamToken, flipped);

    // Gửi kết quả flip (card content)
    socket.emit('cardFlipped', {
      cardId: card.id,
      content: card.content,
    });

    // 8. Nếu đã mở 2 card → kiểm tra match
    if (flipped.length === 2) {
      const card1 = db.prepare('SELECT id, pairId, content FROM cards WHERE id = ?').get(flipped[0]) as
        { id: number; pairId: number; content: string };
      const card2 = db.prepare('SELECT id, pairId, content FROM cards WHERE id = ?').get(flipped[1]) as
        { id: number; pairId: number; content: string };

      const cfg = getConfig();

      if (card1.pairId === card2.pairId) {
        // ✓ Match!
        db.prepare("UPDATE cards SET state = 'matched' WHERE id = ? OR id = ?").run(card1.id, card2.id);
        const newScore = team.score + cfg.matchPoints;
        db.prepare('UPDATE teams SET score = ? WHERE id = ?').run(newScore, team.id);
        teamFlipState.set(teamToken, []);

        socket.emit('matchResult', {
          matched: true,
          cardIds: [card1.id, card2.id],
          score: newScore,
        });

        broadcastScoreboard();
      } else {
        // ✗ Miss — trừ điểm, delay rồi úp lại
        // const newScore = team.score - cfg.missPenalty;
        const newScore = Math.max(0, team.score - cfg.missPenalty);
        db.prepare('UPDATE teams SET score = ? WHERE id = ?').run(newScore, team.id);

        socket.emit('matchResult', {
          matched: false,
          cardIds: [card1.id, card2.id],
          score: newScore,
        });

        broadcastScoreboard();

        // Lock + delay 1s rồi úp lại
        teamFlipLock.add(teamToken);
        setTimeout(() => {
          db.prepare("UPDATE cards SET state = 'hidden' WHERE id = ? OR id = ?").run(card1.id, card2.id);
          teamFlipState.set(teamToken, []);
          teamFlipLock.delete(teamToken);

          socket.emit('cardsHidden', { cardIds: [card1.id, card2.id] });
        }, 1200);
      }
    }
  });

  // Client request board refresh
  socket.on('getBoard', ({ teamToken }: { teamToken: string }) => {
    const db = getDb();
    const team = db.prepare('SELECT id, score FROM teams WHERE token = ?').get(teamToken) as
      { id: number; score: number } | undefined;
    if (!team) return;
    socket.emit('boardUpdate', {
      board: getSafeBoard(team.id),
      score: team.score,
      remainingTime: getRemainingTime(),
      gameActive: isGameActive(),
    });
  });
});

// ─── Timer broadcast mỗi giây ───────────────────────────────────────────
setInterval(() => {
  const cfg = getConfig();
  if (cfg.gameStarted && cfg.gameStartTime) {
    const remaining = getRemainingTime();
    io.emit('timer', { remainingTime: remaining });
    if (remaining <= 0) {
      // Hết giờ → dừng game
      getDb().prepare('UPDATE config SET gameStarted = 0 WHERE id = 1').run();
      io.emit('gameEnded');
      broadcastScoreboard();
    }
  }
}, 1000);

// ─── Start server ────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
