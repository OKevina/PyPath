/**
 * Sequential curriculum data pipeline.
 *
 * 1. Attempts to fetch an open-source beginner Python curriculum from a remote
 *    source. If that fails (offline / shape mismatch), falls back to a curated
 *    embedded curriculum that is guaranteed compatible with the stdin/`-c`
 *    execution engine.
 * 2. Normalizes every challenge and, if the data is not already sequential,
 *    orders it with a keyword-complexity heuristic
 *    (print -> math -> variables -> if/else -> loops -> lists -> functions).
 * 3. Ensures 3 progressive hints per challenge (conceptual, logic, syntax).
 * 4. Writes the ordered array to dataset.json and triggers the Prisma seed.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// Optional remote source. Kept configurable; failure is non-fatal.
const REMOTE_URL =
  process.env.CURRICULUM_URL ||
  'https://raw.githubusercontent.com/nonexistent/python-curriculum/main/curriculum.json';

// --- Complexity heuristic ---------------------------------------------------
// Each tier lists keywords; a challenge's score is the HIGHEST tier any of its
// text matches (a loop problem that also prints is still a loop problem).
const COMPLEXITY_TIERS = [
  { rank: 0, keywords: ['print', 'hello', 'output', 'display'] },
  { rank: 1, keywords: ['add', 'sum', 'multiply', 'subtract', 'divide', 'arithmetic', 'math'] },
  { rank: 2, keywords: ['variable', 'assign', 'store', 'name', 'greet'] },
  { rank: 3, keywords: ['if', 'else', 'condition', 'even', 'odd', 'compare', 'greater', 'less'] },
  { rank: 4, keywords: ['loop', 'for', 'while', 'repeat', 'iterate', 'each integer'] },
  { rank: 5, keywords: ['list', 'array', 'elements', 'collection', 'split'] },
  { rank: 6, keywords: ['function', 'def', 'return', 'parameter', 'recipe'] },
];

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Match keywords on WORD BOUNDARIES so "greet" doesn't match "greeting"
// and "add" doesn't match "addition" — substring matching mis-ranks otherwise.
function complexityScore(challenge) {
  const haystack = `${challenge.title} ${challenge.prompt} ${challenge.concept || ''}`.toLowerCase();
  let score = 0;
  for (const tier of COMPLEXITY_TIERS) {
    const hit = tier.keywords.some((kw) =>
      new RegExp(`\\b${escapeRegExp(kw)}\\b`).test(haystack)
    );
    if (hit) score = Math.max(score, tier.rank);
  }
  return score;
}

function isSequential(list) {
  // Considered already sequential if scores are non-decreasing.
  let prev = -1;
  for (const c of list) {
    const s = complexityScore(c);
    if (s < prev) return false;
    prev = s;
  }
  return true;
}

// --- Hint generation --------------------------------------------------------
// Guarantees exactly 3 progressive hints. Authored hints are preferred; if a
// (remote) challenge lacks them, we synthesize sensible placeholders.
function ensureHints(challenge) {
  if (Array.isArray(challenge.hints) && challenge.hints.length === 3) {
    return challenge.hints;
  }
  return [
    `Concept: think about what "${challenge.title}" is fundamentally asking you to do.`,
    'Logic: read the input, transform it step by step, then print the result.',
    '# Syntax: value = input(); print(...)  # adapt to this problem',
  ];
}

// --- Curated embedded curriculum -------------------------------------------
// Each challenge is solvable by reading stdin and printing to stdout, matching
// the executePython(code, testCases) engine. `concept` aids the heuristic.
const EMBEDDED_CURRICULUM = [
  {
    title: 'Print a Greeting',
    concept: 'print',
    prompt: 'Use print to output the exact text: Hello, World!',
    testCases: [{ input: '', expectedOutput: 'Hello, World!' }],
    hints: [
      'The print() function shows text on the screen.',
      'Pass the exact text you want shown as the argument to print().',
      'print("Hello, World!")',
    ],
    learningTip: 'print() is how a program communicates a result to the outside world.',
  },
  {
    title: 'Add Two Numbers',
    concept: 'math arithmetic',
    prompt:
      'Read two whole numbers (each on its own line) and print their sum using arithmetic addition.',
    testCases: [
      { input: '3\n5', expectedOutput: '8' },
      { input: '10\n-4', expectedOutput: '6' },
      { input: '0\n0', expectedOutput: '0' },
    ],
    hints: [
      'Numbers typed by a user arrive as text and must be converted before doing math.',
      'Read line 1 into a, read line 2 into b, then print a + b.',
      'a = int(input())\nb = int(input())\nprint(a + b)',
    ],
    learningTip: 'input() always returns a string; wrap it in int() to do arithmetic.',
  },
  {
    title: 'Store and Reuse a Variable',
    concept: 'variables',
    prompt:
      'Read a person\'s name, store it in a variable, then print: Hello, <name>!',
    testCases: [
      { input: 'Alice', expectedOutput: 'Hello, Alice!' },
      { input: 'Bob', expectedOutput: 'Hello, Bob!' },
    ],
    hints: [
      'A variable is a labeled box that remembers a value so you can use it later.',
      'Store input() in a variable called name, then build the greeting string from it.',
      'name = input()\nprint("Hello, " + name + "!")',
    ],
    learningTip: 'Variables let you name data so you can reuse it instead of repeating yourself.',
  },
  {
    title: 'Even or Odd',
    concept: 'if else condition',
    prompt:
      'Read a whole number and print "even" if it is divisible by 2, otherwise print "odd". Use an if/else condition.',
    testCases: [
      { input: '4', expectedOutput: 'even' },
      { input: '7', expectedOutput: 'odd' },
      { input: '0', expectedOutput: 'even' },
      { input: '-3', expectedOutput: 'odd' },
    ],
    hints: [
      'A number is even when the remainder of dividing it by 2 is zero.',
      'Compute n % 2; if it equals 0 print even, otherwise print odd.',
      'n = int(input())\nif n % 2 == 0:\n    print("even")\nelse:\n    print("odd")',
    ],
    learningTip: 'if/else lets your program choose between paths based on a condition.',
  },
  {
    title: 'Sum From One To N',
    concept: 'loop',
    prompt:
      'Read a whole number N and use a loop to add up every integer from 1 to N, then print the total.',
    testCases: [
      { input: '5', expectedOutput: '15' },
      { input: '1', expectedOutput: '1' },
      { input: '10', expectedOutput: '55' },
    ],
    hints: [
      'Adding 1 + 2 + ... + N means repeating an addition many times — a job for a loop.',
      'Start total at 0, loop i from 1 through N adding i each pass, then print total.',
      'n = int(input())\ntotal = 0\nfor i in range(1, n + 1):\n    total += i\nprint(total)',
    ],
    learningTip: 'A for loop repeats a block once per item in a range or collection.',
  },
  {
    title: 'Sum a List of Numbers',
    concept: 'list array',
    prompt:
      'Read one line of space-separated numbers into a list and print the sum of all elements in the list.',
    testCases: [
      { input: '1 2 3 4', expectedOutput: '10' },
      { input: '5', expectedOutput: '5' },
      { input: '10 20 30', expectedOutput: '60' },
    ],
    hints: [
      'A list holds many values together; splitting a line of text gives a list of pieces.',
      'Split the input on spaces, convert each piece to int to form a list, then sum the list.',
      'nums = [int(x) for x in input().split()]\nprint(sum(nums))',
    ],
    learningTip: 'Lists store ordered collections; split() turns a line into a list of tokens.',
  },
  {
    title: 'Write a Square Function',
    concept: 'function def return',
    prompt:
      'Define a function that returns the square of its parameter, then read a number, call the function, and print the returned value.',
    testCases: [
      { input: '6', expectedOutput: '36' },
      { input: '0', expectedOutput: '0' },
      { input: '-4', expectedOutput: '16' },
    ],
    hints: [
      'A function is a reusable named recipe that takes input (parameters) and gives back a result.',
      'Define square(x) that returns x * x, read n, then print square(n).',
      'def square(x):\n    return x * x\nn = int(input())\nprint(square(n))',
    ],
    learningTip: 'Functions package logic behind a name so you can reuse it with different inputs.',
  },
];

// --- Remote fetch (best effort) ---------------------------------------------
async function tryFetchRemote() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(REMOTE_URL, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const arr = Array.isArray(data) ? data : data.challenges;
    if (!Array.isArray(arr) || arr.length === 0) throw new Error('Unexpected shape');
    // Normalize to our field names where possible.
    return arr.map((c) => ({
      title: c.title || c.name || 'Untitled',
      concept: c.concept || '',
      prompt: c.prompt || c.description || '',
      testCases: c.testCases || c.tests || [{ input: '', expectedOutput: '' }],
      hints: c.hints,
      learningTip: c.learningTip || c.tip || '',
    }));
  } catch (err) {
    return null;
  }
}

// --- MBPP practice pool (assertion mode) -----------------------------------
// MBPP problems test by calling a named function with asserts, not stdin/stdout.
// We map them to assertion-mode challenges and discard the reference solution.
const MBPP_URL =
  process.env.MBPP_URL ||
  'https://raw.githubusercontent.com/google-research/google-research/master/mbpp/sanitized-mbpp.json';

// Optional cap (env PRACTICE_LIMIT) to keep the seed small during development.
const PRACTICE_LIMIT = process.env.PRACTICE_LIMIT
  ? parseInt(process.env.PRACTICE_LIMIT, 10)
  : Infinity;

function signatureFromCode(code) {
  const m = (code || '').match(/def\s+([a-zA-Z_]\w*)\s*\(([^)]*)\)/);
  if (!m) return null;
  const params = m[2].trim();
  return { name: m[1], params, line: `def ${m[1]}(${params}):` };
}

function titleFromPrompt(p) {
  let t = (p || '').replace(/^write a (python )?(function|program)\s+(to|that)\s+/i, '');
  t = t.charAt(0).toUpperCase() + t.slice(1);
  t = t.replace(/\.$/, '').trim();
  if (t.length > 60) t = `${t.slice(0, 57)}...`;
  return t || 'Python practice problem';
}

// Categorize a challenge from its text (first matching rule wins).
const CATEGORY_RULES = [
  ['recursion', ['recursion', 'recursive', 'fibonacci', 'factorial']],
  ['strings', ['string', 'substring', 'character', 'vowel', 'palindrome', 'word', 'letter', 'char']],
  ['dictionaries', ['dictionary', 'dict', 'hash map']],
  ['tuples', ['tuple']],
  ['lists', ['list', 'array', 'element', 'sublist']],
  ['sorting', ['sort', 'arrange', 'order']],
  ['math', ['prime', 'factor', 'divisor', 'digit', 'integer', 'square', 'multiple', 'sum', 'product', 'number']],
  ['conditionals', ['greater', 'less than', 'whether', 'even', 'odd']],
  ['loops', ['loop', 'iterate', 'repeat', 'count']],
  ['functions', ['function', 'return']],
  ['basics', ['print', 'variable', 'hello']],
];

function categoryOf(text) {
  const h = (text || '').toLowerCase();
  for (const [cat, kws] of CATEGORY_RULES) {
    if (kws.some((k) => h.includes(k))) return cat;
  }
  return 'general';
}

// Grade difficulty from the reference solution's structural complexity.
const DIFFICULTY_RANK = { easy: 0, medium: 1, hard: 2 };
function difficultyOf(code, asserts) {
  const c = code || '';
  const lines = c.split('\n').filter((l) => l.trim()).length;
  let score = 0;
  if (/\bfor\b|\bwhile\b/.test(c)) score += 1; // iteration
  if (/\n\s{8,}\S/.test(c)) score += 1; // deep nesting
  const fn = c.match(/def\s+(\w+)/);
  if (fn && new RegExp(`\\b${fn[1]}\\s*\\(`).test(c.replace(/def\s+\w+/, ''))) score += 2; // self-call (recursion)
  if (lines > 6) score += 1;
  if ((asserts || []).length > 3) score += 1;
  if (score <= 1) return 'easy';
  if (score <= 3) return 'medium';
  return 'hard';
}

function mapMbpp(rec) {
  const prompt = rec.prompt || rec.text || '';
  const asserts = rec.test_list || [];
  const importsArr = rec.test_imports || (rec.test_setup_code ? [rec.test_setup_code] : []);
  const setup = Array.isArray(importsArr) ? importsArr.join('\n') : String(importsArr || '');
  const sig = signatureFromCode(rec.code);
  if (!asserts.length || !sig) return null; // skip records we can't make solvable

  const category = categoryOf(`${prompt} ${asserts.join(' ')}`);
  const difficulty = difficultyOf(rec.code, asserts);

  return {
    title: titleFromPrompt(prompt),
    prompt: `${prompt}\n\nYour solution must define a function named \`${sig.name}(${sig.params})\` that returns its result.`,
    mode: 'assertion',
    category,
    difficulty,
    testCases: { setup, asserts },
    starterCode: `${sig.line}\n    # your code here\n`,
    hints: [
      `Concept: this is a ${category} problem — ${prompt.replace(/\.$/, '')}.`,
      'Logic: use the parameters to compute the answer step by step, then return it (do not print).',
      sig.line,
    ],
    learningTip:
      'Practice problem from the open MBPP dataset — return the result; the tests call your function directly.',
  };
}

async function loadPracticePool() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const res = await fetch(MBPP_URL, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const arr = Array.isArray(data) ? data : data.problems || [];
    const mapped = arr.map(mapMbpp).filter(Boolean);
    // Difficulty-grade the pool so easier problems come first (rec 3).
    mapped.sort((a, b) => DIFFICULTY_RANK[a.difficulty] - DIFFICULTY_RANK[b.difficulty]);
    const limited = Number.isFinite(PRACTICE_LIMIT) ? mapped.slice(0, PRACTICE_LIMIT) : mapped;
    const byDiff = limited.reduce((acc, c) => ({ ...acc, [c.difficulty]: (acc[c.difficulty] || 0) + 1 }), {});
    console.log(`Practice pool: fetched ${arr.length}, usable ${mapped.length}, seeding ${limited.length} (${JSON.stringify(byDiff)}).`);
    return limited;
  } catch (err) {
    console.log(`Practice pool unavailable (${err.message}); seeding intro track only.`);
    return [];
  }
}

async function main() {
  // --- Intro track: curated, scaffolded, stdin/stdout challenges -----------
  let source = 'embedded curated curriculum';
  let intro = await tryFetchRemote();
  if (intro) {
    source = `remote: ${REMOTE_URL}`;
  } else {
    intro = EMBEDDED_CURRICULUM;
  }
  console.log(`Intro track source -> ${source} (${intro.length} challenges)`);

  if (!isSequential(intro)) {
    console.log('Intro track not sequential; applying complexity heuristic...');
    intro = intro
      .map((c) => ({ c, score: complexityScore(c) }))
      .sort((a, b) => a.score - b.score)
      .map((x) => x.c);
  } else {
    console.log('Intro track already sequential by complexity.');
  }

  // --- Practice pool: large MBPP set in assertion mode ---------------------
  const pool = await loadPracticePool();

  // --- Combine and assign a single sequential orderIndex -------------------
  const combined = [...intro, ...pool];
  const ordered = combined.map((c, i) => ({
    title: c.title,
    prompt: c.prompt,
    testCases: c.testCases,
    hints: ensureHints(c),
    learningTip: c.learningTip || 'Keep practicing — each concept builds on the last.',
    mode: c.mode || 'stdin',
    starterCode: c.starterCode || '',
    category: c.category || categoryOf(`${c.title} ${c.prompt} ${c.concept || ''}`),
    difficulty: c.difficulty || 'easy',
    orderIndex: i + 1,
  }));

  const outPath = path.join(__dirname, '..', 'dataset.json');
  fs.writeFileSync(outPath, JSON.stringify(ordered, null, 2));
  console.log(`Wrote ${ordered.length} challenges (${intro.length} intro + ${pool.length} practice) to ${outPath}`);

  // Trigger the Prisma seed.
  console.log('Triggering Prisma seed...');
  const seed = spawnSync(process.execPath, [path.join(__dirname, 'seed.js')], {
    stdio: 'inherit',
  });
  process.exit(seed.status ?? 0);
}

main();
