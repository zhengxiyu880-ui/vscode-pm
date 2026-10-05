/**
 * 后端接口测试：项目 / 任务 CRUD、看板排序、导入导出、删除级联、静态资源安全。
 *   node tests/api.test.mjs
 */

const BASE = process.env.BASE || 'http://127.0.0.1:5177';

let pass = 0;
let fail = 0;
const ok = (cond, name, extra = '') => {
  if (cond) { pass += 1; console.log('  ✓', name); } else { fail += 1; console.log('  ✗', name, extra); }
};

async function j(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* 无 body */ }
  return { status: res.status, data };
}

console.log('\n[1] 项目 CRUD');
let r = await j('POST', '/api/projects', { name: '冒烟测试项目', description: '自动化验证', color: '#3fb950' });
ok(r.status === 201 && r.data.name === '冒烟测试项目', '创建项目返回 201');
const pid = r.data.id;
ok((await j('POST', '/api/projects', { name: '   ' })).status === 400, '空名称被拒绝 400');
ok((await j('POST', '/api/projects', { name: 'x', color: 'javascript:alert(1)' })).data.color !== 'javascript:alert(1)', '非法颜色被回退');
r = await j('PATCH', `/api/projects/${pid}`, { name: '冒烟测试项目 v2', archived: true });
ok(r.status === 200 && r.data.name === '冒烟测试项目 v2' && r.data.archived === true, '更新名称并归档');
ok((await j('PATCH', '/api/projects/nope', { name: 'x' })).status === 404, '更新不存在的项目 404');

console.log('\n[2] 任务 CRUD 与字段校验');
r = await j('POST', '/api/tasks', { title: '任务A', projectId: pid, priority: 'high', status: 'todo', tags: 'a, b a' });
ok(r.status === 201 && r.data.priority === 'high', '创建任务返回 201');
const t1 = r.data.id;
ok(JSON.stringify(r.data.tags) === JSON.stringify(['a', 'b']), '标签解析并去重', JSON.stringify(r.data.tags));
r = await j('POST', '/api/tasks', { title: '任务B', projectId: pid, status: 'todo' });
const t2 = r.data.id;
{
  const col = (await j('GET', '/api/state')).data.tasks.filter((t) => t.status === 'todo').sort((a, b) => a.order - b.order);
  ok(col[0].id === t2, '新任务排在所在列最前');
  ok(col.every((t, i) => t.order === i), '同列 order 连续编号');
}
ok((await j('POST', '/api/tasks', { title: '' })).status === 400, '空标题被拒绝 400');
ok((await j('POST', '/api/tasks', { title: 'x', projectId: 'p_zzz' })).status === 400, '不存在的项目被拒绝 400');
r = await j('PATCH', `/api/tasks/${t1}`, { status: 'doing', priority: 'low' });
ok(r.status === 200 && r.data.status === 'doing', '任务状态流转');
ok((await j('POST', '/api/tasks', { title: 't', projectId: pid, priority: 'urgent' })).data.priority === 'medium', '非法优先级回退 medium');
ok((await j('POST', '/api/tasks', { title: 't2', projectId: pid, status: 'weird' })).data.status === 'todo', '非法状态回退 todo');
ok((await j('PATCH', '/api/tasks/nope', { title: 'x' })).status === 404, '更新不存在的任务 404');

console.log('\n[3] 看板拖拽排序');
r = await j('POST', '/api/tasks/reorder', { status: 'todo', ids: [t2] });
ok(r.status === 200 && r.data.order[0] === t2, 'reorder 生效');
ok((await j('POST', '/api/tasks/reorder', { status: 'todo', ids: [] })).status === 400, '空 ids 被拒绝 400');
ok((await j('POST', '/api/tasks/reorder', { status: 'bad', ids: [t2] })).status === 400, '非法 status 被拒绝 400');

console.log('\n[4] 导出与导入');
const dump = (await j('GET', '/api/export')).data;
ok(Array.isArray(dump.projects) && Array.isArray(dump.tasks), '导出结构正确');
const imported = await j('POST', '/api/import', dump);
ok(imported.status === 200 && imported.data.tasks.length === dump.tasks.length, '导入回写成功');
ok((await j('POST', '/api/import', { nope: 1 })).status === 400, '非法导入被拒绝 400');
const junk = await j('POST', '/api/import', { projects: [{ name: '来自导入' }], tasks: [{ title: '补齐字段' }] });
ok(junk.status === 200 && Boolean(junk.data.projects[0].id) && junk.data.tasks[0].priority === 'medium', '导入数据被规范化补齐');
ok((await j('POST', '/api/import', dump)).status === 200, '恢复导入前数据');

console.log('\n[5] 删除与级联');
const del = await j('DELETE', `/api/projects/${pid}`);
ok(del.status === 200 && del.data.deletedTasks >= 2, `删除项目级联删除任务（${del.data.deletedTasks} 个）`);
const after = (await j('GET', '/api/state')).data;
ok(!after.tasks.some((t) => t.projectId === pid), '关联任务已清理');
ok((await j('DELETE', '/api/tasks/nope')).status === 404, '删除不存在的任务 404');

console.log('\n[6] 静态资源与路径安全');
ok((await fetch(BASE + '/')).status === 200, '首页可访问');
ok((await fetch(BASE + '/styles.css')).status === 200, '样式表可访问');
ok((await fetch(BASE + '/app.js')).status === 200, '脚本可访问');
const trav = await fetch(BASE + '/../server.js');
ok(trav.status === 404 || trav.status === 403, `路径穿越被拦截（${trav.status}）`);
ok((await fetch(BASE + '/api/state', { method: 'DELETE' })).status === 404, '未知方法返回 404');

console.log(`\n接口测试: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
