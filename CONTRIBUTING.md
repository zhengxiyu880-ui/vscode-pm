# 贡献指南

感谢你想帮他改进这个项目 🙌

## 项目约定

这是一个**刻意保持零依赖**的项目，这是它的核心卖点：

- 后端只用 Node 内置模块（`http` / `fs` / `path` / `crypto`），**不引入 express、不引入数据库驱动**
- 前端是原生 HTML + CSS + JS，**不引入 React / Vue / 打包器**
- 不新增 `dependencies`，不需要 `npm install`，`git clone` 之后 `npm start` 就能跑

如果你的改动需要引入构建步骤或第三方依赖，请先在 Issue 里讨论，大概率会被改成内置实现。

## 开发流程

```bash
git clone <repo>
cd vscode-pm
npm start        # http://127.0.0.1:5177
npm test         # 改完必须跑，全绿再提 PR
npm run check    # 只做语法检查，比测试快
```

数据文件默认是 `data/db.json`（已在 `.gitignore` 里），测试会自己用临时文件，不会污染你的数据。

## 提交 PR

1. Fork → 建分支（`feat/xxx` / `fix/xxx`）
2. 改完跑 `npm run check && npm test`
3. 行为有变化就同步更新 `README.md` 里对应的章节
4. PR 描述里写清：**改了什么、为什么、怎么验证的**（贴一段测试输出最好）

## 代码风格

- 2 空格缩进，字符串统一用单引号，末尾分号
- 后端函数保持小、纯逻辑优先，IO 集中在入口附近
- 前端所有插入 DOM 的用户内容必须经过 `escapeHtml()`
- 新增接口要同时补 `tests/api.test.mjs` 的用例

## 报告问题

请附上：运行环境（系统 / Node 版本）、复现步骤、期望结果、实际结果。界面问题优先附截图。
