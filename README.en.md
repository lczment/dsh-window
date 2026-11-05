# DSH Window

English | [简体中文](README.md)

A small add-on for **DeepSeek Harness Desktop**: choose what closing the window does, and open a session or a whole workspace in its own child window.

> This is a third-party add-on, not an official DeepSeek component. It patches the local DeepSeek Harness `resources/app` (see *Install*) and must be re-applied after a DSH update.

## Features

| Feature | What it does |
|---|---|
| **Close behaviour** | Closing the main window opens a dialog in the app's own style: minimise to background, quit, or cancel, with *remember my choice*. |
| **Settings section** | Settings → "Windows & multi-window": ask / minimise to background / quit, applied immediately and sharing the same stored policy as the dialog. |
| **Sidebar shortcut** | A "Multi-window" button at the sidebar footer, above the settings gear (icon only in the narrow rail); opens the same options and target list. |
| **Per-session window** | Hovering a session row shows a window icon next to the "…" menu; clicking opens that session in a new window. |
| **Whole workspace** | Every workspace in the settings page has **Open workspace**, opening the workspace in a new window. |
| **Keep running** | With "minimise to background" the process and agents keep running; the tray icon can reopen or quit. |
| **Hover motion** | 120ms transitions on plugin buttons, disabled when the system prefers reduced motion. |
| **No console flash** | The finish step runs through a hidden `wscript` launcher, so the installer never shows a terminal window. |

## What is inside

DSH plugins run in the Host (a Node child process) and the web frontend, and they have **no** IPC for windows or quitting. The project therefore has two parts:

1. **Plugin** (`index.js` / `client.js`, repository root) — settings section, sidebar buttons, per-session button, the close dialog UI, and Host routes.
2. **Shell extension** (`shell/install.mjs`) — injected into the Electron main process; owns window closing, child windows, and the shared policy file. Install scripts live in `tools/`.

With only the plugin installed, the settings page and buttons appear but the page warns that the shell extension is missing, and closing keeps DSH's original behaviour.

## Install

Requires Windows, DeepSeek Harness Desktop `0.2.1-rc.5` or newer, and Node.js (for the installer).

### 1. Install the plugin

Pick one:

- Install this repository from the market / an index in **Settings → Plugins** (it reads the root `package.json` and `cordis.patch.yml`);
- Or put the repository where the DSH profile can resolve it and install the directory with `plugin_manager` / `dsh plugin`;
- For local development, link the directory to `%USERPROFILE%\.dsh\profiles\desktop\node_modules\@local\dsh-window`.

Then open **Settings → Windows & multi-window**; the page should be there.

### 2. Install the shell extension

> Needs write access to `D:\DeepSeek Harness` (or your install directory) and PowerShell as the current user.

```powershell
# from the repository root
node tools/install-shell-extension.mjs --stage-only

# register the hidden finish task (checks once a minute, deletes itself on success)
powershell -NoProfile -ExecutionPolicy Bypass -File tools/register-completion-task.ps1

# then: tray icon → Quit. The app comes back with the extension within a minute
```

`--stage-only` unpacks `resources/app.asar` into `resources/app`, overlays `app.asar.unpacked`, patches `lib/main.js` (close hook, child-window WebSocket allowlist, child-window IPC), adds the `window.dshWindow` bridge to `lib/preload-app.cjs`, and waits for the app to exit before renaming `app.asar` to `app.asar.orig`.

If the app is not in the default `D:\DeepSeek Harness`, set the root first:

```powershell
$env:DSH_DESKTOP_ROOT = 'E:\Apps\DeepSeek Harness'
```

The finish task has a 75-second health check: if the extension never logs a successful install, or a patch is missing, it restores the original `app.asar` and restarts the app, so the install cannot leave a broken state.

### 3. Verify

- The settings page shows a green "Desktop shell extension is installed".
- Closing the main window shows the in-app dialog.
- Hovering a sidebar session shows the window icon; clicking loads that session in a new window.

## Settings and behaviour

Policy file: `%USERPROFILE%\.dsh\desktop\window-policy.json` (or `$DSH_HOME\desktop\window-policy.json` when `DSH_HOME` is set).

```json
{ "closeAction": "ask" }
```

- `ask` — ask on every close (default)
- `background` — hide to the tray
- `quit` — quit

"Remember my choice" in the dialog writes the same file; changes in the settings page are broadcast to every window immediately.

## After a DSH update

A DSH update brings back a fresh `resources/app.asar` and the patch stops applying (`resources/app` is ignored or overwritten). Re-run step 2:

```powershell
node tools/install-shell-extension.mjs --stage-only
powershell -NoProfile -ExecutionPolicy Bypass -File tools/register-completion-task.ps1
```

The plugin itself usually does not need reinstalling.

## Uninstall

```powershell
# quit DeepSeek Harness first
powershell -NoProfile -ExecutionPolicy Bypass -File tools/uninstall-shell-extension.ps1
```

Then remove the plugin in **Settings → Plugins**. The uninstall script restores `app.asar.orig` and removes `resources/app` and `resources/dsh-window-extension`.

## Market listing

- The official catalog ([awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)) only indexes npm-published plugins in its `docs/index.json`; this repository has no npm package, so it appears on the list page but not in that index.
- To see it in **Plugins → Discover** right away, open "Manage index sources…" and add:

  ```
  https://raw.githubusercontent.com/lczment/dsh-window/main/index.json
  ```

  Entries in that index use a git source pinned to a commit, so installation does not depend on npm.
- You can also install straight from the repository: `dsh plugin add github:lczment/dsh-window`, or download `dsh-window.tgz` from [Release v0.1.0](https://github.com/lczment/dsh-window/releases/tag/v0.1.0).
- The catalog entry is submitted: [awesome-dsh-plugin#12113](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/12113) (`market/lczment__dsh-window.yml`). While the repository is younger than 24 hours, the age gate holds it; the gate re-runs by itself, so no resubmission is needed.

## Limitations

- Windows only: the shell extension relies on DSH's win32 tray, `titleBarOverlay`, and the PowerShell installer.
- The shell extension is a **patch of the local installation**, not an official extension point; re-run it after a DSH update.
- Child windows share the same session cookie and Host connection as the main window; all windows talk to the same runtime.
- `app.asar` is locked while the app runs, so the switch always happens after exit, via the finish task.
- The close dialog needs the frontend to be loaded; before that it falls back to the native message box.

## Development

```
dsh-window/
  index.js            Host half: /dsh-window/policy, /targets, /boot-injections routes
  client.js           Client half: settings section, sidebar buttons, per-session button, close dialog
  locale/{en,zh}.json Display name and description
  cordis.patch.yml    Plugin insertion
  shell/install.mjs   Electron main-process extension (close, child windows, IPC)
  tools/              Installer, finish task, uninstall, UI smoke test
  docs/ARCHITECTURE.md Internal design
```

```powershell
node tools/smoke-client.mjs      # renders client.js in a stub environment; checks 4 slots and the close dialog
node --check client.js index.js shell/install.mjs
```

## License

MIT, see [LICENSE](LICENSE).
