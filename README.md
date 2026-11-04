# DSH Window

给 **DeepSeek Harness Desktop** 加两件事：关闭窗口时由你决定「最小化到后台」还是「完全退出」，以及把某个会话 / 整个工作区丢进独立子窗口。

A small add-on for **DeepSeek Harness Desktop**: choose what closing the window does, and open a session or a whole workspace in its own child window.

> 这是第三方扩展，不是 DeepSeek 官方组件。它会修改本机 DeepSeek Harness 的 `resources/app`（见“安装”），升级 DSH 后需要重跑一次安装脚本。 / This is a third-party add-on. It patches the local DeepSeek Harness `resources/app` (see *Install*) and must be re-applied after a DSH update.

---

## 功能 / Features

| | |
|---|---|
| **关闭行为可选** | 关闭主窗口时弹出与主界面同风格的对话框：最小化到后台 / 完全退出 / 取消，可勾选「记住我的选择」。 |
| **设置页** | 设置 → 「窗口与多开」：三个选项（每次询问 / 最小化到后台 / 完全退出），立即生效，和关闭对话框共用同一份配置。 |
| **侧栏快捷入口** | 侧栏底部、设置齿轮上方新增「多开」按钮（窄栏时只显示图标），点开即可改关闭行为或把目标丢进子窗口。 |
| **每会话独立窗口** | 会话行悬停时在「…」菜单旁出现一个窗口图标，点击即把该会话开进新窗口。 |
| **工作区整窗** | 设置页里每个工作区都有 **Open workspace**，把整个工作区开进新窗口。 |
| **后台保活** | 选「最小化到后台」后进程与 Agent 继续运行，托盘图标可重新打开或退出。 |
| **悬停动效** | 插件内按钮带 120ms 过渡；系统开启「减少动画」时自动关闭位移效果。 |
| **无黑框** | 安装/升级收尾通过隐藏的 `wscript` 启动，不会闪控制台窗口。 |

English: a themed close-confirmation dialog (minimize to tray / quit / cancel, with *remember my choice*), a Settings section to change that choice, a sidebar shortcut, a per-session hover button, per-workspace windows, and a windowless installer helper.

## 组成 / What is inside

DSH 插件运行在 Host（Node 子进程）与 Web 前端里，**没有**窗口或退出的 IPC。因此本项目由两部分组成：

1. **插件**（`index.js` / `client.js`，本仓库根目录）— 设置页、侧栏按钮、会话行按钮、关闭对话框的 UI 与 Host 路由。
2. **壳扩展**（`shell/install.mjs`）— 注入 Electron 主进程，接管窗口关闭、创建子窗口、读写共享配置。安装脚本在 `tools/`。

只装插件：设置页与多开按钮会出现，但顶部会提示壳扩展未安装，关闭窗口仍走 DSH 原行为。

## 安装 / Install

前置：Windows、DeepSeek Harness Desktop `0.2.1-rc.5` 或更新、Node.js 可用（安装脚本用）。

### 1. 安装插件

任选一种：

- 在 **设置 → 插件** 里从市场 / 索引安装本仓库（读取根目录的 `package.json` 与 `cordis.patch.yml`）；
- 或把仓库放到 DSH profile 可以解析的位置后，用 DSH 的 `plugin_manager` / `dsh plugin` 安装本目录；
- 本地开发时也可直接把目录链接到 `%USERPROFILE%\.dsh\profiles\desktop\node_modules\@local\dsh-window`。

安装后打开 **设置 → 窗口与多开**，应能看到本页。

### 2. 安装壳扩展

> 需要写入 `D:\DeepSeek Harness`（或你的安装目录），并以当前用户运行 PowerShell。

```powershell
# 在仓库根目录
node tools/install-shell-extension.mjs --stage-only

# 注册隐藏的收尾任务（每分钟检查一次，成功后自动删除）
powershell -NoProfile -ExecutionPolicy Bypass -File tools/register-completion-task.ps1

# 然后：托盘图标 → 退出。约一分钟内应用会带着扩展重启
```

`--stage-only` 会：解包 `resources/app.asar` → `resources/app`、叠加 `app.asar.unpacked`、给 `lib/main.js` 打补丁（关闭钩子、子窗口 WebSocket 白名单、子窗口 IPC 放行）、给 `lib/preload-app.cjs` 加 `window.dshWindow` 桥，然后等应用退出时把 `app.asar` 改名为 `app.asar.orig`。

安装目录不是默认的 `D:\DeepSeek Harness` 时，先设置环境变量：

```powershell
$env:DSH_DESKTOP_ROOT = 'E:\Apps\DeepSeek Harness'
```

收尾任务有 75 秒健康检查：启动后扩展没写日志、或补丁缺失，会自动回滚到原版 `app.asar` 并重启，不会把应用留在坏状态。

### 3. 验证

- 设置页顶部显示绿色 “Desktop shell extension is installed”。
- 关闭主窗口 → 出现与主界面同风格的对话框。
- 侧栏会话悬停 → 出现窗口图标；点击后新窗口加载该会话。

## 设置与行为 / Settings

配置文件：`%USERPROFILE%\.dsh\desktop\window-policy.json`（`DSH_HOME` 存在时用 `$DSH_HOME\desktop\window-policy.json`）。

```json
{ "closeAction": "ask" }
```

- `ask` — 每次关闭都询问（默认）
- `background` — 直接隐藏到托盘
- `quit` — 直接退出

关闭对话框勾选「记住我的选择」会写入同一文件；设置页修改后立即广播给所有窗口。

## 更新 DSH 之后 / After a DSH update

DSH 升级会带回新的 `resources/app.asar`，旧补丁随之失效（`resources/app` 会被忽略或覆盖）。重新执行第 2 步即可：

```powershell
node tools/install-shell-extension.mjs --stage-only
powershell -NoProfile -ExecutionPolicy Bypass -File tools/register-completion-task.ps1
```

插件部分通常不需要重装。

## 卸载 / Uninstall

```powershell
# 先退出 DeepSeek Harness
powershell -NoProfile -ExecutionPolicy Bypass -File tools/uninstall-shell-extension.ps1
```

再在 **设置 → 插件** 里移除本插件。卸载脚本会恢复 `app.asar.orig`、删除 `resources/app` 与 `resources/dsh-window-extension`。

## 限制 / Limitations

- 仅 Windows：壳扩展依赖 DSH 的 win32 托盘、`titleBarOverlay` 与 PowerShell 安装脚本。
- 壳扩展是**对本机安装目录的补丁**，不是官方扩展点；DSH 升级后要重跑。
- 子窗口与主窗口共享同一份登录 cookie 与 Host 连接；会话数据是同一个 runtime。
- 应用正在运行时 `app.asar` 被占用，所以切换必须等退出后由收尾任务完成。
- 关闭对话框依赖前端已加载；前端尚未就绪时回退到系统原生对话框。

## 开发 / Development

```
dsh-window/
  index.js             Host 半：/dsh-window/policy、/targets、/boot-injections 路由
  client.js            Client 半：设置分区、侧栏按钮、会话行按钮、关闭对话框
  locale/{en,zh}.json  显示名与描述
  cordis.patch.yml     插件插入声明
  shell/install.mjs    注入 Electron 主进程的壳扩展（关闭、子窗口、IPC）
  tools/               安装器、收尾任务、卸载、UI 冒烟测试
  docs/ARCHITECTURE.md 内部机制
```

```powershell
node tools/smoke-client.mjs      # 用桩环境渲染 client.js，校验 4 个插槽与关闭对话框
node --check client.js index.js shell/install.mjs
```

## 许可 / License

MIT，见 [LICENSE](LICENSE)。
