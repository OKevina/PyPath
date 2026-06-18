# 📘 PyPath — Developer Manual & Study Guide

> A deep, module-by-module explanation of how PyPath is built and why. This is a **study document**: it explains not just *what* each file does, but the *concepts* behind it (the Python `-c` flag, the SM-2 algorithm, assertion vs. stdin testing, the gatekeeper pattern, etc.). Read it top-to-bottom once, then use it as a reference.

For a short marketing-style overview, see [`README.md`](README.md). This manual is the long-form companion.

---

## Table of Contents

1. [What PyPath Is](#1-what-pypath-is)
2. [The Big Picture (Architecture)](#2-the-big-picture-architecture)
3. [Tech Stack & Why](#3-tech-stack--why)
4. [File & Directory Structure](#4-file--directory-structure)
5. [The Data Model (`prisma/schema.prisma`)](#5-the-data-model-prismaschemaprisma)
6. [The Execution Engine (`executePython.js`)](#6-the-execution-engine-executepythonjs)
7. [The Curriculum Pipeline (`prisma/fetchCurriculum.js`)](#7-the-curriculum-pipeline-prismafetchcurriculumjs)
8. [The Seeder (`prisma/seed.js`)](#8-the-seeder-prismaseedjs)
9. [The Backend Server (`server.js`)](#9-the-backend-server-serverjs)
10. [GitHub Progress Sync (`githubSync.js`)](#10-github-progress-sync-githubsyncjs)
11. [The Frontend (`frontend/src/App.jsx`)](#11-the-frontend-frontendsrcappjsx)
12. [Styling & Theming (`frontend/src/index.css`)](#12-styling--theming-frontendsrcindexcss)
13. [The Desktop Launcher & Packaging (`launcher.js`)](#13-the-desktop-launcher--packaging-launcherjs)
14. [Configuration Files](#14-configuration-files)
15. [End-to-End Walkthroughs](#15-end-to-end-walkthroughs)
16. [Running, Building & Common Tasks](#16-running-building--common-tasks)
17. [Glossary](#17-glossary)
18. [How to Extend It](#18-how-to-extend-it)

---

## 1. What PyPath Is

PyPath is a **local, single-user, gamified Python learning platform**. You progress through a sequential curriculum of 434 challenges. For each one you:

1. Read a problem ("briefing").
2. Write Python in an in-browser editor.
3. Run it against real test cases on your machine's Python.
4. Earn XP / Elo / streak, optionally spending XP on hints.
5. Have solved challenges scheduled for spaced-repetition review.

It's "local" because the code you write is executed by the **Python interpreter installed on your own computer** — there is no cloud sandbox. It's "single-user" because there's exactly one profile (no accounts/login).

---

## 2. The Big Picture (Architecture)

PyPath is a classic **three-tier app** (UI → API → data) plus a **child-process execution engine**.

```
┌─────────────────────────────────────────────────────────────────────┐
│  BROWSER (React + Vite + Monaco editor)        frontend/src/App.jsx   │
│  - skill-tree sidebar, briefing card, editor, console, notepad        │
│  - talks to the API over HTTP (fetch)                                 │
└───────────────────────────────┬─────────────────────────────────────┘
                                 │  HTTP  (http://localhost:3001/api/*)
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  BACKEND (Node.js + Express)                          server.js       │
│  - REST API: challenges, run, profile, reviews, notes, sync status    │
│  - gamification math, unlock logic, SM-2 scheduling                   │
│      │                         │                          │           │
│      ▼                         ▼                          ▼           │
│  executePython.js        Prisma Client            githubSync.js       │
│  (spawns `python`)       (SQLite queries)         (spawns `gh`)       │
└──────────┬───────────────────────┬───────────────────────┬───────────┘
           ▼                        ▼                        ▼
   ┌──────────────┐         ┌───────────────┐       ┌────────────────┐
   │ python.exe   │         │ prisma/dev.db │       │ GitHub API     │
   │ (your PC)    │         │ (SQLite file) │       │ (progress repo)│
   └──────────────┘         └───────────────┘       └────────────────┘
```

### Two run modes

| Mode | How it starts | Frontend served by | Ports |
|------|---------------|--------------------|-------|
| **Development** | `npm run dev` | Vite dev server (HMR) | API `3001`, UI `5173` |
| **Packaged** | double-click `PyPath.exe` | Express serves `frontend/dist` | everything on `3001` |

In dev, the React app runs on Vite (`:5173`) and calls the API on `:3001` (CORS is enabled for this). In packaged mode, you first build the frontend (`vite build` → `frontend/dist`), and `server.js` serves those static files itself, so the whole app lives on one port and one process.

### Request lifecycle (the core loop)

```
User clicks "Run Code"
   → App.jsx runCode()  POST /api/run { code, challengeId, hintsUsed }
      → server.js looks up the Challenge in SQLite (Prisma)
      → executePython(code, testCases, mode)  ── spawns python -c … per test case
      → server times it, logs an Attempt, computes XP/Elo/streak/unlock
      → SM-2 schedules the next review
      → (async) githubSync pushes progress + solution to GitHub
      → responds { output, passed, total, passRate, xpAwarded, unlocked, profile, … }
   → App.jsx updates the HUD, console, test bar, and shows toasts
```

---

## 3. Tech Stack & Why

| Layer | Technology | Why it's used |
|-------|-----------|---------------|
| UI framework | **React 19** | Component model + hooks for the interactive dashboard |
| Build tool / dev server | **Vite 8** | Fast dev server with hot-module reload; bundles for production |
| Code editor | **@monaco-editor/react** | The same editor engine as VS Code — real Python syntax highlighting |
| Backend | **Express 5** | Minimal HTTP/REST framework on Node.js |
| ORM | **Prisma 6** | Type-safe DB access + schema migrations; generates a client from `schema.prisma` |
| Database | **SQLite** | Zero-config, file-based DB (`prisma/dev.db`) — perfect for a local single-user app |
| Code execution | **Node `child_process`** | Spawns the system `python` to run user code |
| GitHub sync | **GitHub CLI (`gh`)** | Authenticated GitHub API calls without writing OAuth code |
| Env config | **dotenv** | Loads `.env` into `process.env` |
| Packaging | **@yao-pkg/pkg** | Compiles `launcher.js` into a standalone `PyPath.exe` |
| Dev convenience | **concurrently** | Runs backend + frontend with one `npm run dev` |

---

## 4. File & Directory Structure

```
Claude app 1/
├── server.js               ← Express API: the brain. All endpoints + game logic.
├── executePython.js        ← Runs user Python via child_process (stdin & assertion modes).
├── githubSync.js           ← Pushes progress + solutions to a GitHub repo via `gh`.
├── launcher.js             ← Compiled to PyPath.exe; boots server + opens browser.
├── dataset.json            ← The generated curriculum (434 challenges). Seed input.
├── notes.md                ← Your per-challenge notes (git-ignored, local only).
├── package.json            ← Root scripts + backend dependencies.
├── prisma.config.ts        ← Prisma 6 config (schema path, seed command, datasource).
├── .env                    ← Secrets/config: DB URL, GitHub sync settings, GH_TOKEN.
├── PyPath.exe              ← The built launcher (git-ignored).
├── pypath.ico              ← App icon used by the desktop shortcut.
│
├── prisma/
│   ├── schema.prisma       ← Data model: Challenge, Attempt, UserProfile, ReviewSchedule.
│   ├── fetchCurriculum.js  ← Builds dataset.json (intro track + MBPP pool) then seeds.
│   ├── seed.js             ← Loads dataset.json into SQLite (idempotent).
│   └── dev.db              ← The SQLite database file (git-ignored).
│
└── frontend/
    ├── index.html          ← Vite HTML entry; mounts #root.
    ├── vite.config.js      ← Vite + React plugin config.
    ├── package.json        ← Frontend dependencies (React, Monaco) + scripts.
    └── src/
        ├── main.jsx        ← React entry: renders <App/> into #root.
        ├── App.jsx         ← The entire UI + all client logic.
        └── index.css       ← Design system: tokens, themes, every component style.
```

**What's git-ignored and why** (see [`.gitignore`](.gitignore)):
- `node_modules/`, `frontend/dist/` — build artifacts, regenerable.
- `.env`, `.env.*` — **secrets** (holds your `GH_TOKEN`). Never committed.
- `prisma/dev.db` — your local data/progress.
- `notes.md` — your personal notes.
- `*.exe`, `build/` — the compiled launcher.

---

## 5. The Data Model (`prisma/schema.prisma`)

Prisma defines the database as code. Four models (tables):

```prisma
model Challenge {
  id          Int              @id @default(autoincrement())
  title       String
  prompt      String
  testCases   String           // JSON string (see note below)
  orderIndex  Int              @unique   // 1..N — the sequence + unlock gate
  hints       String           // JSON string: array of 3 hints
  learningTip String
  mode        String           @default("stdin")    // "stdin" | "assertion"
  starterCode String           @default("")
  category    String           @default("general")  // e.g. strings, loops, recursion
  difficulty  String           @default("easy")     // easy | medium | hard
  attempts    Attempt[]
  reviews     ReviewSchedule[]
}

model Attempt {
  id              Int        @id @default(autoincrement())
  codeSubmitted   String
  executionTimeMs Int
  success         Boolean
  createdAt       DateTime   @default(now())
  challengeId     Int?
  challenge       Challenge? @relation(fields: [challengeId], references: [id])
}

model UserProfile {
  id                   Int @id @default(autoincrement())
  xp                   Int @default(0)
  eloRating            Int @default(800)
  currentStreak        Int @default(0)
  highestUnlockedIndex Int @default(1)   // challenges with orderIndex ≤ this are playable
}

model ReviewSchedule {
  id             Int       @id @default(autoincrement())
  challengeId    Int       @unique       // one review row per challenge
  challenge      Challenge @relation(fields: [challengeId], references: [id])
  nextReviewDate DateTime
  interval       Int       @default(0)   // SM-2: days until next review
  easinessFactor Float     @default(2.5) // SM-2: how "easy" the card is
  repetitions    Int       @default(0)   // SM-2: consecutive correct recalls
}
```

### Key design decisions

- **Why are `testCases` and `hints` `String`, not real arrays?** SQLite has no native array/JSON column in this setup, so structured data is stored as a **JSON string**. The seeder does `JSON.stringify(...)` on write and the server does `JSON.parse(...)` on read. This is a common pattern for small SQLite apps — simple and portable.

- **`orderIndex` is both the curriculum order *and* the unlock gate.** A challenge is playable only if `orderIndex ≤ UserProfile.highestUnlockedIndex`. It's `@unique` so the sequence has no gaps/dupes.

- **`UserProfile` is a single row (`id = 1`).** The whole app assumes one user. The server's `getProfile()` always upserts id 1.

- **"Completed" is *derived*, not stored.** There is no `completed` boolean. Whether you've solved a challenge is computed from `Attempt` rows (`success: true`). This keeps the source of truth in one place (the attempt log).

- **`ReviewSchedule` has `challengeId @unique`** so each challenge has at most one review card, which lets the server `upsert` it.

### Relationships

```
Challenge 1───∞ Attempt          (a challenge has many attempts)
Challenge 1───1 ReviewSchedule   (a challenge has one review card)
UserProfile                      (standalone single row)
```

---

## 6. The Execution Engine (`executePython.js`)

This module runs user-submitted Python **safely-ish** and reports a pass/fail count. It's the most conceptually important file.

### The core primitive: `runProgram`

```js
const { spawn } = require('child_process');

function runProgram(args, stdinData) {
  return new Promise((resolve) => {
    const proc = spawn('python', args);     // launch the Python interpreter

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    proc.on('error', (err) =>
      resolve({ spawnError: `Failed to start Python: ${err.message}`, code: -1, stdout, stderr }));
    proc.on('close', (code) => resolve({ code, stdout, stderr }));

    if (stdinData != null) proc.stdin.write(String(stdinData));
    proc.stdin.end();                       // close stdin so the program can read to EOF
  });
}
```

**Concept — `spawn` and the `-c` flag.** `spawn('python', ['-c', code])` launches Python and tells it "run this code string directly" (`-c` = command). This means **we never write a temp `.py` file** — the program is passed as an argument. That frees up **stdin** to carry the *test input*. This separation (program via `-c`, input via stdin) is the key trick that lets one run both *carry the code* and *feed it input*.

**Concept — collecting output.** A child process streams data over time, so we accumulate `stdout`/`stderr` chunks and resolve once the process emits `close`.

### Mode 1 — `stdin` (the intro track)

Used for challenges where the program reads input and prints output.

```js
async function runStdinMode(code, testCases) {
  const total = testCases.length;
  let passed = 0, firstError = null;

  for (const tc of testCases) {
    const { stdout, stderr, spawnError } = await runProgram(['-c', code], String(tc.input));
    if (spawnError) return { success: false, passed: 0, total, output: spawnError };
    if (stderr) { if (!firstError) firstError = stderr.trim(); continue; }   // crashed
    if (stdout.trim() === String(tc.expectedOutput).trim()) passed += 1;     // matched
    else if (!firstError) firstError =
      `Test failed. Input: ${tc.input}. Expected: ${tc.expectedOutput}. Got: ${stdout.trim()}`;
  }
  return summarize(passed, total, firstError);
}
```

- Each test case is `{ input, expectedOutput }`.
- The program is run once **per test case**, with that case's `input` piped to stdin.
- Output comparison is **trimmed** on both sides (so a trailing newline doesn't fail you).
- **It runs every case** (does not stop at the first failure) so it can report a pass rate like `2/3`.

### Mode 2 — `assertion` (the MBPP practice pool)

Used for function-style problems where tests call your function with `assert`.

```js
async function runAssertionMode(code, spec) {
  const setup   = spec?.setup || '';
  const asserts = Array.isArray(spec?.asserts) ? spec.asserts : [];
  const total = asserts.length;
  let passed = 0, firstError = null;

  for (const assertion of asserts) {
    const program = [code, setup, assertion].filter(Boolean).join('\n');  // append the assert
    const { code: exitCode, stderr, spawnError } = await runProgram(['-c', program], '');
    if (spawnError) return { success: false, passed: 0, total, output: spawnError };
    if (exitCode === 0 && !stderr) passed += 1;                            // no AssertionError
    else if (!firstError) {
      const lastLine = (stderr.trim().split('\n').pop() || 'failed').trim();
      firstError = `Test failed: ${assertion}\n${lastLine}`;
    }
  }
  return summarize(passed, total, firstError);
}
```

- Here `testCases` is an **object** `{ setup, asserts }`, not an array.
- For each assertion, we build a program = *your code* + *setup (imports)* + *the assert line*, then run it.
- A test **passes** when Python exits 0 (no `AssertionError`/exception). If an assert fails, Python raises and exits non-zero.
- Example assembled program for one assert:
  ```python
  def similar_elements(a, b):      # ← your code
      return tuple(set(a) & set(b))
                                    # ← setup (imports), if any
  assert set(similar_elements((3,4,5,6),(5,7,4,10))) == set((4,5))   # ← the assert
  ```

### The public function & result shape

```js
async function executePython(code, tests, mode = 'stdin') {
  if (mode === 'assertion') return runAssertionMode(code, tests);
  return runStdinMode(code, tests);
}
```

Every path returns the same shape via `summarize`:

```js
{ success: boolean,   // true only if passed === total (and total > 0)
  passed: number,
  total: number,
  output: string }    // "All N tests passed." or "X/N passed.\n\n<first error>"
```

### ⚠️ Security note (important for study)

This engine runs **arbitrary user code on your machine** with no sandbox, no timeout, and no resource limits. That is acceptable here because **you are the only user running your own code locally**. If PyPath were ever exposed to untrusted input over a network, this would be a critical vulnerability — you'd need process isolation (containers/VMs), a hard timeout, and CPU/memory caps.

---

## 7. The Curriculum Pipeline (`prisma/fetchCurriculum.js`)

This script **builds the curriculum** and writes it to `dataset.json`, then triggers the seeder. Run it with `npm run curriculum`. It has four jobs.

### Job 1 — Source the "intro track"

It first *tries* to fetch a remote curriculum, and **falls back** to a curated, embedded 7-lesson track if that fails (offline, 404, wrong shape). This makes the pipeline robust:

```js
async function tryFetchRemote() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);   // 5s timeout
    const res = await fetch(REMOTE_URL, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    /* …normalize fields… */
  } catch (err) {
    return null;   // signal "use the embedded fallback"
  }
}
```

The embedded track is 7 hand-written, scaffolded `stdin`-mode lessons: print → add → variables → if/else → loops → lists → functions. Each has a prompt, test cases, 3 hints, and a learning tip.

### Job 2 — Order by a complexity heuristic

If the intro data isn't already in increasing difficulty, it's sorted using a **keyword-complexity score**. Each tier owns keywords; a challenge's score is the **highest** tier it matches.

```js
const COMPLEXITY_TIERS = [
  { rank: 0, keywords: ['print', 'hello', 'output', 'display'] },
  { rank: 1, keywords: ['add', 'sum', 'multiply', 'subtract', 'divide', 'arithmetic', 'math'] },
  { rank: 2, keywords: ['variable', 'assign', 'store', 'name', 'greet'] },
  { rank: 3, keywords: ['if', 'else', 'condition', 'even', 'odd', 'compare', 'greater', 'less'] },
  { rank: 4, keywords: ['loop', 'for', 'while', 'repeat', 'iterate', 'each integer'] },
  { rank: 5, keywords: ['list', 'array', 'elements', 'collection', 'split'] },
  { rank: 6, keywords: ['function', 'def', 'return', 'parameter', 'recipe'] },
];

function complexityScore(challenge) {
  const haystack = `${challenge.title} ${challenge.prompt} ${challenge.concept || ''}`.toLowerCase();
  let score = 0;
  for (const tier of COMPLEXITY_TIERS)
    if (tier.keywords.some((kw) => new RegExp(`\\b${escapeRegExp(kw)}\\b`).test(haystack)))
      score = Math.max(score, tier.rank);
  return score;
}
```

> **Study note — why word boundaries (`\b`) matter.** An earlier version used substring matching, so the keyword `greet` (tier 2) matched the word "**greet**ing" in the *print* challenge, wrongly bumping its score and putting "Add Two Numbers" before "Print a Greeting". Switching to `\bgreet\b` fixed it — `\bgreet\b` does **not** match "greeting". Likewise `\badd\b` won't match "addition". This is a classic NLP-lite footgun.

### Job 3 — Build the MBPP practice pool (assertion mode)

It fetches the open **MBPP** dataset (Mostly Basic Python Problems, ~974 entries; ~427 usable) and converts each into an assertion-mode challenge:

```js
function mapMbpp(rec) {
  const prompt  = rec.prompt || rec.text || '';
  const asserts = rec.test_list || [];
  const setup   = /* test_imports joined */;
  const sig     = signatureFromCode(rec.code);   // parse `def name(params)` from the reference
  if (!asserts.length || !sig) return null;       // skip if we can't make it solvable

  const category   = categoryOf(`${prompt} ${asserts.join(' ')}`);
  const difficulty = difficultyOf(rec.code, asserts);

  return {
    title: titleFromPrompt(prompt),
    prompt: `${prompt}\n\nYour solution must define a function named \`${sig.name}(${sig.params})\`…`,
    mode: 'assertion',
    category, difficulty,
    testCases: { setup, asserts },              // ← object, not array
    starterCode: `${sig.line}\n    # your code here\n`,
    hints: [ /* concept / logic / signature */ ],
    learningTip: 'Practice problem from the open MBPP dataset…',
  };
}
```

Notable sub-steps:
- **`signatureFromCode`** regex-extracts the expected function name + params from MBPP's reference solution, so we can give you a `starterCode` stub and tell you exactly what to define. The reference solution itself is **discarded** (you must write your own).
- **`categoryOf`** tags each problem (strings, lists, recursion, math…) by first-matching keyword rule.
- **`difficultyOf`** grades easy/medium/hard from the reference solution's structure (loops, deep nesting, recursion (self-call), line count, number of asserts).
- The pool is **sorted easy→hard** before being capped (optional `PRACTICE_LIMIT` env var) so the curriculum eases you in.

### Job 4 — Combine, number, write, seed

```js
const combined = [...intro, ...pool];
const ordered = combined.map((c, i) => ({
  title: c.title, prompt: c.prompt, testCases: c.testCases,
  hints: ensureHints(c),                 // guarantees exactly 3 hints
  learningTip: c.learningTip || 'Keep practicing — each concept builds on the last.',
  mode: c.mode || 'stdin',
  starterCode: c.starterCode || '',
  category: c.category || categoryOf(/* … */),
  difficulty: c.difficulty || 'easy',
  orderIndex: i + 1,                      // ← the single, gapless 1..N sequence
}));
fs.writeFileSync(outPath, JSON.stringify(ordered, null, 2));

// Then run the seed as a child process:
spawnSync(process.execPath, [path.join(__dirname, 'seed.js')], { stdio: 'inherit' });
```

The result: intro lessons get `orderIndex` 1–7, MBPP problems get 8…N, all in one continuous sequence.

---

## 8. The Seeder (`prisma/seed.js`)

Loads `dataset.json` into SQLite. It is **idempotent** — safe to run repeatedly — because it clears the tables first (respecting foreign keys):

```js
const challenges = JSON.parse(fs.readFileSync(datasetPath, 'utf-8'));

// Delete dependents before parents (FK safety):
await prisma.reviewSchedule.deleteMany();
await prisma.attempt.deleteMany();
await prisma.challenge.deleteMany();

for (const c of challenges) {
  await prisma.challenge.create({
    data: {
      title: c.title, prompt: c.prompt,
      testCases: JSON.stringify(c.testCases),   // object/array → string
      orderIndex: c.orderIndex,
      hints: JSON.stringify(c.hints),           // array → string
      learningTip: c.learningTip,
      mode: c.mode || 'stdin',
      starterCode: c.starterCode || '',
      category: c.category || 'general',
      difficulty: c.difficulty || 'easy',
    },
  });
}

// Ensure the single profile exists with starting values:
await prisma.userProfile.upsert({
  where: { id: 1 }, update: {},
  create: { id: 1, xp: 0, eloRating: 800, currentStreak: 0, highestUnlockedIndex: 1 },
});
```

> **Note** the `JSON.stringify` here mirrors the `JSON.parse` in `server.js`. That's the serialize/deserialize boundary for the string-as-JSON columns.

---

## 9. The Backend Server (`server.js`)

The Express server is the brain. It loads `.env` first (so `GH_TOKEN`, etc. are available), creates one Prisma client, and listens on **port 3001**.

```js
require('dotenv/config');                 // MUST be first so process.env is populated
const app = express();
const prisma = new PrismaClient();
app.use(cors());                          // allow the Vite dev origin (:5173)
app.use(express.json());                  // parse JSON request bodies
```

### Helper: `getProfile()`

Single-user pattern — always operate on profile id 1, creating it if absent:

```js
async function getProfile() {
  return prisma.userProfile.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
}
```

### Helper: `sm2(prev, quality)` — the spaced-repetition core

Implements the **SM-2 algorithm** (the one Anki/SuperMemo use). Given the previous card state and a recall `quality` (0–5), it computes the next interval.

```js
function sm2(prev, quality) {
  let { interval, easinessFactor, repetitions } = prev;

  if (quality >= 3) {                              // recalled correctly
    if (repetitions === 0) interval = 1;           // first success → review tomorrow
    else if (repetitions === 1) interval = 6;      // second → in 6 days
    else interval = Math.round(interval * easinessFactor);  // then grow geometrically
    repetitions += 1;
  } else {                                         // failed recall → start over
    repetitions = 0;
    interval = 1;
  }

  // Adjust how "easy" the card is (harder recalls shrink EF; floor at 1.3):
  easinessFactor += 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02);
  if (easinessFactor < 1.3) easinessFactor = 1.3;

  return { interval, easinessFactor, repetitions,
           nextReviewDate: new Date(Date.now() + interval * DAY_MS) };
}
```

**How `quality` is derived in PyPath:** `quality = max(0, 5 - hintsUsed)`. So solving with 0 hints = quality 5 (interval grows fast); 2 hints = quality 3 (still "pass"); 3 hints = quality 2 (treated as a lapse → interval resets to 1 day). Hints don't just cost XP — they make a card come back sooner.

### Endpoint catalogue

| Method & path | Purpose |
|---------------|---------|
| `GET /api/challenges` | The **gatekeeper** — returns only unlocked challenges + profile + total |
| `GET /api/profile` | Profile stats + total + progression % (for the HUD) |
| `POST /api/profile/reset` | Wipe progress back to start (guarded by a confirm in the UI) |
| `GET /api/reviews` | Challenges whose review is due now |
| `GET /api/notes/:id` | Read the note for one challenge |
| `PUT /api/notes/:id` | Save the note for one challenge (writes `notes.md`) |
| `POST /api/run` | **The big one** — execute, score, log, gamify, schedule, sync |
| `GET /api/sync/status` | Last GitHub-sync outcome (for toasts) |
| `POST /api/challenges` | Append a new challenge (admin/extension) |

### The gatekeeper — `GET /api/challenges`

```js
app.get('/api/challenges', async (req, res) => {
  const profile = await getProfile();
  const total = await prisma.challenge.count();
  const challenges = await prisma.challenge.findMany({
    where: { orderIndex: { lte: profile.highestUnlockedIndex } },   // only unlocked
    orderBy: { orderIndex: 'asc' },
  });
  res.json({ profile, total, challenges });
});
```

> **Study note — the gatekeeper pattern.** Locked challenges are **never sent to the client** (their prompts/tests don't leak). But the UI still needs to *show* locked rows. The trick: the response includes `total`, so the frontend renders unlocked challenges from the array and draws greyed-out "🔒 Locked" stubs for indices `highestUnlocked+1 … total`. Security (no leak) and UX (visible progression) are both satisfied.

### The main endpoint — `POST /api/run`

This is the heart of the app. It runs in a strict order:

**1) Validate & load the challenge**
```js
const { code, challengeId, hintsUsed = 0 } = req.body;
const challenge = await prisma.challenge.findUnique({ where: { id: Number(challengeId) } });
const testCases = JSON.parse(challenge.testCases);   // string → object/array
```

**2) Execute & time it**
```js
const start = performance.now();
const result = await executePython(code, testCases, challenge.mode);
const executionTimeMs = Math.round(performance.now() - start);
const passRate = result.total ? Math.round((result.passed / result.total) * 100) : 0;
```

**3) Anti-farming check (BEFORE logging this attempt)**
```js
let alreadyCompleted = false;
if (result.success) {
  const priorSuccesses = await prisma.attempt.count({
    where: { challengeId: Number(challengeId), success: true } });
  alreadyCompleted = priorSuccesses > 0;   // had you solved it before this run?
}
```
This is checked *before* inserting the current attempt, so re-running already-passing code can't grant rewards.

**4) Log the attempt** (always — success or fail) with `codeSubmitted`, `executionTimeMs`, `success`.

**5) Gamification + progression**
```js
if (result.success) {
  // SM-2 on EVERY success (including re-solves = "review mode"):
  const quality = Math.max(0, 5 - hints);
  const next = sm2(prevReviewStateOrDefaults, quality);
  review = await prisma.reviewSchedule.upsert(/* by challengeId */);

  if (!alreadyCompleted) {                  // FIRST solve only:
    const speedReward = Math.max(20, 100 - Math.floor(executionTimeMs / 20));
    xpAwarded = Math.max(5, speedReward - hints * 15);   // faster = more; hints cost 15 each
    eloDelta = 25;
    streak = profile.currentStreak + 1;
    if (challenge.orderIndex === profile.highestUnlockedIndex) {   // clearing the frontier
      highestUnlockedIndex += 1;            // unlock the next concept
      unlocked = true;
    }
  }
} else {                                    // failure:
  streak = 0;                               // streak resets
  if (/SyntaxError|IndentationError/i.test(output)) {
    const priorFails = await prisma.attempt.count({ where: { challengeId, success: false } });
    eloDelta = priorFails > 1 ? -25 : -10;  // repeated syntax errors hurt more
  }
}
await prisma.userProfile.update({ where: { id: 1 }, data: {
  xp: { increment: xpAwarded }, eloRating: { increment: eloDelta },
  currentStreak: streak, highestUnlockedIndex } });
```

**The gamification rules, summarized:**

| Event | XP | Elo | Streak | Unlock | SM-2 |
|-------|----|----|--------|--------|------|
| First solve | `max(5, max(20,100−ms/20) − 15·hints)` | +25 | +1 | if at frontier | reschedule |
| Re-solve (already done) | 0 | 0 | unchanged | no | **reschedule** |
| Fail (syntax error) | 0 | −10, or −25 if repeated | 0 | no | none |
| Fail (wrong answer) | 0 | 0 | 0 | no | none |

**6) GitHub sync (fire-and-forget)** — see §10. It's launched async so it never blocks the response; the outcome is stored in `lastSync` for `GET /api/sync/status`.

**7) Respond** with everything the UI needs:
```js
res.json({ output, executionTimeMs, success, passed, total, passRate,
           xpAwarded, eloDelta, unlocked, alreadyCompleted, syncStarted,
           profile: updatedProfile, review });
```

### Notes storage — one human-readable Markdown file

Notes are kept in a single `notes.md`, with each challenge delimited by HTML comments so the file stays readable *and* machine-parseable:

```js
// Parse: pull each block out by its markers
const re = /<!-- BEGIN (\d+) -->\n([\s\S]*?)\n<!-- END \1 -->/g;
// Serialize: write a "## Title" heading + the marked block per challenge
`## ${title}\n<!-- BEGIN ${id} -->\n${body}\n<!-- END ${id} -->`
```

`GET /api/notes/:id` returns one note; `PUT /api/notes/:id` updates that block and rewrites the file (looking up titles from the DB for nice headings). The file is git-ignored.

### Serving the built frontend (packaged mode)

```js
const DIST = path.join(__dirname, 'frontend', 'dist');
if (fs.existsSync(DIST)) {
  app.use(express.static(DIST));
  app.use((req, res, next) => {        // SPA fallback: non-API GETs → index.html
    if (req.method === 'GET' && !req.path.startsWith('/api'))
      return res.sendFile(path.join(DIST, 'index.html'));
    next();
  });
}
```
This block only activates when `frontend/dist` exists (i.e., after `vite build`). In dev it's skipped because Vite serves the UI.

---

## 10. GitHub Progress Sync (`githubSync.js`)

After each successful solve, PyPath can push your progress (and your solution) to a dedicated GitHub repo. It shells out to the **GitHub CLI (`gh`)** rather than implementing OAuth.

### Enabling it
In `.env`:
```
GITHUB_SYNC=on
GITHUB_PROGRESS_REPO=OWNER/REPO      # e.g. OKevina/pypath-progress
GH_TOKEN=github_pat_...              # a token (see "auth" below)
```
```js
const REPO = process.env.GITHUB_PROGRESS_REPO || '';
const ENABLED = process.env.GITHUB_SYNC === 'on' && !!REPO;
```

### Finding `gh` reliably (a real bug we fixed)

`gh` is invoked by **absolute path**, not by trusting `PATH`:

```js
function resolveGh() {
  const candidates = [
    process.env.GH_PATH,
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'GitHub CLI', 'gh.exe'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'GitHub CLI', 'gh.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'GitHub CLI', 'gh.exe'),
  ].filter(Boolean);
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return 'gh';   // last resort: rely on PATH
}
```

> **Study note — why.** `gh` was installed *during development*, which updates the **machine** PATH. But a process launched from Explorer (or the `.exe`) in a session that started *before* the install still has the old PATH, so `spawn('gh')` failed with `ENOENT`. Resolving the absolute path sidesteps the whole "stale session PATH" problem — sync works without a reboot.

### Auth — why `GH_TOKEN` and not the keyring

`gh auth login` stores its token in the OS **keyring**, which isn't reliably readable from an `.exe`-launched process. The fix is to put a token in `.env` as `GH_TOKEN`; dotenv loads it into `process.env`, and the child `gh` inherits it. We use a **fine-grained Personal Access Token** scoped to *only* the progress repo (Contents: Read/Write) so a leaked `.env` can't touch anything else.

### What gets pushed (and what doesn't)

`syncProgress` writes up to three files via the GitHub Contents API:

```js
async function syncProgress({ profile, completed, total, solution }) {
  if (!ENABLED) return { skipped: true };

  if (solution?.code != null)                       // 1) the solution you just wrote
    await putFile(solutionPath(solution.orderIndex, solution.title), solution.code, msg);

  await putFile('progress.json', JSON.stringify({   // 2) machine-readable progress
    updatedAt, xp, eloRating, currentStreak, completedCount, total, completed }, null, 2), msg);

  await putFile('README.md', buildMarkdown(profile, completed, total), msg);  // 3) pretty progress
  return { ok: true };
}
```

- **`putFile`** base64-encodes the content and does a `PUT /repos/:repo/contents/:path`. To update an existing file the API needs its current blob **SHA**, so `getSha` fetches it first (returns `null` for new files).
- **`progress.json`** holds stats + a list of solved challenges (orderIndex, title, category, difficulty) — **no code**.
- **`README.md`** is a rendered progress bar + metrics table + completed-challenges table.
- **Solutions** are archived under `solutions/NNN-slug.py` (one per solved challenge).

> The `completed` list and stats are the only things in `progress.json`/`README.md`; your *code* only appears in the `solutions/` files. Prompts, test cases, hints, and your `notes.md` are never pushed.

---

## 11. The Frontend (`frontend/src/App.jsx`)

A single React component holds the whole UI. `main.jsx` just mounts it:

```jsx
createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>);
```

### State (the `useState`/`useRef` inventory)

```js
// Core data
const [profile, setProfile]           = useState(null);   // {xp, eloRating, currentStreak, highestUnlockedIndex}
const [total, setTotal]               = useState(0);      // total challenge count (for locked stubs)
const [challenges, setChallenges]     = useState([]);     // unlocked challenges (from gatekeeper)
const [activeChallenge, setActive…]   = useState(null);   // the one you're viewing
const [code, setCode]                 = useState(STARTER_CODE);
const [result, setResult]             = useState(null);   // last run result
const [running, setRunning]           = useState(false);

// Sidebar / hints
const [revealedHints, setRevealed…]   = useState([]);     // hints shown this attempt
const [filter, setFilter]             = useState('all');  // category filter
const [showReviews, setShowReviews]   = useState(false);  // Daily Reviews toggle
const [reviews, setReviews]           = useState([]);

// Theme  (persisted to localStorage)
const [theme, setTheme]               = useState(() => localStorage.getItem('pypath-theme') || 'midnight');

// Notes  (debounced autosave)
const [note, setNote]                 = useState('');
const noteTimer    = useRef(null);     // debounce timer
const noteLoadedFor= useRef(null);     // guards against stale async note loads

// Notifications
const [toasts, setToasts]             = useState([]);
const [online, setOnline]             = useState(navigator.onLine);
```

### Effects (lifecycle)

1. **On mount** → `loadChallenges()` (fetch the gatekeeper response).
2. **On `theme` change** → set `data-theme` attribute on `<html>` + persist to `localStorage`. The CSS does the rest (see §12).
3. **On mount** → register `online`/`offline` window listeners → flip the banner + toast.
4. **On `activeChallenge` change** → reset hints/result and load that challenge's `starterCode`.
5. **On `activeChallenge` change** → fetch its note (guarded by `noteLoadedFor` so a slow response for an old challenge can't overwrite the new one).

### Key handlers

**`runCode()` — submit & react**
```js
const res  = await fetch(`${API}/api/run`, { method:'POST', headers:{'Content-Type':'application/json'},
  body: JSON.stringify({ code, challengeId: activeChallenge.id, hintsUsed: revealedHints.length }) });
const data = await res.json();
setResult(data);
if (data.profile)  setProfile(data.profile);   // refresh HUD
if (data.unlocked) loadChallenges();           // a new challenge appeared → refetch
if (data.syncStarted) { /* toast "Syncing…", then poll GET /api/sync/status until ok/failed */ }
```
The catch block shows a `"Can't reach the server"` toast — distinguishing a network failure from a code failure.

**`onNoteChange(val)` — debounced autosave**
```js
setNote(val); setNoteStatus('saving');
clearTimeout(noteTimer.current);
noteTimer.current = setTimeout(async () => {           // wait 800ms after typing stops
  await fetch(`${API}/api/notes/${id}`, { method:'PUT', /* body: { note: val } */ });
  setNoteStatus('saved');
}, 800);
```

**`revealNextHint()`** — reveals hints one at a time; the count is sent as `hintsUsed`, which the backend turns into an XP penalty *and* a lower SM-2 quality.

**`resetProgress()`** — `window.confirm(...)` then `POST /api/profile/reset`, then reload. The confirm is the "speed bump" for an irreversible action.

### Derived values (computed each render)

```js
const highestUnlocked  = profile?.highestUnlockedIndex ?? 1;
const progressionPct   = Math.round(min(highestUnlocked, total) / total * 100);
const categories       = ['all', ...new Set(challenges.map(c => c.category))];
const visibleChallenges= filter === 'all' ? challenges : challenges.filter(c => c.category === filter);
const lockedIndices    = /* highestUnlocked+1 … highestUnlocked+LOCK_PREVIEW */;
const nextChallenge    = challenges.find(c => c.orderIndex > activeChallenge.orderIndex);
const projectedPenalty = revealedHints.length * HINT_COST;
```

> **Study note — deriving "completed" on the client.** The sidebar marks a row **completed** with `c.orderIndex < highestUnlocked`. Because you can only advance the frontier by solving it, everything below the frontier is necessarily solved — so this is a correct proxy without any extra API call.

### The render tree (what's on screen)

```
<div.app>
 ├─ <header.hud>          brand · Elo/XP/Streak pills · progress bar · theme <select> · Reset
 ├─ {offline && <div.offline-banner>}
 ├─ <div.body>
 │   ├─ <aside.sidebar>   "Skill Tree" · Daily Reviews toggle · category chips · <ul.tree>
 │   │                     (each item: dot + index + title + difficulty tag; locked items disabled)
 │   └─ <main.workspace>
 │       ├─ <section.briefing>   title + difficulty/category badges + prompt + tip + HINTS
 │       ├─ <section.editor-panel>  Monaco editor (theme follows app theme)
 │       ├─ <div.toolbar>       Run · Reset Code · Next · award text
 │       ├─ {result && <div.testbar>}   passed/total progress bar
 │       ├─ <section.console>   stark-black output (green ok / red error)
 │       └─ <section.notepad>   autosaving <textarea> → notes.md
 └─ <div.toast-wrap>      transient notifications
```

Two tiny helper components live at the bottom: `Pill` (a HUD stat badge) and `safeParse` (JSON.parse with a fallback, used to parse `hints`).

---

## 12. Styling & Theming (`frontend/src/index.css`)

All styling is plain CSS driven by **CSS custom properties (variables)**. This is what makes multi-theming trivial.

### Design tokens
```css
:root {
  --bg-0:#0a0c11; --bg-1:#11141b; --bg-2:#161a23; --bg-3:#1d222d;   /* surfaces, dark→light */
  --border:#242a36; --text:#c5cbd6; --text-bright:#f3f5f9;
  --accent:#7c5cff; --elo:#b58bff; --xp:#43e08a; --streak:#ffb24d; --danger:#ff5f56;
  --radius:12px; --shadow:0 10px 30px rgba(0,0,0,.4);
}
```
Every component references these variables (`background: var(--bg-1)`), never hard-coded colors.

### How theme switching works
Each theme is a block that **overrides the variables** when `data-theme` is set on `<html>`:
```css
[data-theme="light"]     { --bg-0:#f4f6f9; --bg-1:#fff; --text:#3a4150; --accent:#6d4aff; … }
[data-theme="nord"]      { --bg-0:#2e3440; --accent:#88c0d0; … }
[data-theme="solarized"] { --bg-0:#002b36; --accent:#268bd2; … }
[data-theme="contrast"]  { --bg-0:#000; --border:#fff; --accent:#ff0; … }
```
The React effect sets `document.documentElement.setAttribute('data-theme', theme)` and **every variable-based color updates instantly** — no per-component logic. The Monaco editor theme is mapped separately (`vs-dark` / `light` / `hc-black`) via the `THEMES` table in `App.jsx`.

### Notable component styles
- **`.panel`** — the shared "card" look (surface bg + border + shadow) that gives the sidebar, editor, console, and notepad their distinct depth.
- **`.tree` / `.tree-item`** — the skill-tree timeline: a vertical connector line (`::before`), a status `.tree-dot` (green=completed, glowing accent=active, dim=locked), and faded `locked` rows.
- **`.console`** — stark black with traffic-light dots and monospace for an "OS terminal" feel.
- **`.toast-wrap` / `.toast`** — fixed-position transient notifications.

---

## 13. The Desktop Launcher & Packaging (`launcher.js`)

`launcher.js` is compiled into `PyPath.exe` so you can double-click instead of running npm commands.

### What it does
```js
const HERE   = path.dirname(process.execPath);   // folder the .exe sits in
const SERVER = path.join(HERE, 'server.js');      // server.js read from disk (not bundled)

const node = findNode();                          // locate node.exe by known paths, fallback to PATH
const server = spawn(node, [SERVER], { cwd: HERE, stdio: 'inherit' });   // start the API

waitForServer();                                  // poll GET /api/profile until it answers, then…
function openBrowser() { spawn('cmd', ['/c','start','', 'http://localhost:3001']); }
```

Key points:
1. It runs `server.js` **from disk** next to the exe — so edits to `server.js`/`githubSync.js` take effect on next launch **without recompiling the exe**. Only changes to `launcher.js` itself require a rebuild.
2. **`findNode()`** searches common install paths (`C:\Program Files\nodejs\node.exe`, …) so it works even if `node` isn't on PATH. (Node must be installed; it isn't bundled.)
3. It waits for the server to actually answer before opening your browser.

### Guaranteed cleanup (freeing port 3001)
```js
function cleanup() {                              // kill the server's whole process tree
  if (server.pid) spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F']);
}
process.on('exit', cleanup);
['SIGINT','SIGTERM','SIGHUP','SIGBREAK'].forEach(sig => process.on(sig, () => { cleanup(); process.exit(0); }));
server.on('exit', (code) => process.exit(code || 0));
```
Closing the console window (or Ctrl+C) kills the child server so the port is released — no orphaned `node` process holding `:3001`.

### Building the exe
```bash
# Compiles launcher.js → PyPath.exe using @yao-pkg/pkg (a maintained fork of vercel/pkg):
npx @yao-pkg/pkg launcher.js --targets node18-win-x64 --output PyPath.exe
```
The `.exe` and `build/` are git-ignored. A `pypath.ico` is used by the Windows desktop shortcut.

> **Windows gotcha — SmartScreen.** Because the exe isn't code-signed, Windows SmartScreen shows "Unknown publisher" the first time. That's expected for an unsigned local tool; "More info → Run anyway" proceeds. The app also requires **Python** and **Node** to be installed (it shells out to both).

---

## 14. Configuration Files

### `.env` (git-ignored — secrets)
```
DATABASE_URL="file:./dev.db"        # SQLite location (also read by Prisma)
GITHUB_SYNC=on                      # turn progress sync on/off
GITHUB_PROGRESS_REPO=OKevina/pypath-progress
GH_TOKEN=github_pat_...             # fine-grained PAT, scoped to the progress repo only
```

### `prisma.config.ts`
Prisma 6's config file. Tells Prisma where the schema is, what the seed command is, and where to get the datasource URL:
```ts
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations", seed: "node prisma/seed.js" },
  engine: "classic",
  datasource: { url: env("DATABASE_URL") },
});
```

### `package.json` scripts (root)
```json
"server":     "node server.js",                  // backend only
"seed":       "node prisma/seed.js",             // load dataset.json into SQLite
"curriculum": "node prisma/fetchCurriculum.js",  // rebuild dataset.json then seed
"dev":        "concurrently … \"node server.js\" \"npm --prefix frontend run dev\""  // both
```

### `frontend/package.json` scripts
```json
"dev":     "vite",          // dev server on :5173 with HMR
"build":   "vite build",    // produces frontend/dist for packaged mode
"preview": "vite preview"   // serve the built bundle locally
```

---

## 15. End-to-End Walkthroughs

### A. "What happens when I press Run Code on a fresh challenge?"

1. **Browser**: `runCode()` POSTs `{ code, challengeId, hintsUsed }` to `/api/run`.
2. **Server**: parses body → loads the `Challenge` → `JSON.parse(testCases)`.
3. **Engine**: `executePython(code, testCases, mode)` spawns `python -c <code>` once per test case (`stdin` mode) or appends each assert (`assertion` mode), collecting pass/fail.
4. **Server**: records `executionTimeMs`, computes `passRate`.
5. **Server**: checks `alreadyCompleted` (prior successes) *before* logging the new `Attempt`.
6. **Server**: inserts the `Attempt`.
7. **Server**: if success → run SM-2 + upsert `ReviewSchedule`; if first solve → award XP/Elo/+streak and maybe bump `highestUnlockedIndex`.
8. **Server**: updates `UserProfile`.
9. **Server**: if success and sync enabled → kicks off the async GitHub push (doesn't wait).
10. **Server**: responds with the full result object.
11. **Browser**: updates HUD pills, the `passed/total` test bar, the console output; if `unlocked`, refetches challenges so the new row appears; if `syncStarted`, polls `/api/sync/status` and toasts the outcome.

### B. "What makes challenge #8 become available?"

You must **solve challenge #7** (the current frontier, where `orderIndex === highestUnlockedIndex`). On that first success, the server sets `highestUnlockedIndex = 8`. The next `GET /api/challenges` now returns #8, and the sidebar's locked stub for #8 turns into a real, clickable row.

### C. "Why did a review show up for something I already did?"

Every successful solve (even re-solves) runs SM-2 and writes a `ReviewSchedule` with a `nextReviewDate`. Once that date passes, `GET /api/reviews` includes it, and toggling **Daily Reviews** surfaces it. Re-solving it runs SM-2 again and pushes the next review further out (if you used few hints).

---

## 16. Running, Building & Common Tasks

```bash
# 1. Install deps (root + frontend)
npm install
npm --prefix frontend install

# 2. Set up the database + curriculum (first time)
npx prisma db push          # create dev.db from schema.prisma
npm run curriculum          # build dataset.json (intro + MBPP) and seed it
#   (or: npm run seed       # just (re)load the existing dataset.json)

# 3a. Develop (two processes, hot reload)
npm run dev                 # API :3001 + Vite UI :5173  → open http://localhost:5173

# 3b. Or run packaged-style (one process)
npm --prefix frontend run build   # produces frontend/dist
npm run server                    # serves UI + API on :3001 → open http://localhost:3001

# 4. Build the desktop launcher
npx @yao-pkg/pkg launcher.js --targets node18-win-x64 --output PyPath.exe
```

Other handy commands:
```bash
npx prisma studio           # browse/edit the SQLite data in a GUI
npm run curriculum          # regenerate + reseed the whole curriculum
```

**Prerequisites:** Node.js and Python must be installed and runnable. GitHub sync additionally needs the `gh` CLI plus `.env` config.

---

## 17. Glossary

- **SM-2** — *SuperMemo 2*, the spaced-repetition algorithm that decides when to review a card again based on how well you recalled it. PyPath derives recall "quality" from how many hints you used.
- **Elo** — a relative skill rating (chess origin). Starts at 800; +25 per first solve, penalties for repeated syntax errors.
- **MBPP** — *Mostly Basic Python Problems*, an open dataset of ~974 beginner problems with function-call tests. PyPath uses ~427 as the assertion-mode practice pool.
- **stdin mode** — a challenge tested by feeding input on standard input and comparing printed output.
- **assertion mode** — a challenge tested by running `assert` statements against a function you define.
- **`-c` flag** — `python -c "<code>"` runs a code string directly, leaving stdin free for input.
- **Gatekeeper** — the pattern of returning only unlocked challenges from the API while still letting the UI show locked placeholders via a `total` count.
- **Frontier** — the challenge whose `orderIndex` equals `highestUnlockedIndex`; clearing it unlocks the next.
- **Anti-farming** — XP/Elo are granted only on the *first* solve of a challenge, checked before the new attempt is logged.
- **HMR** — *Hot Module Replacement*, Vite's instant in-place code reloading in dev.
- **PAT** — *Personal Access Token*; PyPath uses a fine-grained one scoped to only the progress repo.

---

## 18. How to Extend It

**Add a new challenge (manually):** `POST /api/challenges` with `{ title, prompt, testCases, hints, learningTip, orderIndex? }`. If you omit `orderIndex`, it's appended to the end.

**Add a new theme:** add an entry to the `THEMES` array in `App.jsx` (with its Monaco theme), and a `[data-theme="yourid"] { … }` block overriding the CSS variables in `index.css`. That's it — no other code changes.

**Change the XP formula:** edit the `speedReward` / `xpAwarded` lines in `server.js`'s `POST /api/run` first-solve block. Keep the frontend's `HINT_COST` (in `App.jsx`) in sync with the server's per-hint deduction (currently 15).

**Change the review cadence:** tune the SM-2 constants in `sm2()` (`server.js`) — the interval steps (1, 6, ×EF) and the easiness-factor formula.

**Re-grade / re-source the curriculum:** edit the heuristics in `fetchCurriculum.js` (`COMPLEXITY_TIERS`, `CATEGORY_RULES`, `difficultyOf`) and run `npm run curriculum`.

**Swap the GitHub token:** replace `GH_TOKEN` in `.env` (no code change). Use a fine-grained PAT scoped to only the progress repo for least privilege.

---

_Last updated for the PyPath codebase as authored end-to-end by Claude (Opus 4.8) via Claude Code. Every module described here was AI-written; this manual is intended to make that code understandable and studyable._
