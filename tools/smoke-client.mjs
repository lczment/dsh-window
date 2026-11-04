// Minimal harness for the dsh-window Client half: executes the bundle the same
// way the browser module loader does, then runs apply() against stub services.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);

const ReactStub = {
  createElement(type, props, ...children) {
    return { type, props: props ?? {}, children };
  },
  Fragment: Symbol("Fragment"),
  useState(initial) {
    return [typeof initial === "function" ? initial() : initial, () => {}];
  },
  useEffect() {},
  useCallback(fn) {
    return fn;
  },
  useMemo(fn) {
    return fn();
  },
  useRef(value) {
    return { current: value };
  },
};

const registrations = [];
const injections = [];
const effects = [];

const ctx = {
  effect(fn) {
    effects.push(fn);
    const dispose = fn();
    return typeof dispose === "function" ? dispose : () => {};
  },
  on() {
    return () => {};
  },
  get() {
    return undefined;
  },
  locale: {
    bind(ns) {
      return (key) => `${ns}:${key}`;
    },
    register(ns, locale, dict) {
      registrations.push({ ns, locale, keys: Object.keys(dict).length });
      return () => {};
    },
    getLocale() {
      return { active: "zh", locales: [{ id: "zh" }, { id: "en" }], revision: 1 };
    },
  },
  slots: {
    inject(key, callback) {
      injections.push({ key, callback });
      // The live slot system invokes the callback when the target slot appears.
      const dispose = callback();
      effects.push(typeof dispose === "function" ? dispose : () => {});
      return () => {};
    },
    register(options, Component) {
      registrations.push({ slot: options.name, id: options.id, Component });
      return () => {};
    },
  },
};

globalThis.window = {
  location: { search: "" },
  addEventListener() {},
  removeEventListener() {},
  __ModuleLoader__: {
    load(entry) {
      if (entry.id !== "@local/dsh-window") throw new Error(`unexpected id ${entry.id}`);
      const mod = entry.factory((name) => {
        if (name === "react") return ReactStub;
        throw new Error(`unexpected require(${name})`);
      });
      if (typeof mod.apply !== "function") throw new Error("factory returned no apply()");
      mod.apply(ctx);
    },
  },
};

function findButtons(node, found = []) {
  if (!node || typeof node !== "object") return found;
  if (node.props && typeof node.props.onClick === "function" && node.type === "button") found.push(node);
  const children = node.props && node.props.children !== undefined ? node.props.children : node.children;
  for (const child of [].concat(children ?? [])) findButtons(child, found);
  return found;
}

const source = readFileSync(new URL("../client.js", import.meta.url), "utf8");
new Function(source)();

const slots = registrations.filter((r) => r.slot);
if (slots.length !== 4) throw new Error(`expected 4 slot registrations, got ${slots.length}`);
for (const key of [
  "settings.section",
  "sidebar.footer.action",
  "sidebar.workspaces.session.row.action",
  "shell.overlay",
]) {
  if (!injections.some((i) => i.key === key)) throw new Error(`${key} not injected`);
}
for (const slot of slots) {
  if (slot.slot === "shell.overlay" || slot.slot === "sidebar.workspaces.session.row.action") continue;
  const element = slot.Component({ wide: true });
  if (element === undefined || element === null) {
    throw new Error(`slot ${slot.slot} rendered nothing`);
  }
}
const quick = slots.find((s) => s.slot === "sidebar.footer.action");
const dialog = quick.Component({ wide: true });
if (dialog.type === undefined) throw new Error("quick entry returned no element");

// Session-row action: hidden without the shell bridge, opens the row's session
// through it when present.
const rowSlot = slots.find((s) => s.slot === "sidebar.workspaces.session.row.action");
if (rowSlot.Component({ sessionId: "session-1", displayTitle: "Row" }) !== null) {
  throw new Error("row action rendered without the desktop bridge");
}
let opened = null;
window.dshWindow = {
  async open(payload) {
    opened = payload;
    return { ok: true };
  },
};
const rowElement = rowSlot.Component({ sessionId: "session-1", displayTitle: "Row" });
const rowButtons = findButtons(rowElement);
if (rowButtons.length !== 1) throw new Error("row action rendered no button");
rowButtons[0].props.onClick({ stopPropagation() {} });
await Promise.resolve();
if (!opened || opened.kind !== "session" || opened.id !== "session-1") {
  throw new Error(`row action opened ${JSON.stringify(opened)}`);
}
delete window.dshWindow;

// Close prompt: hidden until the shell asks, then resolves with the chosen action.
const promptSlot = slots.find((s) => s.slot === "shell.overlay");
if (promptSlot.Component({}) !== null) throw new Error("close prompt visible before it was requested");
if (typeof window.__dshWindowPrompt !== "function") throw new Error("__dshWindowPrompt not installed");
const pending = window.__dshWindowPrompt();
const rendered = promptSlot.Component({});
if (!rendered) throw new Error("close prompt did not render");
const promptButtons = findButtons(rendered);
if (promptButtons.length < 2) throw new Error("close prompt has no choices");
promptButtons[0].props.onClick();
const decided = await pending;
if (decided.choice !== "background" || decided.remember !== false) {
  throw new Error(`unexpected close answer ${JSON.stringify(decided)}`);
}
if (window.__dshWindowPrompt !== undefined && promptSlot.Component({}) !== null) {
  throw new Error("close prompt stayed open after answering");
}

console.log(
  JSON.stringify(
    {
      ok: true,
      locales: registrations.filter((r) => r.ns).map((r) => `${r.ns}@${r.locale}:${r.keys}`),
      slots: slots.map((s) => `${s.slot}#${s.id}`),
      injections: injections.map((i) => i.key),
    },
    null,
    2,
  ),
);
