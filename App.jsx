import { useState, useEffect, useRef, useCallback } from "react";

const API = "https://couplesync-backend-production.up.railway.app";
const WS_URL = "wss://couplesync-backend-production.up.railway.app";

// ─── API Helper ───────────────────────────────────────────────────────────────
async function api(path, method = "GET", body = null, token = null) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, { method, headers, body: body ? JSON.stringify(body) : null });
  if (!res.ok) throw await res.json();
  return res.json();
}

// ─── Icons (inline SVG) ───────────────────────────────────────────────────────
const icons = {
  home: "🏠", calendar: "📅", tasks: "✅", goals: "🎯",
  heart: "💕", streak: "🔥", messages: "💬", budget: "💰",
  plus: "➕", check: "✔️", trash: "🗑️", edit: "✏️",
  logout: "🚪", user: "👤", partner: "👫", send: "📤"
};

// ─── Auth Screen ──────────────────────────────────────────────────────────────
function AuthScreen({ onLogin }) {
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ name: "", email: "", password: "", loveLanguage: "words-of-affirmation" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const loveLanguages = [
    { value: "words-of-affirmation", label: "Words of Affirmation" },
    { value: "acts-of-service", label: "Acts of Service" },
    { value: "receiving-gifts", label: "Receiving Gifts" },
    { value: "quality-time", label: "Quality Time" },
    { value: "physical-touch", label: "Physical Touch" }
  ];

  async function handleSubmit(e) {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      const data = mode === "login"
        ? await api("/login", "POST", { email: form.email, password: form.password })
        : await api("/register", "POST", form);
      onLogin(data);
    } catch (err) {
      setError(err.error || "Something went wrong");
    } finally { setLoading(false); }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-logo">💕</div>
        <h1>CoupleSync</h1>
        <p className="auth-tagline">Stay connected, grow together</p>

        <div className="auth-tabs">
          <button className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>Sign In</button>
          <button className={mode === "register" ? "active" : ""} onClick={() => setMode("register")}>Create Account</button>
        </div>

        <form onSubmit={handleSubmit}>
          {mode === "register" && (
            <input placeholder="Your name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required />
          )}
          <input type="email" placeholder="Email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} required />
          <input type="password" placeholder="Password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} required />
          {mode === "register" && (
            <select value={form.loveLanguage} onChange={e => setForm({ ...form, loveLanguage: e.target.value })}>
              {loveLanguages.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
            </select>
          )}
          {error && <div className="error">{error}</div>}
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? "Loading..." : mode === "login" ? "Sign In" : "Create Account"}
          </button>
        </form>
      </div>
    </div>
  );
}

// ─── Invite / Pair Screen ─────────────────────────────────────────────────────
function PairScreen({ user, token, onPaired }) {
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  function copyCode() {
    navigator.clipboard.writeText(user.inviteCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleJoin(e) {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      const data = await api("/couple/join", "POST", { inviteCode }, token);
      onPaired(data);
    } catch (err) {
      setError(err.error || "Invalid invite code");
    } finally { setLoading(false); }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-logo">👫</div>
        <h2>Connect with Your Partner</h2>
        <p>Share your code or enter theirs to link your accounts.</p>

        <div className="invite-code-box">
          <label>Your Invite Code</label>
          <div className="invite-code">{user.inviteCode}</div>
          <button className="btn-secondary" onClick={copyCode}>{copied ? "Copied! ✓" : "Copy Code"}</button>
        </div>

        <div className="divider">— OR —</div>

        <form onSubmit={handleJoin}>
          <input
            placeholder="Enter partner's invite code"
            value={inviteCode}
            onChange={e => setInviteCode(e.target.value.toUpperCase())}
            maxLength={8}
            required
          />
          {error && <div className="error">{error}</div>}
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? "Connecting..." : "Connect with Partner"}
          </button>
        </form>
      </div>
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
function Dashboard({ user, partner, token, streak }) {
  const [data, setData] = useState(null);
  const [motivation, setMotivation] = useState(null);
  const [checkedIn, setCheckedIn] = useState(false);

  useEffect(() => {
    api("/dashboard", "GET", null, token).then(setData).catch(() => {});
    api("/motivation", "GET", null, token).then(setMotivation).catch(() => {});
  }, [token]);

  async function handleCheckin() {
    await api("/checkin", "POST", {}, token);
    setCheckedIn(true);
  }

  return (
    <div className="page">
      <h2>Good {new Date().getHours() < 12 ? "morning" : new Date().getHours() < 17 ? "afternoon" : "evening"}, {user.name}! 👋</h2>

      <div className="cards-grid">
        <div className="card streak-card">
          <div className="card-icon">🔥</div>
          <div className="card-value">{streak?.currentStreak || 0}</div>
          <div className="card-label">Day Streak</div>
          <div className="card-sub">Longest: {streak?.longestStreak || 0} days</div>
          {!checkedIn && (
            <button className="btn-primary btn-sm" onClick={handleCheckin}>Daily Check-in ✓</button>
          )}
          {checkedIn && <div className="success-badge">Checked in! ✓</div>}
        </div>

        <div className="card partner-card">
          <div className="card-icon">👫</div>
          <div className="card-value">{partner?.name || "—"}</div>
          <div className="card-label">Your Partner</div>
          <div className="card-sub">Love language: {partner?.loveLanguage?.replace(/-/g, " ") || "—"}</div>
        </div>

        {motivation && (
          <div className="card motivation-card">
            <div className="card-icon">💡</div>
            <div className="card-label">Today's Suggestion for {motivation.partnerName}</div>
            <p>{motivation.suggestion}</p>
          </div>
        )}

        {data?.upcomingEvents?.length > 0 && (
          <div className="card events-card">
            <div className="card-icon">📅</div>
            <div className="card-label">Upcoming</div>
            {data.upcomingEvents.map(e => (
              <div key={e.id} className="mini-item">{e.title} — {new Date(e.date).toLocaleDateString()}</div>
            ))}
          </div>
        )}

        {data?.todayTasks?.length > 0 && (
          <div className="card tasks-card">
            <div className="card-icon">✅</div>
            <div className="card-label">Open Tasks</div>
            {data.todayTasks.map(t => (
              <div key={t.id} className="mini-item">{t.title}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Calendar ─────────────────────────────────────────────────────────────────
function CalendarPage({ token, wsEvents }) {
  const [events, setEvents] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: "", date: "", time: "", notes: "", recurring: "none" });

  useEffect(() => { api("/events", "GET", null, token).then(setEvents).catch(() => {}); }, [token]);

  useEffect(() => {
    if (wsEvents?.type === "EVENT_ADDED") setEvents(prev => [...prev, wsEvents.data]);
    if (wsEvents?.type === "EVENT_UPDATED") setEvents(prev => prev.map(e => e.id === wsEvents.data.id ? wsEvents.data : e));
    if (wsEvents?.type === "EVENT_DELETED") setEvents(prev => prev.filter(e => e.id !== wsEvents.data.id));
  }, [wsEvents]);

  async function addEvent(e) {
    e.preventDefault();
    const event = await api("/events", "POST", form, token);
    setEvents(prev => [...prev, event]);
    setForm({ title: "", date: "", time: "", notes: "", recurring: "none" });
    setShowForm(false);
  }

  async function deleteEvent(id) {
    await api(`/events/${id}`, "DELETE", null, token);
    setEvents(prev => prev.filter(e => e.id !== id));
  }

  const upcoming = events.filter(e => new Date(e.date) >= new Date()).sort((a, b) => new Date(a.date) - new Date(b.date));
  const past = events.filter(e => new Date(e.date) < new Date()).sort((a, b) => new Date(b.date) - new Date(a.date));

  return (
    <div className="page">
      <div className="page-header">
        <h2>📅 Calendar</h2>
        <button className="btn-primary" onClick={() => setShowForm(!showForm)}>{icons.plus} Add Event</button>
      </div>

      {showForm && (
        <form className="card form-card" onSubmit={addEvent}>
          <h3>New Event</h3>
          <input placeholder="Event title" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} required />
          <div className="form-row">
            <input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} required />
            <input type="time" value={form.time} onChange={e => setForm({ ...form, time: e.target.value })} />
          </div>
          <select value={form.recurring} onChange={e => setForm({ ...form, recurring: e.target.value })}>
            <option value="none">No repeat</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
          </select>
          <textarea placeholder="Notes (optional)" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
          <div className="form-actions">
            <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" className="btn-primary">Save Event</button>
          </div>
        </form>
      )}

      <h3>Upcoming</h3>
      {upcoming.length === 0 && <p className="empty">No upcoming events. Add one!</p>}
      <div className="list">
        {upcoming.map(e => (
          <div key={e.id} className="list-item">
            <div className="list-item-icon">📅</div>
            <div className="list-item-content">
              <strong>{e.title}</strong>
              <span>{new Date(e.date).toLocaleDateString()} {e.time && `at ${e.time}`} {e.recurring !== "none" && `· Repeats ${e.recurring}`}</span>
              {e.notes && <span className="notes">{e.notes}</span>}
            </div>
            <button className="icon-btn" onClick={() => deleteEvent(e.id)}>{icons.trash}</button>
          </div>
        ))}
      </div>

      {past.length > 0 && (
        <>
          <h3>Past</h3>
          <div className="list faded">
            {past.slice(0, 5).map(e => (
              <div key={e.id} className="list-item">
                <div className="list-item-icon">📅</div>
                <div className="list-item-content">
                  <strong>{e.title}</strong>
                  <span>{new Date(e.date).toLocaleDateString()}</span>
                </div>
                <button className="icon-btn" onClick={() => deleteEvent(e.id)}>{icons.trash}</button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Tasks ────────────────────────────────────────────────────────────────────
function TasksPage({ token, user, partner, wsEvents }) {
  const [tasks, setTasks] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: "", assignedTo: "", dueDate: "", recurring: "none", priority: "medium" });
  const [filter, setFilter] = useState("all");

  useEffect(() => { api("/tasks", "GET", null, token).then(setTasks).catch(() => {}); }, [token]);

  useEffect(() => {
    if (wsEvents?.type === "TASK_ADDED") setTasks(prev => [...prev, wsEvents.data]);
    if (wsEvents?.type === "TASK_UPDATED") setTasks(prev => prev.map(t => t.id === wsEvents.data.id ? wsEvents.data : t));
    if (wsEvents?.type === "TASK_DELETED") setTasks(prev => prev.filter(t => t.id !== wsEvents.data.id));
  }, [wsEvents]);

  async function addTask(e) {
    e.preventDefault();
    const task = await api("/tasks", "POST", form, token);
    setTasks(prev => [...prev, task]);
    setForm({ title: "", assignedTo: "", dueDate: "", recurring: "none", priority: "medium" });
    setShowForm(false);
  }

  async function toggleTask(task) {
    const updated = await api(`/tasks/${task.id}`, "PUT", { completed: !task.completed }, token);
    setTasks(prev => prev.map(t => t.id === task.id ? updated : t));
  }

  async function deleteTask(id) {
    await api(`/tasks/${id}`, "DELETE", null, token);
    setTasks(prev => prev.filter(t => t.id !== id));
  }

  const filtered = tasks.filter(t => {
    if (filter === "mine") return t.assignedTo === user.id;
    if (filter === "partner") return t.assignedTo === partner?.id;
    if (filter === "pending") return !t.completed;
    if (filter === "done") return t.completed;
    return true;
  });

  const priorityColor = { high: "#ff6b6b", medium: "#ffd93d", low: "#6bcb77" };

  return (
    <div className="page">
      <div className="page-header">
        <h2>✅ Tasks & Chores</h2>
        <button className="btn-primary" onClick={() => setShowForm(!showForm)}>{icons.plus} Add Task</button>
      </div>

      <div className="filter-tabs">
        {["all", "pending", "mine", "partner", "done"].map(f => (
          <button key={f} className={filter === f ? "active" : ""} onClick={() => setFilter(f)}>{f.charAt(0).toUpperCase() + f.slice(1)}</button>
        ))}
      </div>

      {showForm && (
        <form className="card form-card" onSubmit={addTask}>
          <h3>New Task</h3>
          <input placeholder="Task title" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} required />
          <div className="form-row">
            <select value={form.assignedTo} onChange={e => setForm({ ...form, assignedTo: e.target.value })}>
              <option value="">Unassigned</option>
              <option value={user.id}>Me ({user.name})</option>
              {partner && <option value={partner.id}>{partner.name}</option>}
            </select>
            <select value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })}>
              <option value="high">High Priority</option>
              <option value="medium">Medium Priority</option>
              <option value="low">Low Priority</option>
            </select>
          </div>
          <div className="form-row">
            <input type="date" value={form.dueDate} onChange={e => setForm({ ...form, dueDate: e.target.value })} />
            <select value={form.recurring} onChange={e => setForm({ ...form, recurring: e.target.value })}>
              <option value="none">No repeat</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>
          <div className="form-actions">
            <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" className="btn-primary">Add Task</button>
          </div>
        </form>
      )}

      <div className="list">
        {filtered.length === 0 && <p className="empty">No tasks here. Add one!</p>}
        {filtered.map(t => (
          <div key={t.id} className={`list-item ${t.completed ? "completed" : ""}`}>
            <button className="check-btn" onClick={() => toggleTask(t)} style={{ borderColor: priorityColor[t.priority] }}>
              {t.completed ? "✓" : ""}
            </button>
            <div className="list-item-content">
              <strong>{t.title}</strong>
              <span>
                {t.assignedTo === user.id ? `Assigned to me` : t.assignedTo === partner?.id ? `Assigned to ${partner.name}` : "Unassigned"}
                {t.dueDate && ` · Due ${new Date(t.dueDate).toLocaleDateString()}`}
                {t.recurring !== "none" && ` · Repeats ${t.recurring}`}
                <span className="priority-dot" style={{ background: priorityColor[t.priority] }}></span>
              </span>
            </div>
            <button className="icon-btn" onClick={() => deleteTask(t.id)}>{icons.trash}</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Goals ────────────────────────────────────────────────────────────────────
function GoalsPage({ token, wsEvents }) {
  const [goals, setGoals] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: "", description: "", type: "short-term", targetDate: "", targetAmount: 0 });

  useEffect(() => { api("/goals", "GET", null, token).then(setGoals).catch(() => {}); }, [token]);

  useEffect(() => {
    if (wsEvents?.type === "GOAL_ADDED") setGoals(prev => [...prev, wsEvents.data]);
    if (wsEvents?.type === "GOAL_UPDATED") setGoals(prev => prev.map(g => g.id === wsEvents.data.id ? wsEvents.data : g));
    if (wsEvents?.type === "GOAL_DELETED") setGoals(prev => prev.filter(g => g.id !== wsEvents.data.id));
  }, [wsEvents]);

  async function addGoal(e) {
    e.preventDefault();
    const goal = await api("/goals", "POST", form, token);
    setGoals(prev => [...prev, goal]);
    setForm({ title: "", description: "", type: "short-term", targetDate: "", targetAmount: 0 });
    setShowForm(false);
  }

  async function updateProgress(goal, delta) {
    const newProgress = Math.max(0, Math.min(100, (goal.progress || 0) + delta));
    const updated = await api(`/goals/${goal.id}`, "PUT", { progress: newProgress, completed: newProgress >= 100 }, token);
    setGoals(prev => prev.map(g => g.id === goal.id ? updated : g));
  }

  async function deleteGoal(id) {
    await api(`/goals/${id}`, "DELETE", null, token);
    setGoals(prev => prev.filter(g => g.id !== id));
  }

  return (
    <div className="page">
      <div className="page-header">
        <h2>🎯 Goals & Dreams</h2>
        <button className="btn-primary" onClick={() => setShowForm(!showForm)}>{icons.plus} Add Goal</button>
      </div>

      {showForm && (
        <form className="card form-card" onSubmit={addGoal}>
          <h3>New Goal</h3>
          <input placeholder="Goal title" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} required />
          <textarea placeholder="Description" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
          <div className="form-row">
            <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
              <option value="short-term">Short-term (weeks)</option>
              <option value="long-term">Long-term (months/years)</option>
              <option value="dream">Dream Goal</option>
            </select>
            <input type="date" value={form.targetDate} onChange={e => setForm({ ...form, targetDate: e.target.value })} />
          </div>
          <div className="form-actions">
            <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" className="btn-primary">Add Goal</button>
          </div>
        </form>
      )}

      <div className="goals-list">
        {goals.length === 0 && <p className="empty">No goals yet. Add your first shared dream!</p>}
        {goals.map(g => (
          <div key={g.id} className={`card goal-card ${g.completed ? "completed" : ""}`}>
            <div className="goal-header">
              <div>
                <strong>{g.title}</strong>
                <span className={`type-badge type-${g.type}`}>{g.type.replace("-", " ")}</span>
              </div>
              <button className="icon-btn" onClick={() => deleteGoal(g.id)}>{icons.trash}</button>
            </div>
            {g.description && <p className="goal-desc">{g.description}</p>}
            {g.targetDate && <p className="goal-date">🗓 Target: {new Date(g.targetDate).toLocaleDateString()}</p>}
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${g.progress || 0}%` }}></div>
            </div>
            <div className="progress-controls">
              <span>{g.progress || 0}% complete</span>
              <div>
                <button className="btn-sm btn-secondary" onClick={() => updateProgress(g, -10)}>-10%</button>
                <button className="btn-sm btn-primary" onClick={() => updateProgress(g, 10)}>+10%</button>
              </div>
            </div>
            {g.completed && <div className="completed-badge">🎉 Completed!</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Messages ─────────────────────────────────────────────────────────────────
function MessagesPage({ token, user, partner, wsEvents }) {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [type, setType] = useState("text");
  const bottomRef = useRef(null);

  useEffect(() => {
    api("/messages", "GET", null, token).then(setMessages).catch(() => {});
  }, [token]);

  useEffect(() => {
    if (wsEvents?.type === "MESSAGE_ADDED") setMessages(prev => [...prev, wsEvents.data]);
  }, [wsEvents]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  async function sendMessage(e) {
    e.preventDefault();
    if (!text.trim()) return;
    const msg = await api("/messages", "POST", { text, type }, token);
    setMessages(prev => [...prev, msg]);
    setText("");
  }

  const quickMessages = [
    "Thinking of you 💭", "Love you! ❤️", "Miss you 🥺",
    "You're amazing ✨", "Can't wait to see you 🤗", "Good morning! ☀️"
  ];

  return (
    <div className="page messages-page">
      <h2>💬 Messages</h2>

      <div className="quick-messages">
        {quickMessages.map(q => (
          <button key={q} className="quick-msg-btn" onClick={() => setText(q)}>{q}</button>
        ))}
      </div>

      <div className="messages-list">
        {messages.map(m => (
          <div key={m.id} className={`message ${m.senderId === user.id ? "mine" : m.senderId === "system" ? "system" : "theirs"}`}>
            {m.senderId === "system"
              ? <div className="system-msg">{m.text}</div>
              : (
                <div className="bubble">
                  <div className="bubble-text">{m.text}</div>
                  <div className="bubble-time">{new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
                </div>
              )
            }
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <form className="message-input" onSubmit={sendMessage}>
        <select value={type} onChange={e => setType(e.target.value)}>
          <option value="text">💬 Text</option>
          <option value="affirmation">💕 Affirmation</option>
          <option value="gratitude">🙏 Gratitude</option>
          <option value="encouragement">🌟 Encouragement</option>
        </select>
        <input
          placeholder={`Send a ${type} to ${partner?.name || "your partner"}...`}
          value={text}
          onChange={e => setText(e.target.value)}
        />
        <button type="submit" className="btn-primary">{icons.send}</button>
      </form>
    </div>
  );
}

// ─── Budget ───────────────────────────────────────────────────────────────────
function BudgetPage({ token, user, partner, wsEvents }) {
  const [entries, setEntries] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: "", amount: "", category: "food", type: "expense", date: new Date().toISOString().split("T")[0] });

  useEffect(() => { api("/budget", "GET", null, token).then(setEntries).catch(() => {}); }, [token]);

  useEffect(() => {
    if (wsEvents?.type === "BUDGET_ADDED") setEntries(prev => [...prev, wsEvents.data]);
    if (wsEvents?.type === "BUDGET_DELETED") setEntries(prev => prev.filter(e => e.id !== wsEvents.data.id));
  }, [wsEvents]);

  async function addEntry(e) {
    e.preventDefault();
    const entry = await api("/budget", "POST", { ...form, amount: parseFloat(form.amount) }, token);
    setEntries(prev => [...prev, entry]);
    setForm({ title: "", amount: "", category: "food", type: "expense", date: new Date().toISOString().split("T")[0] });
    setShowForm(false);
  }

  async function deleteEntry(id) {
    await api(`/budget/${id}`, "DELETE", null, token);
    setEntries(prev => prev.filter(e => e.id !== id));
  }

  const expenses = entries.filter(e => e.type === "expense");
  const income = entries.filter(e => e.type === "income");
  const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);
  const totalIncome = income.reduce((s, e) => s + e.amount, 0);
  const balance = totalIncome - totalExpenses;

  const categories = { food: "🍔", entertainment: "🎬", transport: "🚗", home: "🏠", health: "💊", shopping: "🛍️", travel: "✈️", other: "📦" };

  const byCategory = expenses.reduce((acc, e) => {
    acc[e.category] = (acc[e.category] || 0) + e.amount;
    return acc;
  }, {});

  return (
    <div className="page">
      <div className="page-header">
        <h2>💰 Budget</h2>
        <button className="btn-primary" onClick={() => setShowForm(!showForm)}>{icons.plus} Add Entry</button>
      </div>

      <div className="budget-summary">
        <div className="budget-stat income">
          <span>Income</span>
          <strong>${totalIncome.toFixed(2)}</strong>
        </div>
        <div className="budget-stat expenses">
          <span>Expenses</span>
          <strong>${totalExpenses.toFixed(2)}</strong>
        </div>
        <div className={`budget-stat balance ${balance >= 0 ? "positive" : "negative"}`}>
          <span>Balance</span>
          <strong>{balance >= 0 ? "+" : ""}${balance.toFixed(2)}</strong>
        </div>
      </div>

      {Object.keys(byCategory).length > 0 && (
        <div className="card">
          <h3>Spending by Category</h3>
          {Object.entries(byCategory).sort((a, b) => b[1] - a[1]).map(([cat, amt]) => (
            <div key={cat} className="category-row">
              <span>{categories[cat] || "📦"} {cat.charAt(0).toUpperCase() + cat.slice(1)}</span>
              <div className="category-bar-wrap">
                <div className="category-bar" style={{ width: `${Math.min(100, (amt / totalExpenses) * 100)}%` }}></div>
              </div>
              <span>${amt.toFixed(2)}</span>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <form className="card form-card" onSubmit={addEntry}>
          <h3>New Entry</h3>
          <input placeholder="Title" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} required />
          <div className="form-row">
            <input type="number" placeholder="Amount" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} min="0" step="0.01" required />
            <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
              <option value="expense">Expense</option>
              <option value="income">Income</option>
            </select>
          </div>
          <div className="form-row">
            <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
              {Object.entries(categories).map(([k, v]) => <option key={k} value={k}>{v} {k.charAt(0).toUpperCase() + k.slice(1)}</option>)}
            </select>
            <input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} />
          </div>
          <div className="form-actions">
            <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" className="btn-primary">Add Entry</button>
          </div>
        </form>
      )}

      <div className="list">
        {entries.sort((a, b) => new Date(b.date) - new Date(a.date)).map(e => (
          <div key={e.id} className="list-item">
            <div className="list-item-icon">{categories[e.category] || "📦"}</div>
            <div className="list-item-content">
              <strong>{e.title}</strong>
              <span>{e.category} · {new Date(e.date).toLocaleDateString()} · Added by {e.addedBy === user.id ? "me" : partner?.name || "partner"}</span>
            </div>
            <div className={`amount ${e.type === "income" ? "income" : "expense"}`}>
              {e.type === "income" ? "+" : "-"}${e.amount.toFixed(2)}
            </div>
            <button className="icon-btn" onClick={() => deleteEntry(e.id)}>{icons.trash}</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Motivation Page ──────────────────────────────────────────────────────────
function MotivationPage({ token, partner }) {
  const [motivation, setMotivation] = useState(null);

  function refresh() {
    api("/motivation", "GET", null, token).then(setMotivation).catch(() => {});
  }

  useEffect(() => { refresh(); }, [token]);

  const loveLanguageEmojis = {
    "words-of-affirmation": "💬", "acts-of-service": "🛠️",
    "receiving-gifts": "🎁", "quality-time": "⏱️", "physical-touch": "🤗"
  };

  return (
    <div className="page">
      <h2>💡 Motivation</h2>

      {motivation && (
        <div className="card motivation-big-card">
          <div className="motivation-emoji">{loveLanguageEmojis[motivation.partnerLoveLanguage] || "💕"}</div>
          <h3>{motivation.partnerName}'s Love Language</h3>
          <p className="love-lang-name">{motivation.partnerLoveLanguage?.replace(/-/g, " ")}</p>
          <div className="divider"></div>
          <h4>Today's Suggestion</h4>
          <p className="motivation-text">{motivation.suggestion}</p>
          <button className="btn-primary" onClick={refresh}>Get New Suggestion 🔄</button>
        </div>
      )}

      <div className="card">
        <h3>About Love Languages</h3>
        <div className="love-lang-grid">
          {Object.entries(loveLanguageEmojis).map(([lang, emoji]) => (
            <div key={lang} className={`love-lang-item ${partner?.loveLanguage === lang ? "highlighted" : ""}`}>
              <span className="lang-emoji">{emoji}</span>
              <span>{lang.replace(/-/g, " ")}</span>
              {partner?.loveLanguage === lang && <span className="partner-tag">{partner.name}'s language</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Push Notification Helpers ────────────────────────────────────────────────
const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY || "";

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.register("/sw.js");
    return reg;
  } catch { return null; }
}

async function subscribeToPush(token) {
  if (!("PushManager" in window)) return false;
  const reg = await navigator.serviceWorker.ready;
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return false;
  try {
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
    });
    await api("/push/subscribe", "POST", sub, token);
    return true;
  } catch { return false; }
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function Toast({ message, onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, 3500);
    return () => clearTimeout(t);
  }, [onDone]);
  return <div className="toast">{message}</div>;
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [auth, setAuth] = useState(() => {
    const token = localStorage.getItem("token");
    const user = JSON.parse(localStorage.getItem("user") || "null");
    const partner = JSON.parse(localStorage.getItem("partner") || "null");
    return { token, user, partner };
  });
  const [page, setPage] = useState("dashboard");
  const [streak, setStreak] = useState(null);
  const [wsEvent, setWsEvent] = useState(null);
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem("theme") === "dark");
  const [notifStatus, setNotifStatus] = useState(() => Notification?.permission || "default");
  const [toast, setToast] = useState(null);
  const [installPrompt, setInstallPrompt] = useState(null);
  const [showInstallBanner, setShowInstallBanner] = useState(false);
  const wsRef = useRef(null);

  // Apply theme
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", darkMode ? "dark" : "light");
    localStorage.setItem("theme", darkMode ? "dark" : "light");
  }, [darkMode]);

  // Register service worker on load
  useEffect(() => { registerServiceWorker(); }, []);

  // Capture PWA install prompt
  useEffect(() => {
    const handler = (e) => { e.preventDefault(); setInstallPrompt(e); setShowInstallBanner(true); };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  useEffect(() => {
    if (!auth.token) return;
    api("/streak", "GET", null, auth.token).then(setStreak).catch(() => {});
  }, [auth.token]);

  useEffect(() => {
    if (!auth.token || !auth.user?.coupleId) return;
    const ws = new WebSocket(`${WS_URL}?token=${auth.token}`);
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      setWsEvent(msg);
      if (msg.type === "STREAK_UPDATED") setStreak(msg.data);
      // Show toast for partner actions
      if (msg.type === "MESSAGE_ADDED") setToast(`💬 New message from ${auth.partner?.name}`);
      if (msg.type === "TASK_ADDED") setToast(`✅ ${auth.partner?.name} added a new task`);
      if (msg.type === "GOAL_UPDATED") setToast(`🎯 Goal progress updated!`);
      if (msg.type === "EVENT_ADDED") setToast(`📅 ${auth.partner?.name} added an event`);
    };
    wsRef.current = ws;
    return () => ws.close();
  }, [auth.token, auth.user?.coupleId]);

  function handleLogin(data) {
    localStorage.setItem("token", data.token);
    localStorage.setItem("user", JSON.stringify(data.user));
    localStorage.setItem("partner", JSON.stringify(data.partner));
    setAuth({ token: data.token, user: data.user, partner: data.partner });
  }

  function handlePaired(data) {
    const updatedUser = { ...auth.user, coupleId: data.couple.id };
    localStorage.setItem("user", JSON.stringify(updatedUser));
    localStorage.setItem("partner", JSON.stringify(data.partner));
    setAuth(prev => ({ ...prev, user: updatedUser, partner: data.partner }));
  }

  function handleLogout() {
    localStorage.clear();
    setAuth({ token: null, user: null, partner: null });
  }

  async function handleEnableNotifications() {
    const ok = await subscribeToPush(auth.token);
    setNotifStatus(Notification?.permission || "default");
    setToast(ok ? "🔔 Notifications enabled!" : "❌ Could not enable notifications");
  }

  async function handleInstall() {
    if (!installPrompt) return;
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === "accepted") { setShowInstallBanner(false); setToast("📱 App installed! Check your home screen."); }
  }

  if (!auth.token || !auth.user) return <AuthScreen onLogin={handleLogin} />;
  if (!auth.user.coupleId) return <PairScreen user={auth.user} token={auth.token} onPaired={handlePaired} />;

  const navItems = [
    { id: "dashboard", label: "Home", icon: "🏠" },
    { id: "calendar", label: "Calendar", icon: "📅" },
    { id: "tasks", label: "Tasks", icon: "✅" },
    { id: "goals", label: "Goals", icon: "🎯" },
    { id: "messages", label: "Messages", icon: "💬" },
    { id: "motivation", label: "Motivation", icon: "💡" },
    { id: "budget", label: "Budget", icon: "💰" },
  ];

  return (
    <div className="app">
      <nav className="sidebar">
        <div className="sidebar-logo">💕 CoupleSync</div>
        <div className="streak-badge">🔥 {streak?.currentStreak || 0} day streak</div>
        {navItems.map(n => (
          <button key={n.id} className={`nav-item ${page === n.id ? "active" : ""}`} onClick={() => setPage(n.id)}>
            <span className="nav-icon">{n.icon}</span>
            <span className="nav-label">{n.label}</span>
          </button>
        ))}
        <div className="sidebar-footer">
          <button className="theme-toggle" onClick={() => setDarkMode(d => !d)}>
            {darkMode ? "☀️ Light Mode" : "🌙 Dark Mode"}
          </button>
          {notifStatus !== "granted" && (
            <button className="notif-btn" onClick={handleEnableNotifications}>
              🔔 Enable Notifications
              {notifStatus === "default" && <span className="notif-dot" />}
            </button>
          )}
          {notifStatus === "granted" && (
            <div className="notif-btn" style={{ cursor: "default", opacity: 0.7 }}>🔔 Notifications on</div>
          )}
          <div className="user-info">
            <span>{auth.user.name}</span>
            <span className="partner-info">& {auth.partner?.name}</span>
          </div>
          <button className="logout-btn" onClick={handleLogout}>Sign Out</button>
        </div>
      </nav>

      <main className="main-content">
        {page === "dashboard" && <Dashboard user={auth.user} partner={auth.partner} token={auth.token} streak={streak} />}
        {page === "calendar" && <CalendarPage token={auth.token} wsEvents={wsEvent} />}
        {page === "tasks" && <TasksPage token={auth.token} user={auth.user} partner={auth.partner} wsEvents={wsEvent} />}
        {page === "goals" && <GoalsPage token={auth.token} wsEvents={wsEvent} />}
        {page === "messages" && <MessagesPage token={auth.token} user={auth.user} partner={auth.partner} wsEvents={wsEvent} />}
        {page === "motivation" && <MotivationPage token={auth.token} partner={auth.partner} />}
        {page === "budget" && <BudgetPage token={auth.token} user={auth.user} partner={auth.partner} wsEvents={wsEvent} />}
      </main>

      {toast && <Toast message={toast} onDone={() => setToast(null)} />}

      {showInstallBanner && (
        <div className="install-banner">
          <p><strong>Install CoupleSync</strong> Add to your home screen for the full app experience</p>
          <div className="install-banner-actions">
            <button className="btn-secondary" onClick={() => setShowInstallBanner(false)}>Not now</button>
            <button className="btn-primary" onClick={handleInstall}>Install App 📱</button>
          </div>
        </div>
      )}
    </div>
  );
}
