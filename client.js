/**
 * dsh-window — Client half.
 *
 * Registers a Settings section that edits the shared close-behaviour policy and
 * launches workspace / session child windows. Child windows boot with
 * `?dshWin=session&id=…` or `?dshWin=workspace&workspaceId=…` and navigate once
 * the connection is available.
 */
window.__ModuleLoader__.load({
  id: "@local/dsh-window",
  factory(require) {
    const React = require("react");
    const h = React.createElement;
    // Optional: portal the quick dialog to <body> so the sidebar's overflow and
    // transform containers cannot clip a position:fixed overlay.
    let ReactDOM = null;
    try {
      ReactDOM = require("react-dom");
    } catch {
      ReactDOM = null;
    }

    const CLOSE_ACTIONS = ["ask", "background", "quit"];

    const dicts = {
      en: {
        title: "Windows & multi-window",
        description:
          "Choose what closing the main window does, and open agents or workspaces in separate windows.",
        closeBehavior: "When the main window is closed",
        ask: "Ask every time",
        background: "Minimize to background",
        quit: "Quit completely",
        askHint: "A dialog asks whether to keep running in the background or quit. It can remember your choice.",
        backgroundHint: "DeepSeek Harness keeps running in the system tray; tasks keep going. Quit from the tray menu.",
        quitHint: "Closing the main window ends the app and stops running tasks.",
        closeActionFailed: "Could not save the close behaviour.",
        shellOn: "Desktop shell extension is installed. Close prompts and child windows are available.",
        shellOff: "Desktop shell extension is not active.",
        shellOffHint:
          "The shell extension is missing or disabled. The close behaviour is stored but cannot be enforced until the extension is reinstalled and the app restarted. Child windows are unavailable.",
        multiWindow: "Multi-window",
        multiWindowDescription:
          "Open an agent session or a whole workspace in its own window. Each window talks to the same runtime.",
        refresh: "Refresh",
        openInWindow: "Open in window",
        noWorkspaces: "No workspaces yet.",
        noSessions: "This workspace has no sessions yet; opening it starts a session in a new window.",
        untitledSession: "Untitled session",
        loading: "Loading…",
        targetsFailed: "Could not load workspaces and sessions.",
        openFailed: "Could not open a new window.",
        openWorkspace: "Open workspace",
        quickLabel: "Multi-window",
        close: "Close",
        promptTitle: "Close main window",
        promptQuestion: "Keep DeepSeek Harness running in the background, or quit completely?",
        promptBackgroundHint: "Hide to the system tray; running tasks keep going.",
        promptQuitHint: "Quit the app and stop running tasks.",
        promptRemember: "Remember my choice (change it in Settings)",
        promptCancel: "Cancel",
      },
      zh: {
        title: "窗口与多开",
        description: "设置关闭主窗口时的行为，并把指定的智能体或工作区放到独立子窗口中运行。",
        closeBehavior: "关闭主窗口时",
        ask: "每次询问",
        background: "最小化到后台",
        quit: "完全退出",
        askHint: "弹出对话框，由你选择保留后台运行还是直接退出，并可勾选不再询问。",
        backgroundHint: "DeepSeek Harness 会隐藏到系统托盘继续运行，任务不会中断；需要退出时使用托盘菜单。",
        quitHint: "关闭主窗口即退出应用，并停止正在运行的任务。",
        closeActionFailed: "关闭行为保存失败。",
        shellOn: "桌面外壳扩展已安装，关闭提示与子窗口可用。",
        shellOff: "桌面外壳扩展未生效。",
        shellOffHint:
          "未检测到外壳扩展：关闭行为会保存下来，但在重新安装扩展并重启应用之前不会生效，子窗口也无法打开。",
        multiWindow: "多窗口",
        multiWindowDescription: "把某个智能体会话或整个工作区放到独立窗口中，所有窗口共用同一个运行时。",
        refresh: "刷新",
        openInWindow: "在子窗口打开",
        noWorkspaces: "还没有工作区。",
        noSessions: "该工作区还没有会话；在子窗口打开会自动开始一个会话。",
        untitledSession: "未命名会话",
        loading: "加载中…",
        targetsFailed: "无法加载工作区与会话列表。",
        openFailed: "无法打开新窗口。",
        openWorkspace: "打开工作区",
        quickLabel: "多开",
        close: "关闭",
        promptTitle: "关闭主窗口",
        promptQuestion: "要让 DeepSeek Harness 继续在后台运行，还是完全退出？",
        promptBackgroundHint: "隐藏到系统托盘，正在运行的任务不会中断。",
        promptQuitHint: "退出应用并停止正在运行的任务。",
        promptRemember: "记住我的选择（可随时在设置中修改）",
        promptCancel: "取消",
      },
    };

    const color = {
      text: "var(--dsw-alias-label-primary)",
      muted: "var(--dsw-alias-label-secondary)",
      border: "var(--dsw-alias-border-l1)",
      borderStrong: "var(--dsw-alias-border-l2)",
      surface: "var(--dsw-alias-bg-layer-1)",
      surfaceNested: "var(--dsw-alias-bg-layer-2)",
      brand: "var(--dsw-alias-brand-primary)",
      error: "var(--dsw-alias-state-error-primary)",
      warn: "var(--dsw-alias-state-warn-primary)",
      success: "var(--dsw-alias-state-success-primary)",
    };

    const buttonBase = {
      font: "inherit",
      fontSize: 12,
      lineHeight: "20px",
      padding: "2px 10px",
      borderRadius: 6,
      border: `1px solid ${color.border}`,
      background: color.surfaceNested,
      color: color.text,
      cursor: "pointer",
      whiteSpace: "nowrap",
    };

    const STYLE_ID = "dsh-window-style";
    const CSS = [
      ".dshw-btn{transition:background-color 120ms ease,border-color 120ms ease,color 120ms ease,transform 120ms ease,box-shadow 120ms ease}",
      ".dshw-btn:hover{background-color:var(--dsw-alias-bg-layer-3)!important;border-color:var(--dsw-alias-border-l2)!important;transform:translateY(-1px);box-shadow:0 2px 10px rgba(0,0,0,.14)}",
      ".dshw-btn:active{transform:translateY(0);box-shadow:none}",
      ".dshw-btn-ghost:hover{background-color:var(--dsw-alias-bg-layer-2)!important;color:var(--dsw-alias-label-primary)!important}",
      ".dshw-choice{transition:background-color 120ms ease,border-color 120ms ease,transform 120ms ease,box-shadow 120ms ease}",
      ".dshw-choice:hover{background-color:var(--dsw-alias-bg-layer-3)!important;border-color:var(--dsw-alias-border-l2)!important;transform:translateY(-1px);box-shadow:0 6px 18px rgba(0,0,0,.18)}",
      ".dshw-choice:active{transform:translateY(0);box-shadow:none}",
      ".dshw-seg{transition:background-color 120ms ease,color 120ms ease}",
      ".dshw-seg:hover{background-color:var(--dsw-alias-bg-layer-3)!important}",
      ".dshw-row{transition:background-color 120ms ease,color 120ms ease,transform 120ms ease}",
      ".dshw-row:hover{background-color:var(--dsw-alias-bg-layer-3)!important;color:var(--dsw-alias-label-primary)!important;transform:scale(1.08)}",
      ".dshw-row:active{transform:scale(.94)}",
      "@media (prefers-reduced-motion: reduce){.dshw-btn,.dshw-choice,.dshw-seg,.dshw-row{transition:none}.dshw-btn:hover,.dshw-choice:hover,.dshw-row:hover{transform:none}}",
    ].join("\n");

    function Section(props) {
      return h(
        "section",
        {
          style: {
            border: `1px solid ${color.border}`,
            borderRadius: 10,
            background: color.surface,
            padding: 14,
            display: "flex",
            flexDirection: "column",
            gap: 10,
          },
        },
        props.children,
      );
    }

    function Row(props) {
      return h(
        "div",
        {
          style: {
            display: "flex",
            alignItems: "center",
            gap: 10,
            justifyContent: "space-between",
            flexWrap: "wrap",
          },
        },
        props.children,
      );
    }

    function Segmented(props) {
      const { value, options, onChange, disabled } = props;
      return h(
        "div",
        {
          role: "radiogroup",
          style: {
            display: "inline-flex",
            padding: 3,
            gap: 2,
            borderRadius: 8,
            background: color.surfaceNested,
            border: `1px solid ${color.border}`,
          },
        },
        options.map((option) =>
          h(
            "button",
            {
              key: option.value,
              type: "button",
              className: "dshw-seg",
              role: "radio",
              "aria-checked": value === option.value,
              disabled,
              onClick: () => onChange(option.value),
              style: {
                font: "inherit",
                fontSize: 12,
                lineHeight: "22px",
                padding: "0 12px",
                borderRadius: 6,
                border: value === option.value ? `1px solid ${color.borderStrong}` : "1px solid transparent",
                background: value === option.value ? "var(--dsw-alias-bg-layer-3)" : "transparent",
                color: value === option.value ? color.text : color.muted,
                fontWeight: value === option.value ? 600 : 400,
                cursor: disabled ? "default" : "pointer",
                opacity: disabled ? 0.6 : 1,
              },
            },
            option.label,
          ),
        ),
      );
    }

    function Hint(props) {
      return h("p", { style: { margin: 0, fontSize: 12, lineHeight: "18px", color: color.muted } }, props.children);
    }

    function makeComponent(t) {
      function WindowSettings() {
        const bridge = typeof window !== "undefined" ? window.dshWindow : undefined;
        const hasBridge = Boolean(bridge && typeof bridge.open === "function");

        const [policy, setPolicy] = React.useState(null);
        const [saving, setSaving] = React.useState(false);
        const [notice, setNotice] = React.useState("");
        const [targets, setTargets] = React.useState(null);
        const [targetsError, setTargetsError] = React.useState("");
        const [refreshing, setRefreshing] = React.useState(false);

        React.useEffect(() => {
          let alive = true;
          (async () => {
            try {
              let action;
              if (hasBridge && typeof bridge.getPolicy === "function") {
                const result = await bridge.getPolicy();
                action = result?.policy?.closeAction;
              } else {
                const response = await fetch("/dsh-window/policy", { cache: "no-store" });
                const json = await response.json();
                action = json?.policy?.closeAction;
              }
              if (alive) setPolicy(CLOSE_ACTIONS.includes(action) ? action : "ask");
            } catch {
              if (alive) setPolicy("ask");
            }
          })();
          return () => {
            alive = false;
          };
        }, [hasBridge]);

        const loadTargets = React.useCallback(async () => {
          setRefreshing(true);
          setTargetsError("");
          try {
            const response = await fetch("/dsh-window/targets", { cache: "no-store" });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const json = await response.json();
            setTargets(Array.isArray(json?.workspaces) ? json.workspaces : []);
          } catch (error) {
            setTargetsError(String(error?.message ?? error));
          } finally {
            setRefreshing(false);
          }
        }, []);

        React.useEffect(() => {
          loadTargets();
        }, [loadTargets]);

        const choose = async (action) => {
          if (action === policy || saving) return;
          setSaving(true);
          setNotice("");
          try {
            if (hasBridge && typeof bridge.setPolicy === "function") await bridge.setPolicy(action);
            else {
              const response = await fetch("/dsh-window/policy", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ closeAction: action }),
              });
              if (!response.ok) throw new Error(`HTTP ${response.status}`);
            }
            setPolicy(action);
          } catch (error) {
            setNotice(`${t("closeActionFailed")} ${String(error?.message ?? error)}`);
          } finally {
            setSaving(false);
          }
        };

        const openWindow = async (kind, id) => {
          if (!hasBridge) return;
          setNotice("");
          try {
            const result = await bridge.open({ kind, id });
            if (result && result.ok === false) setNotice(result.error ? `${t("openFailed")} ${result.error}` : t("openFailed"));
          } catch (error) {
            setNotice(`${t("openFailed")} ${String(error?.message ?? error)}`);
          }
        };

        const options = [
          { value: "ask", label: t("ask") },
          { value: "background", label: t("background") },
          { value: "quit", label: t("quit") },
        ];
        const hint =
          policy === "background" ? t("backgroundHint") : policy === "quit" ? t("quitHint") : t("askHint");

        return h(
          "div",
          { style: { display: "flex", flexDirection: "column", gap: 16, color: color.text } },

          h(
            "header",
            { style: { display: "flex", flexDirection: "column", gap: 4 } },
            h("h2", { style: { margin: 0, fontSize: 16, fontWeight: 600 } }, t("title")),
            h("p", { style: { margin: 0, fontSize: 13, lineHeight: "20px", color: color.muted } }, t("description")),
          ),

          h(
            Section,
            null,
            h(
              Row,
              null,
              h("span", { style: { fontSize: 13, fontWeight: 600 } }, t("closeBehavior")),
              policy === null
                ? h("span", { style: { fontSize: 12, color: color.muted } }, t("loading"))
                : h(Segmented, { value: policy, options, onChange: choose, disabled: saving }),
            ),
            h(Hint, null, hint),
            h(
              "div",
              {
                style: {
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 12,
                  color: hasBridge ? color.success : color.warn,
                },
              },
              h("span", { "aria-hidden": true }, hasBridge ? "●" : "○"),
              h("span", null, hasBridge ? t("shellOn") : t("shellOff")),
            ),
            hasBridge ? null : h(Hint, null, t("shellOffHint")),
            notice === "" ? null : h("p", { style: { margin: 0, fontSize: 12, color: color.error } }, notice),
          ),

          h(
            Section,
            null,
            h(
              Row,
              null,
              h(
                "div",
                { style: { display: "flex", flexDirection: "column", gap: 2 } },
                h("span", { style: { fontSize: 13, fontWeight: 600 } }, t("multiWindow")),
                h("span", { style: { fontSize: 12, color: color.muted } }, t("multiWindowDescription")),
              ),
              h(
                "button",
                { type: "button", className: "dshw-btn", style: buttonBase, onClick: loadTargets, disabled: refreshing },
                t("refresh"),
              ),
            ),

            targetsError === "" ? null : h("p", { style: { margin: 0, fontSize: 12, color: color.error } }, `${t("targetsFailed")} ${targetsError}`),

            targets === null
              ? h("p", { style: { margin: 0, fontSize: 12, color: color.muted } }, t("loading"))
              : targets.length === 0
                ? h("p", { style: { margin: 0, fontSize: 12, color: color.muted } }, t("noWorkspaces"))
                : h(
                    "ul",
                    { style: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 } },
                    targets.map((workspace) =>
                      h(
                        "li",
                        {
                          key: workspace.id,
                          style: {
                            border: `1px solid ${color.border}`,
                            borderRadius: 8,
                            padding: 10,
                            background: color.surfaceNested,
                            display: "flex",
                            flexDirection: "column",
                            gap: 8,
                          },
                        },
                        h(
                          Row,
                          null,
                          h(
                            "div",
                            { style: { display: "flex", flexDirection: "column", gap: 2, minWidth: 0 } },
                            h("span", { style: { fontSize: 13, fontWeight: 600 } }, workspace.title || workspace.path),
                            h(
                              "span",
                              {
                                style: {
                                  fontSize: 11,
                                  color: color.muted,
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                  maxWidth: 460,
                                },
                                title: workspace.path,
                              },
                              workspace.path,
                            ),
                          ),
                          h(
                            "button",
                            {
                              type: "button",
                              className: "dshw-btn",
                              style: { ...buttonBase, opacity: hasBridge ? 1 : 0.5, cursor: hasBridge ? "pointer" : "default" },
                              disabled: !hasBridge,
                              onClick: () => openWindow("workspace", workspace.id),
                            },
                            t("openWorkspace"),
                          ),
                        ),
                        workspace.sessions.length === 0
                          ? h("span", { style: { fontSize: 11, color: color.muted } }, t("noSessions"))
                          : h(
                              "ul",
                              { style: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 } },
                              workspace.sessions.map((session) =>
                                h(
                                  "li",
                                  {
                                    key: session.id,
                                    style: {
                                      display: "flex",
                                      alignItems: "center",
                                      justifyContent: "space-between",
                                      gap: 8,
                                      padding: "4px 8px",
                                      borderRadius: 6,
                                      background: color.surface,
                                      border: `1px solid ${color.border}`,
                                    },
                                  },
                                  h(
                                    "div",
                                    { style: { display: "flex", flexDirection: "column", gap: 1, minWidth: 0 } },
                                    h("span", { style: { fontSize: 12 } }, session.title || t("untitledSession")),
                                    h("span", { style: { fontSize: 10, color: color.muted } }, session.id),
                                  ),
                                  h(
                                    "button",
                                    {
                                      type: "button",
                                      className: "dshw-btn",
                              style: { ...buttonBase, opacity: hasBridge ? 1 : 0.5, cursor: hasBridge ? "pointer" : "default" },
                                      disabled: !hasBridge,
                                      onClick: () => openWindow("session", session.id),
                                    },
                                    t("openInWindow"),
                                  ),
                                ),
                              ),
                            ),
                      ),
                    ),
                  ),
          ),
        );
      }
      WindowSettings.displayName = "DshWindowSettings";
      return WindowSettings;
    }

    /** In a child window, select the requested target once the connection is live. */
    function navigateRequestedTarget(ctx) {
      let params;
      try {
        params = new URLSearchParams(window.location.search);
      } catch {
        return () => {};
      }
      const kind = params.get("dshWin");
      const id = kind === "session" ? params.get("id") : kind === "workspace" ? params.get("workspaceId") : null;
      if (!kind || !id) return () => {};

      let done = false;
      const attempt = () => {
        if (done) return;
        const ui = ctx.get("uiWorkspace");
        if (!ui) return;
        try {
          if (kind === "session") {
            ui.openSession(id);
            done = true;
          } else {
            const pending = ui.openWorkspace(id);
            done = true;
            if (pending && typeof pending.catch === "function") pending.catch(() => {});
          }
        } catch {
          // Not ready yet; the next event or tick retries.
        }
      };

      const off = ctx.on("connection/reset", attempt);
      const timer = setInterval(attempt, 600);
      const stop = setTimeout(() => clearInterval(timer), 20000);
      attempt();
      return () => {
        off();
        clearInterval(timer);
        clearTimeout(stop);
      };
    }

    /** Sidebar-foot shortcut that opens the window settings in a dialog. */
    // In-app close prompt. The shell extension calls window.__dshWindowPrompt()
    // and waits for the answer, so closing the window uses the app's own dialog
    // instead of a native message box.
    let promptRequest = null;
    const promptSubscribers = new Set();

    function answerPrompt(answer) {
      const request = promptRequest;
      if (request === null) return;
      promptRequest = null;
      for (const notify of promptSubscribers) notify();
      request.resolve(answer);
    }

    function requestClosePrompt() {
      if (promptRequest !== null) return promptRequest.promise;
      let resolve;
      const promise = new Promise((done) => {
        resolve = done;
      });
      promptRequest = { resolve, promise };
      for (const notify of promptSubscribers) notify();
      return promise;
    }

    function makeClosePromptHost(t) {
      function ClosePromptHost() {
        const [remember, setRemember] = React.useState(false);
        const [, bump] = React.useState(0);
        const open = promptRequest !== null;

        React.useEffect(() => {
          const notify = () => bump((value) => value + 1);
          promptSubscribers.add(notify);
          // Tells the shell extension that this window can render the prompt.
          window.__dshWindowPromptReady = true;
          return () => {
            promptSubscribers.delete(notify);
            if (window.__dshWindowPromptReady === true) delete window.__dshWindowPromptReady;
          };
        }, []);

        React.useEffect(() => {
          if (open) setRemember(false);
        }, [open]);

        React.useEffect(() => {
          if (!open) return undefined;
          const onKey = (event) => {
            if (event.key === "Escape") answerPrompt({ choice: "cancel", remember: false });
          };
          window.addEventListener("keydown", onKey);
          return () => window.removeEventListener("keydown", onKey);
        }, [open]);

        if (!open) return null;

        const cancel = () => answerPrompt({ choice: "cancel", remember: false });
        const choice = (value, label, hint, accent) =>
          h(
            "button",
            {
              type: "button",
              className: "dshw-choice",
              onClick: () => answerPrompt({ choice: value, remember }),
              style: {
                font: "inherit",
                textAlign: "left",
                display: "flex",
                flexDirection: "column",
                gap: 3,
                width: "100%",
                padding: "10px 12px",
                borderRadius: 10,
                cursor: "pointer",
                border: `1px solid ${color.border}`,
                background: color.surfaceNested,
                color: color.text,
              },
            },
            h("span", { style: { fontSize: 13, fontWeight: 600, color: accent || color.text } }, label),
            h("span", { style: { fontSize: 12, color: color.muted, lineHeight: "18px" } }, hint),
          );

        const dialog = h(
          "div",
          {
            role: "presentation",
            onMouseDown: (event) => {
              if (event.target === event.currentTarget) cancel();
            },
            style: {
              position: "fixed",
              inset: 0,
              zIndex: 1200,
              background: "rgba(0, 0, 0, 0.42)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 24,
            },
          },
          h(
            "div",
            {
              role: "dialog",
              "aria-modal": "true",
              "aria-label": t("promptTitle"),
              style: {
                width: "min(440px, 100%)",
                display: "flex",
                flexDirection: "column",
                gap: 10,
                padding: 18,
                borderRadius: 14,
                background: color.surface,
                border: `1px solid ${color.borderStrong}`,
                boxShadow: "0 24px 60px rgba(0, 0, 0, 0.38)",
              },
            },
            h("div", { style: { fontSize: 15, fontWeight: 600, color: color.text } }, t("promptTitle")),
            h(
              "div",
              { style: { fontSize: 13, color: color.muted, marginBottom: 4, lineHeight: "20px" } },
              t("promptQuestion"),
            ),
            choice("background", t("background"), t("promptBackgroundHint")),
            choice("quit", t("quit"), t("promptQuitHint"), color.error),
            h(
              "div",
              {
                style: {
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  marginTop: 6,
                  flexWrap: "wrap",
                },
              },
              h(
                "label",
                {
                  style: {
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    fontSize: 12,
                    color: color.muted,
                    cursor: "pointer",
                  },
                },
                h("input", {
                  type: "checkbox",
                  checked: remember,
                  onChange: (event) => setRemember(event.target.checked),
                }),
                t("promptRemember"),
              ),
              h(
                "button",
                { type: "button", className: "dshw-btn", onClick: cancel, style: { ...buttonBase, padding: "6px 14px" } },
                t("promptCancel"),
              ),
            ),
          ),
        );

        return ReactDOM !== null ? ReactDOM.createPortal(dialog, document.body) : dialog;
      }

      ClosePromptHost.displayName = "DshWindowClosePrompt";
      return ClosePromptHost;
    }

    function makeQuickEntry(t) {
      const SettingsBody = makeComponent(t);

      function QuickEntry(props) {
        const wide = Boolean(props && props.wide);
        const [open, setOpen] = React.useState(false);

        React.useEffect(() => {
          if (!open) return undefined;
          const onKey = (event) => {
            if (event.key === "Escape") setOpen(false);
          };
          window.addEventListener("keydown", onKey);
          return () => window.removeEventListener("keydown", onKey);
        }, [open]);

        const trigger = h(
          "button",
          {
            type: "button",
            className: "dshw-btn dshw-btn-ghost",
            title: t("quickLabel"),
            "aria-label": t("quickLabel"),
            "aria-haspopup": "dialog",
            "aria-expanded": open,
            onClick: () => setOpen(true),
            style: {
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              width: wide ? "auto" : 36,
              flex: "none",
              height: 36,
              padding: wide ? "0 10px" : 0,
              borderRadius: 10,
              border: `1px solid ${color.border}`,
              background: "transparent",
              color: color.muted,
              font: "inherit",
              fontSize: 13,
              cursor: "pointer",
              overflow: "hidden",
              whiteSpace: "nowrap",
            },
          },
          h(
            "svg",
            { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", "aria-hidden": true, style: { flex: "none" } },
            h("rect", { x: 2.5, y: 3.5, width: 13, height: 11, rx: 2.4, stroke: "currentColor", strokeWidth: 1.6 }),
            h("rect", {
              x: 8.5,
              y: 9.5,
              width: 13,
              height: 11,
              rx: 2.4,
              stroke: "currentColor",
              strokeWidth: 1.6,
              fill: "var(--dsw-alias-bg-base)",
            }),
          ),
          wide ? h("span", { style: { overflow: "hidden", textOverflow: "ellipsis" } }, t("quickLabel")) : null,
        );

        if (!open) return trigger;

        const dialog = h(
          "div",
          {
            role: "presentation",
            onMouseDown: (event) => {
              if (event.target === event.currentTarget) setOpen(false);
            },
            style: {
              position: "fixed",
              inset: 0,
              zIndex: 1100,
              background: "rgba(0, 0, 0, 0.38)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 24,
            },
          },
            h(
              "div",
              {
                role: "dialog",
                "aria-modal": true,
                "aria-label": t("title"),
                style: {
                  width: "min(760px, 100%)",
                  maxHeight: "84vh",
                  overflow: "auto",
                  background: color.surface,
                  border: `1px solid ${color.borderStrong}`,
                  borderRadius: 14,
                  padding: 18,
                  boxShadow: "0 24px 80px rgba(0, 0, 0, 0.45)",
                },
              },
              h(
                "div",
                {
                  style: {
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    marginBottom: 8,
                  },
                },
                h("span", { style: { fontSize: 13, fontWeight: 600, color: color.muted } }, t("quickLabel")),
                h(
                  "button",
                  {
                    type: "button",
                    className: "dshw-btn dshw-btn-ghost",
                    onClick: () => setOpen(false),
                    "aria-label": t("close"),
                    style: { ...buttonBase, padding: "2px 8px" },
                  },
                  "✕",
                ),
              ),
              h(SettingsBody),
            ),
        );

        const portal =
          ReactDOM !== null &&
          typeof ReactDOM.createPortal === "function" &&
          typeof document !== "undefined" &&
          document.body !== null
            ? ReactDOM.createPortal(dialog, document.body)
            : dialog;
        return h(React.Fragment, null, trigger, portal);
      }

      QuickEntry.displayName = "DshWindowQuickEntry";
      return QuickEntry;
    }

    function makeSessionRowAction(t) {
      function SessionRowAction(props) {
        const bridge = typeof window !== "undefined" ? window.dshWindow : undefined;
        const sessionId = props && props.sessionId;
        if (!bridge || typeof bridge.open !== "function" || !sessionId) return null;
        const shown = (props && props.displayTitle) || t("untitledSession");
        const label = `${t("openInWindow")}: ${shown}`;
        return h(
          "button",
          {
            type: "button",
            className: "dshw-row",
            title: label,
            "aria-label": label,
            onClick: (event) => {
              event.stopPropagation();
              Promise.resolve(bridge.open({ kind: "session", id: sessionId })).catch(() => {});
            },
            style: {
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 22,
              height: 22,
              padding: 0,
              borderRadius: 6,
              border: "none",
              background: "transparent",
              color: color.muted,
              cursor: "pointer",
              flex: "none",
            },
          },
          h(
            "svg",
            { width: 14, height: 14, viewBox: "0 0 24 24", fill: "none", "aria-hidden": true },
            h("rect", { x: 2.5, y: 3.5, width: 13, height: 11, rx: 2.4, stroke: "currentColor", strokeWidth: 1.8 }),
            h("rect", {
              x: 8.5,
              y: 9.5,
              width: 13,
              height: 11,
              rx: 2.4,
              stroke: "currentColor",
              strokeWidth: 1.8,
              fill: "var(--dsw-alias-bg-base)",
            }),
          ),
        );
      }
      SessionRowAction.displayName = "DshWindowSessionRowAction";
      return SessionRowAction;
    }

    return {
      inject: ["slots", "locale"],
      apply(ctx) {
        const t = ctx.locale.bind("dsh-window");

        ctx.effect(() => {
          if (typeof document === "undefined") return undefined;
          const style = document.createElement("style");
          style.id = STYLE_ID;
          style.textContent = CSS;
          document.head.appendChild(style);
          return () => style.remove();
        });

        ctx.effect(() => {
          const disposers = [];
          for (const [locale, dict] of [
            ["en", dicts.en],
            ["zh", dicts.zh],
          ]) {
            try {
              disposers.push(ctx.locale.register("dsh-window", locale, dict));
            } catch {
              // Unsupported locale id: keep the remaining dictionaries.
            }
          }
          return () => {
            for (const dispose of disposers) dispose();
          };
        });

        ctx.effect(() => navigateRequestedTarget(ctx));

        // The desktop shell extension calls this while the window is closing.
        ctx.effect(() => {
          const hook = () => requestClosePrompt();
          window.__dshWindowPrompt = hook;
          return () => {
            if (window.__dshWindowPrompt === hook) delete window.__dshWindowPrompt;
            answerPrompt({ choice: "cancel", remember: false });
          };
        });

        ctx.slots.inject("settings.section", () =>
          ctx.slots.register(
            {
              name: "settings.section",
              id: "window",
              order: 120,
              label: () => t("title"),
            },
            makeComponent(t),
          ),
        );

        ctx.slots.inject("sidebar.footer.action", () =>
          ctx.slots.register(
            {
              name: "sidebar.footer.action",
              id: "window",
              order: 15,
              label: () => t("quickLabel"),
            },
            makeQuickEntry(t),
          ),
        );

        ctx.slots.inject("sidebar.workspaces.session.row.action", () =>
          ctx.slots.register(
            {
              name: "sidebar.workspaces.session.row.action",
              id: "window",
              order: 150,
              label: () => t("openInWindow"),
            },
            makeSessionRowAction(t),
          ),
        );

        ctx.slots.inject("shell.overlay", () =>
          ctx.slots.register(
            {
              name: "shell.overlay",
              id: "window-close-prompt",
              order: 120,
            },
            makeClosePromptHost(t),
          ),
        );
      },
    };
  },
});
