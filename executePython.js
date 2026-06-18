const { spawn } = require('child_process');

// Low-level: run `python <args>`, optionally feed stdin, collect output.
function runProgram(args, stdinData) {
  return new Promise((resolve) => {
    const proc = spawn('python', args);

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    proc.on('error', (err) => {
      resolve({ spawnError: `Failed to start Python: ${err.message}`, code: -1, stdout, stderr });
    });
    proc.on('close', (code) => resolve({ code, stdout, stderr }));

    if (stdinData !== null && stdinData !== undefined) {
      proc.stdin.write(String(stdinData));
    }
    proc.stdin.end();
  });
}

// stdin/stdout mode: feed input, compare trimmed stdout. Runs EVERY case and
// reports how many passed (no longer fails fast) so we can show a pass rate.
async function runStdinMode(code, testCases) {
  const total = testCases.length;
  let passed = 0;
  let firstError = null;

  for (const tc of testCases) {
    // Program runs via -c; stdin is reserved for the test case input.
    const { stdout, stderr, spawnError } = await runProgram(['-c', code], String(tc.input));
    if (spawnError) {
      return { success: false, passed: 0, total, output: spawnError };
    }
    if (stderr) {
      if (!firstError) firstError = stderr.trim();
      continue;
    }
    if (stdout.trim() === String(tc.expectedOutput).trim()) {
      passed += 1;
    } else if (!firstError) {
      firstError =
        `Test failed. Input: ${tc.input}. ` +
        `Expected: ${tc.expectedOutput}. Got: ${stdout.trim()}`;
    }
  }

  return summarize(passed, total, firstError);
}

// assertion mode (MBPP-style): append each assert to the user's code and run.
// A case passes when the process exits 0 (no AssertionError / other error).
async function runAssertionMode(code, spec) {
  const setup = spec && spec.setup ? spec.setup : '';
  const asserts = spec && Array.isArray(spec.asserts) ? spec.asserts : [];
  const total = asserts.length;
  let passed = 0;
  let firstError = null;

  for (const assertion of asserts) {
    const program = [code, setup, assertion].filter(Boolean).join('\n');
    const { code: exitCode, stderr, spawnError } = await runProgram(['-c', program], '');
    if (spawnError) {
      return { success: false, passed: 0, total, output: spawnError };
    }
    if (exitCode === 0 && !stderr) {
      passed += 1;
    } else if (!firstError) {
      const lastLine = (stderr.trim().split('\n').pop() || 'failed').trim();
      firstError = `Test failed: ${assertion}\n${lastLine}`;
    }
  }

  return summarize(passed, total, firstError);
}

function summarize(passed, total, firstError) {
  const success = total > 0 && passed === total;
  const output = success
    ? `All ${total} test case${total === 1 ? '' : 's'} passed.`
    : `${passed}/${total} test cases passed.\n\n${firstError || 'Some test cases failed.'}`;
  return { success, passed, total, output };
}

/**
 * Execute Python code against a challenge's tests.
 * @param {string} code        the user's submission
 * @param {Array|Object} tests stdin testcases [{input,expectedOutput}] OR {setup,asserts}
 * @param {string} mode        'stdin' (default) or 'assertion'
 * @returns {Promise<{success:boolean, passed:number, total:number, output:string}>}
 */
async function executePython(code, tests, mode = 'stdin') {
  if (mode === 'assertion') {
    return runAssertionMode(code, tests);
  }
  return runStdinMode(code, tests);
}

module.exports = { executePython };
