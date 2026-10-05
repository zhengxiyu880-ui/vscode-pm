'use strict';

/**
 * 项目管理系统 · 零依赖后端
 * ------------------------------------------------------------
 * · 托管 public/ 下的静态页面
 * · 提供 /api/* REST 接口（项目 / 任务 / 看板排序 / 导入导出）
 * · 数据持久化到 data/db.json，采用「临时文件 + rename」原子写入
 *
 * 仅使用 Node 内置模块，无需 npm install。
 */

const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DEFAULT_DATA_FILE = path.join(ROOT, 'data', 'db.json');
/** 可用环境变量 PM_DATA_FILE 指定数据文件（测试会指向临时文件） */
const DATA_FILE = process.env.PM_DATA_FILE ? path.resolve(process.env.PM_DATA_FILE) : DEFAULT_DATA_FILE;
const DATA_DIR = path.dirname(DATA_FILE);

const PORT = Number(process.env.PORT || 5177);
const HOST = process.env.HOST || '127.0.0.1';
const MAX_BODY = 1024 * 1024; // 1MB

const STATUSES = ['todo', 'doing', 'review', 'done'];
const PRIORITIES = ['low', 'medium', 'high'];
const DEFAULT_COLORS = ['#4f9cf9', '#7c6cf5', '#e06c9f', '#e2a03f', '#3fb950', '#2bb3a3', '#e05c5c', '#8c8c8c'];

/* ------------------------------------------------------------------ 数据层 */

let db = { version: 1, projects: [], tasks: [] };
let writeChain = Promise.resolve();

const uid = (prefix) => `${prefix}_${crypto.randomBytes(5).toString('hex')}`;
const nowIso = () => new Date().toISOString();

function seed() {
  const at = nowIso();
  /** 相对今天的日期，让演示数据里的「今天 / 逾期」状态始终有意义 */
  const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
  const demo = {
    id: uid('p'),
    name: '示例项目',
    description: '预置的演示数据，可以直接编辑或删除。',
    color: '#4f9cf9',
    archived: false,
    createdAt: at,
    updatedAt: at,
  };
  const site = {
    id: uid('p'),
    name: '官网改版',
    description: '官网 2.0 的视觉与开发排期。',
    color: '#7c6cf5',
    archived: false,
    createdAt: at,
    updatedAt: at,
  };
  db.projects = [demo, site];

  const mk = (projectId, title, status, priority, due, tags, description, order) => ({
    id: uid('t'),
    projectId,
    title,
    description: description || '',
    status,
    priority,
    due: due || '',
    tags: tags || [],
    order,
    createdAt: at,
    updatedAt: at,
  });

  db.tasks = [
    mk(demo.id, '梳理需求清单', 'todo', 'medium', day(3), ['需求'], '把零散的想法整理成可执行的任务。', 0),
    mk(demo.id, '确定看板列定义', 'todo', 'low', day(7), ['流程'], '', 1),
    mk(demo.id, '搭建项目骨架', 'doing', 'high', day(-1), ['开发'], '前后端目录与数据模型。', 0),
    mk(demo.id, '任务卡片交互稿', 'doing', 'medium', day(0), ['设计'], '', 1),
    mk(demo.id, '接口联调自测', 'review', 'medium', day(1), ['测试'], '', 0),
    mk(demo.id, '初始化仓库', 'done', 'low', day(-5), ['杂项'], '', 0),
    mk(demo.id, '选定技术方案', 'done', 'high', '', ['决策'], '零依赖 Node + 原生前端。', 1),
    mk(site.id, '首页信息架构', 'todo', 'high', day(4), ['设计', '内容'], '', 0),
    mk(site.id, '组件库选型', 'doing', 'medium', day(10), ['前端'], '', 0),
    mk(site.id, '上线检查表', 'review', 'low', day(2), ['发布'], '', 0),
  ];

  // 每一列内部重新编号，保证排序从 0 开始
  STATUSES.forEach((status) => {
    db.tasks
      .filter((t) => t.status === status)
      .forEach((t, i) => {
        t.order = i;
      });
  });
}

async function load() {
  try {
    const raw = await fsp.readFile(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    db = {
      version: 1,
      projects: Array.isArray(parsed.projects) ? parsed.projects : [],
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
    };
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.warn(`[db] 读取 ${DATA_FILE} 失败（${err.message}），将重建初始数据`);
    } else {
      console.log('[db] 未发现数据文件，已写入初始演示数据');
    }
    db = { version: 1, projects: [], tasks: [] };
    seed();
    await persist();
  }
}

/** 串行化的原子写入，避免并发请求写坏文件 */
function persist() {
  const snapshot = JSON.stringify(db, null, 2);
  writeChain = writeChain
    .then(async () => {
      await fsp.mkdir(DATA_DIR, { recursive: true });
      const tmp = `${DATA_FILE}.${process.pid}.tmp`;
      await fsp.writeFile(tmp, snapshot, 'utf8');
      await fsp.rename(tmp, DATA_FILE);
    })
    .catch((err) => {
      console.error('[db] 写入失败:', err.message);
    });
  return writeChain;
}

/* ------------------------------------------------------------------ 工具 */

const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function normalizeTags(value) {
  const list = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[,，\s]+/)
      : [];
  const out = [];
  for (const item of list) {
    const tag = str(item, 24);
    if (tag && !out.includes(tag)) out.push(tag);
    if (out.length >= 8) break;
  }
  return out;
}

function normalizeProject(payload, base) {
  const p = { ...base };
  if ('name' in payload) p.name = str(payload.name, 80);
  if ('description' in payload) p.description = str(payload.description, 500);
  if ('color' in payload) {
    const color = str(payload.color, 32);
    p.color = /^#[0-9a-fA-F]{3,8}$/.test(color) ? color : base.color || DEFAULT_COLORS[0];
  }
  if ('archived' in payload) p.archived = Boolean(payload.archived);
  return p;
}

function normalizeTask(payload, base) {
  const t = { ...base };
  if ('projectId' in payload) t.projectId = str(payload.projectId, 40);
  if ('title' in payload) t.title = str(payload.title, 200);
  if ('description' in payload) t.description = str(payload.description, 2000);
  if ('status' in payload) t.status = STATUSES.includes(payload.status) ? payload.status : base.status;
  if ('priority' in payload) t.priority = PRIORITIES.includes(payload.priority) ? payload.priority : base.priority;
  if ('due' in payload) t.due = str(payload.due, 20);
  if ('tags' in payload) t.tags = normalizeTags(payload.tags);
  if ('order' in payload && Number.isFinite(Number(payload.order))) t.order = Number(payload.order);
  return t;
}

function nextOrder(status) {
  const orders = db.tasks.filter((t) => t.status === status).map((t) => Number(t.order) || 0);
  return orders.length ? Math.min(...orders) - 1 : 0;
}

/** 重新编号某一列，使其 order 连续 */
function renumber(status) {
  db.tasks
    .filter((t) => t.status === status)
    .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0) || String(a.createdAt).localeCompare(String(b.createdAt)))
    .forEach((t, i) => {
      t.order = i;
    });
}

/* ------------------------------------------------------------------ HTTP */

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store',
  });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('payload_too_large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(Object.assign(new Error('invalid_json'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

const statePayload = () => ({ version: db.version, projects: db.projects, tasks: db.tasks });

/* ------------------------------------------------------------------ 路由 */

async function handleApi(req, res, url) {
  const method = (req.method || 'GET').toUpperCase();
  const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]
  const rest = parts.slice(1);
  const [head, id, sub] = rest;

  if (head === 'state' && method === 'GET') {
    return sendJson(res, 200, statePayload());
  }

  if (head === 'projects') {
    if (!id && method === 'POST') return createProject(req, res);
    if (id && (method === 'PATCH' || method === 'PUT')) return updateProject(req, res, id);
    if (id && method === 'DELETE') return deleteProject(res, id);
  }

  if (head === 'tasks') {
    if (!id && method === 'POST') return createTask(req, res);
    if (id === 'reorder' && method === 'POST') return reorderTasks(req, res);
    if (id && (method === 'PATCH' || method === 'PUT')) return updateTask(req, res, id);
    if (id && method === 'DELETE') return deleteTask(res, id);
  }

  if (head === 'export' && method === 'GET') {
    return sendJson(res, 200, statePayload());
  }

  if (head === 'import' && method === 'POST') {
    const body = await readBody(req);
    if (!body || !Array.isArray(body.projects) || !Array.isArray(body.tasks)) {
      return sendJson(res, 400, { error: 'invalid_payload', message: '导入数据需包含 projects 与 tasks 数组' });
    }
    const at = nowIso();
    db = {
      version: 1,
      projects: body.projects.map((p) =>
        normalizeProject(p, {
          id: str(p.id, 40) || uid('p'),
          name: str(p.name, 80) || '未命名项目',
          description: '',
          color: DEFAULT_COLORS[0],
          archived: false,
          createdAt: str(p.createdAt, 40) || at,
          updatedAt: str(p.updatedAt, 40) || at,
        }),
      ),
      tasks: body.tasks.map((t) =>
        normalizeTask(
          { ...t, title: str(t.title, 200) || '未命名任务' },
          {
            id: str(t.id, 40) || uid('t'),
            projectId: str(t.projectId, 40),
            title: '未命名任务',
            description: '',
            status: 'todo',
            priority: 'medium',
            due: '',
            tags: [],
            order: 0,
            createdAt: str(t.createdAt, 40) || at,
            updatedAt: str(t.updatedAt, 40) || at,
          },
        ),
      ),
    };
    STATUSES.forEach(renumber);
    await persist();
    return sendJson(res, 200, statePayload());
  }

  return sendJson(res, 404, { error: 'not_found', message: `未知接口 ${method} ${url.pathname}` });
}

async function createProject(req, res) {
  const body = await readBody(req);
  const name = str(body.name, 80);
  if (!name) return sendJson(res, 400, { error: 'invalid_name', message: '项目名称不能为空' });

  const at = nowIso();
  const project = normalizeProject(
    { ...body, name },
    {
      id: uid('p'),
      name,
      description: '',
      color: DEFAULT_COLORS[db.projects.length % DEFAULT_COLORS.length],
      archived: false,
      createdAt: at,
      updatedAt: at,
    },
  );
  db.projects.push(project);
  await persist();
  return sendJson(res, 201, project);
}

async function updateProject(req, res, id) {
  const project = db.projects.find((p) => p.id === id);
  if (!project) return sendJson(res, 404, { error: 'project_not_found', message: '项目不存在' });

  const body = await readBody(req);
  Object.assign(project, normalizeProject(body, project), { updatedAt: nowIso() });
  if (!project.name) {
    project.name = '未命名项目';
  }
  await persist();
  return sendJson(res, 200, project);
}

async function deleteProject(res, id) {
  const index = db.projects.findIndex((p) => p.id === id);
  if (index === -1) return sendJson(res, 404, { error: 'project_not_found', message: '项目不存在' });

  const [removed] = db.projects.splice(index, 1);
  const before = db.tasks.length;
  db.tasks = db.tasks.filter((t) => t.projectId !== id);
  await persist();
  return sendJson(res, 200, { removed, deletedTasks: before - db.tasks.length });
}

async function createTask(req, res) {
  const body = await readBody(req);
  const title = str(body.title, 200);
  if (!title) return sendJson(res, 400, { error: 'invalid_title', message: '任务标题不能为空' });

  const projectId = str(body.projectId, 40);
  if (projectId && !db.projects.some((p) => p.id === projectId)) {
    return sendJson(res, 400, { error: 'project_not_found', message: '所属项目不存在' });
  }

  const at = nowIso();
  const status = STATUSES.includes(body.status) ? body.status : 'todo';
  const task = normalizeTask(
    { ...body, title, status },
    {
      id: uid('t'),
      projectId,
      title,
      description: '',
      status,
      priority: 'medium',
      due: '',
      tags: [],
      order: nextOrder(status),
      createdAt: at,
      updatedAt: at,
    },
  );
  db.tasks.push(task);
  renumber(task.status);
  await persist();
  return sendJson(res, 201, task);
}

async function updateTask(req, res, id) {
  const task = db.tasks.find((t) => t.id === id);
  if (!task) return sendJson(res, 404, { error: 'task_not_found', message: '任务不存在' });

  const body = await readBody(req);
  const prevStatus = task.status;
  const patch = normalizeTask(body, task);

  if ('projectId' in body && patch.projectId && !db.projects.some((p) => p.id === patch.projectId)) {
    return sendJson(res, 400, { error: 'project_not_found', message: '所属项目不存在' });
  }
  if (!patch.title) patch.title = task.title || '未命名任务';

  // 变更状态时把它放到新列顶部
  if (patch.status !== prevStatus && !('order' in body)) {
    patch.order = nextOrder(patch.status);
  }

  Object.assign(task, patch, { updatedAt: nowIso() });
  renumber(prevStatus);
  if (patch.status !== prevStatus) renumber(patch.status);
  await persist();
  return sendJson(res, 200, task);
}

async function deleteTask(res, id) {
  const index = db.tasks.findIndex((t) => t.id === id);
  if (index === -1) return sendJson(res, 404, { error: 'task_not_found', message: '任务不存在' });

  const [removed] = db.tasks.splice(index, 1);
  renumber(removed.status);
  await persist();
  return sendJson(res, 200, { removed });
}

/** 看板拖拽落位：{ status, ids: [...] }，ids 为该列从上到下的完整顺序 */
async function reorderTasks(req, res) {
  const body = await readBody(req);
  const status = body.status;
  const ids = Array.isArray(body.ids) ? body.ids.map((v) => str(v, 40)).filter(Boolean) : [];
  if (!STATUSES.includes(status) || !ids.length) {
    return sendJson(res, 400, { error: 'invalid_payload', message: '需要 status 与非空的 ids' });
  }

  const moved = [];
  ids.forEach((id, index) => {
    const task = db.tasks.find((t) => t.id === id);
    if (!task) return;
    task.status = status;
    task.order = index;
    task.updatedAt = nowIso();
    moved.push(task.id);
  });

  // 未出现在 ids 中的同列任务排到后面，并统一连续编号
  const rest = db.tasks
    .filter((t) => t.status === status && !moved.includes(t.id))
    .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
  rest.forEach((t, i) => {
    t.order = moved.length + i;
  });

  await persist();
  return sendJson(res, 200, { status, order: db.tasks.filter((t) => t.status === status).sort((a, b) => a.order - b.order).map((t) => t.id) });
}

/* ------------------------------------------------------------------ 静态资源 */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

async function serveStatic(req, res, url) {
  const method = (req.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    return sendJson(res, 405, { error: 'method_not_allowed' });
  }

  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || rel === '') rel = '/index.html';

  const filePath = path.join(PUBLIC_DIR, path.normalize(rel));
  const relative = path.relative(PUBLIC_DIR, filePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('403 Forbidden');
  }

  let stat;
  try {
    stat = await fsp.stat(filePath);
  } catch {
    stat = null;
  }
  if (!stat || stat.isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('404 Not Found');
  }

  const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': stat.size,
    'Cache-Control': 'no-cache',
    'Last-Modified': stat.mtime.toUTCString(),
  });
  if (method === 'HEAD') return res.end();
  fs.createReadStream(filePath)
    .on('error', () => res.end())
    .pipe(res);
}

/* ------------------------------------------------------------------ 启动 */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || HOST}`);
  try {
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
    } else {
      await serveStatic(req, res, url);
    }
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('[http]', err);
    if (!res.headersSent) {
      sendJson(res, status, { error: err.message || 'internal_error' });
    } else {
      res.end();
    }
  }
});

async function main() {
  await load();
  server.listen(PORT, HOST, () => {
    console.log('');
    console.log('  项目管理系统已启动');
    console.log(`  ▸ 打开浏览器访问  http://${HOST}:${PORT}`);
    console.log(`  ▸ 数据文件        ${path.relative(ROOT, DATA_FILE)}`);
    console.log('  ▸ 按 Ctrl+C 停止服务');
    console.log('');
  });
}

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`端口 ${PORT} 已被占用，可用 PORT=6000 npm start 指定其他端口。`);
    process.exit(1);
  }
  throw err;
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 500).unref();
  });
}

main();
