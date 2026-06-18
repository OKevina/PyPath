require('dotenv/config');
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');
const { PrismaClient } = require('@prisma/client');
const { executePython } = require('./executePython');
const { syncProgress, isEnabled } = require('./githubSync');

const app = express();
const prisma = new PrismaClient();
const PORT = 3001;

app.use(cors());
app.use(express.json());

const DAY_MS = 24 * 60 * 60 * 1000;

// Last GitHub sync outcome, surfaced to the UI via GET /api/sync/status.
let lastSync = { status: 'idle', at: null, message: '' };

// --- Helpers ---------------------------------------------------------------

// Single-user app: always operate on profile id 1, creating it if missing.
async function getProfile() {
  return prisma.userProfile.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1 },
  });
}

// SM-2 spaced-repetition step. quality is 0..5 (>=3 means recalled correctly).
function sm2(prev, quality) {
  let { interval, easinessFactor, repetitions } = prev;

  if (quality >= 3) {
    if (repetitions === 0) interval = 1;
    else if (repetitions === 1) interval = 6;
    else interval = Math.round(interval * easinessFactor);
    repetitions += 1;
  } else {
    repetitions = 0;
    interval = 1;
  }

  easinessFactor =
    easinessFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  if (easinessFactor < 1.3) easinessFactor = 1.3;

  return {
    interval,
    easinessFactor,
    repetitions,
    nextReviewDate: new Date(Date.now() + interval * DAY_MS),
  };
}

// --- Gatekeeper: only return challenges up to the unlocked index -----------
app.get('/api/challenges', async (req, res) => {
  try {
    const profile = await getProfile();
    const total = await prisma.challenge.count();
    const challenges = await prisma.challenge.findMany({
      where: { orderIndex: { lte: profile.highestUnlockedIndex } },
      orderBy: { orderIndex: 'asc' },
    });
    return res.json({ profile, total, challenges });
  } catch (err) {
    console.error('Failed to fetch challenges:', err.message);
    return res.status(500).json({ error: 'Failed to fetch challenges.' });
  }
});

// --- Header stats ----------------------------------------------------------
app.get('/api/profile', async (req, res) => {
  try {
    const profile = await getProfile();
    const total = await prisma.challenge.count();
    const progressionPct = total > 0
      ? Math.round((Math.min(profile.highestUnlockedIndex, total) / total) * 100)
      : 0;
    return res.json({ ...profile, total, progressionPct });
  } catch (err) {
    console.error('Failed to fetch profile:', err.message);
    return res.status(500).json({ error: 'Failed to fetch profile.' });
  }
});

// --- Reset all progress (called by the guarded UI button) ------------------
app.post('/api/profile/reset', async (req, res) => {
  try {
    await prisma.reviewSchedule.deleteMany();
    await prisma.attempt.deleteMany();
    const profile = await prisma.userProfile.update({
      where: { id: 1 },
      data: { xp: 0, eloRating: 800, currentStreak: 0, highestUnlockedIndex: 1 },
    });
    return res.json(profile);
  } catch (err) {
    console.error('Failed to reset profile:', err.message);
    return res.status(500).json({ error: 'Failed to reset profile.' });
  }
});

// --- Due reviews -----------------------------------------------------------
app.get('/api/reviews', async (req, res) => {
  try {
    const due = await prisma.reviewSchedule.findMany({
      where: { nextReviewDate: { lte: new Date() } },
      orderBy: { nextReviewDate: 'asc' },
      include: {
        challenge: { select: { id: true, title: true, orderIndex: true, learningTip: true } },
      },
    });
    return res.json(due);
  } catch (err) {
    console.error('Failed to fetch reviews:', err.message);
    return res.status(500).json({ error: 'Failed to fetch reviews.' });
  }
});

// --- Per-challenge notes (single human-readable Markdown file) -------------
const NOTES_PATH = path.join(__dirname, 'notes.md');

function readNotesFile() {
  try { return fs.readFileSync(NOTES_PATH, 'utf-8'); } catch { return ''; }
}

// Parse the notes file into { challengeId: body } using HTML-comment markers.
function parseNotes(content) {
  const map = {};
  const re = /<!-- BEGIN (\d+) -->\n([\s\S]*?)\n<!-- END \1 -->/g;
  let m;
  while ((m = re.exec(content)) !== null) map[m[1]] = m[2];
  return map;
}

function serializeNotes(map, titles) {
  const ids = Object.keys(map).map(Number).sort((a, b) => a - b);
  const blocks = ids
    .filter((id) => (map[id] || '').trim())
    .map((id) =>
      `## ${titles[id] || `Challenge ${id}`}\n<!-- BEGIN ${id} -->\n${map[id].trim()}\n<!-- END ${id} -->`
    );
  return `# PyPath — Challenge Notes\n\n_Auto-saved from the app; one section per challenge._\n\n${blocks.join('\n\n')}\n`;
}

app.get('/api/notes/:id', (req, res) => {
  const map = parseNotes(readNotesFile());
  return res.json({ challengeId: Number(req.params.id), note: map[req.params.id] || '' });
});

app.put('/api/notes/:id', async (req, res) => {
  try {
    const id = String(req.params.id);
    const map = parseNotes(readNotesFile());
    map[id] = req.body.note || '';

    const ids = Object.keys(map).map(Number);
    const challenges = await prisma.challenge.findMany({
      where: { id: { in: ids } },
      select: { id: true, title: true, orderIndex: true },
    });
    const titles = {};
    for (const c of challenges) titles[c.id] = `#${c.orderIndex} ${c.title}`;

    fs.writeFileSync(NOTES_PATH, serializeNotes(map, titles));
    return res.json({ ok: true });
  } catch (err) {
    console.error('Failed to save note:', err.message);
    return res.status(500).json({ error: 'Failed to save note.' });
  }
});

// --- Run submitted code, score it, advance progression --------------------
app.post('/api/run', async (req, res) => {
  const { code, challengeId, hintsUsed = 0 } = req.body;

  if (typeof code !== 'string') {
    return res.status(400).json({ error: 'A "code" string is required.' });
  }
  if (challengeId == null) {
    return res.status(400).json({ error: 'A "challengeId" is required.' });
  }

  const challenge = await prisma.challenge.findUnique({
    where: { id: Number(challengeId) },
  });
  if (!challenge) {
    return res.status(404).json({ error: `Challenge ${challengeId} not found.` });
  }
  const testCases = JSON.parse(challenge.testCases);

  // --- Timing block --------------------------------------------------------
  let output;
  let success;
  let passed = 0;
  let totalTests = 0;
  const start = performance.now();
  try {
    const result = await executePython(code, testCases, challenge.mode);
    output = result.output;
    success = result.success;
    passed = result.passed;
    totalTests = result.total;
  } catch (err) {
    output = err.message;
    success = false;
  }
  const end = performance.now();
  const executionTimeMs = Math.round(end - start);
  const passRate = totalTests > 0 ? Math.round((passed / totalTests) * 100) : 0;

  // Was this challenge already solved? Counted BEFORE logging this attempt so
  // re-running already-passing code cannot farm XP/Elo.
  let alreadyCompleted = false;
  if (success) {
    const priorSuccesses = await prisma.attempt.count({
      where: { challengeId: Number(challengeId), success: true },
    });
    alreadyCompleted = priorSuccesses > 0;
  }

  // --- Attempt logging block (unchanged shape) ----------------------------
  try {
    await prisma.attempt.create({
      data: {
        codeSubmitted: code,
        executionTimeMs,
        success,
        challenge: { connect: { id: Number(challengeId) } },
      },
    });
  } catch (logErr) {
    console.error('Failed to log attempt:', logErr.message);
  }

  // --- Gamification + progression -----------------------------------------
  const profile = await getProfile();
  const hints = Math.max(0, Number(hintsUsed) || 0);

  let xpAwarded = 0;
  let eloDelta = 0;
  let streak = profile.currentStreak;
  let highestUnlockedIndex = profile.highestUnlockedIndex;
  let unlocked = false;
  let review = null;

  if (success) {
    // SM-2 runs on EVERY successful solve, including re-solves (review mode).
    // Quality drops with hint reliance.
    const quality = Math.max(0, 5 - hints);
    const existing = await prisma.reviewSchedule.findUnique({
      where: { challengeId: challenge.id },
    });
    const prev = existing
      ? {
          interval: existing.interval,
          easinessFactor: existing.easinessFactor,
          repetitions: existing.repetitions,
        }
      : { interval: 0, easinessFactor: 2.5, repetitions: 0 };
    const next = sm2(prev, quality);

    review = await prisma.reviewSchedule.upsert({
      where: { challengeId: challenge.id },
      update: {
        interval: next.interval,
        easinessFactor: next.easinessFactor,
        repetitions: next.repetitions,
        nextReviewDate: next.nextReviewDate,
      },
      create: {
        challengeId: challenge.id,
        interval: next.interval,
        easinessFactor: next.easinessFactor,
        repetitions: next.repetitions,
        nextReviewDate: next.nextReviewDate,
      },
    });

    // XP/Elo/streak/unlock only on the FIRST solve (prevents farming).
    if (!alreadyCompleted) {
      const speedReward = Math.max(20, 100 - Math.floor(executionTimeMs / 20));
      xpAwarded = Math.max(5, speedReward - hints * 15);
      eloDelta = 25;
      streak = profile.currentStreak + 1;

      // Unlock the next concept only when clearing the current frontier.
      if (challenge.orderIndex === profile.highestUnlockedIndex) {
        const total = await prisma.challenge.count();
        if (highestUnlockedIndex < total) {
          highestUnlockedIndex += 1;
          unlocked = true;
        }
      }
    }
  } else {
    // Failure resets the streak. Syntax errors erode Elo, more so on repeats.
    streak = 0;
    if (/SyntaxError|IndentationError/i.test(output)) {
      const priorFails = await prisma.attempt.count({
        where: { challengeId: challenge.id, success: false },
      });
      // priorFails includes the attempt we just logged; >1 means a repeat.
      eloDelta = priorFails > 1 ? -25 : -10;
    }
  }

  const updatedProfile = await prisma.userProfile.update({
    where: { id: 1 },
    data: {
      xp: { increment: xpAwarded },
      eloRating: { increment: eloDelta },
      currentStreak: streak,
      highestUnlockedIndex,
    },
  });

  // On ANY successful solve, push progress + the submitted solution to GitHub
  // (fire-and-forget; never blocks the run). Re-solves overwrite the solution file.
  const syncStarted = success && isEnabled();
  if (syncStarted) {
    lastSync = { status: 'pending', at: Date.now(), message: 'Syncing…' };
    (async () => {
      try {
        const solved = await prisma.attempt.findMany({
          where: { success: true },
          distinct: ['challengeId'],
          select: { challengeId: true },
        });
        const ids = solved.map((a) => a.challengeId).filter((x) => x != null);
        const completed = await prisma.challenge.findMany({
          where: { id: { in: ids } },
          select: { orderIndex: true, title: true, category: true, difficulty: true },
          orderBy: { orderIndex: 'asc' },
        });
        const total = await prisma.challenge.count();
        await syncProgress({
          profile: updatedProfile,
          completed,
          total,
          solution: { orderIndex: challenge.orderIndex, title: challenge.title, code },
        });
        lastSync = { status: 'ok', at: Date.now(), message: `Synced ${completed.length}/${total} + solution` };
      } catch (e) {
        console.error('GitHub sync failed:', e.message);
        lastSync = { status: 'failed', at: Date.now(), message: 'GitHub sync failed (offline?)' };
      }
    })();
  }

  return res.json({
    output,
    executionTimeMs,
    success,
    passed,
    total: totalTests,
    passRate,
    xpAwarded,
    eloDelta,
    unlocked,
    alreadyCompleted,
    syncStarted,
    profile: updatedProfile,
    review,
  });
});

// Last GitHub sync outcome (for UI toasts).
app.get('/api/sync/status', (req, res) => res.json(lastSync));

// --- Append a new challenge (adapted to the new schema) --------------------
app.post('/api/challenges', async (req, res) => {
  const { title, prompt, testCases, hints, learningTip, orderIndex } = req.body;

  if (!title || !prompt) {
    return res.status(400).json({ error: '"title" and "prompt" are required.' });
  }

  try {
    // Default orderIndex to the end of the curriculum if not supplied.
    let idx = orderIndex;
    if (idx == null) {
      const max = await prisma.challenge.aggregate({ _max: { orderIndex: true } });
      idx = (max._max.orderIndex || 0) + 1;
    }

    const challenge = await prisma.challenge.create({
      data: {
        title,
        prompt,
        orderIndex: Number(idx),
        testCases: typeof testCases === 'string' ? testCases : JSON.stringify(testCases ?? []),
        hints: typeof hints === 'string' ? hints : JSON.stringify(hints ?? []),
        learningTip: learningTip ?? '',
      },
    });
    return res.status(201).json(challenge);
  } catch (err) {
    console.error('Failed to create challenge:', err.message);
    return res.status(500).json({ error: 'Failed to create challenge.' });
  }
});

// --- Serve the built frontend (single-process / packaged mode) ------------
// In dev we use Vite on :5173; once `frontend/dist` exists, this server serves
// the whole app on :3001 so it can run from one process (and the launcher).
const DIST = path.join(__dirname, 'frontend', 'dist');
if (fs.existsSync(DIST)) {
  app.use(express.static(DIST));
  // SPA fallback for any non-API GET.
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api')) {
      return res.sendFile(path.join(DIST, 'index.html'));
    }
    next();
  });
}

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
