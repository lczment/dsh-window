/**
 * Install the dsh-window shell extension into the DeepSeek Harness Desktop app.
 *
 * What it does (all under "D:\\DeepSeek Harness\\resources"):
 *   1. extracts resources/app.asar into resources/app
 *   2. overlays resources/app.asar.unpacked on top of that tree
 *   3. patches resources/app/lib/main.js (extension bootstrap, close hook, WS whitelist)
 *   4. patches resources/app/lib/preload-app.cjs (window.dshWindow bridge)
 *   5. writes resources/dsh-window-extension/{install.mjs,package.json}
 *   6. renames app.asar to app.asar.orig so the directory tree is the loaded app
 *
 * Re-run after every DeepSeek Harness update. Uninstall with
 * tools/uninstall-shell-extension.mjs.
 */
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SCRIPT_DIR, "..");
const APP_ROOT = process.env.DSH_DESKTOP_ROOT?.trim() || "D:\\DeepSeek Harness";
const RESOURCES = join(APP_ROOT, "resources");
const ASAR = join(RESOURCES, "app.asar");
const BACKUP = join(RESOURCES, "app.asar.orig");
const APP_DIR = join(RESOURCES, "app");
const STAGE = join(RESOURCES, ".dsh-window-staging");
const UNPACKED = join(RESOURCES, "app.asar.unpacked");
const EXT_DIR = join(RESOURCES, "dsh-window-extension");
const SOURCE_EXTENSION = join(REPO_ROOT, "shell", "install.mjs");

const BOOTSTRAP = `
//#region dsh-window-extension
try {
	const extension = await import(new URL("../../dsh-window-extension/install.mjs", import.meta.url).href);
	extension.install();
} catch (error) {
	console.error("[dsh-window] shell extension failed to load", error);
	try {
		const fs = await import("node:fs");
		const line = new Date().toISOString() + " bootstrap failed: " + (error && error.stack ? error.stack : String(error)) + "\\n";
		fs.appendFileSync(new URL("../../dsh-window-extension/extension.log", import.meta.url), line);
	} catch {}
}
//#endregion dsh-window-extension
`;

const CLOSE_ANCHOR = `\t\t\tif (updateDialog.isOpen) {
\t\t\t\tupdateDialog.focus();
\t\t\t\treturn;
\t\t\t}
`;

const CLOSE_HOOK = `\t\t\tif (globalThis.__dshWindowClose?.(window) === true) return;
`;

const STREAM_ANCHOR = "details.webContentsId !== mainWindow?.webContents.id";
const STREAM_PATCHED =
  "details.webContentsId !== mainWindow?.webContents.id && globalThis.__dshWindowStreams?.has?.(details.webContentsId) !== true";

const BOOT_FAILED_ANCHOR = `\t\tif (event.sender !== mainWindow?.webContents || event.senderFrame !== event.sender.mainFrame) throw new Error("dsh desktop: rejected startup failure from a non-primary frame");`;
const BOOT_FAILED_PATCHED = `\t\tconst primary = event.sender === mainWindow?.webContents && event.senderFrame === event.sender.mainFrame;
\t\tglobalThis.__dshWindowBootFailed?.(primary, event.sender, message);
\t\tif (!primary) throw new Error("dsh desktop: rejected startup failure from a non-primary frame");`;

const BOOT_INJECTIONS_ANCHOR = `\t\tif (backend.host === void 0 || hostUrl === void 0) throw new Error("Desktop Host is unavailable");
\t\treturn {
\t\t\tinjections,
\t\t\tstreamBaseUrl: new URL(hostUrl).origin
\t\t};`;
const BOOT_INJECTIONS_PATCHED = `\t\tif (backend.host === void 0 || hostUrl === void 0) throw new Error("Desktop Host is unavailable");
\t\tlet freshInjections = injections;
\t\ttry {
\t\t\tconst bootTable = await fetch(new URL("/dsh-window/boot-injections", hostUrl), hostCookie === void 0 ? void 0 : { headers: { cookie: hostCookie } });
\t\t\tif (bootTable.ok) {
\t\t\t\tconst table = await bootTable.json();
\t\t\t\tif (Array.isArray(table?.injections)) freshInjections = table.injections;
\t\t\t}
\t\t} catch {}
\t\treturn {
\t\t\tinjections: freshInjections,
\t\t\tstreamBaseUrl: new URL(hostUrl).origin
\t\t};`;

const WS_LOG_ANCHOR = `\t\tif (hostUrl === void 0 || hostCookie === void 0 || details.webContentsId !== mainWindow?.webContents.id && globalThis.__dshWindowStreams?.has?.(details.webContentsId) !== true) {
\t\t\tcallback({});
\t\t\treturn;
\t\t}
`;
const WS_LOG_PATCHED = `${WS_LOG_ANCHOR}\t\tif (details.webContentsId !== mainWindow?.webContents.id) {
\t\t\tconst seen = details.requestHeaders?.Origin ?? details.requestHeaders?.origin ?? "?";
\t\t\tglobalThis.__dshWindowLog?.("ws upgrade child=" + details.webContentsId + " origin=" + seen + " url=" + details.url);
\t\t}
`;

const PRELOAD_BRIDGE = `
//#region dsh-window bridge
;(() => {
	try {
		if (location.protocol !== "dsh-app:" || location.hostname !== "app") return;
		if (!process.isMainFrame) return;
		const electron = require("electron");
		if (!electron?.contextBridge || !electron?.ipcRenderer) return;
		electron.contextBridge.exposeInMainWorld("dshWindow", {
			protocolVersion: 1,
			getPolicy: () => electron.ipcRenderer.invoke("dsh-window:get-policy"),
			setPolicy: (action) => electron.ipcRenderer.invoke("dsh-window:set-policy", action),
			open: (request) => electron.ipcRenderer.invoke("dsh-window:open", request),
			list: () => electron.ipcRenderer.invoke("dsh-window:list"),
			focus: (id) => electron.ipcRenderer.invoke("dsh-window:focus", id),
			close: (id) => electron.ipcRenderer.invoke("dsh-window:close", id),
			onPolicy: (listener) => {
				const handler = (_event, value) => {
					try {
						listener(value);
					} catch {}
				};
				electron.ipcRenderer.on("dsh-window:policy", handler);
				return () => electron.ipcRenderer.removeListener("dsh-window:policy", handler);
			},
		});
	} catch (error) {
		console.error("[dsh-window] preload bridge failed", error);
	}
})();
//#endregion dsh-window bridge
`;

const long = (path) => (process.platform === "win32" ? `\\\\?\\${path}` : path);

function writeLong(path, bytes) {
  mkdirSync(long(dirname(path)), { recursive: true });
  writeFileSync(long(path), bytes);
}

function copyTree(source, target, counter) {
  if (!existsSync(source)) return;
  for (const name of readdirSync(source)) {
    const from = join(source, name);
    const to = join(target, name);
    const info = statSync(from);
    if (info.isDirectory()) copyTree(from, to, counter);
    else {
      mkdirSync(long(dirname(to)), { recursive: true });
      copyFileSync(long(from), long(to));
      counter.files += 1;
      counter.bytes += info.size;
    }
  }
}

function parseHeader(archive) {
  const headerLength = archive.readUInt32LE(12);
  const header = JSON.parse(archive.toString("utf8", 16, 16 + headerLength));
  return { header, dataStart: 16 + headerLength };
}

function collectFiles(node, prefix, out) {
  for (const [name, child] of Object.entries(node.files ?? {})) {
    const path = prefix === "" ? name : `${prefix}/${name}`;
    if (child.files !== undefined) collectFiles(child, path, out);
    else if (child.unpacked === true) continue;
    else if (typeof child.link === "string") continue;
    else out.push({ path, offset: Number(child.offset), size: child.size });
  }
}

function extractArchive() {
  const archive = readFileSync(ASAR);
  const { header, dataStart } = parseHeader(archive);
  const files = [];
  collectFiles(header, "", files);
  rmSync(long(STAGE), { recursive: true, force: true });
  mkdirSync(long(STAGE), { recursive: true });
  for (const file of files) {
    const bytes = archive.subarray(dataStart + file.offset, dataStart + file.offset + file.size);
    writeLong(join(STAGE, ...file.path.split("/")), bytes);
  }
  return files.length;
}

const REGION_START = "//#region dsh-window-extension";
const REGION_END = "//#endregion dsh-window-extension";

function ensureBootstrap(source) {
  const start = source.indexOf(REGION_START);
  if (start < 0) return `${source}\n${BOOTSTRAP}`;
  const end = source.indexOf(REGION_END, start);
  if (end < 0) return `${source}\n${BOOTSTRAP}`;
  return source.slice(0, start) + BOOTSTRAP.trimStart() + source.slice(end + REGION_END.length);
}

function patchMain() {
  const file = join(APP_DIR, "lib", "main.js");
  let source = readFileSync(file, "utf8");
  let changed = false;

  const withBootstrap = ensureBootstrap(source);
  if (withBootstrap !== source) {
    source = withBootstrap;
    changed = true;
  }

  if (!source.includes("__dshWindowClose")) {
    const occurrences = source.split(CLOSE_ANCHOR).length - 1;
    if (occurrences !== 1) throw new Error(`close anchor matched ${occurrences} times; app layout changed`);
    source = source.replace(CLOSE_ANCHOR, CLOSE_ANCHOR + CLOSE_HOOK);
    changed = true;
  }

  if (!source.includes("__dshWindowStreams")) {
    const occurrences = source.split(STREAM_ANCHOR).length - 1;
    if (occurrences !== 1) throw new Error(`stream anchor matched ${occurrences} times; app layout changed`);
    source = source.replace(STREAM_ANCHOR, STREAM_PATCHED);
    changed = true;
  }

  if (!source.includes("__dshWindowBootFailed")) {
    const occurrences = source.split(BOOT_FAILED_ANCHOR).length - 1;
    if (occurrences !== 1) throw new Error(`boot-failed anchor matched ${occurrences} times; app layout changed`);
    source = source.replace(BOOT_FAILED_ANCHOR, BOOT_FAILED_PATCHED);
    changed = true;
  }

  if (!source.includes("dsh-window/boot-injections")) {
    const occurrences = source.split(BOOT_INJECTIONS_ANCHOR).length - 1;
    if (occurrences !== 1) throw new Error(`boot-injections anchor matched ${occurrences} times; app layout changed`);
    source = source.replace(BOOT_INJECTIONS_ANCHOR, BOOT_INJECTIONS_PATCHED);
    changed = true;
  }

  if (!source.includes("ws upgrade child=")) {
    const occurrences = source.split(WS_LOG_ANCHOR).length - 1;
    if (occurrences !== 1) throw new Error(`ws log anchor matched ${occurrences} times; app layout changed`);
    source = source.replace(WS_LOG_ANCHOR, WS_LOG_PATCHED);
    changed = true;
  }

  if (changed) writeFileSync(file, source, "utf8");
  return changed;
}

const PRODUCT_PATCHES = [
  {
    label: "locale bootstrap",
    marker: "dsh-window: locale bootstrap",
    anchor: `event.sender !== mainWindow?.webContents || event.senderFrame !== mainWindow.webContents.mainFrame || new URL(event.senderFrame.url).origin !== new URL(applicationUrl).origin`,
    replacement: `event.senderFrame === null || new URL(event.senderFrame.url).origin !== new URL(applicationUrl).origin /* dsh-window: locale bootstrap */`,
  },
  {
    label: "locale change",
    marker: "dsh-window: locale change",
    anchor: `window === void 0 || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || typeof next !== "string"`,
    replacement: `window === void 0 || typeof next !== "string" || event.senderFrame === null || event.senderFrame !== event.sender.mainFrame || new URL(event.senderFrame.url).origin !== new URL(applicationUrl).origin /* dsh-window: locale change */`,
  },
  {
    label: "product sender",
    marker: "dsh-window: product sender",
    anchor: `if (mainWindow === void 0 || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents || event.senderFrame === null || event.senderFrame !== mainWindow.webContents.mainFrame) throw new Error("dsh desktop: rejected IPC from an unowned renderer");`,
    replacement: `if (event.senderFrame === null || event.senderFrame !== event.sender.mainFrame || BrowserWindow.fromWebContents(event.sender) === void 0 || globalThis.__dshWindowStreams?.has?.(event.sender.id) !== true && BrowserWindow.fromWebContents(event.sender) !== mainWindow) throw new Error("dsh desktop: rejected IPC from an unowned renderer"); /* dsh-window: product sender */`,
  },
  {
    label: "shortcuts sender",
    marker: "dsh-window: shortcuts",
    anchor: `event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error("desktop shortcuts: rejected sender");`,
    replacement: `event.senderFrame === null || event.senderFrame !== event.sender.mainFrame) throw new Error("desktop shortcuts: rejected sender"); /* dsh-window: shortcuts */`,
  },
  {
    label: "directory picker",
    marker: "dsh-window: directory picker",
    anchor: `event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error("dsh desktop: rejected directory picker from an unowned renderer");`,
    replacement: `event.senderFrame === null || event.senderFrame !== event.sender.mainFrame) throw new Error("dsh desktop: rejected directory picker from an unowned renderer"); /* dsh-window: directory picker */`,
  },
];

function patchProductHandlers() {
  const file = join(APP_DIR, "lib", "main.js");
  let source = readFileSync(file, "utf8");
  let changed = false;
  for (const patch of PRODUCT_PATCHES) {
    if (source.includes(patch.marker)) continue;
    const occurrences = source.split(patch.anchor).length - 1;
    if (occurrences !== 1) throw new Error(`${patch.label} anchor matched ${occurrences} times; app layout changed`);
    source = source.replace(patch.anchor, patch.replacement);
    changed = true;
  }
  if (changed) writeFileSync(file, source, "utf8");
  return changed;
}

function patchPreload() {
  const file = join(APP_DIR, "lib", "preload-app.cjs");
  const source = readFileSync(file, "utf8");
  if (source.includes("dsh-window bridge")) return false;
  writeFileSync(file, `${source}\n${PRELOAD_BRIDGE}`, "utf8");
  return true;
}

function writeExtension(asarDigest) {
  rmSync(long(EXT_DIR), { recursive: true, force: true });
  mkdirSync(long(EXT_DIR), { recursive: true });
  copyFileSync(SOURCE_EXTENSION, join(EXT_DIR, "install.mjs"));
  writeFileSync(join(EXT_DIR, "package.json"), JSON.stringify({ name: "dsh-window-extension", private: true, type: "module" }, null, 2));
  writeFileSync(
    join(EXT_DIR, "installed.json"),
    JSON.stringify(
      {
        installedAt: new Date().toISOString(),
        appAsarSha256: asarDigest,
        appRoot: APP_ROOT,
        policy: join(process.env.DSH_HOME?.trim() || join(process.env.USERPROFILE ?? "", ".dsh"), "desktop", "window-policy.json"),
      },
      null,
      2,
    ),
  );
}

function assertPatched() {
  const main = readFileSync(join(APP_DIR, "lib", "main.js"), "utf8");
  const required = [
    "__dshWindowClose",
    "__dshWindowStreams",
    "__dshWindowBootFailed",
    "dsh-window/boot-injections",
    "dsh-window: locale bootstrap",
    "dsh-window: locale change",
    "dsh-window: product sender",
    "dsh-window: shortcuts",
    "dsh-window: directory picker",
  ];
  const missing = required.filter((marker) => !main.includes(marker));
  if (missing.length > 0) {
    throw new Error(`main.js patch verification failed; missing ${missing.join(", ")}`);
  }
  const preload = readFileSync(join(APP_DIR, "lib", "preload-app.cjs"), "utf8");
  if (!preload.includes("dsh-window bridge") || !preload.includes('"dshWindow"')) {
    throw new Error("preload patch verification failed");
  }
  console.log("[install] patch verification passed");
}


function main() {
  if (!existsSync(ASAR) && !existsSync(BACKUP)) throw new Error(`app.asar not found under ${RESOURCES}`);
  if (!existsSync(SOURCE_EXTENSION)) throw new Error(`extension source missing: ${SOURCE_EXTENSION}`);

  const patchOnly = process.argv.includes("--patch-only");
  if (patchOnly) {
    if (!existsSync(join(APP_DIR, "lib", "main.js"))) {
      throw new Error("--patch-only requires an already staged resources/app");
    }
    console.log("[install] patch-only: reusing the staged app directory");
  } else {
    if (!existsSync(ASAR) && existsSync(BACKUP)) {
      console.log("[install] app.asar is absent; restoring it from app.asar.orig for a clean reinstall");
      copyFileSync(BACKUP, ASAR);
    }

    console.log("[install] extracting app.asar ...");
    const count = extractArchive();
    console.log(`[install] extracted ${count} files`);

    console.log("[install] overlaying app.asar.unpacked ...");
    const counter = { files: 0, bytes: 0 };
    copyTree(UNPACKED, STAGE, counter);
    console.log(`[install] overlaid ${counter.files} files (${(counter.bytes / 1048576).toFixed(1)} MiB)`);

    rmSync(long(APP_DIR), { recursive: true, force: true });
    renameSync(STAGE, APP_DIR);
    console.log("[install] staged directory is in place:", APP_DIR);
  }

  const digest = createHash("sha256").update(readFileSync(existsSync(ASAR) ? ASAR : BACKUP)).digest("hex");

  const mainPatched = patchMain();
  const productPatched = patchProductHandlers();
  const preloadPatched = patchPreload();
  console.log(`[install] patched main.js: ${mainPatched}, product IPC: ${productPatched}, preload: ${preloadPatched}`);

  assertPatched();

  writeExtension(digest);
  console.log("[install] extension written:", EXT_DIR);

  if (process.argv.includes("--stage-only")) {
    writeFileSync(
      join(APP_DIR, ".dsh-window-pending"),
      JSON.stringify({ stagedAt: new Date().toISOString(), appAsarSha256: digest }, null, 2),
    );
    console.log("[install] staged only: app.asar is still loaded by the running app.");
    console.log(`[install] register the hidden exit watcher: powershell -NoProfile -ExecutionPolicy Bypass -File "${join(SCRIPT_DIR, "register-completion-task.ps1")}"`);
    console.log("[install] then quit DeepSeek Harness from the tray; it relaunches with the extension within a minute.");
    return;
  }

  rmSync(BACKUP, { force: true });
  renameSync(ASAR, BACKUP);
  console.log("[install] app.asar moved to app.asar.orig");
  console.log("[install] done. Restart DeepSeek Harness to load the extension.");
}

try {
  main();
} catch (error) {
  console.error("[install] failed:", error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
}
