# Dev Control Center — Technical Architecture & Codebase Guide

This document is the **single source of truth** for the codebase architecture, design decisions, data contracts, and modification guidelines for **Dev Control Center**.

---

## 1. Core Principles & Design Boundaries

1. **Production-Grade & Native**: UI adapts automatically to VS Code themes (`Dark`, `Light`, `High Contrast`) via native CSS variables (`--vscode-*`).
2. **Zero Privileged Code in Webview**: The Webview runs inside a sandboxed iframe with strict Content Security Policy (CSP). Privileged Node.js APIs (`child_process`, `fs`, `os`) run strictly within the Extension Host.
3. **Explicit Type-Safe Message Passing**: All communication between Webview $\leftrightarrow$ Extension Host occurs via strongly-typed messages defined in [`src/webview/messages.ts`](file:///C:/Users/risha/Desktop/Rishab/Dev/portManager/src/webview/messages.ts).
4. **Resilience & Fault Tolerance**: No operation (process inspection, netstat, terminal exit, permission denial) is permitted to crash the extension. All errors log to the dedicated `Dev Control Center` OutputChannel.
5. **No AI in Core Extension**: The tool is an intentionally lean, fast, keyboard-first developer control panel.

---

## 2. Directory Structure & File Map

```text
portManager/
├── package.json                         # Extension manifest (contributions, commands, configuration)
├── tsconfig.json                        # TypeScript strict compiler config
├── esbuild.js                           # Extension host build config (platform: node, target: ES2022)
├── esbuild.webview.js                   # Webview client build config (platform: browser, bundled with xterm)
├── esbuild.test.js                      # Unit test bundler
├── .vscodeignore                        # Release packaging filters for lean VSIX
├── README.md                            # End-user documentation
├── ARCHITECTURE.md                      # Complete developer & architecture reference (THIS FILE)
│
├── media/
│   ├── styles.css                       # Webview stylesheet using VS Code theme variables
│   └── icons/
│       └── control-center.svg           # Activity bar icon (SVG)
│
├── src/
│   ├── extension.ts                     # Extension activation, dependency injection & disposal
│   │
│   ├── types/
│   │   └── index.ts                     # Shared interfaces (PortInfo, ProcessInfo, SavedCommand, etc.)
│   │
│   ├── utils/
│   │   ├── platform.ts                  # isWindows(), isMacOS(), isLinux() platform guards
│   │   ├── debounce.ts                  # debounce() & throttle() helpers
│   │   └── formatters.ts                # formatBytes(), formatTime(), truncateString(), cleanAnsi()
│   │
│   ├── services/
│   │   ├── OutputChannelService.ts      # Singleton VS Code OutputChannel ("Dev Control Center")
│   │   ├── ConfigService.ts             # Typed wrapper around vscode.workspace.getConfiguration()
│   │   └── StatusBarService.ts          # VS Code Status Bar item displaying active listening ports
│   │
│   ├── workspace/
│   │   └── WorkspaceService.ts          # Multi-folder workspace resolver & CWD manager
│   │
│   ├── processes/
│   │   ├── types.ts                     # DetailedProcessInfo interface
│   │   └── ProcessService.ts            # Cross-platform CLI inspection (PowerShell/CIM, ps) & process termination
│   │
│   ├── ports/
│   │   ├── IPortService.ts              # PortService abstraction interface
│   │   ├── PortService.ts               # Facade with 800ms cache & OS delegator
│   │   ├── WindowsPortService.ts        # Windows netstat -ano -p tcp + tasklist batch PID lookup
│   │   ├── MacPortService.ts            # macOS lsof -iTCP -sTCP:LISTEN -n -P + ps
│   │   ├── LinuxPortService.ts          # Linux ss -tulpn / lsof / netstat
│   │   └── FrameworkDetector.ts         # Heuristic runtime & framework detector (Next.js, Vite, FastAPI, etc.)
│   │
│   ├── terminal/
│   │   ├── ITerminalService.ts          # Terminal management interface
│   │   ├── ShellDetector.ts             # Auto-detects PowerShell 7, WinPS, CMD, Git Bash, WSL, zsh, bash, fish
│   │   ├── TerminalSession.ts           # Spawns interactive shell child_process with stdin/stdout/stderr pipes
│   │   └── TerminalSessionManager.ts    # Multi-tab session manager with scrollback history & data emitter
│   │
│   ├── savedCommands/
│   │   ├── types.ts                     # CreateCommandDto, UpdateCommandDto
│   │   └── SavedCommandService.ts       # Persistence in globalState (Global) & workspaceState (Workspace)
│   │
│   ├── webview/
│   │   ├── messages.ts                  # Type contracts for Webview <-> Extension Host messages
│   │   ├── htmlHelper.ts                # Nonce-based CSP HTML shell generator
│   │   ├── DevControlCenterViewProvider.ts # Sidebar WebviewViewProvider (devControlCenter.sidebarView)
│   │   ├── DevControlCenterPanel.ts     # Editor tab WebviewPanel (devControlCenter.openInEditor)
│   │   ├── WebviewMessageHandler.ts     # Central message router & port auto-refresh timer manager
│   │   └── ui/
│   │       └── index.ts                 # Webview application (xterm.js instances, ports table, commands CRUD, modals)
│   │
│   └── commands/
│       ├── index.ts
│       └── registerCommands.ts          # VS Code Command Palette & keyboard shortcut handlers
│
└── test/
    ├── vscodeMock.js                    # Comprehensive standalone mock for VS Code APIs
    ├── runUnitTests.js                  # Mocha test runner
    └── unit/
        ├── frameworkDetector.test.ts    # 8 Framework detection tests
        ├── portService.test.ts          # 5 Port & Process service tests
        ├── savedCommands.test.ts        # 7 Saved Commands CRUD & persistence tests
        ├── terminal.test.ts             # 5 Terminal lifecycle & stream tests
        └── webviewMessageHandler.test.ts # 3 Webview message passing tests
```

---

## 3. Data Models & Schemas

### PortInfo (`src/types/index.ts`)
```typescript
interface PortInfo {
  port: number;
  pid: number;
  processName: string;
  protocol: 'TCP' | 'UDP';
  address: string;
  runtime?: string;    // 'node' | 'python' | 'java' | 'dotnet' | 'go' | 'ruby' | 'php' | 'postgres' | 'redis' | 'docker' | etc.
  framework?: string;  // 'Next.js' | 'Vite' | 'FastAPI' | 'Django' | 'Spring Boot' | 'PostgreSQL' | etc.
  command?: string;
  cpu?: string;
  memory?: string;
  started?: string;
  status: 'listening' | 'established' | 'closed';
}
```

### SavedCommand (`src/types/index.ts`)
```typescript
interface SavedCommand {
  id: string;               // e.g. "cmd-1725028392-a1b2c"
  name: string;             // User-friendly name
  command: string;          // Executable shell command string
  description?: string;     // Optional details
  workingDirectory?: string;// Custom path or defaults to workspace root
  shell?: string;           // Optional specific shell override
  scope: 'workspace' | 'global';
  createdAt: number;
  updatedAt: number;
}
```

### TerminalSessionInfo (`src/types/index.ts`)
```typescript
interface TerminalSessionInfo {
  id: string;        // e.g. "term-1725028392-1"
  name: string;      // e.g. "Terminal 1" or user renamed
  cwd: string;       // Working directory
  shell: string;     // Full shell executable path
  createdAt: number;
  isActive: boolean;
  isAlive: boolean;
}
```

---

## 4. Message Passing Protocol

All messages are exchanged through `vscode.postMessage(msg)` (Webview $\to$ Host) and `webview.postMessage(msg)` (Host $\to$ Webview).

### Webview to Extension Host (`WebviewToExtensionMessage`)

| Message Type | Payload | Action Performed |
| :--- | :--- | :--- |
| `init` | `{}` | Requests complete `state:init` payload on load |
| `switchTab` | `{ tab: 'terminal' \| 'ports' \| 'commands' \| 'settings' }` | Updates active tab; triggers port scan if `ports` |
| `terminal:create` | `{ options?: { name, cwd, shell } }` | Creates a new `TerminalSession` |
| `terminal:select` | `{ id: string }` | Marks session active & sends scrollback |
| `terminal:close` | `{ id: string }` | Kills process and disposes session |
| `terminal:rename` | `{ id: string, name: string }` | Renames session tab |
| `terminal:restart`| `{ id: string }` | Restarts terminal session process |
| `terminal:kill` | `{ id: string }` | Kills session child process |
| `terminal:input` | `{ id: string, data: string }` | Writes raw keystroke/data to shell stdin |
| `terminal:resize` | `{ id: string, cols: number, rows: number }` | Sends resize event |
| `terminal:requestScrollback` | `{ id: string }` | Requests historical buffer for session |
| `ports:refresh` | `{}` | Forces immediate TCP port scan |
| `ports:toggleAutoRefresh` | `{ enabled: boolean }` | Updates `devControlCenter.autoRefreshPorts` |
| `ports:openBrowser` | `{ port: number }` | Opens `http://localhost:<port>` in browser |
| `ports:copyUrl` | `{ port: number }` | Copies `http://localhost:<port>` to clipboard |
| `ports:killProcess` | `{ pid, port, processName }` | Prompts confirmation if enabled & terminates process |
| `ports:inspectProcess` | `{ port, pid }` | Queries detailed memory, command line, start time |
| `commands:add` | `{ dto: CreateCommandDto }` | Persists new saved command |
| `commands:update` | `{ id, dto: UpdateCommandDto }` | Updates existing saved command |
| `commands:delete` | `{ id: string }` | Removes saved command |
| `commands:duplicate` | `{ id: string }` | Creates a copy of saved command |
| `commands:run` | `{ id: string, inNewTerminal?: boolean }` | Sends command string + `\r\n` to terminal |
| `settings:update` | `{ key, value }` | Updates VS Code configuration |

### Extension Host to Webview (`ExtensionToWebviewMessage`)

| Message Type | Payload | Webview Handling |
| :--- | :--- | :--- |
| `state:init` | `{ payload: InitialStatePayload }` | Initializes all tabs, sessions, ports, commands & settings |
| `terminal:sessions` | `{ sessions, activeSessionId }` | Re-renders terminal tab bar |
| `terminal:data` | `{ id: string, data: string }` | Passes raw string to `xterm.write(data)` |
| `terminal:scrollback` | `{ id: string, data: string }` | Populates initial terminal scrollback on tab switch |
| `ports:list` | `{ ports: PortInfo[] }` | Re-renders ports table and updates nav badge |
| `ports:inspectResult` | `{ port, process: ProcessInfo }` | Populates Process Details modal |
| `commands:list` | `{ commands: SavedCommand[] }` | Re-renders saved commands cards |
| `settings:updated` | `{ settings: ExtensionSettings }` | Applies font size/family & auto-refresh settings |
| `notification` | `{ level: 'info'\|'warning'\|'error', message }` | Displays bottom-right toast banner |
| `switchTab` | `{ tab }` | Switches active tab in UI |

---

## 5. Subsystem Implementations

### A. Terminal Subsystem
- Located in [`src/terminal/`](file:///C:/Users/risha/Desktop/Rishab/Dev/portManager/src/terminal).
- **Interactive Shell Process**: `TerminalSession` spawns native shell processes using `child_process.spawn`.
  - Windows: `powershell.exe -NoLogo -NoExit`, `cmd.exe /K`, or `bash.exe -i`.
  - Unix: `zsh -i` or `bash -i`.
- **Environment**: Sets `TERM=xterm-256color`, `COLORTERM=truecolor`, `FORCE_COLOR=3` for rich ANSI formatting.
- **Scrollback Buffer**: Maintains circular history buffer (1,000 lines) per session so switching between tabs never loses terminal text.
- **UI Terminal Emulator**: Uses `@xterm/xterm` with `@xterm/addon-fit` for responsive resizing via `ResizeObserver`.

### B. Ports Subsystem
- Located in [`src/ports/`](file:///C:/Users/risha/Desktop/Rishab/Dev/portManager/src/ports).
- **PortService**: Implements `IPortService` with an 800ms cache TTL to avoid hammering the OS during rapid polling.
- **Windows Implementation**:
  - `netstat -ano -p tcp` extracts listening TCP ports and PIDs in $<50\text{ ms}$.
  - Unique PIDs are resolved to process names in a single batch call via `tasklist /FO CSV /NH`.
- **macOS / Linux Implementation**:
  - Uses `lsof -iTCP -sTCP:LISTEN -n -P` and `ss -tulpn`.
- **Framework Detection Heuristic (`FrameworkDetector.ts`)**:
  - Checks process name, command line, and standard port mappings.
  - Matches Node frameworks (Next.js, Vite, React, Remix, Astro, Nuxt, SvelteKit, NestJS, Express, Storybook).
  - Matches Python frameworks (FastAPI/uvicorn, Django, Flask, Streamlit).
  - Matches Java (Spring Boot, Quarkus, Tomcat), .NET (ASP.NET Core), PHP (Laravel).
  - Matches common database ports (Postgres `5432`, MySQL `3306`, Redis `6379`, MongoDB `27017`, Elasticsearch `9200`).

### C. Saved Commands Subsystem
- Located in [`src/savedCommands/`](file:///C:/Users/risha/Desktop/Rishab/Dev/portManager/src/savedCommands).
- **Storage Keys**:
  - Global: `ExtensionContext.globalState` key `devControlCenter.savedCommands.global`
  - Workspace: `ExtensionContext.workspaceState` key `devControlCenter.savedCommands.workspace`
- **Default Seed Commands**: Automatically seeds `Start Dev Server`, `Git Status`, `Git Pull & Rebase` if storage is empty.
- **Execution Flow**: When Run is clicked, the command is dispatched to `TerminalSessionManager.sendText(sessionId, command, true)`.

---

## 6. How to Extend or Modify

### Adding a New Port Framework Detection Rule
1. Open [`src/ports/FrameworkDetector.ts`](file:///C:/Users/risha/Desktop/Rishab/Dev/portManager/src/ports/FrameworkDetector.ts).
2. Add heuristic checks for process name, command line string, or port number under `detect()`.
3. Add a corresponding unit test in [`test/unit/frameworkDetector.test.ts`](file:///C:/Users/risha/Desktop/Rishab/Dev/portManager/test/unit/frameworkDetector.test.ts).
4. Run `npm test` to verify.

### Adding a New Configuration Setting
1. Add property to `contributes.configuration.properties` in [`package.json`](file:///C:/Users/risha/Desktop/Rishab/Dev/portManager/package.json).
2. Add the field to `ExtensionSettings` in [`src/types/index.ts`](file:///C:/Users/risha/Desktop/Rishab/Dev/portManager/src/types/index.ts).
3. Update `getSettings()` in [`src/services/ConfigService.ts`](file:///C:/Users/risha/Desktop/Rishab/Dev/portManager/src/services/ConfigService.ts).
4. Expose the control in the Settings modal in [`src/webview/ui/index.ts`](file:///C:/Users/risha/Desktop/Rishab/Dev/portManager/src/webview/ui/index.ts).

### Adding a New Webview Message
1. Define the message payload in [`src/webview/messages.ts`](file:///C:/Users/risha/Desktop/Rishab/Dev/portManager/src/webview/messages.ts).
2. Add a handler branch in `WebviewMessageHandler.handleMessage()` in [`src/webview/WebviewMessageHandler.ts`](file:///C:/Users/risha/Desktop/Rishab/Dev/portManager/src/webview/WebviewMessageHandler.ts).
3. Call `vscode.postMessage({ type: '...' })` or handle incoming messages in [`src/webview/ui/index.ts`](file:///C:/Users/risha/Desktop/Rishab/Dev/portManager/src/webview/ui/index.ts).

---

## 7. Build & Test Commands

```bash
# Compile TypeScript to check for type errors
npm run compile

# Build both Extension and Webview bundles
npm run build

# Run all 28 automated Mocha unit tests
npm test

# Package into production VSIX
npx @vscode/vsce package --no-git-tag-version
```
