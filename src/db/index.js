// src/db/index.js
// Uses sql.js — pure JavaScript SQLite, no native compilation required.
// Exposes the same synchronous .prepare().get()/.all()/.run() surface
// as better-sqlite3 so the rest of the code stays unchanged.

const path = require("path");
const fs = require("fs");
require("dotenv").config();

const dbPath = process.env.DB_PATH || "./storage/aiops.db";
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

let _db = null;

function persist() {
  if (!_db) return;
  fs.writeFileSync(dbPath, Buffer.from(_db.export()));
}

async function init() {
  const initSqlJs = require("sql.js");
  const SQL = await initSqlJs();

  _db = fs.existsSync(dbPath)
    ? new SQL.Database(fs.readFileSync(dbPath))
    : new SQL.Database();

  // Schema
  _db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      email      TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS events (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      type       TEXT NOT NULL,
      payload    TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Seed
  const rows = _db.exec("SELECT COUNT(*) as c FROM users");
  const count = rows[0]?.values[0][0] ?? 0;
  if (count === 0) {
    const seeds = [
      ["Alice", "alice@example.com"],
      ["Bob", "bob@example.com"],
      ["Charlie", "charlie@example.com"],
      ["Diana", "diana@example.com"],
      ["Eve", "eve@example.com"],
    ];
    for (const [name, email] of seeds) {
      _db.run("INSERT INTO users (name, email) VALUES (?, ?)", [name, email]);
    }
    persist();
  }

  // Return thin wrapper matching better-sqlite3's synchronous API
  return {
    prepare(sql) {
      return {
        get(...params) {
          const stmt = _db.prepare(sql);
          stmt.bind(params);
          const row = stmt.step() ? stmt.getAsObject() : undefined;
          stmt.free();
          return row;
        },
        all(...params) {
          const results = [];
          const stmt = _db.prepare(sql);
          stmt.bind(params);
          while (stmt.step()) results.push(stmt.getAsObject());
          stmt.free();
          return results;
        },
        run(...params) {
          _db.run(sql, params);
          persist();
          return { changes: _db.getRowsModified() };
        },
      };
    },
    exec(sql) {
      _db.run(sql);
      persist();
    },
  };
}

// Export a promise — routes must await this before first use
module.exports = { ready: init() };
