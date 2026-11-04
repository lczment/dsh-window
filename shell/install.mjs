/**
 * dsh-window shell extension.
 *
 * Loaded by the patched Desktop main process (resources/app/lib/main.js) before
 * the stock window logic runs. It owns three things the Cordis plugin cannot
 * reach:
 *   1. the close decision for the main window (ask / hide to tray / quit),
 *   2. the shared close-behaviour policy file,
 *   3. child windows for a chosen workspace or session.
 *
 * The policy file is identical to the one the Host plugin reads:
 *   <DSH home>/desktop/window-policy.json  ->  { "closeAction": "ask"|"background"|"quit" }
 */
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from "electron";
import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const CLOSE_ACTIONS = new Set(["ask", "background", "quit"]);
const MARKER = "__dshWindowExtension";

let installed = false;
const children = new Map();
const streamSenders = new Set();

globalThis.__dshWindowStreams = streamSenders;

function logFilePath() {
  return join(process.resourcesPath, "dsh-window-extension", "extension.log");
}

function log(message) {
  try {
    const file = logFilePath();
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, `${new Date().toISOString()} ${message}\n`, "utf8");
  } catch {
    // Logging must never break window behaviour.
  }
}

function policyPath() {
  const home = process.env.DSH_HOME?.trim() || join(homedir(), ".dsh");
  return join(home, "desktop", "window-policy.json");
}

function readCloseAction() {
  try {
    const parsed = JSON.parse(readFileSync(policyPath(), "utf8"));
    return CLOSE_ACTIONS.has(parsed?.closeAction) ? parsed.closeAction : "ask";
  } catch {
    return "ask";
  }
}

function writeCloseAction(closeAction) {
  if (!CLOSE_ACTIONS.has(closeAction)) throw new Error(`unsupported closeAction: ${closeAction}`);
  const file = policyPath();
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify({ closeAction }, null, 2)}\n`, "utf8");
  renameSync(temporary, file);
}

function messages() {
  const zh = String(app.getLocale()).toLowerCase().startsWith("zh");
  return zh
    ? {
        title: "关闭 DeepSeek Harness",
        message: "关闭主窗口后要做什么？",
        detail: "最小化到后台会隐藏窗口并继续运行任务；完全退出会结束应用和正在运行的任务。",
        background: "最小化到后台",
        quit: "完全退出",
        cancel: "取消",
        remember: "记住我的选择，不再询问",
      }
    : {
        title: "Close DeepSeek Harness",
        message: "What should closing the main window do?",
        detail: "Minimize to background hides the window and keeps tasks running. Quit closes the app and stops running tasks.",
        background: "Minimize to background",
        quit: "Quit completely",
        cancel: "Cancel",
        remember: "Remember my choice and do not ask again",
      };
}

function overlayColors() {
  return nativeTheme.shouldUseDarkColors
    ? { color: "#141416", symbolColor: "#e6e6e6" }
    : { color: "#f7f7f8", symbolColor: "#1f1f21" };
}

function childUrl(kind, id) {
  const params = new URLSearchParams();
  if (kind === "workspace") {
    params.set("dshWin", "workspace");
    params.set("workspaceId", id);
  } else {
    params.set("dshWin", "session");
    params.set("id", id);
  }
  return `dsh-app://app/?${params.toString()}`;
}

function trusted(event) {
  try {
    const frame = event.senderFrame;
    if (frame === undefined || frame === null) return false;
    if (frame !== event.sender.mainFrame) return false;
    return new URL(frame.url).protocol === "dsh-app:";
  } catch {
    return false;
  }
}

function broadcastPolicy() {
  const value = { closeAction: readCloseAction() };
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue;
    try {
      window.webContents.send("dsh-window:policy", value);
    } catch {
      // A closing window can reject the send; policy is re-read on demand.
    }
  }
}

export function install() {
  if (installed) return;
  installed = true;
  log(`install() starting (app=${app.getName?.() ?? "?"} ${app.getVersion?.() ?? "?"}, electron=${process.versions.electron})`);

  const setup = () => {

  globalThis.__dshWindowLog = (message) => log(`main: ${String(message)}`);
  globalThis.__dshWindowBootFailed = (primary, sender, message) => {
    const url = (() => {
      try {
        return sender?.getURL?.() ?? "";
      } catch {
        return "";
      }
    })();
    log(`web boot failed (${primary ? "primary" : "secondary"}) ${url}: ${String(message)}`);
    if (!primary) {
      try {
        dialog.showErrorBox("Child window failed to boot", String(message));
      } catch {
        // The dialog is best effort; the log line is the durable record.
      }
    }
  };

  const preload = join(app.getAppPath(), "lib", "preload-app.cjs");
  const trustedOrigin = "dsh-app://app/";

  const openChild = (kind, id) => {
    if (typeof id !== "string" || id.trim() === "") return { ok: false, error: "missing target id" };
    log(`openChild ${kind} ${id}`);
    for (const window of children.values()) {
      if (window.isDestroyed()) continue;
      if (window.__dshKind === kind && window.__dshId === id) {
        window.show();
        window.focus();
        return { ok: true, reused: true };
      }
    }

    const window = new BrowserWindow({
      width: 1180,
      height: 820,
      minWidth: 520,
      minHeight: 600,
      show: false,
      backgroundColor: nativeTheme.shouldUseDarkColors ? "#141416" : "#ffffff",
      ...(process.platform === "win32"
        ? { titleBarStyle: "hidden", titleBarOverlay: { height: 40, ...overlayColors() } }
        : {}),
      webPreferences: {
        preload,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        webviewTag: false,
        devTools: true,
      },
    });
    window.__dshKind = kind;
    window.__dshId = id;
    const webContentsId = window.webContents.id;
    children.set(webContentsId, window);
    streamSenders.add(webContentsId);

    window.once("ready-to-show", () => {
      if (!window.isDestroyed()) window.show();
    });
    window.on("closed", () => {
      children.delete(webContentsId);
      streamSenders.delete(webContentsId);
    });
    window.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/i.test(url)) shell.openExternal(url).catch(() => {});
      return { action: "deny" };
    });
    window.webContents.on("will-navigate", (event, url) => {
      try {
        if (new URL(url).protocol !== "dsh-app:") event.preventDefault();
      } catch {
        event.preventDefault();
      }
    });
    window.webContents.on("did-fail-load", (_event, code, description) => {
      if (code === -3) return;
      log(`child window failed to load: ${code} ${description}`);
      console.error(`[dsh-window] child window failed to load: ${code} ${description}`);
    });
    window.webContents.on("preload-error", (_event, preloadPath, error) => {
      log(`child preload error ${preloadPath}: ${error?.stack ?? error}`);
    });
    window.webContents.on("render-process-gone", (_event, details) => {
      log(`child render process gone: ${JSON.stringify(details)}`);
    });
    window.webContents.on("console-message", (event, ...legacy) => {
      try {
        const level = typeof event?.level === "number" ? event.level : legacy[0];
        const message = typeof event?.message === "string" ? event.message : legacy[1];
        const source = typeof event?.sourceId === "string" ? `${event.sourceId}:${event.lineNumber ?? 0}` : "";
        log(`child console[${level}] ${source} ${String(message ?? "").slice(0, 800)}`);
      } catch {
        // Diagnostics must never change behaviour.
      }
    });
    window.webContents.on("did-finish-load", () => {
      setTimeout(() => {
        if (window.isDestroyed()) return;
        const probe = `(() => {
          try {
            const resources = performance.getEntriesByType("resource");
            const failed = resources
              .filter((row) => row.responseStatus >= 400)
              .map((row) => row.responseStatus + " " + row.name.split("?")[0])
              .slice(0, 20);
            const boot = window.__DSH_BOOT__;
            return JSON.stringify({
              href: location.href,
              title: document.title,
              body: (document.body && document.body.innerText || "").slice(0, 400),
              bootReady: typeof window.__DSH_BOOT_READY__,
              bootType: boot ? typeof boot : "missing",
              bootPlugins: boot && Array.isArray(boot.plugins) ? boot.plugins.length : null,
              bootKeys: boot && typeof boot === "object" ? Object.keys(boot).slice(0, 20) : null,
              transport: typeof window.__DSH_TRANSPORT__,
              desktopBoot: typeof window.dshDesktopBoot,
              scripts: Array.from(document.scripts).map((s) => s.src || "inline").slice(0, 24),
              resourceCount: resources.length,
              failed
            });
          } catch (error) {
            return JSON.stringify({ probeError: String(error && error.stack || error) });
          }
        })()`;
        window.webContents
          .executeJavaScript(probe, true)
          .then((value) => log(`child boot probe ${value}`))
          .catch((error) => log(`child boot probe failed: ${error?.message ?? error}`));
      }, 3500);
    });

    window.loadURL(childUrl(kind, id)).catch((error) => {
      log(`child window load error: ${error?.stack ?? error}`);
      console.error("[dsh-window] child window load error", error);
      if (!window.isDestroyed()) window.destroy();
    });
    return { ok: true, id: webContentsId };
  };

  // ---- close decision -----------------------------------------------------
  const applyDecision = (window, choice, remember) => {
    if (remember) {
      try {
        writeCloseAction(choice);
        broadcastPolicy();
      } catch (error) {
        log(`could not persist close policy: ${error?.stack ?? error}`);
        console.error("[dsh-window] could not persist close policy", error);
      }
    }
    if (choice === "quit") app.quit();
    else if (!window.isDestroyed()) window.hide();
  };

  // Prefer the app's own dialog: the plugin registers window.__dshWindowPrompt,
  // which resolves with { choice, remember }. Returns null when unavailable so
  // the native message box can take over.
  const askInApp = (window) => {
    if (window.isDestroyed() || window.webContents.isDestroyed()) return Promise.resolve(null);
    const ready = `typeof window.__dshWindowPrompt === "function" && window.__dshWindowPromptReady === true`;
    return window.webContents
      .executeJavaScript(ready, false)
      .then((available) => (available === true ? showInAppPrompt(window) : null))
      .catch((error) => {
        log(`in-app close prompt unavailable: ${error?.stack ?? error}`);
        return null;
      });
  };

  const showInAppPrompt = (window) => {
    const script = `(async () => {
      try {
        if (typeof window.__dshWindowPrompt !== "function") return null;
        const answer = await window.__dshWindowPrompt();
        if (!answer || typeof answer !== "object") return null;
        const choice = answer.choice;
        if (choice !== "background" && choice !== "quit" && choice !== "cancel") return null;
        return { choice: choice, remember: answer.remember === true };
      } catch (error) {
        return null;
      }
    })()`;
    return window.webContents.executeJavaScript(script, true).catch((error) => {
      log(`in-app close prompt failed: ${error?.stack ?? error}`);
      return null;
    });
  };

  const askNative = (window) => {
    const text = messages();
    return dialog
      .showMessageBox(window, {
        type: "question",
        title: text.title,
        message: text.message,
        detail: text.detail,
        buttons: [text.background, text.quit, text.cancel],
        defaultId: 0,
        cancelId: 2,
        noLink: true,
        checkboxLabel: text.remember,
        checkboxChecked: false,
      })
      .then((result) => {
        if (result.response === 2) return { choice: "cancel", remember: false };
        return {
          choice: result.response === 1 ? "quit" : "background",
          remember: result.checkboxChecked === true,
        };
      });
  };

  let asking = false;
  globalThis.__dshWindowClose = (window) => {
    const action = readCloseAction();
    if (action === "background") {
      window.hide();
      return true;
    }
    if (action === "quit") {
      app.quit();
      return true;
    }
    if (asking) return true;
    asking = true;
    askInApp(window)
      .then((answer) => (answer === null ? askNative(window) : answer))
      .then((answer) => {
        asking = false;
        if (!answer || answer.choice === "cancel") return;
        applyDecision(window, answer.choice, answer.remember === true);
      })
      .catch((error) => {
        asking = false;
        log(`close prompt failed: ${error?.stack ?? error}`);
        console.error("[dsh-window] close prompt failed", error);
      });
    return true;
  };

  // ---- client bridge ------------------------------------------------------
  const handle = (channel, handler) => {
    ipcMain.handle(channel, (event, ...args) => {
      if (!trusted(event)) throw new Error("dsh-window: untrusted sender");
      return handler(event, ...args);
    });
  };

  handle("dsh-window:get-policy", () => ({ policy: { closeAction: readCloseAction() }, extension: 1 }));
  handle("dsh-window:set-policy", (_event, action) => {
    writeCloseAction(action);
    broadcastPolicy();
    return { policy: { closeAction: action } };
  });
  handle("dsh-window:open", (_event, request) => {
    const kind = request?.kind === "workspace" ? "workspace" : "session";
    return openChild(kind, request?.id);
  });
  handle("dsh-window:list", () => ({
    windows: [...children.values()]
      .filter((window) => !window.isDestroyed())
      .map((window) => ({ id: window.webContents.id, kind: window.__dshKind, target: window.__dshId })),
  }));
  handle("dsh-window:focus", (_event, id) => {
    const window = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.id === id);
    if (window === undefined) return { ok: false };
    window.show();
    window.focus();
    return { ok: true };
  });
  handle("dsh-window:close", (_event, id) => {
    const window = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.id === id);
    if (window === undefined) return { ok: false };
    window.close();
    return { ok: true };
  });

  const refreshOverlays = () => {
    if (process.platform !== "win32") return;
    for (const window of children.values()) {
      if (window.isDestroyed()) continue;
      try {
        window.setTitleBarOverlay({ height: 40, ...overlayColors() });
      } catch {
        // Overlay updates are cosmetic.
      }
    }
  };
  nativeTheme.on("updated", refreshOverlays);

  app.on("will-quit", () => {
    nativeTheme.off("updated", refreshOverlays);
  });

  log(`shell extension installed (policy: ${policyPath()}, origin: ${trustedOrigin})`);
  console.log(`[dsh-window] shell extension installed (policy: ${policyPath()}, origin: ${trustedOrigin})`);
  };

  if (app.isReady()) setup();
  else app.whenReady().then(setup, (error) => log(`install wait failed: ${error?.stack ?? error}`));
}

if (globalThis[MARKER] !== true) globalThis[MARKER] = true;
