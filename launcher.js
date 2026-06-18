/**
 * PyPath portable launcher.
 *
 * Compiled to PyPath.exe (via pkg). Double-clicking it:
 *   1. starts the bundled Express server (which serves the built frontend),
 *   2. waits for it to come up,
 *   3. opens your default browser to the app.
 *
 * Closing the console window stops the server. Requires Node.js installed and
 * PyPath.exe sitting next to server.js (i.e. in the project folder).
 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const HERE = path.dirname(process.execPath); // folder the .exe lives in
const SERVER = path.join(HERE, 'server.js');
const URL = 'http://localhost:3001';

function findNode() {
  const candidates = [
    'C:\\Program Files\\nodejs\\node.exe',
    'C:\\Program Files (x86)\\nodejs\\node.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'nodejs', 'node.exe'),
  ];
  for (const c of candidates) {
    try { fs.accessSync(c); return c; } catch { /* keep looking */ }
  }
  return 'node'; // fall back to PATH
}

if (!fs.existsSync(SERVER)) {
  console.error(`Could not find server.js next to the launcher (${SERVER}).`);
  console.error('Keep PyPath.exe inside the project folder.');
  setTimeout(() => process.exit(1), 8000);
  return;
}

console.log('⌁ Starting PyPath...');
const node = findNode();
const server = spawn(node, [SERVER], { cwd: HERE, stdio: 'inherit' });

function openBrowser() {
  spawn('cmd', ['/c', 'start', '', URL], { detached: true, stdio: 'ignore' });
}

function waitForServer(attempt = 0) {
  http
    .get(`${URL}/api/profile`, () => {
      console.log(`✓ PyPath is running at ${URL}`);
      openBrowser();
    })
    .on('error', () => {
      if (attempt < 80) setTimeout(() => waitForServer(attempt + 1), 500);
      else console.error('Server did not start in time.');
    });
}

waitForServer();
server.on('exit', (code) => process.exit(code || 0));
