/**
 * 测试编排：每个测试文件都在「全新数据文件」上启动一个独立服务，
 * 跑完即清理，避免用例之间互相污染。
 *   node tests/run.mjs
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE_PORT = Number(process.env.TEST_PORT || 5199);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForServer(base, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/api/state`);
      if (res.ok) return true;
    } catch { /* 还没起来 */ }
    await sleep(120);
  }
  return false;
}

/** 启动服务 -> 跑测试文件 -> 关闭服务并删除临时数据 */
async function withServer(name, port, testFile) {
  const dataFile = path.join(os.tmpdir(), `pm-test-${name}-${process.pid}-${Date.now()}.json`);
  const base = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), PM_DATA_FILE: dataFile },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let log = '';
  server.stdout.on('data', (d) => { log += d; });
  server.stderr.on('data', (d) => { log += d; });

  let code = 1;
  try {
    if (!(await waitForServer(base))) {
      console.error(`✗ ${name}: 服务启动失败\n${log}`);
      return 1;
    }
    console.log(`\n=== ${name} · ${base} ===`);
    code = await new Promise((resolve) => {
      const child = spawn(process.execPath, [testFile], { cwd: ROOT, env: { ...process.env, BASE: base }, stdio: 'inherit' });
      child.on('exit', (c) => resolve(c ?? 1));
    });
  } finally {
    server.kill('SIGTERM');
    await sleep(150);
    try { fs.unlinkSync(dataFile); } catch { /* 忽略 */ }
  }
  return code;
}

let code = 0;
code |= await withServer('api', BASE_PORT, path.join(ROOT, 'tests', 'api.test.mjs'));
code |= await withServer('ui', BASE_PORT + 1, path.join(ROOT, 'tests', 'ui.test.mjs'));

console.log(code === 0 ? '\n全部测试通过 ✅\n' : '\n存在失败用例 ❌\n');
process.exit(code ? 1 : 0);
