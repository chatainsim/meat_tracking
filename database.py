import sqlite3
import os

DB_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')
DB_PATH = os.path.join(DB_DIR, 'cave.db')

def get_db():
    if not os.path.exists(DB_DIR):
        os.makedirs(DB_DIR, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init():
    conn = get_db()
    conn.execute("PRAGMA journal_mode = WAL")
    
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS meats (
            id            TEXT PRIMARY KEY,
            name          TEXT NOT NULL,
            type          TEXT NOT NULL,
            initialWeight REAL NOT NULL,
            startDate     TEXT NOT NULL,
            targetDays    INTEGER NOT NULL DEFAULT 60,
            targetLoss    REAL NOT NULL DEFAULT 30,
            createdAt     TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS weight_entries (
            id      INTEGER PRIMARY KEY AUTOINCREMENT,
            meatId  TEXT NOT NULL,
            weight  REAL NOT NULL,
            date    TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sensors (
            id          INTEGER PRIMARY KEY CHECK (id = 1),
            temperature REAL,
            humidity    REAL,
            updatedAt   TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS sensor_settings (
            id          INTEGER PRIMARY KEY CHECK (id = 1),
            temp_min    REAL DEFAULT 3.0,
            temp_max    REAL DEFAULT 15.0,
            hum_min     REAL DEFAULT 60.0,
            hum_max     REAL DEFAULT 85.0
        );
        
        CREATE TABLE IF NOT EXISTS sensor_history (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            temperature REAL,
            humidity    REAL,
            timestamp   TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS github_settings (
            id      INTEGER PRIMARY KEY CHECK (id = 1),
            token   TEXT,
            repo    TEXT,
            path    TEXT DEFAULT 'backup.json',
            enabled INTEGER DEFAULT 0
        );
        INSERT OR IGNORE INTO github_settings (id, token, repo, path, enabled) VALUES (1, '', '', 'backup.json', 0);

        CREATE TABLE IF NOT EXISTS telegram_settings (
            id            INTEGER PRIMARY KEY CHECK (id = 1),
            token         TEXT,
            chat_id       TEXT,
            interval_days INTEGER DEFAULT 7,
            enabled       INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS type_defaults (
            type TEXT PRIMARY KEY,
            days INTEGER,
            loss REAL
        );
        INSERT OR IGNORE INTO type_defaults (type, days, loss) VALUES 
            ('coppa', 90, 30), ('lonzo', 60, 30), ('pancetta', 75, 30),
            ('guanciale', 90, 30), ('bresaola', 45, 35), ('jambon', 180, 25),
            ('saucisson', 30, 25), ('magret', 21, 35), ('filet_mignon', 21, 35),
            ('boeuf_seche', 45, 40), ('jerky', 1, 50), ('lomo', 60, 35),
            ('pastrami', 14, 20), ('autre', 60, 30);
        CREATE TABLE IF NOT EXISTS app_settings (
            id            INTEGER PRIMARY KEY CHECK (id = 1),
            producer_name TEXT DEFAULT ''
        );
        INSERT OR IGNORE INTO app_settings (id, producer_name) VALUES (1, '');
    """)
    
    # Ensure new columns exist before we try to use them
    try:
        conn.execute("ALTER TABLE telegram_settings ADD COLUMN report_frequency TEXT DEFAULT 'off'")
    except: pass
    try:
        conn.execute("ALTER TABLE telegram_settings ADD COLUMN last_report_date TEXT")
    except: pass
    
    # Now that we are sure columns exist, we can INSERT/IGNORE
    conn.execute("INSERT OR IGNORE INTO telegram_settings (id, token, chat_id, interval_days, enabled, report_frequency) VALUES (1, '', '', 7, 0, 'off')")
    
    # Migration for sensor_settings
    try:
        conn.execute("ALTER TABLE sensor_settings ADD COLUMN alerts_enabled INTEGER DEFAULT 0")
    except: pass
    
    # Ensure default settings exist
    conn.execute("INSERT OR IGNORE INTO sensor_settings (id, temp_min, temp_max, hum_min, hum_max, alerts_enabled) VALUES (1, 3.0, 15.0, 60.0, 85.0, 0)")
    
    conn.commit()
    
    # migration
    cursor = conn.execute("PRAGMA table_info(meats)")
    cols = [row['name'] for row in cursor.fetchall()]
    
    if 'salt' not in cols: conn.execute('ALTER TABLE meats ADD COLUMN salt REAL')
    if 'sugar' not in cols: conn.execute('ALTER TABLE meats ADD COLUMN sugar REAL')
    if 'spices' not in cols: conn.execute('ALTER TABLE meats ADD COLUMN spices TEXT')
    if 'notes' not in cols: conn.execute('ALTER TABLE meats ADD COLUMN notes TEXT')
    if 'price' not in cols: conn.execute('ALTER TABLE meats ADD COLUMN price REAL')
    if 'archived' not in cols: conn.execute('ALTER TABLE meats ADD COLUMN archived INTEGER DEFAULT 0')
    if 'smoked' not in cols: conn.execute('ALTER TABLE meats ADD COLUMN smoked INTEGER DEFAULT 0')
    if 'lastNotificationDate' not in cols: conn.execute('ALTER TABLE meats ADD COLUMN lastNotificationDate TEXT')
    
    conn.commit()
    conn.close()

def query_db(query, args=(), one=False):
    conn = get_db()
    cur = conn.execute(query, args)
    rv = [dict(row) for row in cur.fetchall()]
    conn.commit()
    conn.close()
    return (rv[0] if rv else None) if one else rv

def execute_db(query, args=()):
    conn = get_db()
    cur = conn.execute(query, args)
    lastrowid = cur.lastrowid
    conn.commit()
    conn.close()
    return lastrowid
