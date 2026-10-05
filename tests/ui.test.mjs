/**
 * 前端渲染测试：在没有浏览器的环境下，用最小 DOM 桩加载 public/app.js，
 * 通过真实 HTTP 请求驱动渲染，校验看板 / 列表 / 概览 / 筛选 / 转义 / 拖拽落位。
 *   node tests/ui.test.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.BASE || 'http://127.0.0.1:5177';

/* ------------------------------------------------------------ 最小 DOM 桩 */

class El {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.innerHTML = '';
    this.className = '';
    this.textContent = '';
    this.value = '';
    this.hidden = false;
    this.dataset = {};
    this.files = [];
    this._listeners = {};
    const classes = new Set();
    this.classList = {
      add: (...c) => c.forEach((x) => classes.add(x)),
      remove: (...c) => c.forEach((x) => classes.delete(x)),
      toggle: (c, on) => {
        if (on === undefined) { classes.has(c) ? classes.delete(c) : classes.add(c); } else if (on) { classes.add(c); } else { classes.delete(c); }
      },
      contains: (c) => classes.has(c),
    };
  }
  addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); }
  removeEventListener() {}
  dispatch(type, event) { (this._listeners[type] || []).forEach((fn) => fn(event)); }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  closest() { return null; }
  contains() { return false; }
  appendChild() {} remove() {} focus() {} click() {}
}

const nodes = new Map();
const tabs = ['board', 'list', 'overview'].map((view) => {
  const el = new El('button');
  el.dataset.view = view;
  return el;
});

const realFetch = globalThis.fetch;
globalThis.fetch = (url, opts) => realFetch(typeof url === 'string' && url.startsWith('/') ? BASE + url : url, opts);
globalThis.window = globalThis;
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
globalThis.confirm = () => true;
globalThis.document = {
  documentElement: Object.assign(new El('html'), { dataset: {} }),
  querySelector: (sel) => {
    if (!nodes.has(sel)) nodes.set(sel, new El());
    return nodes.get(sel);
  },
  querySelectorAll: (sel) => (sel === '.tab' ? tabs : []),
  createElement: (tag) => new El(tag),
  addEventListener: () => {},
  activeElement: null,
};

/* ------------------------------------------------------------ 断言工具 */

let pass = 0;
let fail = 0;
const ok = (cond, name, extra = '') => {
  if (cond) { pass += 1; console.log('  ✓', name); } else { fail += 1; console.log('  ✗', name, extra); }
};

const api = async (method, url, body) => {
  const res = await realFetch(BASE + url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
};
const state = () => api('GET', '/api/state');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------ 启动前端 */

const view = document.querySelector('#view');
const projectList = document.querySelector('#project-list');
const search = document.querySelector('#search');
const priority = document.querySelector('#filter-priority');
const fileInput = document.querySelector('#file-input');

eval(fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8'));
await sleep(400);

const cards = () => (view.innerHTML.match(/class="card[ "]/g) || []).length;
const columns = () => (view.innerHTML.match(/class="board-col"/g) || []).length;

console.log('\n[1] 看板视图');
ok(columns() === 4, '渲染 4 个看板列', columns());
ok(cards() === 10, '渲染 10 张任务卡片', cards());
ok(view.innerHTML.includes('待办') && view.innerHTML.includes('已完成'), '列标题为中文');
ok((view.innerHTML.match(/draggable="true"/g) || []).length === 10, '所有卡片可拖拽');
ok(view.innerHTML.includes('pri-high') && view.innerHTML.includes('card-due'), '优先级与截止日期渲染');
ok((view.innerHTML.match(/data-drop=/g) || []).length === 4, '4 个列均为可放置区域');

console.log('\n[2] 侧栏');
ok(projectList.innerHTML.includes('全部任务') && projectList.innerHTML.includes('示例项目'), '侧栏包含全部任务与项目');
ok((projectList.innerHTML.match(/class="project-item/g) || []).length === 3, '侧栏 3 个入口（全部 + 2 个项目）');

console.log('\n[3] 视图切换');
tabs[1]._listeners.click[0]();
ok(view.innerHTML.includes('<table'), '切换到列表视图');
ok((view.innerHTML.match(/<tr data-id/g) || []).length === 10, '列表渲染 10 行');
tabs[2]._listeners.click[0]();
ok(view.innerHTML.includes('stat-grid') && view.innerHTML.includes('项目进度'), '切换到概览视图');
ok(view.innerHTML.includes('已逾期'), '概览包含逾期统计');
tabs[0]._listeners.click[0]();
ok(columns() === 4, '切回看板视图');

console.log('\n[4] 筛选与搜索');
const clickProject = (id) => projectList._listeners.click[0]({ target: { closest: () => ({ dataset: { project: id } }) } });
clickProject('archived');
ok(cards() === 0 && view.innerHTML.includes('拖动任务到此处'), '归档筛选下无任务');
clickProject('all');
search.value = '接口';
search._listeners.input[0]();
await sleep(260);
ok(cards() === 1, '搜索「接口」命中 1 条', cards());
search.value = '';
search._listeners.input[0]();
await sleep(260);
ok(cards() === 10, '清空搜索后恢复 10 条', cards());
priority.value = 'high';
priority._listeners.change[0]();
ok(cards() === 3, '高优先级筛选命中 3 条', cards());
priority.value = 'all';
priority._listeners.change[0]();

console.log('\n[5] 输出转义（XSS 防护）');
const evilProject = await api('POST', '/api/projects', { name: '<img src=x onerror=alert(1)>' });
const evilTask = await api('POST', '/api/tasks', {
  title: '<script>alert(1)</script>',
  projectId: evilProject.id,
  description: '<b onmouseover=alert(2)>粗体</b>',
});
// 通过「导出 -> 导入」触发一次真实重载，让前端拿到最新数据
const dump = await (await realFetch(`${BASE}/api/export`)).text();
fileInput.files = [{ text: async () => dump }];
fileInput.dispatch('change', {});
await sleep(400);
ok(!view.innerHTML.includes('<script>alert(1)</script>'), '任务标题未被注入为真实标签');
ok(view.innerHTML.includes('&lt;script&gt;'), '尖括号被转义');
ok(view.innerHTML.includes('&lt;img src=x onerror=alert(1)&gt;'), '项目名被转义');
ok(!view.innerHTML.includes('<b onmouseover'), '描述中的 HTML 未被注入');
await api('DELETE', `/api/tasks/${evilTask.id}`);
await api('DELETE', `/api/projects/${evilProject.id}`);

console.log('\n[6] 看板拖拽落位');
const before = await state();
const moving = before.tasks.find((t) => t.title === '梳理需求清单');
const doneBefore = before.tasks.filter((t) => t.status === 'done').length;
const cardsBefore = cards();
const targetColumn = {
  dataset: { status: 'done' },
  classList: { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false },
  querySelector: () => ({ querySelectorAll: () => [] }), // 目标列当前为空
  contains: () => false,
};
view._listeners.drop[0]({
  preventDefault() {},
  clientY: 0,
  target: { closest: (sel) => (sel === '.board-col' ? targetColumn : null) },
  dataTransfer: { getData: () => moving.id, dropEffect: '' },
});
await sleep(350);
const after = await state();
ok(after.tasks.find((t) => t.id === moving.id).status === 'done', '拖拽后任务状态更新为 done');
ok(after.tasks.filter((t) => t.status === 'done').length === doneBefore + 1, '目标列任务数 +1');
ok(cards() === cardsBefore, '重绘后卡片总数不变', cards());

console.log(`\n前端测试: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
