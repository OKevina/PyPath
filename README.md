# ⌁ PyPath

**A gamified, spaced-repetition platform for learning Python — built end-to-end by AI.**

[![Built by Claude](https://img.shields.io/badge/Built%20by-Claude%20Opus%204.8-7c5cff)](https://claude.com/claude-code)
[![100% AI-authored](https://img.shields.io/badge/Code-100%25%20AI--authored-43e08a)](#-built-by-ai)
[![Stack](https://img.shields.io/badge/Stack-React%20%C2%B7%20Express%20%C2%B7%20Prisma%20%C2%B7%20SQLite-444)](#-architecture)

PyPath turns learning Python into a progression game: solve a scaffolded curriculum of **434 challenges**, unlock the next concept as you clear the current one, earn XP/Elo/streaks, lean on a metered hint economy, and let an SM-2 spaced-repetition engine bring concepts back for review at the right time.

---

## 🤖 Built by AI

**Every line of this application — backend, frontend, database schema, execution engine, curriculum pipeline, and UI design — was written autonomously by [Claude (Opus 4.8)](https://claude.com/claude-code) via Claude Code.** The human collaborator provided direction, product decisions, and review; Claude designed the architecture, wrote and refactored the code, ran and debugged it, verified behavior in a live browser, and graded the curriculum dataset.

This repository is intentionally an artifact of AI-assisted software engineering. Commits carry `Co-Authored-By: Claude`.

---

## ✨ Features

- **Sequential curriculum (434 challenges)** — 7 hand-authored intro lessons (print → math → variables → conditionals → loops → lists → functions) plus 427 practice problems sourced from the open **MBPP** dataset, difficulty-graded (easy/medium/hard) and category-tagged.
- **Unlock progression** — clearing the frontier challenge unlocks the next; locked challenges are shown but disabled in a skill-tree timeline.
- **Gamification** — XP scaled by execution speed, Elo rating, and a daily streak. Rewards apply on **first solve only** (no farming).
- **Hint economy** — three progressive hints per challenge (concept → logic → syntax), each costing XP.
- **SM-2 spaced repetition** — solved challenges are scheduled for review; re-solving re-runs the algorithm ("review mode").
- **Per-challenge pass rate** — the engine runs *every* test case and reports a live `passed/total` progress bar.
- **Per-challenge notepad** — jot notes that auto-save to a single human-readable `notes.md`.
- **Multiple themes** — Midnight, Light, Nord, Solarized, and High-Contrast, with the Monaco editor theme following along.
- **Native Python execution** — runs your real local `python` via `python -c`, supporting both stdin/stdout and function-assertion (MBPP) test formats.

---

## 🏗 Architecture

```
React + Vite + Monaco editor  ──HTTP──►  Express API (:3001)  ──►  SQLite (via Prisma)
        (:5173 dev)                              │
                                                 └─► spawns `python -c` to run submissions
```

| Layer | Tech |
|-------|------|
| Frontend | React 19, Vite, `@monaco-editor/react`, CSS design system (themeable variables) |
| Backend | Node.js, Express 5 |
| Data | Prisma ORM, SQLite |
| Execution | Node `child_process.spawn('python', ['-c', …])` |
| Curriculum | `prisma/fetchCurriculum.js` (MBPP fetch + heuristic grading) → `dataset.json` → seed |

### Data model
- **Challenge** — prompt, test cases, hints, learning tip, `orderIndex`, `category`, `difficulty`, execution `mode`.
- **UserProfile** — `xp`, `eloRating`, `currentStreak`, `highestUnlockedIndex` (single-user).
- **Attempt** — every run logged (source of truth for "solved before").
- **ReviewSchedule** — SM-2 state (`interval`, `easinessFactor`, `repetitions`, `nextReviewDate`).

---

## 🚀 Getting started

**Prerequisites:** Node.js 18+ and Python 3 on your PATH (the engine runs your real `python`).

```bash
# 1. Install dependencies
npm install
npm --prefix frontend install

# 2. Set up the database + curriculum
npx prisma db push      # create the SQLite schema
npm run curriculum      # fetch/grade the curriculum, write dataset.json, seed

# 3. Run (backend + frontend together)
npm run dev             # API on :3001, app on :5173
```

Then open <http://localhost:5173>.

### Scripts
| Script | Does |
|--------|------|
| `npm run dev` | Start API + frontend concurrently |
| `npm run server` | Start the API only |
| `npm run seed` | Seed the database from `dataset.json` |
| `npm run curriculum` | Rebuild the curriculum and reseed |

---

## 📁 Project structure

```
├── server.js              # Express API: run, progress, reviews, notes, profile
├── executePython.js       # Native Python execution engine (stdin + assertion modes)
├── dataset.json           # Generated curriculum (434 challenges)
├── prisma/
│   ├── schema.prisma      # Data model
│   ├── fetchCurriculum.js # Curriculum pipeline + difficulty/category grading
│   └── seed.js            # Seeder
└── frontend/              # React + Vite app (Monaco editor, themed UI)
```

---

## ⚠️ Notes & limitations

- **Python is required** at runtime — submissions execute against your installed interpreter.
- **Single-user** — one local profile; no accounts.
- **MBPP hints are auto-generated** (the 7 intro challenges have hand-authored hints).
- Your `notes.md` and local `dev.db` are git-ignored and stay on your machine.

---

## 📜 License & credit

Curriculum practice problems derive from the open **MBPP (Mostly Basic Python Problems)** dataset.
Software authored by **Claude (Opus 4.8)** via **Claude Code**.
