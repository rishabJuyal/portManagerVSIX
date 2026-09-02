# Dev Control Center (VS Code Extension)

**Dev Control Center** is a fast, focused, production-grade developer control center inside VS Code combining:

1. 💻 **Full-featured Integrated Terminal** (multi-session tabs, shell auto-discovery, ANSI output, scrollback, toolbar controls)
2. 🔌 **Port & Process Management** (real-time TCP port scanning, framework detection, 1-click browser launch, URL copy, PID inspection, safe process termination)
3. 💾 **Saved & Reusable Commands** (workspace-scoped & global commands, search filter, 1-click execution, inline editing, duplication)
4. 📂 **Workspace Awareness** (automatic multi-folder workspace detection, directory badges, CWD switching)
5. ⌨️ **Keyboard-First Workflow** (fast navigation, search shortcuts, Command Palette integration)
6. 🎨 **Native VS Code Look & Feel** (adapts dynamically to dark, light, and high-contrast themes)

---

## 🌟 Key Features

### 1. Integrated Multi-Tab Terminal
- **True Interactive Shell**: Runs directly against native shells with full ANSI color rendering, cursor control, resizing, and signal handling.
- **Multiple Concurrent Sessions**: Open multiple terminals side-by-side or tabbed, rename sessions, and switch instantly.
- **Shell Auto-Discovery**: Automatically detects PowerShell 7 (`pwsh`), Windows PowerShell, Command Prompt (`cmd.exe`), Git Bash, WSL on Windows, and `zsh`, `bash`, `fish` on macOS and Linux.
- **Session Persistence & Scrollback**: Terminal output history is preserved across tab navigation and view changes.
- **Compact Toolbar**: Quick actions for New Terminal (`+`), Restart (`↻`), Clear (`Ctrl+L`), and Terminate (`✕`).

### 2. Live Port & Process Management
- **Cross-Platform Detection**: Reliable local port scanning across Windows (`netstat`/PowerShell), macOS (`lsof`), and Linux (`ss`/`netstat`/`lsof`).
- **Development Server & Framework Recognition**: Identifies common runtimes and frameworks:
  - **Node.js**: Next.js, Vite, React, Remix, Astro, Nuxt, SvelteKit, NestJS, Express, Storybook
  - **Python**: FastAPI (uvicorn), Django, Flask, Streamlit, Tornado
  - **Java / .NET / PHP**: Spring Boot, ASP.NET Core, Laravel
  - **Databases & Services**: PostgreSQL (5432), MySQL (3306), Redis (6379), MongoDB (27017)
- **1-Click Browser Launch**: Open `http://localhost:<port>` directly in your default browser.
- **Quick Copy**: Copy localhost URL to clipboard with a single click.
- **Process Inspection**: Inspect PID, command line invocation, memory working set, CPU usage, and start time.
- **Safe Process Termination**: Kill hung or runaway development servers directly from the UI with configurable confirmation dialogs.
- **Auto-Refresh & Status Bar**: Periodic background scan with live port count in the VS Code status bar (e.g. `🔌 3 Ports`).

### 3. Saved Commands Library
- **Dual Scope Support**:
  - **Workspace Commands**: Specific to the current project / repository.
  - **Global Commands**: Available across all projects in VS Code.
- **Fast Execution**: Run commands directly in the active terminal tab or spawn a new terminal tab.
- **Instant Search (`Ctrl+K` / `Cmd+K`)**: Filter by command name, command script, or description.
- **Command Management**: Add, edit, duplicate, copy, and delete saved commands with ease.

---

## ⌨️ Keyboard Shortcuts & Command Palette

| Command | Title | Default Shortcut |
| :--- | :--- | :--- |
| `devControlCenter.open` | Dev Control Center: Open Control Center | `Alt + D` |
| `devControlCenter.newTerminal` | Dev Control Center: New Terminal | `Alt + Shift + T` |
| `devControlCenter.showPorts` | Dev Control Center: Show Ports | `Alt + Shift + P` |
| `devControlCenter.showCommands` | Dev Control Center: Show Saved Commands | `Alt + Shift + C` |
| `devControlCenter.refreshPorts` | Dev Control Center: Refresh Ports | - |
| `devControlCenter.openInEditor` | Dev Control Center: Open in Editor Panel | - |
| `devControlCenter.saveCommand` | Dev Control Center: Save Command | - |
| `devControlCenter.runSavedCommand` | Dev Control Center: Run Saved Command | - |

---

## ⚙️ Configuration Settings

Customize Dev Control Center via VS Code Settings (`settings.json`):

```json
{
  "devControlCenter.confirmBeforeKill": true,
  "devControlCenter.autoRefreshPorts": true,
  "devControlCenter.portRefreshInterval": 3000,
  "devControlCenter.showStatusBarItem": true,
  "devControlCenter.terminalFontSize": 13,
  "devControlCenter.terminalFontFamily": "Consolas, 'Courier New', monospace",
  "devControlCenter.defaultShell": "",
  "devControlCenter.defaultRunLocation": "activeTerminal"
}
```

---

## 🏗️ Architecture & Project Structure

```text
src/
  extension.ts                     # Main extension entrypoint & activation
  commands/                        # Command registrations and VS Code actions
  terminal/                        # Interactive terminal session manager & shell detection
  ports/                           # Cross-platform port detection (Windows, Mac, Linux) & framework detection
  processes/                       # Process inspection and termination services
  savedCommands/                   # Saved commands persistent storage (globalState / workspaceState)
  workspace/                       # VS Code workspace folder awareness
  services/                        # Logging, Configuration, Status Bar services
  webview/                         # Webview provider, Editor panel, and UI application
    ui/index.ts                    # xterm.js integration, Ports view, Commands view, Settings
  utils/                           # Platform detection, formatters, debounce/throttle
  types/                           # Core TypeScript interfaces

media/
  styles.css                       # VS Code native CSS variables theme styling
  icons/                           # SVG Activity Bar icon

test/
  unit/                            # Unit tests for all subsystems (ports, terminal, commands, framework)
  runUnitTests.js                  # Automated mocha test runner
```

---

## 🚀 Building & Testing

```bash
# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Build extension and webview bundles
npm run build

# Run unit tests
npm test

# Package into installable .vsix file (Always run after build & test)
npm run package
# (or: npx -y @vscode/vsce package --no-git-tag-version --allow-missing-repository)

# Or do everything in one command (Build + Test + Package .vsix):
npm run build:all
```

