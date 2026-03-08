const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const CONFIG = require('./constants');

const DB_PATH = path.join(process.cwd(), 'radio.db');
let db = null;

async function initializeDatabase() {
  const SQL = await initSqlJs();
  
  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS recordings (
      id TEXT PRIMARY KEY,
      filename TEXT NOT NULL,
      filepath TEXT NOT NULL,
      filesize INTEGER,
      duration INTEGER,
      channel_id TEXT,
      cloud_url TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  try {
    db.run('ALTER TABLE recordings ADD COLUMN cloud_url TEXT');
  } catch (e) {
    // Column already exists
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS channels (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      description TEXT,
      admin_id INTEGER,
      is_live INTEGER DEFAULT 0,
      color TEXT DEFAULT '#e94560',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (admin_id) REFERENCES admins(id)
    )
  `);

  const adminCount = db.exec('SELECT COUNT(*) as count FROM admins')[0]?.values[0][0] || 0;
  if (adminCount === 0) {
    const bcrypt = require('bcryptjs');
    const defaultPassword = CONFIG.ADMIN_PASSWORD;
    const hash = bcrypt.hashSync(defaultPassword, 10);
    
    db.run('INSERT INTO admins (username, password_hash) VALUES (?, ?)', [
      CONFIG.ADMIN_USERNAME,
      hash
    ]);
    console.log(`Default admin created: ${CONFIG.ADMIN_USERNAME} / ${defaultPassword}`);
  }

  saveDatabase();
}

function saveDatabase() {
  if (db) {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
  }
}

function getDb() {
  return db;
}

function ensureRecordingsDirectory() {
  if (!fs.existsSync(CONFIG.RECORDINGS_DIR)) {
    fs.mkdirSync(CONFIG.RECORDINGS_DIR, { recursive: true });
  }
}

module.exports = {
  db: { get: getDb, run: (sql, params) => {
    db.run(sql, params);
    saveDatabase();
  }, exec: (sql, params) => {
    if (params && params.length > 0) {
      const stmt = db.prepare(sql);
      stmt.bind(params);
      const results = [];
      while (stmt.step()) {
        results.push(stmt.getAsObject());
      }
      stmt.free();
      return [{ columns: Object.keys(results[0] || {}), values: results.map(r => Object.values(r)) }];
    }
    return db.exec(sql);
  } },
  initializeDatabase,
  ensureRecordingsDirectory,
  getRecordingsDir: () => CONFIG.RECORDINGS_DIR,
  saveDatabase
};
