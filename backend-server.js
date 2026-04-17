const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const webpush = require('web-push');
const { Pool } = require('pg');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || 'couples-app-secret-change-in-production';

// ─── PostgreSQL Setup ─────────────────────────────────────────────────────────
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('railway')
      ? { rejectUnauthorized: false }
          : false,
});

async function initDB() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
              id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                          email TEXT UNIQUE NOT NULL,
                                password TEXT NOT NULL,
                                      love_language TEXT DEFAULT 'words-of-affirmation',
                                            couple_id TEXT,
                                                  invite_code TEXT UNIQUE,
                                                        created_at TIMESTAMPTZ DEFAULT NOW()
                                                            );
                                                                CREATE TABLE IF NOT EXISTS couples (
                                                                      id TEXT PRIMARY KEY,
                                                                            partner1_id TEXT NOT NULL,
                                                                                  partner2_id TEXT NOT NULL,
                                                                                        anniversary DATE,
                                                                                              created_at TIMESTAMPTZ DEFAULT NOW()
                                                                                                  );
                                                                                                      CREATE TABLE IF NOT EXISTS events (
                                                                                                            id TEXT PRIMARY KEY,
                                                                                                                  couple_id TEXT NOT NULL,
                                                                                                                        created_by TEXT NOT NULL,
                                                                                                                              title TEXT,
                                                                                                                                    date TEXT,
                                                                                                                                          description TEXT,
                                                                                                                                                created_at TIMESTAMPTZ DEFAULT NOW()
                                                                                                                                                    );
                                                                                                                                                        CREATE TABLE IF NOT EXISTS tasks (
                                                                                                                                                              id TEXT PRIMARY KEY,
                                                                                                                                                                    couple_id TEXT NOT NULL,
                                                                                                                                                                          created_by TEXT NOT NULL,
                                                                                                                                                                                title TEXT,
                                                                                                                                                                                      assignee TEXT,
                                                                                                                                                                                            completed BOOLEAN DEFAULT false,
                                                                                                                                                                                                  created_at TIMESTAMPTZ DEFAULT NOW()
                                                                                                                                                                                                      );
                                                                                                                                                                                                          CREATE TABLE IF NOT EXISTS goals (
                                                                                                                                                                                                                id TEXT PRIMARY KEY,
                                                                                                                                                                                                                      couple_id TEXT NOT NULL,
                                                                                                                                                                                                                            created_by TEXT NOT NULL,
                                                                                                                                                                                                                                  title TEXT,
                                                                                                                                                                                                                                        target_amount NUMERIC,
                                                                                                                                                                                                                                              progress NUMERIC DEFAULT 0,
                                                                                                                                                                                                                                                    completed BOOLEAN DEFAULT false,
                                                                                                                                                                                                                                                          created_at TIMESTAMPTZ DEFAULT NOW()
                                                                                                                                                                                                                                                              );
                                                                                                                                                                                                                                                                  CREATE TABLE IF NOT EXISTS messages (
                                                                                                                                                                                                                                                                        id TEXT PRIMARY KEY,
                                                                                                                                                                                                                                                                              couple_id TEXT NOT NULL,
                                                                                                                                                                                                                                                                                    sender_id TEXT NOT NULL,
                                                                                                                                                                                                                                                                                          type TEXT DEFAULT 'text',
                                                                                                                                                                                                                                                                                                text TEXT,
                                                                                                                                                                                                                                                                                                      created_at TIMESTAMPTZ DEFAULT NOW()
                                                                                                                                                                                                                                                                                                          );
                                                                                                                                                                                                                                                                                                              CREATE TABLE IF NOT EXISTS streaks (
                                                                                                                                                                                                                                                                                                                    couple_id TEXT PRIMARY KEY,
                                                                                                                                                                                                                                                                                                                          current_streak INTEGER DEFAULT 0,
                                                                                                                                                                                                                                                                                                                                longest_streak INTEGER DEFAULT 0,
                                                                                                                                                                                                                                                                                                                                      last_checkin DATE,
                                                                                                                                                                                                                                                                                                                                            partner1_checkin BOOLEAN DEFAULT false,
                                                                                                                                                                                                                                                                                                                                                  partner2_checkin BOOLEAN DEFAULT false
                                                                                                                                                                                                                                                                                                                                                      );
                                                                                                                                                                                                                                                                                                                                                          CREATE TABLE IF NOT EXISTS budgets (
                                                                                                                                                                                                                                                                                                                                                                id TEXT PRIMARY KEY,
                                                                                                                                                                                                                                                                                                                                                                      couple_id TEXT NOT NULL,
                                                                                                                                                                                                                                                                                                                                                                            added_by TEXT NOT NULL,
                                                                                                                                                                                                                                                                                                                                                                                  description TEXT,
                                                                                                                                                                                                                                                                                                                                                                                        amount NUMERIC,
                                                                                                                                                                                                                                                                                                                                                                                              type TEXT,
                                                                                                                                                                                                                                                                                                                                                                                                    created_at TIMESTAMPTZ DEFAULT NOW()
                                                                                                                                                                                                                                                                                                                                                                                                        );
                                                                                                                                                                                                                                                                                                                                                                                                            CREATE TABLE IF NOT EXISTS push_subscriptions (
                                                                                                                                                                                                                                                                                                                                                                                                                  user_id TEXT PRIMARY KEY,
                                                                                                                                                                                                                                                                                                                                                                                                                        subscription JSONB NOT NULL
                                                                                                                                                                                                                                                                                                                                                                                                                            );
                                                                                                                                                                                                                                                                                                                                                                                                                              `);
    console.log('✅ Database tables ready');
}

initDB().catch(err => console.error('DB init error:', err));

// ─── Web Push Setup ───────────────────────────────────────────────────────────
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(
          process.env.VAPID_EMAIL || 'mailto:hello@couplesync.app',
          process.env.VAPID_PUBLIC_KEY,
          process.env.VAPID_PRIVATE_KEY
        );
}

// ─── WebSocket Clients ────────────────────────────────────────────────────────
const clients = new Map(); // userId -> ws

async function broadcast(coupleId, type, data, excludeUserId = null) {
    const { rows } = await pool.query('SELECT partner1_id, partner2_id FROM couples WHERE id = $1', [coupleId]);
    if (!rows.length) return;
    const members = [rows[0].partner1_id, rows[0].partner2_id];
    members.forEach(userId => {
          if (userId === excludeUserId) return;
          const ws = clients.get(userId);
          if (ws && ws.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify({ type, data }));
          }
    });
}

wss.on('connection', (ws, req) => {
    const token = new URL(req.url, 'http://localhost').searchParams.get('token');
    if (!token) { ws.close(); return; }
    try {
          const decoded = jwt.verify(token, JWT_SECRET);
          clients.set(decoded.userId, ws);
          ws.on('close', () => clients.delete(decoded.userId));
          ws.on('message', async msg => {
                  try {
                            const { type, data } = JSON.parse(msg);
                            const { rows } = await pool.query('SELECT couple_id FROM users WHERE id = $1', [decoded.userId]);
                            if (!rows.length || !rows[0].couple_id) return;
                            broadcast(rows[0].couple_id, type, data, decoded.userId);
                  } catch {}
          });
    } catch { ws.close(); }
});

// ─── Auth Middleware ──────────────────────────────────────────────────────────
function auth(req, res, next) {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No token' });
    try {
          req.user = jwt.verify(token, JWT_SECRET);
          next();
    } catch {
          res.status(401).json({ error: 'Invalid token' });
    }
}

async function (req) {
    const { rows: users } = await pool.query('SELECT couple_id FROM users WHERE id = $1', [req.user.userId]);
    if (!users.length || !users[0].couple_id) return null;
    const { rows: couples } = await pool.query('SELECT * FROM couples WHERE id = $1', [users[0].couple_id]);
    return couples[0] || null;
}

// ─── Auth Routes ──────────────────────────────────────────────────────────────
app.post('/api/register', async (req, res) => {
    try {
          const { name, email, password, loveLanguage } = req.body;
          const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
          if (existing.rows.length) return res.status(400).json({ error: 'Email already exists' });
          const hashed = await bcrypt.hash(password, 10);
          const id = uuidv4();
          const inviteCode = uuidv4().slice(0, 8).toUpperCase();
          await pool.query(
                  'INSERT INTO users (id, name, email, password, love_language, invite_code) VALUES ($1,$2,$3,$4,$5,$6)',
                  [id, name, email, hashed, loveLanguage || 'words-of-affirmation', inviteCode]
                );
          const token = jwt.sign({ userId: id }, JWT_SECRET, { expiresIn: '30d' });
          res.json({ token, user: { id, name, email, loveLanguage, inviteCode, coupleId: null, partner: null } });
    } catch (err) {
          console.error(err);
          res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/login', async (req, res) => {
    try {
          const { email, password } = req.body;
          const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
          const user = rows[0];
          if (!user || !(await bcrypt.compare(password, user.password))) {
                  return res.status(400).json({ error: 'Invalid credentials' });
          }
          const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });
          let partner = null;
          if (user.couple_id) {
                  const { rows: couples } = await pool.query('SELECT * FROM couples WHERE id = $1', [user.couple_id]);
                  const couple = couples[0];
                  if (couple) {
                            const partnerId = couple.partner1_id === user.id ? couple.partner2_id : couple.partner1_id;
                            const { rows: partners } = await pool.query('SELECT id, name, love_language FROM users WHERE id = $1', [partnerId]);
                            if (partners[0]) partner = { name: partners[0].name, loveLanguage: partners[0].love_language };
                  }
          }
          res.json({ token, user: { id: user.id, name: user.name, email: user.email, loveLanguage: user.love_language, inviteCode: user.invite_code, coupleId: user.couple_id, partner } });
    } catch (err) {
          console.error(err);
          res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/couple/join', auth, async (req, res) => {
    try {
          const { inviteCode } = req.body;
          const { rows: inviters } = await pool.query('SELECT * FROM users WHERE invite_code = $1', [inviteCode]);
          const inviter = inviters[0];
          if (!inviter) return res.status(404).json({ error: 'Invalid invite code' });
          if (inviter.id === req.user.userId) return res.status(400).json({ error: 'Cannot pair with yourself' });
          const coupleId = uuidv4();
          await pool.query(
                  'INSERT INTO couples (id, partner1_id, partner2_id) VALUES ($1,$2,$3)',
                  [coupleId, inviter.id, req.user.userId]
                );
          await pool.query('UPDATE users SET couple_id = $1 WHERE id = $2 OR id = $3', [coupleId, inviter.id, req.user.userId]);
          await pool.query('INSERT INTO streaks (couple_id) VALUES ($1) ON CONFLICT DO NOTHING', [coupleId]);
          const { rows: currentUsers } = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.userId]);
          const currentUser = currentUsers[0];
          broadcast(coupleId, 'COUPLE_JOINED', { partner: { name: currentUser.name, loveLanguage: currentUser.love_language } });
          res.json({ coupleId, partner: { name: inviter.name, loveLanguage: inviter.love_language } });
    } catch (err) {
          console.error(err);
          res.status(500).json({ error: 'Server error' });
    }
});

// ─── Dashboard ────────────────────────────────────────────────────────────────
app.get('/api/dashboard', auth, async (req, res) => {
    try {
          const couple = await getCouple(req);
          if (!couple) return res.status(404).json({ error: 'No couple found' });
          const { rows: streakRows } = await pool.query('SELECT * FROM streaks WHERE couple_id = $1', [couple.id]);
          const streak = streakRows[0] || { current_streak: 0, longest_streak: 0 };
          const { rows: todayTasks } = await pool.query('SELECT * FROM tasks WHERE couple_id = $1 AND completed = false LIMIT 5', [couple.id]);
          const { rows: upcomingEvents } = await pool.query("SELECT * FROM events WHERE couple_id = $1 AND date >= NOW()::DATE ORDER BY date LIMIT 3", [couple.id]);
          const { rows: recentMessages } = await pool.query('SELECT * FROM messages WHERE couple_id = $1 ORDER BY created_at DESC LIMIT 10', [couple.id]);
          const { rows: activeGoals } = await pool.query('SELECT * FROM goals WHERE couple_id = $1 AND completed = false LIMIT 5', [couple.id]);
          res.json({ streak: { currentStreak: streak.current_streak, longestStreak: streak.longest_streak }, todayTasks, upcomingEvents, recentMessages, goals: activeGoals });
    } catch (err) {
          console.error(err);
          res.status(500).json({ error: 'Server error' });
    }
});

// ─── Calendar ─────────────────────────────────────────────────────────────────
app.get('/api/events', auth, async (req, res) => {
    try {
          const couple = await getCouple(req);
          if (!couple) return res.status(404).json({ error: 'No couple' });
          const { rows } = await pool.query('SELECT * FROM events WHERE couple_id = $1 ORDER BY date', [couple.id]);
          res.json(rows);
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/events', auth, async (req, res) => {
    try {
          const couple = await getCouple(req);
          if (!couple) return res.status(404).json({ error: 'No couple' });
          const id = uuidv4();
          const { title, date, description } = req.body;
          await pool.query('INSERT INTO events (id, couple_id, created_by, title, date, description) VALUES ($1,$2,$3,$4,$5,$6)',
                                 [id, couple.id, req.user.userId, title, date, description]);
          const { rows } = await pool.query('SELECT * FROM events WHERE id = $1', [id]);
          broadcast(couple.id, 'EVENT_ADDED', rows[0], req.user.userId);
          res.json(rows[0]);
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.put('/api/events/:id', auth, async (req, res) => {
    try {
          const couple = await getCouple(req);
          const { title, date, description } = req.body;
          await pool.query('UPDATE events SET title=$1, date=$2, description=$3 WHERE id=$4 AND couple_id=$5',
                                 [title, date, description, req.params.id, couple.id]);
          const { rows } = await pool.query('SELECT * FROM events WHERE id = $1', [req.params.id]);
          if (!rows.length) return res.status(404).json({ error: 'Not found' });
          broadcast(couple.id, 'EVENT_UPDATED', rows[0], req.user.userId);
          res.json(rows[0]);
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.delete('/api/events/:id', auth, async (req, res) => {
    try {
          const couple = await getCouple(req);
          await pool.query('DELETE FROM events WHERE id = $1 AND couple_id = $2', [req.params.id, couple.id]);
          broadcast(couple.id, 'EVENT_DELETED', { id: req.params.id }, req.user.userId);
          res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// ─── Tasks & Chores ───────────────────────────────────────────────────────────
app.get('/api/tasks', auth, async (req, res) => {
    try {
          const couple = await getCouple(req);
          if (!couple) return res.status(404).json({ error: 'No couple' });
          const { rows } = await pool.query('SELECT * FROM tasks WHERE couple_id = $1 ORDER BY created_at DESC', [couple.id]);
          res.json(rows);
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/tasks', auth, async (req, res) => {
    try {
          const couple = await getCouple(req);
          if (!couple) return res.status(404).json({ error: 'No couple' });
          const id = uuidv4();
          const { title, assignee } = req.body;
          await pool.query('INSERT INTO tasks (id, couple_id, created_by, title, assignee) VALUES ($1,$2,$3,$4,$5)',
                                 [id, couple.id, req.user.userId, title, assignee]);
          const { rows } = await pool.query('SELECT * FROM tasks WHERE id = $1', [id]);
          broadcast(couple.id, 'TASK_ADDED', rows[0], req.user.userId);
          res.json(rows[0]);
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.put('/api/tasks/:id', auth, async (req, res) => {
    try {
          const couple = await getCouple(req);
          const { title, assignee, completed } = req.body;
          await pool.query('UPDATE tasks SET title=$1, assignee=$2, completed=$3 WHERE id=$4 AND couple_id=$5',
                                 [title, assignee, completed, req.params.id, couple.id]);
          const { rows } = await pool.query('SELECT * FROM tasks WHERE id = $1', [req.params.id]);
          if (!rows.length) return res.status(404).json({ error: 'Not found' });
          broadcast(couple.id, 'TASK_UPDATED', rows[0], req.user.userId);
          res.json(rows[0]);
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.delete('/api/tasks/:id', auth, async (req, res) => {
    try {
          const couple = await getCouple(req);
          await pool.query('DELETE FROM tasks WHERE id = $1 AND couple_id = $2', [req.params.id, couple.id]);
          broadcast(couple.id, 'TASK_DELETED', { id: req.params.id }, req.user.userId);
          res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// ─── Goals ────────────────────────────────────────────────────────────────────
app.get('/api/goals', auth, async (req, res) => {
    try {
          const couple = await getCouple(req);
          if (!couple) return res.status(404).json({ error: 'No couple' });
          const { rows } = await pool.query('SELECT * FROM goals WHERE couple_id = $1 ORDER BY created_at DESC', [couple.id]);
          res.json(rows);
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/goals', auth, async (req, res) => {
    try {
          const couple = await getCouple(req);
          if (!couple) return res.status(404).json({ error: 'No couple' });
          const id = uuidv4();
          const { title, targetAmount } = req.body;
          await pool.query('INSERT INTO goals (id, couple_id, created_by, title, target_amount) VALUES ($1,$2,$3,$4,$5)',
                                 [id, couple.id, req.user.userId, title, targetAmount || 0]);
          const { rows } = await pool.query('SELECT * FROM goals WHERE id = $1', [id]);
          broadcast(couple.id, 'GOAL_ADDED', rows[0], req.user.userId);
          res.json(rows[0]);
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.put('/api/goals/:id', auth, async (req, res) => {
    try {
          const couple = await getCouple(req);
          const { title, targetAmount, progress, completed } = req.body;
          const { rows: old } = await pool.query('SELECT progress FROM goals WHERE id = $1', [req.params.id]);
          const oldProgress = old[0] ? parseFloat(old[0].progress) : 0;
          await pool.query('UPDATE goals SET title=$1, target_amount=$2, progress=$3, completed=$4 WHERE id=$5 AND couple_id=$6',
                                 [title, targetAmount, progress, completed, req.params.id, couple.id]);
          const { rows } = await pool.query('SELECT * FROM goals WHERE id = $1', [req.params.id]);
          if (!rows.length) return res.status(404).json({ error: 'Not found' });
          const goal = rows[0];
          const milestones = [25, 50, 75, 100];
          milestones.forEach(async m => {
                  if (oldProgress < m && parseFloat(goal.progress) >= m) {
                            const msgId = uuidv4();
                            await pool.query('INSERT INTO messages (id, couple_id, sender_id, type, text) VALUES ($1,$2,$3,$4,$5)',
                                                       [msgId, couple.id, 'system', 'milestone', `🎉 You've reached ${m}% on "${goal.title}"!`]);
                  }
          });
          broadcast(couple.id, 'GOAL_UPDATED', goal, req.user.userId);
          res.json(goal);
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.delete('/api/goals/:id', auth, async (req, res) => {
    try {
          const couple = await getCouple(req);
          await pool.query('DELETE FROM goals WHERE id = $1 AND couple_id = $2', [req.params.id, couple.id]);
          broadcast(couple.id, 'GOAL_DELETED', { id: req.params.id }, req.user.userId);
          res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// ─── Messages ─────────────────────────────────────────────────────────────────
app.get('/api/messages', auth, async (req, res) => {
    try {
          const couple = await getCouple(req);
          if (!couple) return res.status(404).json({ error: 'No couple' });
          const { rows } = await pool.query('SELECT * FROM messages WHERE couple_id = $1 ORDER BY created_at DESC LIMIT 100', [couple.id]);
          res.json(rows.reverse());
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/messages', auth, async (req, res) => {
    try {
          const couple = await getCouple(req);
          if (!couple) return res.status(404).json({ error: 'No couple' });
          const id = uuidv4();
          const { text, type } = req.body;
          await pool.query('INSERT INTO messages (id, couple_id, sender_id, type, text) VALUES ($1,$2,$3,$4,$5)',
                                 [id, couple.id, req.user.userId, type || 'text', text]);
          const { rows } = await pool.query('SELECT * FROM messages WHERE id = $1', [id]);
          broadcast(couple.id, 'MESSAGE_ADDED', rows[0], req.user.userId);
          res.json(rows[0]);
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// ─── Streaks & Check-ins ──────────────────────────────────────────────────────
app.post('/api/checkin', auth, async (req, res) => {
    try {
          const couple = await getCouple(req);
          if (!couple) return res.status(404).json({ error: 'No couple' });
          await pool.query('INSERT INTO streaks (couple_id) VALUES ($1) ON CONFLICT DO NOTHING', [couple.id]);
          const { rows } = await pool.query('SELECT * FROM streaks WHERE couple_id = $1', [couple.id]);
          let streak = rows[0];
          const today = new Date().toDateString();
          const isPartner1 = couple.partner1_id === req.user.userId;
          if (isPartner1) streak.partner1_checkin = true;
          else streak.partner2_checkin = true;
          if (streak.partner1_checkin && streak.partner2_checkin) {
                  const lastDate = streak.last_checkin ? new Date(streak.last_checkin).toDateString() : null;
                  if (lastDate !== today) {
                            const yesterday = new Date();
                            yesterday.setDate(yesterday.getDate() - 1);
                            if (lastDate === yesterday.toDateString()) streak.current_streak += 1;
                            else streak.current_streak = 1;
                            streak.longest_streak = Math.max(streak.longest_streak, streak.current_streak);
                            streak.last_checkin = new Date();
                            streak.partner1_checkin = false;
                            streak.partner2_checkin = false;
                  }
          }
          await pool.query(
                  'UPDATE streaks SET current_streak=$1, longest_streak=$2, last_checkin=$3, partner1_checkin=$4, partner2_checkin=$5 WHERE couple_id=$6',
                  [streak.current_streak, streak.longest_streak, streak.last_checkin, streak.partner1_checkin, streak.partner2_checkin, couple.id]
                );
          broadcast(couple.id, 'STREAK_UPDATED', streak);
          res.json(streak);
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/streak', auth, async (req, res) => {
    try {
          const couple = await getCouple(req);
          if (!couple) return res.json({ currentStreak: 0, longestStreak: 0 });
          const { rows } = await pool.query('SELECT * FROM streaks WHERE couple_id = $1', [couple.id]);
          const s = rows[0] || { current_streak: 0, longest_streak: 0 };
          res.json({ currentStreak: s.current_streak, longestStreak: s.longest_streak });
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// ─── Budget ───────────────────────────────────────────────────────────────────
app.get('/api/budget', auth, async (req, res) => {
    try {
          const couple = await getCouple(req);
          if (!couple) return res.status(404).json({ error: 'No couple' });
          const { rows } = await pool.query('SELECT * FROM budgets WHERE couple_id = $1 ORDER BY created_at DESC', [couple.id]);
          res.json(rows);
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/budget', auth, async (req, res) => {
    try {
          const couple = await getCouple(req);
          if (!couple) return res.status(404).json({ error: 'No couple' });
          const id = uuidv4();
          const { description, amount, type } = req.body;
          await pool.query('INSERT INTO budgets (id, couple_id, added_by, description, amount, type) VALUES ($1,$2,$3,$4,$5,$6)',
                                 [id, couple.id, req.user.userId, description, amount, type]);
          const { rows } = await pool.query('SELECT * FROM budgets WHERE id = $1', [id]);
          broadcast(couple.id, 'BUDGET_ADDED', rows[0], req.user.userId);
          res.json(rows[0]);
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.delete('/api/budget/:id', auth, async (req, res) => {
    try {
          const couple = await getCouple(req);
          await pool.query('DELETE FROM budgets WHERE id = $1 AND couple_id = $2', [req.params.id, couple.id]);
          broadcast(couple.id, 'BUDGET_DELETED', { id: req.params.id }, req.user.userId);
          res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// ─── Motivation ───────────────────────────────────────────────────────────────
const motivations = {
    'words-of-affirmation': ["Tell your partner one thing you admire about them today 💬","Send a heartfelt text letting them know you're thinking of them 💌","Write a note about a specific memory that makes you smile 📝","Share three things you appreciate about them out loud ✨"],
    'acts-of-service': ["Surprise them by taking care of a task they normally do 🛠️","Make their morning easier — coffee, breakfast, or their bag packed ☕","Handle something on their to-do list without being asked 📋","Cook their favorite meal tonight 🍽️"],
    'receiving-gifts': ["Leave a small, thoughtful surprise somewhere they'll find it 🎁","Order something they've mentioned wanting — big or small 🛍️","Bring home their favorite snack or treat 🍫","Create a handmade card or note just for them ✉️"],
    'quality-time': ["Plan a phone-free evening focused entirely on each other 📵","Try a new activity or recipe together tonight 🎲","Take a walk and just talk — no destination needed 🚶","Set aside 30 minutes to sit together and share your day 🕐"],
    'physical-touch': ["Give a long, intentional hug when you see them today 🤗","Offer a shoulder or back massage tonight 💆","Hold hands on your next walk or errand 🤝","Sit close together during your next movie or show 🎬"],
};

app.get('/api/motivation', auth, async (req, res) => {
    try {
          const couple = await getCouple(req);
          if (!couple) return res.status(404).json({ error: 'No couple' });
          const partnerId = couple.partner1_id === req.user.userId ? couple.partner2_id : couple.partner1_id;
          const { rows } = await pool.query('SELECT name, love_language FROM users WHERE id = $1', [partnerId]);
          const partner = rows[0];
          const partnerLang = partner ? partner.love_language : 'words-of-affirmation';
          const suggestions = motivations[partnerLang] || motivations['words-of-affirmation'];
          const suggestion = suggestions[Math.floor(Math.random() * suggestions.length)];
          res.json({ suggestion, partnerLoveLanguage: partnerLang, partnerName: partner ? partner.name : '' });
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// ─── Push Notifications ───────────────────────────────────────────────────────
async function pushNotify(userId, payload) {
    const { rows } = await pool.query('SELECT subscription FROM push_subscriptions WHERE user_id = $1', [userId]);
    if (!rows.length || !process.env.VAPID_PUBLIC_KEY) return;
    try {
          await webpush.sendNotification(rows[0].subscription, JSON.stringify(payload));
    } catch (err) {
          if (err.statusCode === 410) await pool.query('DELETE FROM push_subscriptions WHERE user_id = $1', [userId]);
    }
}

async function pushPartner(coupleId, senderId, payload) {
    const { rows } = await pool.query('SELECT partner1_id, partner2_id FROM couples WHERE id = $1', [coupleId]);
    if (!rows.length) return;
    const partnerId = rows[0].partner1_id === senderId ? rows[0].partner2_id : rows[0].partner1_id;
    await pushNotify(partnerId, payload);
}

app.post('/api/push/subscribe', auth, async (req, res) => {
    await pool.query('INSERT INTO push_subscriptions (user_id, subscription) VALUES ($1,$2) ON CONFLICT (user_id) DO UPDATE SET subscription = $2',
                         [req.user.userId, req.body]);
    res.json({ success: true });
});

app.delete('/api/push/subscribe', auth, async (req, res) => {
    await pool.query('DELETE FROM push_subscriptions WHERE user_id = $1', [req.user.userId]);
    res.json({ success: true });
});

app.get('/api/push/vapid-key', (req, res) => {
    res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
});

app.post('/api/push/notify-message', auth, async (req, res) => {
    const { rows } = await pool.query('SELECT name, couple_id FROM users WHERE id = $1', [req.user.userId]);
    const user = rows[0];
    if (!user || !user.couple_id) return res.json({});
    await pushPartner(user.couple_id, req.user.userId, {
          title: `💬 Message from ${user.name}`,
          body: req.body.text ? req.body.text.slice(0, 100) : 'New message',
          icon: '/icon-192.png',
          url: '/',
    });
    res.json({ success: true });
});

// ─── Server Start ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`✅ Couples App API running on port ${PORT}`));
