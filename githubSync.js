/**
 * GitHub progress sync.
 *
 * On each FIRST solve, pushes a progress.json + a rendered README.md to a
 * dedicated progress repo using the GitHub CLI (`gh api`) — no local clone.
 *
 * Enable by setting in .env:
 *   GITHUB_SYNC=on
 *   GITHUB_PROGRESS_REPO=OWNER/REPO   e.g. OKevina/pypath-progress
 *
 * Requires `gh` installed and authenticated (`gh auth login`).
 */
const { execFile } = require('child_process');
const util = require('util');
const execFileP = util.promisify(execFile);

const REPO = process.env.GITHUB_PROGRESS_REPO || '';
const ENABLED = process.env.GITHUB_SYNC === 'on' && !!REPO;

function isEnabled() {
  return ENABLED;
}

async function gh(args) {
  return execFileP('gh', args, { maxBuffer: 4 * 1024 * 1024 });
}

// Current blob SHA for a path (needed to update an existing file), or null.
async function getSha(filePath) {
  try {
    const { stdout } = await gh(['api', `/repos/${REPO}/contents/${filePath}`, '--jq', '.sha']);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function putFile(filePath, contentStr, message) {
  const b64 = Buffer.from(contentStr, 'utf-8').toString('base64');
  const args = [
    'api', `/repos/${REPO}/contents/${filePath}`,
    '--method', 'PUT',
    '-f', `message=${message}`,
    '-f', `content=${b64}`,
  ];
  const sha = await getSha(filePath);
  if (sha) args.push('-f', `sha=${sha}`);
  await gh(args);
}

function bar(pct, width = 24) {
  const filled = Math.round((pct / 100) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

function slug(title) {
  return (title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50) || 'challenge';
}

function solutionPath(orderIndex, title) {
  return `solutions/${String(orderIndex).padStart(3, '0')}-${slug(title)}.py`;
}

function buildMarkdown(profile, completed, total) {
  const pct = total > 0 ? Math.round((completed.length / total) * 100) : 0;
  const rows = completed
    .map((c) => `| ${c.orderIndex} | ${c.title} | ${c.category} | ${c.difficulty} |`)
    .join('\n');
  return `# 🐍 My PyPath Progress

_Auto-updated by [PyPath](https://github.com/OKevina/PyPath) after each solved challenge._

\`\`\`
${bar(pct)}  ${pct}%
\`\`\`

| Metric | Value |
|--------|-------|
| ✅ Challenges solved | **${completed.length} / ${total}** |
| ✦ XP | **${profile.xp}** |
| ♟ Elo | **${profile.eloRating}** |
| 🔥 Streak | **${profile.currentStreak}** |
| 🕒 Last updated | ${new Date().toISOString()} |

💾 Solutions are archived in the [\`solutions/\`](solutions/) folder.

## Completed challenges
| # | Title | Category | Difficulty |
|---|-------|----------|------------|
${rows || '| — | _none yet_ | | |'}
`;
}

async function syncProgress({ profile, completed, total, solution }) {
  if (!ENABLED) return { skipped: true };

  // Archive the just-solved solution as its own file (incremental — one per solve).
  if (solution && solution.code != null) {
    await putFile(
      solutionPath(solution.orderIndex, solution.title),
      solution.code,
      `solution: #${solution.orderIndex} ${solution.title}`
    );
  }

  const json = JSON.stringify(
    {
      updatedAt: new Date().toISOString(),
      xp: profile.xp,
      eloRating: profile.eloRating,
      currentStreak: profile.currentStreak,
      completedCount: completed.length,
      total,
      completed,
    },
    null,
    2
  );
  const msg = `progress: ${completed.length}/${total} solved`;
  await putFile('progress.json', json, msg);
  await putFile('README.md', buildMarkdown(profile, completed, total), msg);
  return { ok: true };
}

module.exports = { syncProgress, isEnabled };
