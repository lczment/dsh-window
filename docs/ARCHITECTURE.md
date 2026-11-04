# 架构 / Architecture

本文记录两部分如何配合，以及为什么必须修改 DSH 的 Electron 主进程。

## 为什么需要壳扩展

DSH 的插件模型有两半：

- **Host 半**：跑在 DSH 的 Node 子进程里（Cordis 上下文），能注册 Host 服务、HTTP 路由、工具。
- **Client 半**：跑在渲染进程里，通过 `ctx.slots.register` 往界面插槽里渲染组件。

窗口本身属于 **Electron 主进程**。DSH 现有的 preload（`lib/preload-app.cjs`）只暴露了 `dshDesktop`（快捷键、更新、设备信息）、`dshPlatform`、`dshDesktopBoot` 等，没有“退出应用”“隐藏窗口”“新建窗口”“读取/写入关闭策略”的通道。插件两半都拿不到这些能力，所以壳扩展通过补丁把能力补上：

```
plugin (Host)  ── HTTP /dsh-window/* ──►  页面 fetch（同源转发）
plugin (Client) ── window.dshWindow ──►  preload ── IPC ──► shell/install.mjs
```

## 共享策略文件

两侧都读写同一个 JSON：

```
%DSH_HOME%\desktop\window-policy.json      (DSH_HOME 缺省为 %USERPROFILE%\.dsh)
{ "closeAction": "ask" | "background" | "quit" }
```

- 壳扩展启动时读取一次，之后每次关闭窗口前重读（外部改文件也能生效）。
- 设置页通过 `window.dshWindow.setPolicy` 写入；勾选“记住我的选择”时由壳扩展写入。
- 写入后壳扩展广播 `dsh-window:policy-changed`，所有窗口同步刷新。

## 关闭流程

1. 用户点关闭 → 主进程 `window.on("close")`。
2. 补丁插入的一行：`if (globalThis.__dshWindowClose?.(window) === true) return;`。
3. 壳扩展按 `closeAction` 决策：
   - `background` → `window.hide()`（进程、Agent、任务继续）；
   - `quit` → `app.quit()`（仍会走 DSH 原有的“有任务在跑”确认）；
   - `ask` → 调页面里的 `window.__dshWindowPrompt()`（设置页同款弹窗），返回 `{choice, remember}`；
     - 前端未就绪 / 返回无效 → 回退 `dialog.showMessageBox` 原生框；
     - `remember` 为真时写策略文件；
     - `cancel` 则不关闭。
4. 返回 `true` 表示壳扩展已处理，不再执行 DSH 原本的“隐藏 + 一次性提示”。

## 子窗口

- 由壳扩展创建 `BrowserWindow`，沿用同一 preload 与 `webPreferences`（`contextIsolation`、`sandbox`、关闭 `nodeIntegration`）。
- 地址：`dsh-app://app/?dshWin=session&id=<sessionId>` 或 `?dshWin=workspace&workspaceId=<workspaceId>`。
- Client 半在启动时读取 query，调用 `uiWorkspace.openSession(id)` / `uiWorkspace.openWorkspace(id)`，并在连接未就绪时重试。
- 子窗口与主窗口共享同一个 Electron session（登录 cookie）与同一个 Host 连接（`ws://127.0.0.1:<port>/api/remote.mux`）。

## 主进程补丁清单

安装器 `tools/install-shell-extension.mjs` 对解包后的 `lib/main.js` / `lib/preload-app.cjs` 做定点替换，每处都有 anchor 与幂等 marker，找不到 anchor 就报错而不是瞎改：

| 补丁 | 作用 |
| --- | --- |
| `dsh-window close hook` | `close` 事件里让位给壳扩展 |
| `dsh-window streams` | WebSocket 头注入的白名单接受已登记子窗口的 `webContents.id` |
| `dsh-window boot-injections` | 每个窗口启动时向 Host 重新取注入表，避免拿到过期 bundle 版本 |
| `dsh-window boot-failed` | 子窗口启动失败不再被主窗口专属的校验吞掉，改为回调日志/弹窗 |
| `dsh-window ws log` | 子窗口 WS 升级写入 `extension.log`，便于排障 |
| `dsh-window: locale bootstrap` | 允许任意 `dsh-app://app` 帧读语言（否则子窗口 locale 插件失败，全部插件卡在 `Loading plugins…`） |
| `dsh-window: locale change` | 同上，语言切换广播 |
| `dsh-window: product sender` | `assertProductSender` 接受已登记子窗口（设备信息、更新、浏览器等） |
| `dsh-window: shortcuts` | 快捷键 IPC 接受子窗口 |
| `dsh-window: directory picker` | 目录选择器接受子窗口 |
| `dsh-window bridge`（preload） | 暴露 `window.dshWindow`：`getPolicy/setPolicy/open/list/focus/close` |

## 安装/切换机制

Windows 上运行中的应用会占用 `resources/app.asar`，无法直接替换。安装器分两步：

1. `--stage-only`：解包到 `resources/app`、叠加 `app.asar.unpacked`、打补丁、写入 `resources/dsh-window-extension`，并留下 `.dsh-window-pending` 标记。
2. 计划任务每分钟运行 `tools/complete-shell-extension.vbs`（隐藏窗口）：
   - 应用还开着（`app.asar` 被占用）→ 静默退出；
   - 应用已退出 → `app.asar` 改名为 `app.asar.orig`，启动应用；
   - 75 秒内扩展没写安装日志 → 杀掉进程、还原 `app.asar`、重启原版、删除任务。

成功时任务自删，不会常驻。

## Host 路由

`index.js` 注册在 DSH `webServer` 上（`dsh-app://app` 会把未知路径同源转发到 Host）：

- `GET /dsh-window/policy` → `{policy:{closeAction}}`
- `POST /dsh-window/policy` → 校验 `closeAction`，写入后返回 `{policy}`
- `GET /dsh-window/targets` → `{workspaces:[{id,title,path,sessions:[{id,title}]}]}`
- `GET /dsh-window/boot-injections` → `{injections}`（每次请求重新收集，供子窗口启动用）

## 失败模式

- 壳扩展未安装 / DSH 升级后失效：设置页红字提示，多开按钮只弹提示，关闭走原行为。
- 前端未加载完就关闭：回退原生对话框。
- 补丁 anchor 不匹配（DSH 改了这段代码）：安装器失败并保留原 `app.asar`，不会产生半坏状态。
