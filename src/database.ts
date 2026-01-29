import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = path.join(__dirname, '..', 'game.db');

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

/** Khởi tạo schema */
export function initSchema(): void {
  const d = getDb();

  d.exec(`
    -- Bộ từ vựng (deck) — admin quản lý
    CREATE TABLE IF NOT EXISTS deck (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      pairId    INTEGER NOT NULL,
      faceA     TEXT NOT NULL,       -- tiếng Anh
      faceB     TEXT NOT NULL,       -- nghĩa tiếng Việt
      enabled   INTEGER NOT NULL DEFAULT 1
    );

    -- Cấu hình game (singleton row id=1)
    CREATE TABLE IF NOT EXISTS config (
      id            INTEGER PRIMARY KEY CHECK (id = 1),
      timeLimitSec  INTEGER NOT NULL DEFAULT 120,
      matchPoints   INTEGER NOT NULL DEFAULT 10,
      missPenalty   INTEGER NOT NULL DEFAULT 2,
      gameStarted   INTEGER NOT NULL DEFAULT 0,
      gameStartTime INTEGER          -- unix ms khi bắt đầu
    );

    -- Các team đã join
    CREATE TABLE IF NOT EXISTS teams (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      name      TEXT NOT NULL UNIQUE,
      token     TEXT NOT NULL UNIQUE,
      score     INTEGER NOT NULL DEFAULT 0
    );

    -- Board card cho mỗi team (mỗi team có bộ card riêng)
    CREATE TABLE IF NOT EXISTS cards (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      teamId    INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      pairId    INTEGER NOT NULL,
      content   TEXT NOT NULL,        -- nội dung hiển thị khi lật
      side      TEXT NOT NULL,        -- 'A' hoặc 'B'
      state     TEXT NOT NULL DEFAULT 'hidden',  -- hidden | flipped | matched
      position  INTEGER NOT NULL      -- vị trí trên board
    );

    -- Đảm bảo config có 1 row
    INSERT OR IGNORE INTO config (id, timeLimitSec, matchPoints, missPenalty, gameStarted)
    VALUES (1, 120, 10, 2, 0);
  `);

  // Seed default deck nếu trống
  const count = d.prepare('SELECT COUNT(*) as c FROM deck').get() as { c: number };
  if (count.c === 0) {
    const pairs = [
      [1, 'Apple', 'Quả táo'],
      [2, 'Dog', 'Con chó'],
      [3, 'Cat', 'Con mèo'],
      [4, 'House', 'Ngôi nhà'],
      [5, 'Book', 'Quyển sách'],
      [6, 'Water', 'Nước'],
      [7, 'Sun', 'Mặt trời'],
      [8, 'Moon', 'Mặt trăng'],
    ];
    const insert = d.prepare('INSERT INTO deck (pairId, faceA, faceB) VALUES (?, ?, ?)');
    for (const p of pairs) {
      insert.run(p[0], p[1], p[2]);
    }
  }
}
