/**
 * dsh-window — Host half.
 *
 * Owns the close-behaviour policy file shared with the Desktop shell extension
 * and serves the multi-window target inventory the Client settings page reads.
 *
 * Policy file: <DSH home>/desktop/window-policy.json
 * Shape: { "closeAction": "ask" | "background" | "quit" }
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const CLOSE_ACTIONS = new Set(["ask", "background", "quit"]);
const POLICY_NAMESPACE = "dsh-window";
const MAX_BODY_BYTES = 16 * 1024;

export const name = "dsh-window";
export const inject = ["webServer"];

/** Resolve the shared policy file; the Desktop shell extension uses the same rule. */
export function resolvePolicyPath(env = process.env) {
  const home = env.DSH_HOME && env.DSH_HOME.trim() !== "" ? env.DSH_HOME : join(homedir(), ".dsh");
  return join(home, "desktop", "window-policy.json");
}

async function readCloseAction() {
  try {
    const raw = await readFile(resolvePolicyPath(), "utf8");
    const parsed = JSON.parse(raw);
    return CLOSE_ACTIONS.has(parsed?.closeAction) ? parsed.closeAction : "ask";
  } catch {
    return "ask";
  }
}

async function writeCloseAction(closeAction) {
  if (!CLOSE_ACTIONS.has(closeAction)) throw new Error(`unsupported closeAction: ${String(closeAction)}`);
  const file = resolvePolicyPath();
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify({ closeAction }, null, 2)}\n`, "utf8");
  await rename(temporary, file);
  return closeAction;
}

function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
  });
  response.end(body);
}

async function readJsonBody(request) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) throw new Error("request body too large");
    chunks.push(chunk);
  }
  if (chunks.length === 0) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/** Read every durable workspace and the titles of its sessions. */
async function collectTargets(ctx) {
  const registry = ctx.get("workspaceRegistry");
  const query = ctx.get("sessionQuery");
  const workspaces = typeof registry?.list === "function" ? registry.list() : [];
  const sessionIds = [];
  for (const workspace of workspaces) {
    for (const id of workspace.sessionIds ?? []) sessionIds.push(id);
  }
  const titles = new Map();
  if (typeof query?.readTitleSnapshots === "function" && sessionIds.length > 0) {
    try {
      const results = await query.readTitleSnapshots(sessionIds);
      for (const result of results ?? []) {
        if (result?.status === "fulfilled") titles.set(result.sessionId, result.value?.title?.title ?? "");
      }
    } catch {
      // Titles are decoration; the ids remain usable without them.
    }
  }
  return {
    workspaces: workspaces.map((workspace) => ({
      id: workspace.id,
      title: workspace.title,
      path: workspace.path,
      sessions: (workspace.sessionIds ?? []).map((id) => ({ id, title: titles.get(id) ?? "" })),
    })),
  };
}

export function apply(ctx) {
  const server = ctx.webServer;
  ctx.effect(() =>
    server.register({
      kind: "exact",
      path: `/dsh-window/policy`,
      handler: async (request, response) => {
        try {
          if (request.method === "GET") {
            sendJson(response, 200, { policy: { closeAction: await readCloseAction() } });
            return;
          }
          if (request.method === "POST" || request.method === "PUT") {
            const body = await readJsonBody(request);
            const closeAction = body?.closeAction;
            if (!CLOSE_ACTIONS.has(closeAction)) {
              sendJson(response, 400, { error: "closeAction must be ask, background or quit" });
              return;
            }
            sendJson(response, 200, { policy: { closeAction: await writeCloseAction(closeAction) } });
            return;
          }
          response.writeHead(405, { allow: "GET, POST" });
          response.end();
        } catch (error) {
          sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
        }
      },
    }),
  );

  ctx.effect(() =>
    server.register({
      kind: "exact",
      path: `/dsh-window/targets`,
      handler: async (request, response) => {
        if (request.method !== "GET") {
          response.writeHead(405, { allow: "GET" });
          response.end();
          return;
        }
        try {
          sendJson(response, 200, await collectTargets(ctx));
        } catch (error) {
          sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
        }
      },
    }),
  );

  ctx.effect(() =>
    server.register({
      kind: "exact",
      path: `/dsh-window/boot-injections`,
      handler: (request, response) => {
        if (request.method !== "GET") {
          response.writeHead(405, { allow: "GET" });
          response.end();
          return;
        }
        try {
          // Fresh rows per request: client bundle revisions change on HMR, and a
          // window opened later must not boot from a stale injection table.
          sendJson(response, 200, { injections: server.collectIndexInjections() });
        } catch (error) {
          sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
        }
      },
    }),
  );
}

export { CLOSE_ACTIONS, POLICY_NAMESPACE };
