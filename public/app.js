/* ==========================================================================
   项目管理系统 · 前端逻辑
   原生 JS，无构建步骤。视图由「状态 + 渲染函数」驱动，交互后整体重绘。
   ========================================================================== */

(() => {
  'use strict';

  const STATUSES = [
    { key: 'todo', label: '待办', color: '#8c8c8c' },
    { key: 'doing', label: '进行中', color: '#4f9cf9' },
    { key: 'review', label: '待评审', color: '#a371f7' },
    { key: 'done', label: '已完成', color: '#3fb950' },
  ];

  const STATUS_MAP = Object.fromEntries(STATUSES.map((s) => [s.key, s]));

  const PRIORITIES = {
    high: { label: '高', cls: 'pri-high', rank: 0 },
    medium: { label: '中', cls: 'pri-medium', rank: 1 },
    low: { label: '低', cls: 'pri-low', rank: 2 },
  };

  const COLORS = ['#4f9cf9', '#7c6cf5', '#e06c9f', '#e2a03f', '#3fb950', '#2bb3a3', '#e05c5c', '#8c8c8c'];

  const state = {
    projects: [],
    tasks: [],
    view: 'board',
    projectFilter: 'all',
    query: '',
    priority: 'all',
    sort: 'manual',
    dragId: null,
    loading: true,
  };

  const $ = (sel) => document.querySelector(sel);

  const els = {
    projectList: $('#project-list'),
    projectTotal: $('#project-total'),
    view: $('#view'),
    search: $('#search'),
    priority: $('#filter-priority'),
    sort: $('#filter-sort'),
    clear: $('#btn-clear'),
    modalRoot: $('#modal-root'),
    toastRoot: $('#toast-root'),
    fileInput: $('#file-input'),
    theme: $('#btn-theme'),
  };

  /* ------------------------------------------------------------- 基础工具 */

  const esc = (value) =>
    String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);

  const safeColor = (c) => (/^#[0-9a-fA-F]{3,8}$/.test(String(c || '')) ? c : COLORS[0]);

  const projectById = (id) => state.projects.find((p) => p.id === id) || null;

  const todayStr = () => new Date().toISOString().slice(0, 10);

  function formatDue(due) {
    if (!due) return '';
    const today = todayStr();
    if (due === today) return '今天';
    const date = new Date(`${due}T00:00:00`);
    if (Number.isNaN(date.getTime())) return due;
    const sameYear = date.getFullYear() === new Date().getFullYear();
    const text = `${sameYear ? '' : `${date.getFullYear()}-`}${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const diff = Math.round((date - new Date(`${today}T00:00:00`)) / 86400000);
    if (diff === 1) return '明天';
    if (diff === -1) return '昨天';
    return text;
  }

  function dueState(task) {
    if (!task.due || task.status === 'done') return '';
    const diff = Math.round((new Date(`${task.due}T00:00:00`) - new Date(`${todayStr()}T00:00:00`)) / 86400000);
    if (Number.isNaN(diff)) return '';
    if (diff < 0) return 'is-overdue';
    if (diff <= 2) return 'is-soon';
    return '';
  }

  function toast(message, type = 'info') {
    const node = document.createElement('div');
    node.className = `toast ${type}`;
    node.textContent = message;
    els.toastRoot.appendChild(node);
    setTimeout(() => {
      node.classList.add('is-hidden');
      setTimeout(() => node.remove(), 220);
    }, 2400);
  }

  async function api(method, path, body) {
    const res = await fetch(path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error((data && data.message) || `请求失败（${res.status}）`);
    return data;
  }

  /* ------------------------------------------------------------- 数据筛选 */

  function sortedTasks(list) {
    const byOrder = (a, b) => (Number(a.order) || 0) - (Number(b.order) || 0);
    const clone = [...list];
    switch (state.sort) {
      case 'due':
        return clone.sort((a, b) => {
          if (!a.due && !b.due) return byOrder(a, b);
          if (!a.due) return 1;
          if (!b.due) return -1;
          return a.due.localeCompare(b.due) || byOrder(a, b);
        });
      case 'priority':
        return clone.sort((a, b) => (PRIORITIES[a.priority]?.rank ?? 9) - (PRIORITIES[b.priority]?.rank ?? 9) || byOrder(a, b));
      case 'created':
        return clone.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      default:
        return clone.sort(byOrder);
    }
  }

  function currentTasks() {
    let list = state.tasks;

    if (state.projectFilter === 'all') {
      list = list.filter((t) => {
        const p = projectById(t.projectId);
        return !p || !p.archived;
      });
    } else if (state.projectFilter === 'archived') {
      list = list.filter((t) => projectById(t.projectId)?.archived);
    } else {
      list = list.filter((t) => t.projectId === state.projectFilter);
    }

    if (state.priority !== 'all') list = list.filter((t) => t.priority === state.priority);

    const q = state.query.trim().toLowerCase();
    if (q) {
      list = list.filter((t) => {
        const haystack = [t.title, t.description, (t.tags || []).join(' '), projectById(t.projectId)?.name || '']
          .join(' ')
          .toLowerCase();
        return haystack.includes(q);
      });
    }

    return sortedTasks(list);
  }

  const hasFilter = () => Boolean(state.query.trim()) || state.priority !== 'all';

  /* ------------------------------------------------------------- 渲染 */

  function render() {
    renderSidebar();
    renderView();
    els.clear.hidden = !hasFilter();
    els.priority.value = state.priority;
    els.sort.value = state.sort;
    document.querySelectorAll('.tab').forEach((tab) => {
      tab.classList.toggle('is-active', tab.dataset.view === state.view);
    });
  }

  function renderSidebar() {
    const active = state.projects.filter((p) => !p.archived);
    const archived = state.projects.filter((p) => p.archived);
    const countFor = (id) => state.tasks.filter((t) => t.projectId === id).length;
    const allCount = state.tasks.filter((t) => {
      const p = projectById(t.projectId);
      return !p || !p.archived;
    }).length;

    const item = (id, name, color, count, active_) => `
      <button class="project-item${active_ ? ' is-active' : ''}" type="button" data-project="${esc(id)}">
        <span class="swatch" style="--swatch:${safeColor(color)}"></span>
        <span class="name">${esc(name)}</span>
        <span class="badge-count">${count}</span>
      </button>`;

    const parts = [item('all', '全部任务', COLORS[0], allCount, state.projectFilter === 'all')];

    if (!active.length && !archived.length) {
      parts.push('<div class="sidebar-empty">还没有项目，点击右上角「＋ 项目」创建。</div>');
    }

    parts.push(...active.map((p) => item(p.id, p.name, p.color, countFor(p.id), state.projectFilter === p.id)));

    if (archived.length) {
      parts.push(`<div class="project-group-title">已归档</div>`);
      parts.push(...archived.map((p) => item(p.id, p.name, p.color, countFor(p.id), state.projectFilter === p.id)));
      const archivedTasks = state.tasks.filter((t) => projectById(t.projectId)?.archived).length;
      parts.push(item('archived', '全部已归档', COLORS[7], archivedTasks, state.projectFilter === 'archived'));
    }

    els.projectList.innerHTML = parts.join('');
    els.projectTotal.textContent = String(state.projects.length);
  }

  function renderView() {
    if (state.loading) {
      els.view.className = 'view';
      els.view.innerHTML = '<div class="empty"><div class="title">正在加载…</div></div>';
      return;
    }
    if (state.view === 'overview') {
      els.view.className = 'view';
      els.view.innerHTML = renderOverview();
      return;
    }
    if (state.view === 'list') {
      els.view.className = 'view';
      els.view.innerHTML = renderList();
      return;
    }
    els.view.className = 'view board';
    els.view.innerHTML = renderBoard();
  }

  /* ---------------------------------------------------------- 看板视图 */

  function renderBoard() {
    const tasks = currentTasks();

    const columns = STATUSES.map((status) => {
      const col = tasks.filter((t) => t.status === status.key);
      const cards = col.length
        ? col.map((t) => renderCard(t)).join('')
        : '<div class="board-col-empty">拖动任务到此处</div>';
      return `
        <section class="board-col" data-status="${status.key}">
          <header class="board-col-head">
            <span class="col-dot" style="background:${status.color}"></span>
            <span>${status.label}</span>
            <span class="col-count">${col.length}</span>
          </header>
          <div class="board-col-body" data-drop="${status.key}">${cards}</div>
        </section>`;
    }).join('');

    if (!state.tasks.length) {
      return `<div class="empty">
        <div class="title">还没有任何任务</div>
        <div class="hint">先创建一个项目，再添加任务；任务可以在看板中拖拽流转。</div>
        <button class="btn primary" type="button" data-action="new-task">＋ 新建任务</button>
      </div>`;
    }

    return `<div class="board-grid">${columns}</div>`;
  }

  function renderCard(task) {
    const project = projectById(task.projectId);
    const priority = PRIORITIES[task.priority] || PRIORITIES.medium;
    const tags = (task.tags || []).map((tag) => `<span class="pill tag">${esc(tag)}</span>`).join('');
    const due = task.due
      ? `<span class="card-due ${dueState(task)}">${esc(formatDue(task.due))}</span>`
      : '';

    return `
      <article class="card${task.status === 'done' ? ' is-done' : ''}" draggable="true" data-id="${esc(task.id)}" tabindex="0">
        <div class="card-title">${esc(task.title)}</div>
        ${task.description ? `<div class="card-desc">${esc(task.description)}</div>` : ''}
        ${tags ? `<div class="card-tags">${tags}</div>` : ''}
        <div class="card-foot">
          ${project ? `<span class="card-project"><span class="swatch" style="background:${safeColor(project.color)}"></span><span>${esc(project.name)}</span></span>` : ''}
          <span class="card-meta">
            ${due}
            <span class="pill ${priority.cls}">${priority.label}</span>
          </span>
        </div>
      </article>`;
  }

  /* ---------------------------------------------------------- 列表视图 */

  function renderList() {
    const tasks = currentTasks();
    if (!tasks.length) return emptyState('没有符合条件的任务');

    const rows = tasks.map((task) => {
      const project = projectById(task.projectId);
      const priority = PRIORITIES[task.priority] || PRIORITIES.medium;
      const status = STATUS_MAP[task.status] || STATUS_MAP.todo;
      const tags = (task.tags || []).map((tag) => `<span class="pill tag">${esc(tag)}</span>`).join('') || '<span class="muted">—</span>';
      return `
        <tr data-id="${esc(task.id)}" class="${task.status === 'done' ? 'row-done' : ''}">
          <td class="col-title">${esc(task.title)}</td>
          <td>${project ? `<span class="card-project"><span class="swatch" style="background:${safeColor(project.color)}"></span><span>${esc(project.name)}</span></span>` : '<span class="muted">—</span>'}</td>
          <td><span class="pill status-${status.key}">${status.label}</span></td>
          <td><span class="pill ${priority.cls}">${priority.label}</span></td>
          <td class="${dueState(task) === 'is-overdue' ? 'card-due is-overdue' : 'muted'}">${task.due ? esc(formatDue(task.due)) : '—'}</td>
          <td><div class="tags-cell">${tags}</div></td>
          <td class="col-actions"><button class="row-del" type="button" data-del="${esc(task.id)}" title="删除任务">✕</button></td>
        </tr>`;
    }).join('');

    return `
      <div class="list-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>任务</th><th>项目</th><th>状态</th><th>优先级</th><th>截止</th><th>标签</th><th></th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  function emptyState(title, hint) {
    return `<div class="empty">
      <div class="title">${esc(title)}</div>
      ${hint ? `<div class="hint">${esc(hint)}</div>` : ''}
      ${hasFilter() ? '<button class="btn ghost" type="button" data-action="clear-filter">清除筛选</button>' : ''}
    </div>`;
  }

  /* ---------------------------------------------------------- 概览视图 */

  function renderOverview() {
    const tasks = state.tasks;
    const activeProjects = state.projects.filter((p) => !p.archived);
    const done = tasks.filter((t) => t.status === 'done').length;
    const doing = tasks.filter((t) => t.status === 'doing' || t.status === 'review').length;
    const overdue = tasks.filter((t) => t.status !== 'done' && t.due && t.due < todayStr()).length;
    const rate = tasks.length ? Math.round((done / tasks.length) * 100) : 0;

    const stats = [
      { label: '进行中的项目', value: activeProjects.length },
      { label: '全部任务', value: tasks.length },
      { label: '进行中 / 待评审', value: doing, cls: 'is-accent' },
      { label: '已完成', value: `${done}<span class="pct">${rate}%</span>` },
      { label: '已逾期', value: overdue, cls: overdue ? 'is-danger' : '' },
    ];

    const statHtml = stats
      .map((s) => `<div class="stat"><div class="label">${s.label}</div><div class="value ${s.cls || ''}">${s.value}</div></div>`)
      .join('');

    const byStatus = (list) => STATUSES.map((s) => list.filter((t) => t.status === s.key).length);

    const rows = activeProjects
      .map((project) => {
        const list = tasks.filter((t) => t.projectId === project.id);
        const counts = byStatus(list);
        const total = list.length;
        const segments = total
          ? STATUSES.map((s, i) => (counts[i] ? `<i style="width:${(counts[i] / total) * 100}%;background:${s.color}"></i>` : '')).join('')
          : '';
        const doneCount = counts[3];
        return `
          <div class="progress-row">
            <div class="progress-top">
              <span class="swatch" style="--swatch:${safeColor(project.color)};width:8px;height:8px;border-radius:50%;background:${safeColor(project.color)}"></span>
              <span class="name">${esc(project.name)}</span>
              <span class="meta">${doneCount}/${total} 已完成</span>
            </div>
            <div class="bar">${segments}</div>
          </div>`;
      })
      .join('');

    const projectPanel = activeProjects.length
      ? `<div class="panel">
           <div class="panel-head">项目进度</div>
           <div class="panel-body">
             ${rows}
             <div class="legend">${STATUSES.map((s) => `<span><i style="background:${s.color}"></i>${s.label}</span>`).join('')}</div>
           </div>
         </div>`
      : '';

    const recent = [...tasks].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, 5);
    const recentPanel = recent.length
      ? `<div class="panel">
           <div class="panel-head">最近更新</div>
           <div class="panel-body">
             ${recent
               .map((t) => {
                 const project = projectById(t.projectId);
                 const status = STATUS_MAP[t.status] || STATUS_MAP.todo;
                 return `<div class="progress-row" style="display:flex;align-items:center;gap:8px">
                   <span class="pill status-${status.key}">${status.label}</span>
                   <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t.title)}</span>
                   <span class="meta" style="font-size:11px;color:var(--text-faint)">${esc(project ? project.name : '未归类')}</span>
                 </div>`;
               })
               .join('')}
           </div>
         </div>`
      : '';

    return `<div class="overview">
      <div class="stat-grid">${statHtml}</div>
      ${projectPanel}
      ${recentPanel}
    </div>`;
  }

  /* ------------------------------------------------------------- 弹窗 */

  function closeModal() {
    els.modalRoot.innerHTML = '';
    document.removeEventListener('keydown', onModalKey);
  }

  function onModalKey(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeModal();
    }
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      const form = els.modalRoot.querySelector('form');
      if (form) {
        event.preventDefault();
        form.requestSubmit();
      }
    }
  }

  function openModal(html) {
    els.modalRoot.innerHTML = `<div class="modal-mask"><div class="modal" role="dialog" aria-modal="true">${html}</div></div>`;
    const mask = els.modalRoot.querySelector('.modal-mask');
    mask.addEventListener('mousedown', (event) => {
      if (event.target === mask) closeModal();
    });
    els.modalRoot.querySelectorAll('[data-close]').forEach((btn) => btn.addEventListener('click', closeModal));
    document.addEventListener('keydown', onModalKey);
    const first = els.modalRoot.querySelector('input, textarea, select');
    if (first) setTimeout(() => first.focus(), 30);
  }

  function projectOptions(selectedId) {
    const active = state.projects.filter((p) => !p.archived);
    const archived = state.projects.filter((p) => p.archived);
    const opt = (p) => `<option value="${esc(p.id)}"${p.id === selectedId ? ' selected' : ''}>${esc(p.name)}</option>`;
    return `<option value=""${selectedId ? '' : ' selected'}>未归类</option>
      ${active.map(opt).join('')}
      ${archived.length ? `<optgroup label="已归档">${archived.map(opt).join('')}</optgroup>` : ''}`;
  }

  function openTaskModal(task, presetStatus) {
    const editing = Boolean(task);
    const draft = task || {
      title: '',
      description: '',
      projectId: state.projectFilter !== 'all' && state.projectFilter !== 'archived' ? state.projectFilter : '',
      status: presetStatus || 'todo',
      priority: 'medium',
      due: '',
      tags: [],
    };

    openModal(`
      <form>
        <div class="modal-head">
          ${editing ? '编辑任务' : '新建任务'}
          <button class="icon-btn modal-x" type="button" data-close aria-label="关闭">✕</button>
        </div>
        <div class="modal-body">
          <div class="field">
            <label for="f-title">标题 *</label>
            <input id="f-title" class="input" name="title" maxlength="200" required placeholder="例如：完成登录页联调" value="${esc(draft.title)}">
          </div>
          <div class="field">
            <label for="f-desc">描述</label>
            <textarea id="f-desc" class="textarea" name="description" maxlength="2000" placeholder="补充背景、验收标准…">${esc(draft.description)}</textarea>
          </div>
          <div class="field-row">
            <div class="field">
              <label for="f-project">所属项目</label>
              <select id="f-project" class="select" name="projectId" style="height:34px">${projectOptions(draft.projectId)}</select>
            </div>
            <div class="field">
              <label for="f-status">状态</label>
              <select id="f-status" class="select" name="status" style="height:34px">
                ${STATUSES.map((s) => `<option value="${s.key}"${s.key === draft.status ? ' selected' : ''}>${s.label}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="field-row">
            <div class="field">
              <label for="f-priority">优先级</label>
              <select id="f-priority" class="select" name="priority" style="height:34px">
                ${Object.entries(PRIORITIES).map(([key, p]) => `<option value="${key}"${key === draft.priority ? ' selected' : ''}>${p.label}</option>`).join('')}
              </select>
            </div>
            <div class="field">
              <label for="f-due">截止日期</label>
              <input id="f-due" class="input" type="date" name="due" value="${esc(draft.due || '')}">
            </div>
          </div>
          <div class="field">
            <label for="f-tags">标签</label>
            <input id="f-tags" class="input" name="tags" placeholder="用逗号或空格分隔，最多 8 个" value="${esc((draft.tags || []).join(', '))}">
          </div>
        </div>
        <div class="modal-foot">
          ${editing ? '<button class="btn danger" type="button" data-delete>删除</button>' : ''}
          <span class="spacer"></span>
          <button class="btn ghost" type="button" data-close>取消</button>
          <button class="btn primary" type="submit">${editing ? '保存' : '创建'}</button>
        </div>
      </form>`);

    const form = els.modalRoot.querySelector('form');
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(form).entries());
      if (!String(data.title || '').trim()) return toast('请填写任务标题', 'error');
      try {
        if (editing) {
          await api('PATCH', `/api/tasks/${task.id}`, data);
          toast('任务已更新', 'success');
        } else {
          await api('POST', '/api/tasks', data);
          toast('任务已创建', 'success');
        }
        closeModal();
        await load();
      } catch (err) {
        toast(err.message, 'error');
      }
    });

    const del = els.modalRoot.querySelector('[data-delete]');
    if (del) {
      del.addEventListener('click', async () => {
        if (!window.confirm(`确定删除任务「${task.title}」？`)) return;
        try {
          await api('DELETE', `/api/tasks/${task.id}`);
          toast('任务已删除', 'success');
          closeModal();
          await load();
        } catch (err) {
          toast(err.message, 'error');
        }
      });
    }
  }

  function openProjectModal(project) {
    const editing = Boolean(project);
    const draft = project || { name: '', description: '', color: COLORS[state.projects.length % COLORS.length], archived: false };
    let color = safeColor(draft.color);

    openModal(`
      <form>
        <div class="modal-head">
          ${editing ? '编辑项目' : '新建项目'}
          <button class="icon-btn modal-x" type="button" data-close aria-label="关闭">✕</button>
        </div>
        <div class="modal-body">
          <div class="field">
            <label for="p-name">项目名称 *</label>
            <input id="p-name" class="input" name="name" maxlength="80" required placeholder="例如：官网改版" value="${esc(draft.name)}">
          </div>
          <div class="field">
            <label for="p-desc">项目描述</label>
            <textarea id="p-desc" class="textarea" name="description" maxlength="500" placeholder="一句话说明项目目标…">${esc(draft.description)}</textarea>
          </div>
          <div class="field">
            <label>标识色</label>
            <div class="color-row">
              ${COLORS.map((c) => `<button type="button" class="color-dot${c === color ? ' is-active' : ''}" style="--swatch:${c}" data-color="${c}" aria-label="选择颜色 ${c}"></button>`).join('')}
            </div>
            <input type="hidden" name="color" value="${color}">
          </div>
          ${editing ? `
          <div class="field">
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
              <input type="checkbox" name="archived" ${draft.archived ? 'checked' : ''}>
              <span>归档该项目（从看板默认视图隐藏）</span>
            </label>
          </div>` : ''}
        </div>
        <div class="modal-foot">
          ${editing ? '<button class="btn danger" type="button" data-delete>删除</button>' : ''}
          <span class="spacer"></span>
          <button class="btn ghost" type="button" data-close>取消</button>
          <button class="btn primary" type="submit">${editing ? '保存' : '创建'}</button>
        </div>
      </form>`);

    const form = els.modalRoot.querySelector('form');
    const colorInput = form.querySelector('input[name="color"]');

    form.querySelectorAll('.color-dot').forEach((dot) => {
      dot.addEventListener('click', () => {
        color = dot.dataset.color;
        colorInput.value = color;
        form.querySelectorAll('.color-dot').forEach((d) => d.classList.toggle('is-active', d === dot));
      });
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(form).entries());
      if (!String(data.name || '').trim()) return toast('请填写项目名称', 'error');
      const payload = { name: data.name, description: data.description, color: data.color, archived: Boolean(data.archived) };
      try {
        if (editing) {
          await api('PATCH', `/api/projects/${project.id}`, payload);
          toast('项目已更新', 'success');
        } else {
          await api('POST', '/api/projects', payload);
          toast('项目已创建', 'success');
        }
        closeModal();
        await load();
      } catch (err) {
        toast(err.message, 'error');
      }
    });

    const del = els.modalRoot.querySelector('[data-delete]');
    if (del) {
      del.addEventListener('click', async () => {
        const count = state.tasks.filter((t) => t.projectId === project.id).length;
        const warning = count
          ? `确定删除项目「${project.name}」？其下 ${count} 个任务也会被一并删除。`
          : `确定删除项目「${project.name}」？`;
        if (!window.confirm(warning)) return;
        try {
          await api('DELETE', `/api/projects/${project.id}`);
          if (state.projectFilter === project.id) state.projectFilter = 'all';
          toast('项目已删除', 'success');
          closeModal();
          await load();
        } catch (err) {
          toast(err.message, 'error');
        }
      });
    }
  }

  /* ------------------------------------------------------------- 事件 */

  function bindEvents() {
    // 视图切换
    document.querySelectorAll('.tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        state.view = tab.dataset.view;
        render();
      });
    });

    // 侧栏项目筛选
    els.projectList.addEventListener('click', (event) => {
      const item = event.target.closest('.project-item');
      if (!item) return;
      state.projectFilter = item.dataset.project;
      render();
    });

    // 搜索与筛选
    let searchTimer = null;
    els.search.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        state.query = els.search.value;
        render();
      }, 120);
    });

    els.priority.addEventListener('change', () => {
      state.priority = els.priority.value;
      render();
    });

    els.sort.addEventListener('change', () => {
      state.sort = els.sort.value;
      render();
    });

    els.clear.addEventListener('click', () => {
      els.search.value = '';
      state.query = '';
      state.priority = 'all';
      render();
    });

    // 新建
    $('#btn-new-task').addEventListener('click', () => openTaskModal(null));
    $('#btn-new-project').addEventListener('click', () => openProjectModal(null));

    // 主题
    els.theme.addEventListener('click', () => {
      const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      localStorage.setItem('pm-theme', next);
    });

    // 主区域交互（事件委托）
    els.view.addEventListener('click', async (event) => {
      const action = event.target.closest('[data-action]');
      if (action) {
        const name = action.dataset.action;
        if (name === 'new-task') openTaskModal(null);
        if (name === 'clear-filter') {
          els.search.value = '';
          state.query = '';
          state.priority = 'all';
          render();
        }
        return;
      }

      const del = event.target.closest('[data-del]');
      if (del) {
        event.stopPropagation();
        const task = state.tasks.find((t) => t.id === del.dataset.del);
        if (task && window.confirm(`确定删除任务「${task.title}」？`)) {
          try {
            await api('DELETE', `/api/tasks/${task.id}`);
            toast('任务已删除', 'success');
            await load();
          } catch (err) {
            toast(err.message, 'error');
          }
        }
        return;
      }

      const card = event.target.closest('.card');
      if (card) {
        openTaskModal(state.tasks.find((t) => t.id === card.dataset.id));
        return;
      }

      const row = event.target.closest('tbody tr[data-id]');
      if (row) openTaskModal(state.tasks.find((t) => t.id === row.dataset.id));
    });

    // 回车打开卡片
    els.view.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      const card = event.target.closest('.card');
      if (card) openTaskModal(state.tasks.find((t) => t.id === card.dataset.id));
    });

    // 拖拽
    els.view.addEventListener('dragstart', (event) => {
      const card = event.target.closest('.card');
      if (!card) return;
      state.dragId = card.dataset.id;
      card.classList.add('is-dragging');
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', card.dataset.id);
      }
    });

    els.view.addEventListener('dragend', () => {
      state.dragId = null;
      els.view.querySelectorAll('.card.is-dragging').forEach((c) => c.classList.remove('is-dragging'));
      els.view.querySelectorAll('.board-col.is-over').forEach((c) => c.classList.remove('is-over'));
    });

    els.view.addEventListener('dragover', (event) => {
      const col = event.target.closest('.board-col');
      if (!col) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      els.view.querySelectorAll('.board-col.is-over').forEach((c) => c.classList.toggle('is-over', c === col));
    });

    els.view.addEventListener('dragleave', (event) => {
      const col = event.target.closest('.board-col');
      if (col && !col.contains(event.relatedTarget)) col.classList.remove('is-over');
    });

    els.view.addEventListener('drop', async (event) => {
      const col = event.target.closest('.board-col');
      if (!col) return;
      event.preventDefault();
      col.classList.remove('is-over');

      const dragId = state.dragId || (event.dataTransfer && event.dataTransfer.getData('text/plain'));
      const status = col.dataset.status;
      if (!dragId || !STATUS_MAP[status]) return;

      const body = col.querySelector('.board-col-body');
      const others = [...body.querySelectorAll('.card')].filter((c) => c.dataset.id !== dragId);
      let index = others.length;
      for (let i = 0; i < others.length; i += 1) {
        const rect = others[i].getBoundingClientRect();
        if (event.clientY < rect.top + rect.height / 2) {
          index = i;
          break;
        }
      }

      const ids = others.map((c) => c.dataset.id);
      ids.splice(index, 0, dragId);

      // 乐观更新后再同步到服务端
      ids.forEach((id, i) => {
        const task = state.tasks.find((t) => t.id === id);
        if (task) {
          task.status = status;
          task.order = i;
        }
      });
      state.dragId = null;
      render();

      try {
        await api('POST', '/api/tasks/reorder', { status, ids });
      } catch (err) {
        toast(err.message, 'error');
        await load();
      }
    });

    // 全局快捷键
    document.addEventListener('keydown', (event) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
      if (event.key === '/' && !typing && !els.modalRoot.innerHTML) {
        event.preventDefault();
        els.search.focus();
      }
      if (event.key.toLowerCase() === 'n' && !typing && !event.metaKey && !event.ctrlKey && !els.modalRoot.innerHTML) {
        event.preventDefault();
        openTaskModal(null);
      }
    });

    // 导入导出
    $('#btn-export').addEventListener('click', async () => {
      try {
        const data = await api('GET', '/api/export');
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `项目数据-${todayStr()}.json`;
        link.click();
        URL.revokeObjectURL(url);
        toast('已导出数据', 'success');
      } catch (err) {
        toast(err.message, 'error');
      }
    });

    $('#btn-import').addEventListener('click', () => els.fileInput.click());

    els.fileInput.addEventListener('change', async () => {
      const file = els.fileInput.files && els.fileInput.files[0];
      els.fileInput.value = '';
      if (!file) return;
      try {
        const text = await file.text();
        const payload = JSON.parse(text);
        if (!window.confirm('导入会覆盖当前全部数据，确定继续？')) return;
        await api('POST', '/api/import', payload);
        toast('数据已导入', 'success');
        state.projectFilter = 'all';
        await load();
      } catch (err) {
        toast(`导入失败：${err.message}`, 'error');
      }
    });
  }

  /* ------------------------------------------------------------- 启动 */

  async function load() {
    try {
      const data = await api('GET', '/api/state');
      state.projects = data.projects || [];
      state.tasks = data.tasks || [];
      state.loading = false;
      if (state.projectFilter !== 'all' && state.projectFilter !== 'archived' && !projectById(state.projectFilter)) {
        state.projectFilter = 'all';
      }
      render();
    } catch (err) {
      state.loading = false;
      els.view.className = 'view';
      els.view.innerHTML = `<div class="empty">
        <div class="title">无法连接后端服务</div>
        <div class="hint">${esc(err.message)}。请确认已运行 <code>npm start</code>。</div>
      </div>`;
      toast(err.message, 'error');
    }
  }

  function init() {
    const saved = localStorage.getItem('pm-theme');
    if (saved === 'light' || saved === 'dark') document.documentElement.dataset.theme = saved;
    bindEvents();
    load();
  }

  init();
})();
