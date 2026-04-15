const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const webpush = require('web-push');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || 'couples-app-secret-change-in-production';

// ─── Web Push Setup ───────────────────────────────────────────────────────────
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    process.env.VAPID_EMAIL || 'mailto:hello@couplesync.app',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

// ─── In-Memory Database (replace with PostgreSQL/MongoDB in production) ───────
let db = {
  users: [],
  couples: [],
  events: [],
  tasks: [],
  goals: [],
  messages: [],
  streaks: {},
  budgets: [],
  checkins: [],
  pushSubscriptions: {} // userId -> push subscription object
};

// ─── WebSocket Clients ────────────────────────────────────────────────────────
const clients = new Map(); // userId -> ws

function broadcast(coupleId, type, data, excludeUserId = null) {
  const couple = db.couples.find(c => c.id === coupleId);
  if (!couple) return;
  const members = [couple.partner1Id, couple.partner2Id];
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
    ws.userId = decoded.userId;

    ws.on('close', () => clients.delete(decoded.userId));
    ws.on('message', (msg) => {
      try {
        const { type, data } = JSON.parse(msg);
        const user = db.users.find(u => u.id === decoded.userId);
        if (!user) return;
        broadcast(user.coupleId, type, data, decoded.userId);
      } catch (e) {}
    });
  } catch (e) {
    ws.close();
  }
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

function getCouple(req) {
  const user = db.users.find(u => u.id === req.user.userId);
  return user ? db.couples.find(c => c.id === user.coupleId) : null;
}

// ─── Auth Routes ──────────────────────────────────────────────────────────────
app.post('/api/register', async (req, res) => {
  const { name, email, password, loveLanguage } = req.body;
  if (db.users.find(u => u.email === email))
    return res.status(400).json({ error: 'Email already exists' });

  const hashed = await bcrypt.hash(password, 10);
  const user = { id: uuidv4(), name, email, password: hashed, loveLanguage, coupleId: null, inviteCode: uuidv4().slice(0, 8).toUpperCase(), createdAt: new Date() };
  db.users.push(user);
  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, user: { id: user.id, name: user.name, email: user.email, loveLanguage: user.loveLanguage, inviteCode: user.inviteCode } });
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  const user = db.users.find(u => u.email === email);
  if (!user || !(await bcrypt.compare(password, user.password)))
    return res.status(400).json({ error: 'Invalid credentials' });

  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });
  const partner = user.coupleId ? db.users.find(u => u.id !== user.id && db.couples.find(c => c.id === user.coupleId && (c.partner1Id === u.id || c.partner2Id === u.id))) : null;
  res.json({ token, user: { id: user.id, name: user.name, email: user.email, loveLanguage: user.loveLanguage, inviteCode: user.inviteCode, coupleId: user.coupleId }, partner: partner ? { id: partner.id, name: partner.name, loveLanguage: partner.loveLanguage } : null });
});

app.post('/api/couple/join', auth, (req, res) => {
  const { inviteCode } = req.body;
  const inviter = db.users.find(u => u.inviteCode === inviteCode);
  if (!inviter) return res.status(404).json({ error: 'Invalid invite code' });
  if (inviter.id === req.user.userId) return res.status(400).json({ error: 'Cannot pair with yourself' });

  const couple = { id: uuidv4(), partner1Id: inviter.id, partner2Id: req.user.userId, createdAt: new Date(), anniversary: null };
  db.couples.push(couple);

  db.users = db.users.map(u => {
    if (u.id === inviter.id || u.id === req.user.userId) return { ...u, coupleId: couple.id };
    return u;
  });

  db.streaks[couple.id] = { currentStreak: 0, longestStreak: 0, lastCheckin: null, partner1Checkin: false, partner2Checkin: false };

  const currentUser = db.users.find(u => u.id === req.user.userId);
  broadcast(couple.id, 'COUPLE_JOINED', { partner: { id: currentUser.id, name: currentUser.name, loveLanguage: currentUser.loveLanguage } });
  res.json({ couple, partner: { id: inviter.id, name: inviter.name, loveLanguage: inviter.loveLanguage } });
});

// ─── Dashboard ────────────────────────────────────────────────────────────────
app.get('/api/dashboard', auth, (req, res) => {
  const couple = getCouple(req);
  if (!couple) return res.status(404).json({ error: 'No couple found' });

  const streak = db.streaks[couple.id] || { currentStreak: 0, longestStreak: 0 };
  const todayTasks = db.tasks.filter(t => t.coupleId === couple.id && !t.completed).slice(0, 5);
  const upcomingEvents = db.events.filter(e => e.coupleId === couple.id && new Date(e.date) >= new Date()).slice(0, 3);
  const recentMessages = db.messages.filter(m => m.coupleId === couple.id).slice(-5);
  const goals = db.goals.filter(g => g.coupleId === couple.id && !g.completed).slice(0, 3);

  res.json({ streak, todayTasks, upcomingEvents, recentMessages, goals });
});

// ─── Calendar ─────────────────────────────────────────────────────────────────
app.get('/api/events', auth, (req, res) => {
  const couple = getCouple(req);
  if (!couple) return res.status(404).json({ error: 'No couple' });
  res.json(db.events.filter(e => e.coupleId === couple.id));
});

app.post('/api/events', auth, (req, res) => {
  const couple = getCouple(req);
  if (!couple) return res.status(404).json({ error: 'No couple' });
  const event = { id: uuidv4(), coupleId: couple.id, createdBy: req.user.userId, ...req.body, createdAt: new Date() };
  db.events.push(event);
  broadcast(couple.id, 'EVENT_ADDED', event, req.user.userId);
  res.json(event);
});

app.put('/api/events/:id', auth, (req, res) => {
  const couple = getCouple(req);
  const idx = db.events.findIndex(e => e.id === req.params.id && e.coupleId === couple?.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  db.events[idx] = { ...db.events[idx], ...req.body };
  broadcast(couple.id, 'EVENT_UPDATED', db.events[idx], req.user.userId);
  res.json(db.events[idx]);
});

app.delete('/api/events/:id', auth, (req, res) => {
  const couple = getCouple(req);
  const idx = db.events.findIndex(e => e.id === req.params.id && e.coupleId === couple?.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  db.events.splice(idx, 1);
  broadcast(couple.id, 'EVENT_DELETED', { id: req.params.id }, req.user.userId);
  res.json({ success: true });
});

// ─── Tasks & Chores ───────────────────────────────────────────────────────────
app.get('/api/tasks', auth, (req, res) => {
  const couple = getCouple(req);
  if (!couple) return res.status(404).json({ error: 'No couple' });
  res.json(db.tasks.filter(t => t.coupleId === couple.id));
});

app.post('/api/tasks', auth, (req, res) => {
  const couple = getCouple(req);
  if (!couple) return res.status(404).json({ error: 'No couple' });
  const task = { id: uuidv4(), coupleId: couple.id, createdBy: req.user.userId, completed: false, ...req.body, createdAt: new Date() };
  db.tasks.push(task);
  broadcast(couple.id, 'TASK_ADDED', task, req.user.userId);
  res.json(task);
});

app.put('/api/tasks/:id', auth, (req, res) => {
  const couple = getCouple(req);
  const idx = db.tasks.findIndex(t => t.id === req.params.id && t.coupleId === couple?.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  db.tasks[idx] = { ...db.tasks[idx], ...req.body };
  broadcast(couple.id, 'TASK_UPDATED', db.tasks[idx], req.user.userId);
  res.json(db.tasks[idx]);
});

app.delete('/api/tasks/:id', auth, (req, res) => {
  const couple = getCouple(req);
  const idx = db.tasks.findIndex(t => t.id === req.params.id && t.coupleId === couple?.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  db.tasks.splice(idx, 1);
  broadcast(couple.id, 'TASK_DELETED', { id: req.params.id }, req.user.userId);
  res.json({ success: true });
});

// ─── Goals ────────────────────────────────────────────────────────────────────
app.get('/api/goals', auth, (req, res) => {
  const couple = getCouple(req);
  if (!couple) return res.status(404).json({ error: 'No couple' });
  res.json(db.goals.filter(g => g.coupleId === couple.id));
});

app.post('/api/goals', auth, (req, res) => {
  const couple = getCouple(req);
  if (!couple) return res.status(404).json({ error: 'No couple' });
  const goal = { id: uuidv4(), coupleId: couple.id, createdBy: req.user.userId, progress: 0, completed: false, ...req.body, createdAt: new Date() };
  db.goals.push(goal);
  broadcast(couple.id, 'GOAL_ADDED', goal, req.user.userId);
  res.json(goal);
});

app.put('/api/goals/:id', auth, (req, res) => {
  const couple = getCouple(req);
  const idx = db.goals.findIndex(g => g.id === req.params.id && g.coupleId === couple?.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const oldProgress = db.goals[idx].progress;
  db.goals[idx] = { ...db.goals[idx], ...req.body };

  // Milestone messages
  const milestones = [25, 50, 75, 100];
  milestones.forEach(m => {
    if (oldProgress < m && db.goals[idx].progress >= m) {
      const msg = { id: uuidv4(), coupleId: couple.id, senderId: 'system', type: 'milestone', text: `🎉 You've reached ${m}% on "${db.goals[idx].title}"!`, createdAt: new Date() };
      db.messages.push(msg);
      broadcast(couple.id, 'MESSAGE_ADDED', msg);
    }
  });

  broadcast(couple.id, 'GOAL_UPDATED', db.goals[idx], req.user.userId);
  res.json(db.goals[idx]);
});

app.delete('/api/goals/:id', auth, (req, res) => {
  const couple = getCouple(req);
  const idx = db.goals.findIndex(g => g.id === req.params.id && g.coupleId === couple?.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  db.goals.splice(idx, 1);
  broadcast(couple.id, 'GOAL_DELETED', { id: req.params.id }, req.user.userId);
  res.json({ success: true });
});

// ─── Messages ─────────────────────────────────────────────────────────────────
app.get('/api/messages', auth, (req, res) => {
  const couple = getCouple(req);
  if (!couple) return res.status(404).json({ error: 'No couple' });
  res.json(db.messages.filter(m => m.coupleId === couple.id).slice(-100));
});

app.post('/api/messages', auth, (req, res) => {
  const couple = getCouple(req);
  if (!couple) return res.status(404).json({ error: 'No couple' });
  const message = { id: uuidv4(), coupleId: couple.id, senderId: req.user.userId, ...req.body, createdAt: new Date() };
  db.messages.push(message);
  broadcast(couple.id, 'MESSAGE_ADDED', message, req.user.userId);
  res.json(message);
});

// ─── Streaks & Check-ins ──────────────────────────────────────────────────────
app.post('/api/checkin', auth, (req, res) => {
  const couple = getCouple(req);
  if (!couple) return res.status(404).json({ error: 'No couple' });

  const streak = db.streaks[couple.id] || { currentStreak: 0, longestStreak: 0, lastCheckin: null, partner1Checkin: false, partner2Checkin: false };
  const today = new Date().toDateString();
  const isPartner1 = couple.partner1Id === req.user.userId;

  if (isPartner1) streak.partner1Checkin = true;
  else streak.partner2Checkin = true;

  if (streak.partner1Checkin && streak.partner2Checkin) {
    const lastDate = streak.lastCheckin ? new Date(streak.lastCheckin).toDateString() : null;
    if (lastDate !== today) {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      if (lastDate === yesterday.toDateString()) {
        streak.currentStreak += 1;
      } else {
        streak.currentStreak = 1;
      }
      streak.longestStreak = Math.max(streak.longestStreak, streak.currentStreak);
      streak.lastCheckin = new Date();
      streak.partner1Checkin = false;
      streak.partner2Checkin = false;
    }
  }

  db.streaks[couple.id] = streak;
  broadcast(couple.id, 'STREAK_UPDATED', streak);
  res.json(streak);
});

app.get('/api/streak', auth, (req, res) => {
  const couple = getCouple(req);
    if (!couple) return res.json({ currentStreak: 0, longestStreak: 0 });
  res.json(db.streaks[couple.id] || { currentStreak: 0, longestStreak: 0 });
});

// ─── Budget ───────────────────────────────────────────────────────────────────
app.get('/api/budget', auth, (req, res) => {
  const couple = getCouple(req);
  if (!couple) return res.status(404).json({ error: 'No couple' });
  res.json(db.budgets.filter(b => b.coupleId === couple.id));
});

app.post('/api/budget', auth, (req, res) => {
  const couple = getCouple(req);
  if (!couple) return res.status(404).json({ error: 'No couple' });
  const entry = { id: uuidv4(), coupleId: couple.id, addedBy: req.user.userId, ...req.body, createdAt: new Date() };
  db.budgets.push(entry);
  broadcast(couple.id, 'BUDGET_ADDED', entry, req.user.userId);
  res.json(entry);
});

app.delete('/api/budget/:id', auth, (req, res) => {
  const couple = getCouple(req);
  const idx = db.budgets.findIndex(b => b.id === req.params.id && b.coupleId === couple?.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  db.budgets.splice(idx, 1);
  broadcast(couple.id, 'BUDGET_DELETED', { id: req.params.id }, req.user.userId);
  res.json({ success: true });
});

// ─── Motivation ───────────────────────────────────────────────────────────────
const motivations = {
  'words-of-affirmation': [
    "Tell your partner one thing you admire about them today 💬",
    "Send a heartfelt text letting them know you're thinking of them 💌",
    "Write a note about a specific memory that makes you smile 📝",
    "Share three things you appreciate about them out loud ✨"
  ],
  'acts-of-service': [
    "Surprise them by taking care of a task they normally do 🛠️",
    "Make their morning easier — coffee, breakfast, or their bag packed ☕",
    "Handle something on their to-do list without being asked 📋",
    "Cook their favorite meal tonight 🍽️"
  ],
  'receiving-gifts': [
    "Leave a small, thoughtful surprise somewhere they'll find it 🎁",
    "Order something they've mentioned wanting — big or small 🛍️",
    "Bring home their favorite snack or treat 🍫",
    "Create a handmade card or note just for them ✉️"
  ],
  'quality-time': [
    "Plan a phone-free evening focused entirely on each other 📵",
    "Try a new activity or recipe together tonight 🎲",
    "Take a walk and just talk — no destination needed 🚶",
    "Set aside 30 minutes to sit together and share your day 🕐"
  ],
  'physical-touch': [
    "Give a long, intentional hug when you see them today 🤗",
    "Offer a shoulder or back massage tonight 💆",
    "Hold hands on your next walk or errand 🤝",
    "Sit close together during your next movie or show 🎬"
  ]
};

app.get('/api/motivation', auth, (req, res) => {
  const user = db.users.find(u => u.id === req.user.userId);
  const couple = getCouple(req);
  if (!couple) return res.status(404).json({ error: 'No couple' });

  const partner = db.users.find(u => u.id !== req.user.userId && (couple.partner1Id === u.id || couple.partner2Id === u.id));
  const partnerLang = partner?.loveLanguage || 'words-of-affirmation';
  const suggestions = motivations[partnerLang] || motivations['words-of-affirmation'];
  const suggestion = suggestions[Math.floor(Math.random() * suggestions.length)];

  res.json({ suggestion, partnerLoveLanguage: partnerLang, partnerName: partner?.name });
});

// ─── Push Notifications ───────────────────────────────────────────────────────

// Helper: send a push notification to a specific user
async function pushNotify(userId, payload) {
  const sub = db.pushSubscriptions[userId];
  if (!sub || !process.env.VAPID_PUBLIC_KEY) return;
  try {
    await webpush.sendNotification(sub, JSON.stringify(payload));
  } catch (err) {
    if (err.statusCode === 410) delete db.pushSubscriptions[userId]; // expired subscription
  }
}

// Helper: push to the partner
async function pushPartner(coupleId, senderId, payload) {
  const couple = db.couples.find(c => c.id === coupleId);
  if (!couple) return;
  const partnerId = couple.partner1Id === senderId ? couple.partner2Id : couple.partner1Id;
  await pushNotify(partnerId, payload);
}

// Subscribe endpoint
app.post('/api/push/subscribe', auth, (req, res) => {
  db.pushSubscriptions[req.user.userId] = req.body;
  res.json({ success: true });
});

// Unsubscribe endpoint
app.delete('/api/push/subscribe', auth, (req, res) => {
  delete db.pushSubscriptions[req.user.userId];
  res.json({ success: true });
});

// VAPID public key endpoint (frontend fetches this)
app.get('/api/push/vapid-key', (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || '' });
});

// Hook push notifications into existing message + checkin routes
// (Middleware that fires after broadcast for message adds)
app.post('/api/push/notify-message', auth, async (req, res) => {
  const user = db.users.find(u => u.id === req.user.userId);
  if (!user?.coupleId) return res.json({});
  await pushPartner(user.coupleId, req.user.userId, {
    title: `💬 Message from ${user.name}`,
    body: req.body.text?.slice(0, 80) || 'New message',
    icon: '/icon-192.png',
    url: '/'
  });
  res.json({ success: true });
});

// ─── Server Start ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`✅ Couples App API running on port ${PORT}`));
