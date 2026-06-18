import { useState, useEffect, useCallback, useRef } from 'react';
import Editor from '@monaco-editor/react';

const API = 'http://localhost:3001';
const HINT_COST = 15; // mirrors the server's per-hint XP deduction
const LOCK_PREVIEW = 12;
const STARTER_CODE = `# Read input (if any), compute, and print the result\n`;

const THEMES = [
  { id: 'midnight', label: 'Midnight', monaco: 'vs-dark' },
  { id: 'light', label: 'Light', monaco: 'light' },
  { id: 'nord', label: 'Nord', monaco: 'vs-dark' },
  { id: 'solarized', label: 'Solarized', monaco: 'vs-dark' },
  { id: 'contrast', label: 'High Contrast', monaco: 'hc-black' },
];

export default function App() {
  const [profile, setProfile] = useState(null);
  const [total, setTotal] = useState(0);
  const [challenges, setChallenges] = useState([]);
  const [activeChallenge, setActiveChallenge] = useState(null);
  const [code, setCode] = useState(STARTER_CODE);
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [revealedHints, setRevealedHints] = useState([]);
  const [filter, setFilter] = useState('all');
  const [showReviews, setShowReviews] = useState(false);
  const [reviews, setReviews] = useState([]);

  // Theme
  const [theme, setTheme] = useState(() => localStorage.getItem('pypath-theme') || 'midnight');
  useEffect(() => {
    if (theme === 'midnight') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('pypath-theme', theme);
  }, [theme]);
  const monacoTheme = THEMES.find((t) => t.id === theme)?.monaco || 'vs-dark';

  // Notes
  const [note, setNote] = useState('');
  const [noteStatus, setNoteStatus] = useState('');
  const noteTimer = useRef(null);
  const noteLoadedFor = useRef(null);

  // Notifications
  const [toasts, setToasts] = useState([]);
  const [online, setOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const toastId = useRef(0);

  const pushToast = useCallback((type, message, ttl = 4500) => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, type, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), ttl);
  }, []);

  useEffect(() => {
    const up = () => { setOnline(true); pushToast('ok', 'Back online ✓'); };
    const down = () => { setOnline(false); pushToast('error', "You're offline — code still runs locally; editor & sync need internet."); };
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); };
  }, [pushToast]);

  const loadChallenges = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/challenges`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setProfile(data.profile);
      setTotal(data.total);
      setChallenges(data.challenges);
      setActiveChallenge((cur) => cur || data.challenges[0] || null);
    } catch (err) {
      setLoadError(err.message);
    }
  }, []);

  useEffect(() => { loadChallenges(); }, [loadChallenges]);

  useEffect(() => {
    setRevealedHints([]);
    setResult(null);
    setCode(activeChallenge?.starterCode ? activeChallenge.starterCode : STARTER_CODE);
  }, [activeChallenge?.id, activeChallenge?.starterCode]);

  // Load this challenge's note when it changes.
  useEffect(() => {
    if (!activeChallenge) return;
    noteLoadedFor.current = activeChallenge.id;
    setNoteStatus('');
    fetch(`${API}/api/notes/${activeChallenge.id}`)
      .then((r) => r.json())
      .then((d) => { if (noteLoadedFor.current === activeChallenge.id) setNote(d.note || ''); })
      .catch(() => {});
  }, [activeChallenge?.id]);

  const activeHints = activeChallenge ? safeParse(activeChallenge.hints, []) : [];

  function revealNextHint() {
    if (revealedHints.length < activeHints.length) {
      setRevealedHints(activeHints.slice(0, revealedHints.length + 1));
    }
  }

  function resetCode() {
    setCode(activeChallenge?.starterCode ? activeChallenge.starterCode : STARTER_CODE);
  }

  function onNoteChange(val) {
    setNote(val);
    setNoteStatus('saving');
    const id = activeChallenge?.id;
    if (noteTimer.current) clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(async () => {
      if (!id) return;
      try {
        await fetch(`${API}/api/notes/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ note: val }),
        });
        setNoteStatus('saved');
      } catch { setNoteStatus('error'); }
    }, 800);
  }

  async function runCode() {
    if (!activeChallenge) return;
    setRunning(true);
    setResult(null);
    try {
      const res = await fetch(`${API}/api/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, challengeId: activeChallenge.id, hintsUsed: revealedHints.length }),
      });
      const data = await res.json();
      setResult(data);
      if (data.profile) setProfile(data.profile);
      if (data.unlocked) loadChallenges();

      // Surface GitHub sync result (sync is async on the server; poll until resolved).
      if (data.syncStarted) {
        pushToast('info', 'Syncing progress to GitHub…');
        let tries = 0;
        const poll = async () => {
          tries += 1;
          try {
            const s = await fetch(`${API}/api/sync/status`).then((r) => r.json());
            if (s.status === 'ok') return pushToast('ok', `✓ ${s.message}`);
            if (s.status === 'failed') return pushToast('error', `⚠ ${s.message}`);
          } catch { /* ignore, will retry */ }
          if (tries < 8) setTimeout(poll, 1500);
        };
        setTimeout(poll, 1500);
      }
    } catch (err) {
      setResult({ output: `Request failed: ${err.message}`, success: false });
      pushToast('error', "Can't reach the server — is it running?");
    } finally {
      setRunning(false);
    }
  }

  async function toggleReviews() {
    const next = !showReviews;
    setShowReviews(next);
    if (next) {
      try {
        const res = await fetch(`${API}/api/reviews`);
        setReviews(await res.json());
      } catch { setReviews([]); }
    }
  }

  async function resetProgress() {
    const ok = window.confirm(
      'Reset ALL progress?\n\nThis wipes your XP, Elo, streak, review schedule, and unlocks back to the start. This cannot be undone.'
    );
    if (!ok) return;
    try {
      await fetch(`${API}/api/profile/reset`, { method: 'POST' });
      setActiveChallenge(null);
      setResult(null);
      setShowReviews(false);
      setFilter('all');
      loadChallenges();
    } catch { /* ignore */ }
  }

  const highestUnlocked = profile?.highestUnlockedIndex ?? 1;
  const progressionPct = total > 0 ? Math.round((Math.min(highestUnlocked, total) / total) * 100) : 0;

  const categories = ['all', ...Array.from(new Set(challenges.map((c) => c.category).filter(Boolean)))];
  const visibleChallenges = filter === 'all' ? challenges : challenges.filter((c) => c.category === filter);

  const lockedEnd = Math.min(total, highestUnlocked + LOCK_PREVIEW);
  const lockedIndices = [];
  if (filter === 'all') for (let i = highestUnlocked + 1; i <= lockedEnd; i++) lockedIndices.push(i);
  const moreLocked = filter === 'all' ? total - lockedEnd : 0;

  const nextChallenge = activeChallenge
    ? challenges.find((c) => c.orderIndex > activeChallenge.orderIndex)
    : null;

  const projectedPenalty = revealedHints.length * HINT_COST;

  return (
    <div className="app">
      {/* HUD */}
      <header className="hud">
        <div className="hud-brand"><span className="logo">⌁</span> PyPath</div>
        <div className="hud-stats">
          <Pill cls="pill-elo" icon="♟" value={profile?.eloRating ?? '—'} label="Elo" />
          <Pill cls="pill-xp" icon="✦" value={profile?.xp ?? '—'} label="XP" />
          <Pill cls="pill-streak" icon="🔥" value={profile?.currentStreak ?? 0} label="Streak" />
          <div className="hud-progress">
            <div className="progress-top"><span>Progress</span><span>{progressionPct}%</span></div>
            <div className="progress-track"><div className="progress-fill" style={{ width: `${progressionPct}%` }} /></div>
          </div>
          <select className="theme-select" value={theme} onChange={(e) => setTheme(e.target.value)} title="Color theme">
            {THEMES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
          <button className="reset-link" onClick={resetProgress} title="Reset all progress">↺ Reset</button>
        </div>
      </header>

      {!online && (
        <div className="offline-banner">
          ⚠ You're offline — running code still works, but the editor and GitHub sync need internet.
        </div>
      )}

      <div className="body">
        {/* Sidebar / skill tree */}
        <aside className="sidebar panel">
          <div className="sidebar-inner">
            <div className="sidebar-head">
              <h2 className="sidebar-title">Skill Tree</h2>
              <label className="reviews-toggle">
                <input type="checkbox" checked={showReviews} onChange={toggleReviews} /> Daily Reviews
              </label>
            </div>

            {loadError && <p className="load-error">Failed to load: {loadError}</p>}

            {showReviews ? (
              reviews.length === 0 ? (
                <p className="muted">No reviews due. 🎉</p>
              ) : (
                <ul className="tree">
                  {reviews.map((r) => (
                    <li key={r.id} className="tree-item completed">
                      <span className="tree-dot" />
                      <button
                        className="tree-link"
                        onClick={() => {
                          const c = challenges.find((x) => x.id === r.challengeId);
                          if (c) { setShowReviews(false); setActiveChallenge(c); }
                        }}
                      >
                        <span className="tree-idx">{r.challenge.orderIndex}</span>
                        <span className="tree-name">{r.challenge.title}</span>
                        <span className="diff-tag diff-medium">due</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )
            ) : (
              <>
                <div className="filter-row">
                  {categories.map((cat) => (
                    <button key={cat} className={`filter-chip${filter === cat ? ' active' : ''}`} onClick={() => setFilter(cat)}>
                      {cat}
                    </button>
                  ))}
                </div>

                <ul className="tree">
                  {visibleChallenges.map((c) => {
                    const completed = c.orderIndex < highestUnlocked;
                    const active = activeChallenge && activeChallenge.id === c.id;
                    return (
                      <li key={c.id} className={`tree-item${completed ? ' completed' : ''}${active ? ' active' : ''}`}>
                        <span className="tree-dot" />
                        <button className="tree-link" onClick={() => setActiveChallenge(c)}>
                          <span className="tree-idx">{c.orderIndex}</span>
                          <span className="tree-name">{c.title}</span>
                          <span className={`diff-tag diff-${c.difficulty}`}>{c.difficulty}</span>
                        </button>
                      </li>
                    );
                  })}
                  {lockedIndices.map((i) => (
                    <li key={`locked-${i}`} className="tree-item locked">
                      <span className="tree-dot" />
                      <button className="tree-link" disabled>
                        <span className="tree-idx">{i}</span>
                        <span className="tree-name">🔒 Locked</span>
                      </button>
                    </li>
                  ))}
                </ul>
                {moreLocked > 0 && <div className="more-locked">+ {moreLocked} more locked challenges</div>}
              </>
            )}
          </div>
        </aside>

        {/* Workspace */}
        <main className="workspace">
          {/* Briefing card */}
          <section className="briefing panel">
            {activeChallenge ? (
              <>
                <div className="briefing-head">
                  <h2 className="briefing-title">#{activeChallenge.orderIndex} {activeChallenge.title}</h2>
                  <span className={`badge diff-tag diff-${activeChallenge.difficulty}`}>{activeChallenge.difficulty}</span>
                  {activeChallenge.category && <span className="badge badge-cat">{activeChallenge.category}</span>}
                </div>
                <p className="briefing-prompt">{activeChallenge.prompt}</p>
                {activeChallenge.learningTip && <p className="briefing-tip">💡 {activeChallenge.learningTip}</p>}

                <div className="hints">
                  <div className="hints-bar">
                    <button className="hint-btn" onClick={revealNextHint} disabled={revealedHints.length >= activeHints.length}>
                      💡 Reveal Hint (−{HINT_COST} XP)
                    </button>
                    <span className="hint-meta">
                      {revealedHints.length}/{activeHints.length} used
                      {projectedPenalty > 0 && <strong className="penalty"> · −{projectedPenalty} XP at stake</strong>}
                    </span>
                  </div>
                  {revealedHints.length > 0 && (
                    <ol className="hint-list">
                      {revealedHints.map((h, i) => (
                        <li key={i} className="hint-item"><pre className="hint-pre">{h}</pre></li>
                      ))}
                    </ol>
                  )}
                </div>
              </>
            ) : (
              <p className="muted">Select a challenge to begin.</p>
            )}
          </section>

          {/* Editor */}
          <section className="editor-panel panel">
            <div className="panel-bar">
              <span className="dot dot-r" /><span className="dot dot-y" /><span className="dot dot-g" />
              <span className="panel-bar-title">solution.py</span>
              <span className="panel-bar-tag">{activeChallenge?.mode === 'assertion' ? 'function tests' : 'stdin tests'}</span>
            </div>
            <div className="editor-host">
              <Editor
                height="100%"
                language="python"
                theme={monacoTheme}
                value={code}
                onChange={(value) => setCode(value ?? '')}
                options={{ fontSize: 14, minimap: { enabled: false }, scrollBeyondLastLine: false }}
              />
            </div>
          </section>

          {/* Toolbar */}
          <div className="toolbar">
            <button className="btn btn-run" onClick={runCode} disabled={running || !activeChallenge}>
              {running ? 'Running…' : '▶ Run Code'}
            </button>
            <button className="btn btn-ghost" onClick={resetCode} disabled={!activeChallenge} title="Restore starter code">
              ↺ Reset Code
            </button>
            <button
              className="btn btn-next"
              onClick={() => nextChallenge && setActiveChallenge(nextChallenge)}
              disabled={!nextChallenge}
              title={nextChallenge ? `Go to #${nextChallenge.orderIndex}` : 'Solve to unlock the next challenge'}
            >
              Next →
            </button>
            {result && result.success && (
              <span className={`award ${result.alreadyCompleted ? 'dim' : 'ok'}`}>
                {result.alreadyCompleted
                  ? '✓ Already completed — replay logged as review (no XP)'
                  : `+${result.xpAwarded} XP${result.unlocked ? ' · 🔓 New challenge unlocked!' : ''}`}
              </span>
            )}
          </div>

          {/* Per-challenge test progress */}
          {result && result.total > 0 && (
            <div className="testbar">
              <div className="testbar-track">
                <div className={`testbar-fill ${result.success ? 'full' : 'partial'}`} style={{ width: `${result.passRate}%` }} />
              </div>
              <span className="testbar-label">{result.passed}/{result.total} tests · {result.passRate}%</span>
            </div>
          )}

          {/* Console */}
          <section className="console panel">
            <div className="console-bar">
              <span className="dot dot-r" /><span className="dot dot-y" /><span className="dot dot-g" />
              <span className="console-name">Output</span>
            </div>
            <div className="console-body">
              {result ? (
                <span className={result.success ? 'console-ok' : 'console-err'}>
                  {result.output}
                  {result.success && result.executionTimeMs != null && (
                    <span className="console-time">{`\n\n✓ Completed in ${result.executionTimeMs} ms`}</span>
                  )}
                </span>
              ) : (
                <span className="console-idle">{running ? 'Running…' : '// Output will appear here'}</span>
              )}
            </div>
          </section>

          {/* Notepad */}
          <section className="notepad panel">
            <div className="notepad-bar">
              <span className="dot dot-r" /><span className="dot dot-y" /><span className="dot dot-g" />
              <span className="notepad-title">📝 notes.md{activeChallenge ? ` — #${activeChallenge.orderIndex}` : ''}</span>
              <span className={`notepad-status ${noteStatus === 'saved' ? 'saved' : ''}`}>
                {noteStatus === 'saving' ? 'Saving…' : noteStatus === 'saved' ? '✓ Saved' : noteStatus === 'error' ? 'Save failed' : ''}
              </span>
            </div>
            <textarea
              value={note}
              onChange={(e) => onNoteChange(e.target.value)}
              placeholder="Jot notes for this challenge… (auto-saved to notes.md)"
              disabled={!activeChallenge}
            />
          </section>
        </main>
      </div>

      <div className="toast-wrap">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.type}`}>{t.message}</div>
        ))}
      </div>
    </div>
  );
}

function Pill({ cls, icon, value, label }) {
  return (
    <div className={`pill ${cls}`}>
      <span className="pill-icon">{icon}</span>
      <span className="pill-text">
        <span className="pill-val">{value}</span>
        <span className="pill-label">{label}</span>
      </span>
    </div>
  );
}

function safeParse(str, fallback) {
  try { return JSON.parse(str); } catch { return fallback; }
}
