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
const PORT = 3000;
const JWT_SECRET = 'cipher-crm-secret-' + Date.now();
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
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (assigned_to) REFERENCES users(id),
    FOREIGN KEY (created_by) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    note TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES clients(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

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

// User management (admin only)
app.get('/api/users', auth, adminOnly, (req, res) => {
  const users = db.prepare('SELECT id, name, username, role, created_at FROM users').all();
  res.json(users);
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

// Client routes
app.get('/api/clients', auth, (req, res) => {
  let query, params;
  if (req.user.role === 'admin') {
    query = `SELECT c.*, u.name as assigned_name FROM clients c LEFT JOIN users u ON c.assigned_to = u.id ORDER BY c.followup_date ASC`;
    params = [];
  } else {
    query = `SELECT c.*, u.name as assigned_name FROM clients c LEFT JOIN users u ON c.assigned_to = u.id WHERE c.assigned_to = ? ORDER BY c.followup_date ASC`;
    params = [req.user.id];
  }
  
  const { interest_level, search, assigned_to } = req.query;
  let conditions = [];
  
  if (req.user.role === 'admin' && assigned_to) {
    conditions.push(`c.assigned_to = ${parseInt(assigned_to)}`);
  }
  if (interest_level) {
    conditions.push(`c.interest_level = '${interest_level.replace(/'/g, "''")}'`);
  }
  if (search) {
    conditions.push(`(c.name LIKE '%${search.replace(/'/g, "''")}%' OR c.contact LIKE '%${search.replace(/'/g, "''")}%')`);
  }
  
  if (conditions.length > 0) {
    if (query.includes('WHERE')) {
      query = query.replace('ORDER BY', `AND ${conditions.join(' AND ')} ORDER BY`);
    } else {
      query = query.replace('ORDER BY', `WHERE ${conditions.join(' AND ')} ORDER BY`);
    }
  }
  
  res.json(db.prepare(query).all(...params));
});

app.post('/api/clients', auth, (req, res) => {
  const { name, contact, email, interest_level, followup_date, assigned_to } = req.body;
  const assignTo = req.user.role === 'admin' ? (assigned_to || req.user.id) : req.user.id;
  const result = db.prepare(
    'INSERT INTO clients (name, contact, email, interest_level, followup_date, assigned_to, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(name, contact, email, interest_level || 'cold', followup_date, assignTo, req.user.id);
  res.json({ id: result.lastInsertRowid });
});

app.put('/api/clients/:id', auth, (req, res) => {
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
  if (!client) return res.status(404).json({ error: 'Not found' });
  if (req.user.role !== 'admin' && client.assigned_to !== req.user.id) {
    return res.status(403).json({ error: 'Not your client' });
  }
  const { name, contact, email, interest_level, followup_date, assigned_to } = req.body;
  db.prepare(
    'UPDATE clients SET name=?, contact=?, email=?, interest_level=?, followup_date=?, assigned_to=?, updated_at=CURRENT_TIMESTAMP WHERE id=?'
  ).run(name, contact, email, interest_level, followup_date, req.user.role === 'admin' ? (assigned_to || client.assigned_to) : client.assigned_to, req.params.id);
  res.json({ ok: true });
});

app.delete('/api/clients/:id', auth, (req, res) => {
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
  if (!client) return res.status(404).json({ error: 'Not found' });
  if (req.user.role !== 'admin' && client.assigned_to !== req.user.id) {
    return res.status(403).json({ error: 'Not your client' });
  }
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
  const result = db.prepare('INSERT INTO notes (client_id, user_id, note) VALUES (?, ?, ?)').run(req.params.id, req.user.id, req.body.note);
  res.json({ id: result.lastInsertRowid });
});

// Excel upload
app.post('/api/clients/upload', auth, upload.single('file'), (req, res) => {
  try {
    const workbook = XLSX.readFile(req.file.path);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(sheet);
    
    const insert = db.prepare(
      'INSERT INTO clients (name, contact, email, interest_level, followup_date, assigned_to, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    
    let count = 0;
    const assignTo = req.body.assigned_to || req.user.id;
    
    for (const row of data) {
      const name = row.name || row.Name || row.NAME || row['Client Name'] || '';
      const contact = row.contact || row.Contact || row.CONTACT || row.Phone || row.phone || row.PHONE || row.Mobile || '';
      const email = row.email || row.Email || row.EMAIL || '';
      const interest = row.interest_level || row.Interest || row.interest || row.Status || row.status || 'cold';
      const followup = row.followup_date || row.Followup || row.followup || row['Follow Up'] || '';
      
      if (name) {
        insert.run(name, String(contact), email, interest, followup, assignTo, req.user.id);
        count++;
      }
    }
    
    fs.unlinkSync(req.file.path);
    res.json({ imported: count });
  } catch (e) {
    res.status(400).json({ error: 'Invalid file: ' + e.message });
  }
});

// Dashboard stats (admin)
app.get('/api/stats', auth, (req, res) => {
  if (req.user.role === 'admin') {
    const total = db.prepare('SELECT COUNT(*) as c FROM clients').get().c;
    const byLevel = db.prepare('SELECT interest_level, COUNT(*) as c FROM clients GROUP BY interest_level').all();
    const byUser = db.prepare('SELECT u.name, COUNT(c.id) as c FROM users u LEFT JOIN clients c ON c.assigned_to = u.id GROUP BY u.id').all();
    const todayFollowups = db.prepare("SELECT COUNT(*) as c FROM clients WHERE followup_date = date('now')").get().c;
    const overdueFollowups = db.prepare("SELECT COUNT(*) as c FROM clients WHERE followup_date < date('now') AND interest_level NOT IN ('close_won','close_lost','not_interested')").get().c;
    res.json({ total, byLevel, byUser, todayFollowups, overdueFollowups });
  } else {
    const total = db.prepare('SELECT COUNT(*) as c FROM clients WHERE assigned_to = ?').get(req.user.id).c;
    const byLevel = db.prepare('SELECT interest_level, COUNT(*) as c FROM clients WHERE assigned_to = ? GROUP BY interest_level').all(req.user.id);
    const todayFollowups = db.prepare("SELECT COUNT(*) as c FROM clients WHERE assigned_to = ? AND followup_date = date('now')").get(req.user.id).c;
    const overdueFollowups = db.prepare("SELECT COUNT(*) as c FROM clients WHERE assigned_to = ? AND followup_date < date('now') AND interest_level NOT IN ('close_won','close_lost','not_interested')").get(req.user.id).c;
    res.json({ total, byLevel, byUser: [], todayFollowups, overdueFollowups });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`CRM running on http://localhost:${PORT}`);
});
