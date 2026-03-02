const express = require('express');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const XLSX = require('xlsx');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'hrpb-crm-stable-secret-key-2024';
const upload = multer({ dest: '/tmp/uploads/' });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Database setup
const db = new Database(path.join(__dirname, 'crm.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    contact TEXT,
    email TEXT,
    interest_level TEXT DEFAULT 'cold',
    followup_date TEXT,
    assigned_to INTEGER,
    created_by INTEGER,
    project_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (assigned_to) REFERENCES users(id),
    FOREIGN KEY (created_by) REFERENCES users(id),
    FOREIGN KEY (project_id) REFERENCES projects(id)
  );

  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    location TEXT,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    note TEXT NOT NULL,
    followup_date TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES clients(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS custom_fields (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    field_name TEXT NOT NULL,
    field_key TEXT UNIQUE NOT NULL,
    field_type TEXT NOT NULL DEFAULT 'text',
    options TEXT,
    sort_order INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS client_custom_data (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL,
    field_id INTEGER NOT NULL,
    value TEXT,
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
    FOREIGN KEY (field_id) REFERENCES custom_fields(id) ON DELETE CASCADE,
    UNIQUE(client_id, field_id)
  );

  CREATE TABLE IF NOT EXISTS interest_levels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    emoji TEXT DEFAULT '',
    color TEXT DEFAULT '#6b7280',
    bg_color TEXT DEFAULT '#f3f4f6',
    sort_order INTEGER DEFAULT 0
  );
`);

// Seed default interest levels if empty
const levelCount = db.prepare('SELECT COUNT(*) as c FROM interest_levels').get().c;
if (levelCount === 0) {
  const levels = [
    { key: 'cold', name: 'Cold', emoji: '❄️', color: '#2563eb', bg_color: '#eff6ff', sort_order: 0 },
    { key: 'warm', name: 'Warm', emoji: '🌤', color: '#ea580c', bg_color: '#fff7ed', sort_order: 1 },
    { key: 'hot', name: 'Hot', emoji: '🔥', color: '#dc2626', bg_color: '#fef2f2', sort_order: 2 },
    { key: 'not_interested', name: 'Not Interested', emoji: '🚫', color: '#64748b', bg_color: '#f1f5f9', sort_order: 3 },
    { key: 'close_won', name: 'Close Won', emoji: '✅', color: '#16a34a', bg_color: '#f0fdf4', sort_order: 4 },
    { key: 'close_lost', name: 'Close Lost', emoji: '❌', color: '#991b1b', bg_color: '#fef2f2', sort_order: 5 },
  ];
  const ins = db.prepare('INSERT INTO interest_levels (key, name, emoji, color, bg_color, sort_order) VALUES (?, ?, ?, ?, ?, ?)');
  for (const l of levels) ins.run(l.key, l.name, l.emoji, l.color, l.bg_color, l.sort_order);
}

// Seed default theme settings
const themeExists = db.prepare("SELECT key FROM settings WHERE key = 'theme_primary'").get();
if (!themeExists) {
  const ins = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  ins.run('theme_primary', '#2563eb');
  ins.run('theme_sidebar', '#1e293b');
  ins.run('theme_background', '#f1f5f9');
}

// Create default admin if not exists
const adminExists = db.prepare('SELECT id FROM users WHERE role = ?').get('admin');
if (!adminExists) {
  const hash = bcrypt.hashSync('admin123', 10);
  db.prepare('INSERT INTO users (name, username, password, role) VALUES (?, ?, ?, ?)').run('Zarghan', 'admin', hash, 'admin');
}

// Auth middleware
function auth(req, res, next) {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: 'Not logged in' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    res.status(401).json({ error: 'Invalid token' });
  }
}

function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

// Auth routes
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const token = jwt.sign({ id: user.id, name: user.name, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
  res.cookie('token', token, { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 });
  res.json({ id: user.id, name: user.name, role: user.role });
});

app.post('/api/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

app.get('/api/me', auth, (req, res) => {
  res.json(req.user);
});

// User management
app.get('/api/users', auth, adminOnly, (req, res) => {
  res.json(db.prepare('SELECT id, name, username, role, created_at FROM users').all());
});

app.post('/api/users', auth, adminOnly, (req, res) => {
  const { name, username, password, role } = req.body;
  const hash = bcrypt.hashSync(password, 10);
  try {
    const result = db.prepare('INSERT INTO users (name, username, password, role) VALUES (?, ?, ?, ?)').run(name, username, hash, role || 'member');
    res.json({ id: result.lastInsertRowid });
  } catch (e) {
    res.status(400).json({ error: 'Username already exists' });
  }
});

app.delete('/api/users/:id', auth, adminOnly, (req, res) => {
  db.prepare('DELETE FROM users WHERE id = ? AND role != ?').run(req.params.id, 'admin');
  res.json({ ok: true });
});

// Project routes
app.get('/api/projects', auth, (req, res) => {
  res.json(db.prepare('SELECT * FROM projects ORDER BY name').all());
});

app.post('/api/projects', auth, adminOnly, (req, res) => {
  const { name, location, description } = req.body;
  const result = db.prepare('INSERT INTO projects (name, location, description) VALUES (?, ?, ?)').run(name, location, description);
  res.json({ id: result.lastInsertRowid });
});

app.put('/api/projects/:id', auth, adminOnly, (req, res) => {
  const { name, location, description } = req.body;
  db.prepare('UPDATE projects SET name=?, location=?, description=? WHERE id=?').run(name, location, description, req.params.id);
  res.json({ ok: true });
});

app.delete('/api/projects/:id', auth, adminOnly, (req, res) => {
  db.prepare('UPDATE clients SET project_id = NULL WHERE project_id = ?').run(req.params.id);
  db.prepare('DELETE FROM projects WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Client routes
app.get('/api/clients', auth, (req, res) => {
  let query, params;
  if (req.user.role === 'admin') {
    query = `SELECT c.*, u.name as assigned_name, p.name as project_name FROM clients c LEFT JOIN users u ON c.assigned_to = u.id LEFT JOIN projects p ON c.project_id = p.id`;
    params = [];
  } else {
    query = `SELECT c.*, u.name as assigned_name, p.name as project_name FROM clients c LEFT JOIN users u ON c.assigned_to = u.id LEFT JOIN projects p ON c.project_id = p.id WHERE c.assigned_to = ?`;
    params = [req.user.id];
  }

  const { interest_level, search, assigned_to, project_id } = req.query;
  let conditions = [];

  if (req.user.role === 'admin' && assigned_to) {
    conditions.push(`c.assigned_to = ${parseInt(assigned_to)}`);
  }
  if (project_id) {
    conditions.push(`c.project_id = ${parseInt(project_id)}`);
  }
  if (interest_level) {
    conditions.push(`c.interest_level = '${interest_level.replace(/'/g, "''")}'`);
  }
  if (search) {
    conditions.push(`(c.name LIKE '%${search.replace(/'/g, "''")}%' OR c.contact LIKE '%${search.replace(/'/g, "''")}%')`);
  }

  if (conditions.length > 0) {
    if (query.includes('WHERE')) {
      query += ` AND ${conditions.join(' AND ')}`;
    } else {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }
  }

  query += ' ORDER BY c.followup_date ASC';

  const clients = db.prepare(query).all(...params);

  // Attach custom data
  const customFields = db.prepare('SELECT * FROM custom_fields ORDER BY sort_order').all();
  if (customFields.length > 0) {
    for (const client of clients) {
      const cd = db.prepare('SELECT field_id, value FROM client_custom_data WHERE client_id = ?').all(client.id);
      client.custom_data = {};
      for (const d of cd) {
        const field = customFields.find(f => f.id === d.field_id);
        if (field) client.custom_data[field.field_key] = d.value;
      }
    }
  }

  res.json(clients);
});

app.post('/api/clients', auth, (req, res) => {
  const { name, contact, email, interest_level, followup_date, assigned_to, project_id, custom_data } = req.body;
  const assignTo = req.user.role === 'admin' ? (assigned_to || req.user.id) : req.user.id;
  const result = db.prepare(
    'INSERT INTO clients (name, contact, email, interest_level, followup_date, assigned_to, created_by, project_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(name, contact, email, interest_level || 'cold', followup_date, assignTo, req.user.id, project_id || null);

  if (custom_data && typeof custom_data === 'object') {
    const ins = db.prepare('INSERT OR REPLACE INTO client_custom_data (client_id, field_id, value) VALUES (?, ?, ?)');
    const fields = db.prepare('SELECT * FROM custom_fields').all();
    for (const [key, val] of Object.entries(custom_data)) {
      const field = fields.find(f => f.field_key === key);
      if (field) ins.run(result.lastInsertRowid, field.id, val);
    }
  }

  res.json({ id: result.lastInsertRowid });
});

app.put('/api/clients/:id', auth, (req, res) => {
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
  if (!client) return res.status(404).json({ error: 'Not found' });
  if (req.user.role !== 'admin' && client.assigned_to !== req.user.id) {
    return res.status(403).json({ error: 'Not your client' });
  }
  const { name, contact, email, interest_level, followup_date, assigned_to, project_id, custom_data } = req.body;
  db.prepare(
    'UPDATE clients SET name=?, contact=?, email=?, interest_level=?, followup_date=?, assigned_to=?, project_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=?'
  ).run(name, contact, email, interest_level, followup_date, req.user.role === 'admin' ? (assigned_to || client.assigned_to) : client.assigned_to, project_id || null, req.params.id);

  if (custom_data && typeof custom_data === 'object') {
    const ins = db.prepare('INSERT OR REPLACE INTO client_custom_data (client_id, field_id, value) VALUES (?, ?, ?)');
    const fields = db.prepare('SELECT * FROM custom_fields').all();
    for (const [key, val] of Object.entries(custom_data)) {
      const field = fields.find(f => f.field_key === key);
      if (field) ins.run(req.params.id, field.id, val);
    }
  }

  res.json({ ok: true });
});

app.delete('/api/clients/:id', auth, (req, res) => {
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
  if (!client) return res.status(404).json({ error: 'Not found' });
  if (req.user.role !== 'admin' && client.assigned_to !== req.user.id) {
    return res.status(403).json({ error: 'Not your client' });
  }
  db.prepare('DELETE FROM client_custom_data WHERE client_id = ?').run(req.params.id);
  db.prepare('DELETE FROM notes WHERE client_id = ?').run(req.params.id);
  db.prepare('DELETE FROM clients WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Notes routes
app.get('/api/clients/:id/notes', auth, (req, res) => {
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
  if (!client) return res.status(404).json({ error: 'Not found' });
  if (req.user.role !== 'admin' && client.assigned_to !== req.user.id) {
    return res.status(403).json({ error: 'Not your client' });
  }
  const notes = db.prepare('SELECT n.*, u.name as user_name FROM notes n JOIN users u ON n.user_id = u.id WHERE n.client_id = ? ORDER BY n.created_at DESC').all(req.params.id);
  res.json(notes);
});

app.post('/api/clients/:id/notes', auth, (req, res) => {
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
  if (!client) return res.status(404).json({ error: 'Not found' });
  if (req.user.role !== 'admin' && client.assigned_to !== req.user.id) {
    return res.status(403).json({ error: 'Not your client' });
  }
  const { note, followup_date } = req.body;
  const result = db.prepare('INSERT INTO notes (client_id, user_id, note, followup_date) VALUES (?, ?, ?, ?)').run(req.params.id, req.user.id, note, followup_date || null);

  // Auto-update client followup_date if provided
  if (followup_date) {
    db.prepare('UPDATE clients SET followup_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(followup_date, req.params.id);
  }

  res.json({ id: result.lastInsertRowid });
});

// Excel upload
app.post('/api/clients/upload', auth, upload.single('file'), (req, res) => {
  try {
    const workbook = XLSX.readFile(req.file.path);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(sheet);

    const insert = db.prepare(
      'INSERT INTO clients (name, contact, email, interest_level, followup_date, assigned_to, created_by, project_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );

    let count = 0;
    const assignTo = req.body.assigned_to || req.user.id;
    const projectId = req.body.project_id || null;

    for (const row of data) {
      const name = row.name || row.Name || row.NAME || row['Client Name'] || '';
      const contact = row.contact || row.Contact || row.CONTACT || row.Phone || row.phone || row.PHONE || row.Mobile || '';
      const email = row.email || row.Email || row.EMAIL || '';
      const interest = row.interest_level || row.Interest || row.interest || row.Status || row.status || 'cold';
      const followup = row.followup_date || row.Followup || row.followup || row['Follow Up'] || '';

      if (name) {
        insert.run(name, String(contact), email, interest, followup, assignTo, req.user.id, projectId);
        count++;
      }
    }

    fs.unlinkSync(req.file.path);
    res.json({ imported: count });
  } catch (e) {
    res.status(400).json({ error: 'Invalid file: ' + e.message });
  }
});

// Dashboard stats
app.get('/api/stats', auth, (req, res) => {
  if (req.user.role === 'admin') {
    const total = db.prepare('SELECT COUNT(*) as c FROM clients').get().c;
    const byLevel = db.prepare('SELECT interest_level, COUNT(*) as c FROM clients GROUP BY interest_level').all();
    const byUser = db.prepare('SELECT u.name, COUNT(c.id) as c FROM users u LEFT JOIN clients c ON c.assigned_to = u.id GROUP BY u.id').all();
    const todayFollowups = db.prepare("SELECT COUNT(*) as c FROM clients WHERE followup_date = date('now')").get().c;
    const overdueFollowups = db.prepare("SELECT COUNT(*) as c FROM clients WHERE followup_date < date('now') AND interest_level NOT IN ('close_won','close_lost','not_interested')").get().c;
    const recentClients = db.prepare("SELECT COUNT(*) as c FROM clients WHERE created_at >= date('now', '-7 days')").get().c;
    res.json({ total, byLevel, byUser, todayFollowups, overdueFollowups, recentClients });
  } else {
    const total = db.prepare('SELECT COUNT(*) as c FROM clients WHERE assigned_to = ?').get(req.user.id).c;
    const byLevel = db.prepare('SELECT interest_level, COUNT(*) as c FROM clients WHERE assigned_to = ? GROUP BY interest_level').all(req.user.id);
    const todayFollowups = db.prepare("SELECT COUNT(*) as c FROM clients WHERE assigned_to = ? AND followup_date = date('now')").get(req.user.id).c;
    const overdueFollowups = db.prepare("SELECT COUNT(*) as c FROM clients WHERE assigned_to = ? AND followup_date < date('now') AND interest_level NOT IN ('close_won','close_lost','not_interested')").get(req.user.id).c;
    res.json({ total, byLevel, byUser: [], todayFollowups, overdueFollowups, recentClients: 0 });
  }
});

// ===== SETTINGS API =====

// Interest levels
app.get('/api/interest-levels', auth, (req, res) => {
  res.json(db.prepare('SELECT * FROM interest_levels ORDER BY sort_order').all());
});

app.post('/api/interest-levels', auth, adminOnly, (req, res) => {
  const { key, name, emoji, color, bg_color } = req.body;
  if (!key || !name) return res.status(400).json({ error: 'Key and name required' });
  const maxOrder = db.prepare('SELECT MAX(sort_order) as m FROM interest_levels').get().m || 0;
  try {
    const result = db.prepare('INSERT INTO interest_levels (key, name, emoji, color, bg_color, sort_order) VALUES (?, ?, ?, ?, ?, ?)').run(key, name, emoji || '', color || '#6b7280', bg_color || '#f3f4f6', maxOrder + 1);
    res.json({ id: result.lastInsertRowid });
  } catch (e) {
    res.status(400).json({ error: 'Key already exists' });
  }
});

app.put('/api/interest-levels/:id', auth, adminOnly, (req, res) => {
  const { name, emoji, color, bg_color } = req.body;
  db.prepare('UPDATE interest_levels SET name=?, emoji=?, color=?, bg_color=? WHERE id=?').run(name, emoji, color, bg_color, req.params.id);
  res.json({ ok: true });
});

app.delete('/api/interest-levels/:id', auth, adminOnly, (req, res) => {
  db.prepare('DELETE FROM interest_levels WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Custom fields
app.get('/api/custom-fields', auth, (req, res) => {
  res.json(db.prepare('SELECT * FROM custom_fields ORDER BY sort_order').all());
});

app.post('/api/custom-fields', auth, adminOnly, (req, res) => {
  const { field_name, field_key, field_type, options } = req.body;
  if (!field_name || !field_key) return res.status(400).json({ error: 'Name and key required' });
  const maxOrder = db.prepare('SELECT MAX(sort_order) as m FROM custom_fields').get().m || 0;
  try {
    const result = db.prepare('INSERT INTO custom_fields (field_name, field_key, field_type, options, sort_order) VALUES (?, ?, ?, ?, ?)').run(field_name, field_key, field_type || 'text', options || null, maxOrder + 1);
    res.json({ id: result.lastInsertRowid });
  } catch (e) {
    res.status(400).json({ error: 'Field key already exists' });
  }
});

app.delete('/api/custom-fields/:id', auth, adminOnly, (req, res) => {
  db.prepare('DELETE FROM client_custom_data WHERE field_id = ?').run(req.params.id);
  db.prepare('DELETE FROM custom_fields WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Theme settings
app.get('/api/settings/theme', auth, (req, res) => {
  const rows = db.prepare("SELECT key, value FROM settings WHERE key LIKE 'theme_%'").all();
  const theme = {};
  for (const r of rows) theme[r.key] = r.value;
  res.json(theme);
});

app.put('/api/settings/theme', auth, adminOnly, (req, res) => {
  const upd = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  for (const [key, value] of Object.entries(req.body)) {
    if (key.startsWith('theme_')) upd.run(key, value);
  }
  res.json({ ok: true });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`HRPB CRM running on http://localhost:${PORT}`);
});
