import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import {
  ExtensionToWebviewMessage,
  InitialStatePayload,
  WebviewToExtensionMessage
} from '../messages';
import {
  PortInfo,
  ProcessInfo,
  SavedCommand,
  TerminalSessionInfo,
  ExtensionSettings,
  AvailableShell
} from '../../types';

// Acquire VS Code API
declare function acquireVsCodeApi(): {
  postMessage(message: any): void;
  getState(): any;
  setState(state: any): void;
};

const vscode = acquireVsCodeApi();

interface TerminalInstance {
  session: TerminalSessionInfo;
  xterm: Terminal;
  fitAddon: FitAddon;
  element: HTMLElement;
}

class DevControlCenterApp {
  private activeTab: 'terminal' | 'ports' | 'commands' | 'settings' = 'terminal';
  private activeDropdown: 'ports' | 'commands' | null = null;
  private sessions: TerminalSessionInfo[] = [];
  private activeSessionId: string | null = null;
  private ports: PortInfo[] = [];
  private commands: SavedCommand[] = [];
  private settings: ExtensionSettings = {
    confirmBeforeKill: true,
    autoRefreshPorts: true,
    portRefreshInterval: 3000,
    showStatusBarItem: true,
    terminalFontSize: 13,
    terminalFontFamily: "Consolas, 'Courier New', monospace",
    defaultShell: '',
    defaultRunLocation: 'activeTerminal'
  };
  private availableShells: AvailableShell[] = [];
  private currentWorkspace = '';

  private terminalInstances = new Map<string, TerminalInstance>();
  private portSearchQuery = '';
  private commandSearchQuery = '';
  private commandScopeFilter: 'all' | 'workspace' | 'global' = 'all';

  private activeModal: 'saveCommand' | 'processDetails' | 'settings' | 'killConfirm' | null = null;
  private editingCommandId: string | null = null;
  private inspectingPort: number | null = null;
  private inspectingProcess: ProcessInfo | null = null;
  private pendingKillTarget: { pid: number; port: number; processName: string } | null = null;

  constructor() {
    this.renderLayout();
    this.setupMessageListener();
    this.setupGlobalShortcuts();

    // Signal ready to host
    vscode.postMessage({ type: 'init' });
  }

  private postToExtension(msg: WebviewToExtensionMessage): void {
    vscode.postMessage(msg);
  }

  private setupMessageListener(): void {
    window.addEventListener('message', (event: MessageEvent<ExtensionToWebviewMessage>) => {
      const msg = event.data;
      switch (msg.type) {
        case 'state:init':
          this.handleStateInit(msg.payload);
          break;

        case 'terminal:sessions':
          this.handleSessionsUpdate(msg.sessions, msg.activeSessionId);
          break;

        case 'terminal:data':
          this.handleTerminalData(msg.id, msg.data);
          break;

        case 'terminal:scrollback':
          this.handleTerminalScrollback(msg.id, msg.data);
          break;

        case 'ports:list':
          this.ports = msg.ports;
          this.renderPorts();
          this.updateNavBadges();
          break;

        case 'ports:inspectResult':
          if (this.inspectingPort === msg.port) {
            this.inspectingProcess = msg.process;
            this.renderModal();
          }
          break;

        case 'commands:list':
          this.commands = msg.commands;
          this.renderCommands();
          this.updateNavBadges();
          break;

        case 'settings:updated':
          this.settings = msg.settings;
          this.applySettings();
          break;

        case 'switchTab':
          this.switchTab(msg.tab);
          break;

        case 'terminal:clear':
          if (this.activeSessionId) {
            const instance = this.terminalInstances.get(this.activeSessionId);
            instance?.xterm.clear();
          }
          break;

        case 'notification':
          this.showToast(msg.message, msg.level);
          break;
      }
    });
  }

  private setupGlobalShortcuts(): void {
    window.addEventListener('keydown', (e: KeyboardEvent) => {
      // Ctrl+K or Cmd+K to focus search in active dropdown or open ports
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        if (this.activeDropdown === 'ports') {
          const input = document.getElementById('port-search-input') as HTMLInputElement;
          input?.focus();
        } else if (this.activeDropdown === 'commands') {
          const input = document.getElementById('command-search-input') as HTMLInputElement;
          input?.focus();
        } else {
          this.openDropdown('ports');
        }
      }

      // Escape closes open modals or open dropdowns
      if (e.key === 'Escape') {
        if (this.activeModal) {
          this.closeModal();
        } else if (this.activeDropdown) {
          this.closeDropdown();
        }
      }
    });

    window.addEventListener('resize', () => {
      this.fitActiveTerminal();
    });

    // Close dropdown when clicking / tapping outside
    window.addEventListener('pointerdown', (e: PointerEvent) => {
      if (!this.activeDropdown) return;
      const target = e.target as HTMLElement | null;
      if (!target) return;

      const dropdownEl = document.getElementById(`dropdown-${this.activeDropdown}`);
      if (dropdownEl && dropdownEl.contains(target)) {
        return;
      }

      const triggerBtn = document.getElementById(`btn-header-${this.activeDropdown}`);
      if (triggerBtn && triggerBtn.contains(target)) {
        return;
      }

      const modalBackdrop = document.getElementById('modal-backdrop');
      if (modalBackdrop && modalBackdrop.style.display !== 'none' && modalBackdrop.contains(target)) {
        return;
      }

      this.closeDropdown();
    }, true);
  }

  private handleStateInit(payload: InitialStatePayload): void {
    this.sessions = payload.sessions;
    this.activeSessionId = payload.activeSessionId;
    this.ports = payload.ports;
    this.commands = payload.commands;
    this.settings = payload.settings;
    this.availableShells = payload.availableShells;
    this.currentWorkspace = payload.currentWorkspace;

    this.renderAll();
    if (payload.activeTab && payload.activeTab !== 'terminal') {
      this.switchTab(payload.activeTab);
    }
  }

  private handleSessionsUpdate(sessions: TerminalSessionInfo[], activeId: string | null): void {
    this.sessions = sessions;
    this.activeSessionId = activeId;

    // Destroy instances for deleted sessions
    const sessionIds = new Set(sessions.map(s => s.id));
    for (const [id, instance] of this.terminalInstances.entries()) {
      if (!sessionIds.has(id)) {
        instance.xterm.dispose();
        instance.element.remove();
        this.terminalInstances.delete(id);
      }
    }

    this.renderTerminalTabs();

    if (activeId && this.terminalInstances.has(activeId)) {
      this.activateTerminalSession(activeId);
    } else if (activeId) {
      // Instance will be created on render
      this.renderTerminalArea();
    }
  }

  private handleTerminalData(id: string, data: string): void {
    let instance = this.terminalInstances.get(id);
    if (!instance && this.activeSessionId === id) {
      this.renderTerminalArea();
      instance = this.terminalInstances.get(id);
    }
    if (instance) {
      instance.xterm.write(data);
    }
  }

  private handleTerminalScrollback(id: string, data: string): void {
    const instance = this.terminalInstances.get(id);
    if (instance) {
      instance.xterm.clear();
      instance.xterm.write(data);
    }
  }

  private renderAll(): void {
    this.renderNav();
    this.renderTerminalArea();
    this.renderPorts();
    this.renderCommands();
    this.updateNavBadges();
  }

  private renderLayout(): void {
    const app = document.getElementById('app');
    if (!app) return;

    app.innerHTML = `
      <nav class="nav-bar">
        <div class="nav-left">
          <div class="terminal-tabs-wrapper" id="terminal-tab-bar"></div>
          <button class="icon-btn header-add-btn" id="btn-term-new" title="New Terminal (Alt+Shift+T)">
            <i class="codicon codicon-add"></i>
          </button>
        </div>
        <div class="nav-actions">
          <span class="terminal-cwd-info" id="terminal-cwd-badge" title="Working Directory">
            <i class="codicon codicon-folder"></i> <span id="terminal-cwd-text">~</span>
          </span>
        </div>
      </nav>

      <!-- Ports Dropdown Overlay -->
      <div id="dropdown-ports" class="header-dropdown" style="display: none;">
        <div class="dropdown-header">
          <div class="dropdown-title">
            <i class="codicon codicon-plug"></i>
            <span>Active Ports</span>
            <span class="badge" id="dropdown-ports-count">0</span>
          </div>
          <div class="dropdown-header-actions">
            <button class="icon-btn" id="btn-dropdown-ports-close" title="Close dropdown">
              <i class="codicon codicon-close"></i>
            </button>
          </div>
        </div>
        <div class="dropdown-toolbar">
          <div class="search-input-wrapper">
            <i class="codicon codicon-search"></i>
            <input type="text" id="port-search-input" class="search-input" placeholder="Filter ports or processes... (Ctrl+K)" />
          </div>
          <label class="toggle-switch" title="Auto-refresh ports periodically">
            <input type="checkbox" id="toggle-port-autorefresh" checked />
            <span class="toggle-slider"></span>
            <span>Auto</span>
          </label>
          <button class="btn btn-secondary btn-sm" id="btn-refresh-ports" title="Scan Ports Now">
            <i class="codicon codicon-refresh"></i> Refresh
          </button>
        </div>
        <div class="dropdown-body ports-list-container" id="ports-list-container"></div>
        <div class="dropdown-resize-handle-left" id="dropdown-ports-resize-grip" title="Drag to resize dropdown">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
            <circle cx="2" cy="2" r="1"/>
            <circle cx="2" cy="5" r="1"/>
            <circle cx="5" cy="5" r="1"/>
            <circle cx="2" cy="8" r="1"/>
            <circle cx="5" cy="8" r="1"/>
            <circle cx="8" cy="8" r="1"/>
          </svg>
        </div>
        <div class="dropdown-resize-handle-bottom" id="dropdown-ports-resize-bottom" title="Drag to resize height"></div>
      </div>

      <!-- Saved Commands Dropdown Overlay -->
      <div id="dropdown-commands" class="header-dropdown" style="display: none;">
        <div class="dropdown-header">
          <div class="dropdown-title">
            <i class="codicon codicon-save"></i>
            <span>Saved Commands</span>
            <span class="badge" id="dropdown-commands-count">0</span>
          </div>
          <div class="dropdown-header-actions">
            <button class="btn btn-primary btn-sm" id="btn-new-command" title="Save New Command">
              <i class="codicon codicon-add"></i> Save
            </button>
            <button class="icon-btn" id="btn-dropdown-commands-close" title="Close dropdown">
              <i class="codicon codicon-close"></i>
            </button>
          </div>
        </div>
        <div class="dropdown-toolbar">
          <div class="search-input-wrapper">
            <i class="codicon codicon-search"></i>
            <input type="text" id="command-search-input" class="search-input" placeholder="Search commands... (Ctrl+K)" />
          </div>
          <div class="commands-filter-bar">
            <button class="filter-btn active" data-scope="all">All</button>
            <button class="filter-btn" data-scope="workspace">Workspace</button>
            <button class="filter-btn" data-scope="global">Global</button>
          </div>
        </div>
        <div class="dropdown-body commands-list-container" id="commands-list-container"></div>
        <div class="dropdown-resize-handle-left" id="dropdown-commands-resize-grip" title="Drag to resize dropdown">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
            <circle cx="2" cy="2" r="1"/>
            <circle cx="2" cy="5" r="1"/>
            <circle cx="5" cy="5" r="1"/>
            <circle cx="2" cy="8" r="1"/>
            <circle cx="5" cy="8" r="1"/>
            <circle cx="8" cy="8" r="1"/>
          </svg>
        </div>
        <div class="dropdown-resize-handle-bottom" id="dropdown-commands-resize-bottom" title="Drag to resize height"></div>
      </div>

      <!-- Terminal Body Container -->
      <div class="terminal-body" id="terminal-container"></div>

      <div id="modal-backdrop" class="process-modal-backdrop" style="display: none;"></div>
      <div id="toast-container" style="position: fixed; bottom: 12px; right: 12px; z-index: 999; display: flex; flex-direction: column; gap: 6px;"></div>
    `;

    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    // Header Dropdown Toggles
    document.getElementById('btn-header-ports')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleDropdown('ports');
    });

    document.getElementById('btn-header-commands')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleDropdown('commands');
    });

    document.getElementById('btn-dropdown-ports-close')?.addEventListener('click', () => {
      this.closeDropdown();
    });

    document.getElementById('btn-dropdown-commands-close')?.addEventListener('click', () => {
      this.closeDropdown();
    });

    // Global action buttons
    document.getElementById('btn-global-refresh')?.addEventListener('click', () => {
      this.postToExtension({ type: 'ports:refresh' });
      this.showToast('Refreshing listening ports...', 'info');
    });

    document.getElementById('btn-open-settings')?.addEventListener('click', () => {
      this.openSettingsModal();
    });

    // Terminal Toolbar
    document.getElementById('btn-term-new')?.addEventListener('click', () => {
      this.postToExtension({ type: 'terminal:create' });
    });

    document.getElementById('btn-term-restart')?.addEventListener('click', () => {
      if (this.activeSessionId) {
        this.postToExtension({ type: 'terminal:restart', id: this.activeSessionId });
      }
    });

    document.getElementById('btn-term-clear')?.addEventListener('click', () => {
      if (this.activeSessionId) {
        const instance = this.terminalInstances.get(this.activeSessionId);
        instance?.xterm.clear();
      }
    });

    document.getElementById('btn-term-kill')?.addEventListener('click', () => {
      if (this.activeSessionId) {
        this.postToExtension({ type: 'terminal:kill', id: this.activeSessionId });
      }
    });

    // Ports View Events
    const portSearch = document.getElementById('port-search-input') as HTMLInputElement;
    portSearch?.addEventListener('input', () => {
      this.portSearchQuery = portSearch.value.toLowerCase().trim();
      this.renderPorts();
    });

    const autoToggle = document.getElementById('toggle-port-autorefresh') as HTMLInputElement;
    autoToggle?.addEventListener('change', () => {
      this.postToExtension({ type: 'ports:toggleAutoRefresh', enabled: autoToggle.checked });
    });

    document.getElementById('btn-refresh-ports')?.addEventListener('click', () => {
      this.postToExtension({ type: 'ports:refresh' });
    });

    // Commands View Events
    const cmdSearch = document.getElementById('command-search-input') as HTMLInputElement;
    cmdSearch?.addEventListener('input', () => {
      this.commandSearchQuery = cmdSearch.value.toLowerCase().trim();
      this.renderCommands();
    });

    document.getElementById('btn-new-command')?.addEventListener('click', () => {
      this.openSaveCommandModal();
    });

    document.querySelectorAll('.filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.commandScopeFilter = (btn as HTMLElement).dataset.scope as any;
        this.renderCommands();
      });
    });

    // Modal backdrop click
    document.getElementById('modal-backdrop')?.addEventListener('click', e => {
      if ((e.target as HTMLElement).id === 'modal-backdrop') {
        this.closeModal();
      }
    });

    // Dropdown resize initialization
    const portsDropdown = document.getElementById('dropdown-ports');
    const portsResizeGrip = document.getElementById('dropdown-ports-resize-grip');
    const portsResizeBottom = document.getElementById('dropdown-ports-resize-bottom');
    if (portsDropdown && portsResizeGrip) {
      this.initDropdownResize(portsDropdown, portsResizeGrip);
    }
    if (portsDropdown && portsResizeBottom) {
      this.initDropdownBottomResize(portsDropdown, portsResizeBottom);
    }

    const commandsDropdown = document.getElementById('dropdown-commands');
    const commandsResizeGrip = document.getElementById('dropdown-commands-resize-grip');
    const commandsResizeBottom = document.getElementById('dropdown-commands-resize-bottom');
    if (commandsDropdown && commandsResizeGrip) {
      this.initDropdownResize(commandsDropdown, commandsResizeGrip);
    }
    if (commandsDropdown && commandsResizeBottom) {
      this.initDropdownBottomResize(commandsDropdown, commandsResizeBottom);
    }
  }

  public toggleDropdown(type: 'ports' | 'commands'): void {
    if (this.activeDropdown === type) {
      this.closeDropdown();
    } else {
      this.openDropdown(type);
    }
  }

  public openDropdown(type: 'ports' | 'commands'): void {
    this.activeDropdown = type;

    const portsDropdown = document.getElementById('dropdown-ports');
    const commandsDropdown = document.getElementById('dropdown-commands');
    const portsBtn = document.getElementById('btn-header-ports');
    const commandsBtn = document.getElementById('btn-header-commands');

    if (portsDropdown) portsDropdown.style.display = type === 'ports' ? 'flex' : 'none';
    if (commandsDropdown) commandsDropdown.style.display = type === 'commands' ? 'flex' : 'none';

    portsBtn?.classList.toggle('active', type === 'ports');
    commandsBtn?.classList.toggle('active', type === 'commands');

    if (type === 'ports') {
      this.renderPorts();
      this.postToExtension({ type: 'ports:refresh' });
      setTimeout(() => {
        const input = document.getElementById('port-search-input') as HTMLInputElement;
        input?.focus();
      }, 50);
    } else if (type === 'commands') {
      this.renderCommands();
      setTimeout(() => {
        const input = document.getElementById('command-search-input') as HTMLInputElement;
        input?.focus();
      }, 50);
    }
  }

  public closeDropdown(): void {
    this.activeDropdown = null;

    const portsDropdown = document.getElementById('dropdown-ports');
    const commandsDropdown = document.getElementById('dropdown-commands');
    const portsBtn = document.getElementById('btn-header-ports');
    const commandsBtn = document.getElementById('btn-header-commands');

    if (portsDropdown) portsDropdown.style.display = 'none';
    if (commandsDropdown) commandsDropdown.style.display = 'none';

    portsBtn?.classList.remove('active');
    commandsBtn?.classList.remove('active');

    this.fitActiveTerminal();
  }

  public switchTab(tab: 'terminal' | 'ports' | 'commands' | 'settings'): void {
    this.activeTab = tab;

    if (tab === 'ports') {
      this.toggleDropdown('ports');
    } else if (tab === 'commands') {
      this.toggleDropdown('commands');
    } else if (tab === 'settings') {
      this.closeDropdown();
      this.openSettingsModal();
    } else {
      this.closeDropdown();
      setTimeout(() => this.fitActiveTerminal(), 50);
    }

    this.postToExtension({ type: 'switchTab', tab });
  }

  private updateNavBadges(): void {
    const portsBadge = document.getElementById('ports-count-badge');
    if (portsBadge) {
      portsBadge.textContent = String(this.ports.length);
    }
    const dropdownPortsCount = document.getElementById('dropdown-ports-count');
    if (dropdownPortsCount) {
      dropdownPortsCount.textContent = String(this.ports.length);
    }

    const commandsBadge = document.getElementById('commands-count-badge');
    if (commandsBadge) {
      commandsBadge.textContent = String(this.commands.length);
    }
    const dropdownCommandsCount = document.getElementById('dropdown-commands-count');
    if (dropdownCommandsCount) {
      dropdownCommandsCount.textContent = String(this.commands.length);
    }
  }

  private renderNav(): void {
    this.updateNavBadges();
  }

  // =========================================================================
  // TERMINAL LOGIC
  // =========================================================================
  private renderTerminalArea(): void {
    this.renderTerminalTabs();
    const container = document.getElementById('terminal-container');
    if (!container) return;

    if (this.sessions.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <i class="codicon codicon-terminal empty-state-icon"></i>
          <div class="empty-state-title">No Active Terminal</div>
          <div class="empty-state-desc">Launch an interactive terminal session to run scripts and workflows.</div>
          <button class="btn btn-primary" id="btn-empty-term-new">
            <i class="codicon codicon-add"></i> New Terminal
          </button>
        </div>
      `;
      document.getElementById('btn-empty-term-new')?.addEventListener('click', () => {
        this.postToExtension({ type: 'terminal:create' });
      });
      return;
    }

    // Ensure terminal element exists for each session
    for (const session of this.sessions) {
      if (!this.terminalInstances.has(session.id)) {
        this.createTerminalInstance(session, container);
      }
    }

    if (this.activeSessionId) {
      this.activateTerminalSession(this.activeSessionId);
    } else if (this.sessions.length > 0) {
      this.activateTerminalSession(this.sessions[0].id);
    }
  }

  private createTerminalInstance(session: TerminalSessionInfo, container: HTMLElement): void {
    const element = document.createElement('div');
    element.className = 'terminal-instance';
    element.id = `term-inst-${session.id}`;
    container.appendChild(element);

    const xterm = new Terminal({
      fontSize: this.settings.terminalFontSize || 13,
      fontFamily: this.settings.terminalFontFamily || "Consolas, 'Courier New', monospace",
      cursorBlink: true,
      cursorStyle: 'block',
      theme: {
        background: 'transparent',
        foreground: '#cccccc',
        cursor: '#ffffff',
        selectionBackground: 'rgba(255, 255, 255, 0.2)'
      },
      allowProposedApi: true
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    xterm.loadAddon(fitAddon);
    xterm.loadAddon(webLinksAddon);
    xterm.open(element);

    xterm.onData(data => {
      this.postToExtension({ type: 'terminal:input', id: session.id, data });
    });

    xterm.onResize(({ cols, rows }) => {
      this.postToExtension({ type: 'terminal:resize', id: session.id, cols, rows });
    });

    this.terminalInstances.set(session.id, {
      session,
      xterm,
      fitAddon,
      element
    });

    // Request scrollback from extension host
    this.postToExtension({ type: 'terminal:requestScrollback', id: session.id });
  }

  private activateTerminalSession(id: string): void {
    this.activeSessionId = id;

    // Update active tab headers
    document.querySelectorAll('.terminal-tab-item').forEach(el => {
      el.classList.toggle('active', (el as HTMLElement).dataset.id === id);
    });

    // Update active terminal elements
    for (const [sId, inst] of this.terminalInstances.entries()) {
      if (sId === id) {
        inst.element.classList.add('active');
      } else {
        inst.element.classList.remove('active');
      }
    }

    // Update CWD text badge
    const activeSession = this.sessions.find(s => s.id === id);
    const cwdBadge = document.getElementById('terminal-cwd-text');
    if (cwdBadge && activeSession) {
      cwdBadge.textContent = activeSession.cwd;
      (cwdBadge.parentElement as HTMLElement).title = `Shell: ${activeSession.shell}\nCWD: ${activeSession.cwd}`;
    }

    this.fitActiveTerminal();
  }

  private fitActiveTerminal(): void {
    if (!this.activeSessionId) return;
    const inst = this.terminalInstances.get(this.activeSessionId);
    if (inst) {
      try {
        inst.fitAddon.fit();
      } catch {
        // ignore layout race
      }
    }
  }

  private renderTerminalTabs(): void {
    const tabBar = document.getElementById('terminal-tab-bar');
    if (!tabBar) return;

    tabBar.innerHTML = '';
    for (const session of this.sessions) {
      const tab = document.createElement('div');
      tab.className = `terminal-tab-item ${session.id === this.activeSessionId ? 'active' : ''}`;
      tab.dataset.id = session.id;

      tab.innerHTML = `
        <i class="codicon codicon-terminal"></i>
        <span class="terminal-tab-title" title="Double click to rename">${this.escapeHtml(session.name)}</span>
        <i class="codicon codicon-close terminal-tab-close" title="Close"></i>
      `;

      tab.addEventListener('click', e => {
        if ((e.target as HTMLElement).classList.contains('terminal-tab-close')) {
          e.stopPropagation();
          this.postToExtension({ type: 'terminal:close', id: session.id });
        } else {
          this.postToExtension({ type: 'terminal:select', id: session.id });
          this.activateTerminalSession(session.id);
        }
      });

      // Double-click to rename
      const titleSpan = tab.querySelector('.terminal-tab-title') as HTMLElement;
      titleSpan?.addEventListener('dblclick', e => {
        e.stopPropagation();
        titleSpan.contentEditable = 'true';
        titleSpan.focus();

        const save = () => {
          titleSpan.contentEditable = 'false';
          const newName = titleSpan.textContent?.trim() || session.name;
          this.postToExtension({ type: 'terminal:rename', id: session.id, name: newName });
        };

        titleSpan.addEventListener('blur', save, { once: true });
        titleSpan.addEventListener('keydown', keyE => {
          if (keyE.key === 'Enter') {
            keyE.preventDefault();
            titleSpan.blur();
          }
        });
      });

      tabBar.appendChild(tab);
    }
  }

  // =========================================================================
  // PORTS VIEW LOGIC
  // =========================================================================
  private renderPorts(): void {
    const container = document.getElementById('ports-list-container');
    if (!container) return;

    const filtered = this.ports.filter(p => {
      if (!this.portSearchQuery) return true;
      const q = this.portSearchQuery;
      return (
        String(p.port).includes(q) ||
        p.processName.toLowerCase().includes(q) ||
        String(p.pid).includes(q) ||
        (p.framework && p.framework.toLowerCase().includes(q)) ||
        (p.runtime && p.runtime.toLowerCase().includes(q))
      );
    });

    if (filtered.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <i class="codicon codicon-plug empty-state-icon"></i>
          <div class="empty-state-title">No listening ports detected</div>
          <div class="empty-state-desc">Start a development server and it will appear here automatically.</div>
          <button class="btn btn-primary" id="btn-empty-ports-refresh">
            <i class="codicon codicon-refresh"></i> Refresh Ports
          </button>
        </div>
      `;
      document.getElementById('btn-empty-ports-refresh')?.addEventListener('click', () => {
        this.postToExtension({ type: 'ports:refresh' });
      });
      return;
    }

    container.innerHTML = `
      <table class="ports-table">
        <thead>
          <tr>
            <th>Port</th>
            <th>Process</th>
            <th>PID</th>
            <th>Runtime / Framework</th>
            <th style="text-align: right;">Actions</th>
          </tr>
        </thead>
        <tbody id="ports-table-body"></tbody>
      </table>
    `;

    const tbody = document.getElementById('ports-table-body');
    if (!tbody) return;

    for (const port of filtered) {
      const row = document.createElement('tr');
      row.className = 'port-row';

      const frameworkBadge = port.framework
        ? `<span class="framework-badge">${this.escapeHtml(port.framework)}</span>`
        : port.runtime
        ? `<span class="framework-badge" style="opacity: 0.7;">${this.escapeHtml(port.runtime)}</span>`
        : `<span style="opacity: 0.4;">-</span>`;

      row.innerHTML = `
        <td>
          <span class="port-status-dot"></span>
          <span class="port-number">${port.port}</span>
        </td>
        <td>
          <span class="process-tag">
            <i class="codicon codicon-server-process"></i>
            ${this.escapeHtml(port.processName)}
          </span>
        </td>
        <td>
          <span class="pid-badge">${port.pid}</span>
        </td>
        <td>${frameworkBadge}</td>
        <td>
          <div class="row-actions">
            <button class="icon-btn btn-port-open" title="Open http://localhost:${port.port} in browser">
              <i class="codicon codicon-globe"></i>
            </button>
            <button class="icon-btn btn-port-copy" title="Copy http://localhost:${port.port}">
              <i class="codicon codicon-copy"></i>
            </button>
            <button class="icon-btn btn-port-inspect" title="Inspect Process Details">
              <i class="codicon codicon-info"></i>
            </button>
            <button class="icon-btn danger btn-port-kill" title="Kill Process (${port.processName})">
              <i class="codicon codicon-close"></i>
            </button>
          </div>
        </td>
      `;

      row.querySelector('.btn-port-open')?.addEventListener('click', e => {
        e.stopPropagation();
        this.postToExtension({ type: 'ports:openBrowser', port: port.port });
      });

      row.querySelector('.btn-port-copy')?.addEventListener('click', e => {
        e.stopPropagation();
        this.postToExtension({ type: 'ports:copyUrl', port: port.port });
      });

      row.querySelector('.btn-port-inspect')?.addEventListener('click', e => {
        e.stopPropagation();
        this.inspectProcess(port.port, port.pid, port.processName);
      });

      row.querySelector('.btn-port-kill')?.addEventListener('click', e => {
        e.stopPropagation();
        this.confirmKillProcess(port.pid, port.port, port.processName);
      });

      row.addEventListener('click', () => {
        this.inspectProcess(port.port, port.pid, port.processName);
      });

      tbody.appendChild(row);
    }
  }

  private inspectProcess(port: number, pid: number, name: string): void {
    this.closeDropdown();
    this.inspectingPort = port;
    this.inspectingProcess = { pid, name, port };
    this.activeModal = 'processDetails';
    this.postToExtension({ type: 'ports:inspectProcess', port, pid });
    this.renderModal();
  }

  private confirmKillProcess(pid: number, port: number, processName: string): void {
    this.closeDropdown();
    if (this.settings.confirmBeforeKill) {
      this.pendingKillTarget = { pid, port, processName };
      this.activeModal = 'killConfirm';
      this.renderModal();
    } else {
      this.postToExtension({ type: 'ports:killProcess', pid, port, processName });
    }
  }

  // =========================================================================
  // COMMANDS VIEW LOGIC
  // =========================================================================
  private renderCommands(): void {
    const container = document.getElementById('commands-list-container');
    if (!container) return;

    let filtered = this.commands;
    if (this.commandScopeFilter !== 'all') {
      filtered = filtered.filter(c => c.scope === this.commandScopeFilter);
    }

    if (this.commandSearchQuery) {
      const q = this.commandSearchQuery;
      filtered = filtered.filter(c =>
        c.name.toLowerCase().includes(q) ||
        c.command.toLowerCase().includes(q) ||
        (c.description && c.description.toLowerCase().includes(q))
      );
    }

    if (filtered.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <i class="codicon codicon-save empty-state-icon"></i>
          <div class="empty-state-title">No Saved Commands</div>
          <div class="empty-state-desc">Save frequently used terminal commands to run them instantly with 1-click.</div>
          <button class="btn btn-primary" id="btn-empty-cmd-new">
            <i class="codicon codicon-add"></i> Save Command
          </button>
        </div>
      `;
      document.getElementById('btn-empty-cmd-new')?.addEventListener('click', () => {
        this.openSaveCommandModal();
      });
      return;
    }

    container.innerHTML = '';
    for (const cmd of filtered) {
      const card = document.createElement('div');
      card.className = 'command-card';

      const scopeClass = cmd.scope === 'workspace' ? 'workspace' : 'global';

      card.innerHTML = `
        <div class="command-header">
          <div class="command-title-row">
            <span class="command-name">${this.escapeHtml(cmd.name)}</span>
            <span class="command-scope-badge ${scopeClass}">${cmd.scope}</span>
          </div>
          <div class="command-card-actions">
            <button class="btn btn-primary btn-run-cmd" title="Run in Terminal">
              <i class="codicon codicon-play"></i> Run
            </button>
            <button class="icon-btn btn-run-new" title="Run in New Terminal">
              <i class="codicon codicon-plus"></i>
            </button>
            <button class="icon-btn btn-edit-cmd" title="Edit Command">
              <i class="codicon codicon-edit"></i>
            </button>
            <button class="icon-btn btn-dup-cmd" title="Duplicate Command">
              <i class="codicon codicon-copy"></i>
            </button>
            <button class="icon-btn danger btn-del-cmd" title="Delete Command">
              <i class="codicon codicon-trash"></i>
            </button>
          </div>
        </div>
        ${cmd.description ? `<div class="command-description">${this.escapeHtml(cmd.description)}</div>` : ''}
        <div class="command-snippet">${this.escapeHtml(cmd.command)}</div>
      `;

      card.querySelector('.btn-run-cmd')?.addEventListener('click', () => {
        this.postToExtension({ type: 'commands:run', id: cmd.id, inNewTerminal: false });
        this.closeDropdown();
        this.showToast(`Running "${cmd.name}"...`, 'info');
      });

      card.querySelector('.btn-run-new')?.addEventListener('click', () => {
        this.postToExtension({ type: 'commands:run', id: cmd.id, inNewTerminal: true });
        this.closeDropdown();
        this.showToast(`Running "${cmd.name}" in new terminal...`, 'info');
      });

      card.querySelector('.btn-edit-cmd')?.addEventListener('click', () => {
        this.openSaveCommandModal(cmd.id);
      });

      card.querySelector('.btn-dup-cmd')?.addEventListener('click', () => {
        this.postToExtension({ type: 'commands:duplicate', id: cmd.id });
      });

      card.querySelector('.btn-del-cmd')?.addEventListener('click', () => {
        this.postToExtension({ type: 'commands:delete', id: cmd.id });
      });

      container.appendChild(card);
    }
  }

  // =========================================================================
  // MODALS & DIALOGS
  // =========================================================================
  private renderModal(): void {
    const backdrop = document.getElementById('modal-backdrop');
    if (!backdrop) return;

    if (!this.activeModal) {
      backdrop.style.display = 'none';
      backdrop.innerHTML = '';
      return;
    }

    backdrop.style.display = 'flex';

    if (this.activeModal === 'processDetails') {
      const proc = this.inspectingProcess;
      backdrop.innerHTML = `
        <div class="process-modal">
          <div class="modal-header">
            <div class="modal-title">
              <i class="codicon codicon-info"></i> Process Details [Port ${proc?.port || ''}]
            </div>
            <button class="icon-btn" id="btn-modal-close" title="Close"><i class="codicon codicon-close"></i></button>
          </div>
          <div class="modal-body">
            <div class="modal-grid-2col">
              <div class="modal-info-item">
                <span class="label">Port:</span>
                <span class="value badge-port-value">${proc?.port ?? '-'}</span>
              </div>
              <div class="modal-info-item">
                <span class="label">PID:</span>
                <span class="value">${proc?.pid ?? '-'}</span>
              </div>
              <div class="modal-info-item">
                <span class="label">Name:</span>
                <span class="value" title="${this.escapeHtml(proc?.name || '-')}">${this.escapeHtml(proc?.name || '-')}</span>
              </div>
              <div class="modal-info-item">
                <span class="label">Started:</span>
                <span class="value">${proc?.started || 'N/A'}</span>
              </div>
              <div class="modal-info-item">
                <span class="label">CPU:</span>
                <span class="value">${proc?.cpu || 'N/A'}</span>
              </div>
              <div class="modal-info-item">
                <span class="label">Memory:</span>
                <span class="value">${proc?.memory || 'N/A'}</span>
              </div>
            </div>
            <div class="modal-command-section">
              <span class="label">Command:</span>
              <div class="modal-command-box" title="Full Command Line">${this.escapeHtml(proc?.command || 'Command unavailable')}</div>
            </div>
          </div>
          <div class="modal-actions">
            <button class="btn btn-secondary" id="btn-modal-close-action">Close</button>
            <button class="btn btn-danger" id="btn-modal-kill-action">
              <i class="codicon codicon-close"></i> Terminate Process
            </button>
          </div>
          <div class="modal-resize-handle" id="modal-resize-grip" title="Drag to resize modal">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
              <circle cx="8" cy="2" r="1"/>
              <circle cx="8" cy="5" r="1"/>
              <circle cx="5" cy="5" r="1"/>
              <circle cx="8" cy="8" r="1"/>
              <circle cx="5" cy="8" r="1"/>
              <circle cx="2" cy="8" r="1"/>
            </svg>
          </div>
        </div>
      `;

      document.getElementById('btn-modal-close')?.addEventListener('click', () => this.closeModal());
      document.getElementById('btn-modal-close-action')?.addEventListener('click', () => this.closeModal());
      document.getElementById('btn-modal-kill-action')?.addEventListener('click', () => {
        if (proc) {
          this.closeModal();
          this.confirmKillProcess(proc.pid, proc.port || 0, proc.name);
        }
      });
    } else if (this.activeModal === 'killConfirm') {
      const target = this.pendingKillTarget;
      backdrop.innerHTML = `
        <div class="process-modal" style="width: 480px;">
          <div class="modal-header">
            <div class="modal-title" style="color: var(--dcc-danger);">
              <i class="codicon codicon-warning"></i> Confirm Process Termination
            </div>
            <button class="icon-btn" id="btn-kill-cancel" title="Close"><i class="codicon codicon-close"></i></button>
          </div>
          <div class="modal-body">
            <div style="font-size: 12px; line-height: 1.4;">
              Are you sure you want to terminate the process running on port <strong>${target?.port}</strong>?
            </div>
            <div class="modal-grid-2col" style="background: rgba(0,0,0,0.2); padding: 8px 10px; border-radius: 3px;">
              <div class="modal-info-item">
                <span class="label">Process:</span>
                <span class="value">${this.escapeHtml(target?.processName || '-')}</span>
              </div>
              <div class="modal-info-item">
                <span class="label">PID:</span>
                <span class="value">${target?.pid}</span>
              </div>
              <div class="modal-info-item">
                <span class="label">Port:</span>
                <span class="value badge-port-value">${target?.port}</span>
              </div>
            </div>
          </div>
          <div class="modal-actions">
            <button class="btn btn-secondary" id="btn-kill-cancel-action">Cancel</button>
            <button class="btn btn-danger" id="btn-kill-confirm-action">
              <i class="codicon codicon-trash"></i> Kill Process
            </button>
          </div>
          <div class="modal-resize-handle" id="modal-resize-grip" title="Drag to resize modal">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
              <circle cx="8" cy="2" r="1"/>
              <circle cx="8" cy="5" r="1"/>
              <circle cx="5" cy="5" r="1"/>
              <circle cx="8" cy="8" r="1"/>
              <circle cx="5" cy="8" r="1"/>
              <circle cx="2" cy="8" r="1"/>
            </svg>
          </div>
        </div>
      `;

      document.getElementById('btn-kill-cancel')?.addEventListener('click', () => this.closeModal());
      document.getElementById('btn-kill-cancel-action')?.addEventListener('click', () => this.closeModal());
      document.getElementById('btn-kill-confirm-action')?.addEventListener('click', () => {
        if (target) {
          this.postToExtension({
            type: 'ports:killProcess',
            pid: target.pid,
            port: target.port,
            processName: target.processName
          });
        }
        this.closeModal();
      });
    } else if (this.activeModal === 'saveCommand') {
      const isEdit = !!this.editingCommandId;
      const cmd = isEdit ? this.commands.find(c => c.id === this.editingCommandId) : null;

      backdrop.innerHTML = `
        <div class="process-modal">
          <div class="modal-header">
            <div class="modal-title">
              <i class="codicon codicon-save"></i> ${isEdit ? 'Edit Command' : 'Save Command'}
            </div>
            <button class="icon-btn" id="btn-cmd-form-close" title="Close"><i class="codicon codicon-close"></i></button>
          </div>
          <form id="save-command-form" class="modal-form">
            <div class="modal-body" style="gap: 10px;">
              <div class="form-row">
                <div class="form-group" style="flex: 2;">
                  <label for="cmd-form-name">Command Name *</label>
                  <input type="text" id="cmd-form-name" class="form-input" placeholder="e.g. Start Dev Server" value="${this.escapeHtml(cmd?.name || '')}" required />
                </div>
                <div class="form-group" style="flex: 1;">
                  <label for="cmd-form-scope">Scope</label>
                  <select id="cmd-form-scope" class="form-select">
                    <option value="workspace" ${cmd?.scope === 'workspace' || !cmd ? 'selected' : ''}>Workspace Specific</option>
                    <option value="global" ${cmd?.scope === 'global' ? 'selected' : ''}>Global (All Projects)</option>
                  </select>
                </div>
              </div>
              <div class="form-group" style="flex: 1;">
                <label for="cmd-form-cmd">Command String *</label>
                <textarea id="cmd-form-cmd" class="form-textarea" placeholder="e.g. npm run dev" style="min-height: 55px; height: 60px;" required>${this.escapeHtml(cmd?.command || '')}</textarea>
              </div>
              <div class="form-row">
                <div class="form-group" style="flex: 1;">
                  <label for="cmd-form-desc">Description (Optional)</label>
                  <input type="text" id="cmd-form-desc" class="form-input" placeholder="e.g. Starts frontend with Next.js" value="${this.escapeHtml(cmd?.description || '')}" />
                </div>
                <div class="form-group" style="flex: 1;">
                  <label for="cmd-form-cwd">Working Directory</label>
                  <input type="text" id="cmd-form-cwd" class="form-input" placeholder="Default Workspace" value="${this.escapeHtml(cmd?.workingDirectory || '')}" />
                </div>
              </div>
            </div>
            <div class="modal-actions">
              <button type="button" class="btn btn-secondary" id="btn-cmd-form-cancel">Cancel</button>
              <button type="submit" class="btn btn-primary">
                <i class="codicon codicon-check"></i> ${isEdit ? 'Save Changes' : 'Save Command'}
              </button>
            </div>
          </form>
          <div class="modal-resize-handle" id="modal-resize-grip" title="Drag to resize modal">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
              <circle cx="8" cy="2" r="1"/>
              <circle cx="8" cy="5" r="1"/>
              <circle cx="5" cy="5" r="1"/>
              <circle cx="8" cy="8" r="1"/>
              <circle cx="5" cy="8" r="1"/>
              <circle cx="2" cy="8" r="1"/>
            </svg>
          </div>
        </div>
      `;

      document.getElementById('btn-cmd-form-close')?.addEventListener('click', () => this.closeModal());
      document.getElementById('btn-cmd-form-cancel')?.addEventListener('click', () => this.closeModal());

      const form = document.getElementById('save-command-form') as HTMLFormElement;
      form?.addEventListener('submit', e => {
        e.preventDefault();
        const name = (document.getElementById('cmd-form-name') as HTMLInputElement).value.trim();
        const command = (document.getElementById('cmd-form-cmd') as HTMLTextAreaElement).value.trim();
        const description = (document.getElementById('cmd-form-desc') as HTMLInputElement).value.trim();
        const scope = (document.getElementById('cmd-form-scope') as HTMLSelectElement).value as any;
        const workingDirectory = (document.getElementById('cmd-form-cwd') as HTMLInputElement).value.trim();

        if (!name || !command) return;

        if (isEdit && this.editingCommandId) {
          this.postToExtension({
            type: 'commands:update',
            id: this.editingCommandId,
            dto: { name, command, description, scope, workingDirectory: workingDirectory || undefined }
          });
        } else {
          this.postToExtension({
            type: 'commands:add',
            dto: { name, command, description, scope, workingDirectory: workingDirectory || undefined }
          });
        }
        this.closeModal();
      });
    } else if (this.activeModal === 'settings') {
      backdrop.innerHTML = `
        <div class="process-modal" style="width: 500px;">
          <div class="modal-header">
            <div class="modal-title">
              <i class="codicon codicon-settings-gear"></i> Extension Settings
            </div>
            <button class="icon-btn" id="btn-settings-close" title="Close"><i class="codicon codicon-close"></i></button>
          </div>
          <div class="modal-body" style="gap: 10px;">
            <div class="form-row" style="align-items: center; justify-content: space-between; background: rgba(0,0,0,0.15); padding: 6px 10px; border-radius: 3px;">
              <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 12px;">
                <input type="checkbox" id="setting-confirm-kill" ${this.settings.confirmBeforeKill ? 'checked' : ''} />
                <span>Confirm Before Kill</span>
              </label>
              <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 12px;">
                <input type="checkbox" id="setting-auto-refresh" ${this.settings.autoRefreshPorts ? 'checked' : ''} />
                <span>Auto Refresh Ports</span>
              </label>
            </div>
            <div class="form-row">
              <div class="form-group" style="flex: 1;">
                <label for="setting-refresh-interval">Port Refresh Interval (ms)</label>
                <input type="number" id="setting-refresh-interval" class="form-input" min="1000" step="500" value="${this.settings.portRefreshInterval || 3000}" />
              </div>
              <div class="form-group" style="flex: 1;">
                <label for="setting-font-size">Terminal Font Size (px)</label>
                <input type="number" id="setting-font-size" class="form-input" min="8" max="32" value="${this.settings.terminalFontSize || 13}" />
              </div>
            </div>
            <div class="form-group">
              <label for="setting-run-loc">Default Command Run Location</label>
              <select id="setting-run-loc" class="form-select">
                <option value="activeTerminal" ${this.settings.defaultRunLocation === 'activeTerminal' ? 'selected' : ''}>Active Terminal</option>
                <option value="newTerminal" ${this.settings.defaultRunLocation === 'newTerminal' ? 'selected' : ''}>New Terminal Tab</option>
              </select>
            </div>
          </div>
          <div class="modal-actions">
            <button class="btn btn-primary" id="btn-settings-save">Done</button>
          </div>
          <div class="modal-resize-handle" id="modal-resize-grip" title="Drag to resize modal">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
              <circle cx="8" cy="2" r="1"/>
              <circle cx="8" cy="5" r="1"/>
              <circle cx="5" cy="5" r="1"/>
              <circle cx="8" cy="8" r="1"/>
              <circle cx="5" cy="8" r="1"/>
              <circle cx="2" cy="8" r="1"/>
            </svg>
          </div>
        </div>
      `;

      document.getElementById('btn-settings-close')?.addEventListener('click', () => this.closeModal());
      document.getElementById('btn-settings-save')?.addEventListener('click', () => {
        const confirmBeforeKill = (document.getElementById('setting-confirm-kill') as HTMLInputElement).checked;
        const autoRefreshPorts = (document.getElementById('setting-auto-refresh') as HTMLInputElement).checked;
        const portRefreshInterval = parseInt((document.getElementById('setting-refresh-interval') as HTMLInputElement).value, 10) || 3000;
        const terminalFontSize = parseInt((document.getElementById('setting-font-size') as HTMLInputElement).value, 10) || 13;
        const defaultRunLocation = (document.getElementById('setting-run-loc') as HTMLSelectElement).value as any;

        this.postToExtension({ type: 'settings:update', key: 'confirmBeforeKill', value: confirmBeforeKill });
        this.postToExtension({ type: 'settings:update', key: 'autoRefreshPorts', value: autoRefreshPorts });
        this.postToExtension({ type: 'settings:update', key: 'portRefreshInterval', value: portRefreshInterval });
        this.postToExtension({ type: 'settings:update', key: 'terminalFontSize', value: terminalFontSize });
        this.postToExtension({ type: 'settings:update', key: 'defaultRunLocation', value: defaultRunLocation });

        this.closeModal();
      });
    }

    const modal = backdrop.querySelector('.process-modal') as HTMLElement;
    const grip = document.getElementById('modal-resize-grip');
    if (modal && grip) {
      this.initModalResize(modal, grip);
    }
  }

  private initModalResize(modalElement: HTMLElement, handleElement: HTMLElement): void {
    handleElement.addEventListener('mousedown', (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      handleElement.classList.add('active');
      document.body.style.cursor = 'nwse-resize';

      const startX = e.clientX;
      const startY = e.clientY;
      const rect = modalElement.getBoundingClientRect();
      const startWidth = rect.width;
      const startHeight = rect.height;

      const onMouseMove = (moveEvent: MouseEvent) => {
        moveEvent.preventDefault();
        const deltaX = moveEvent.clientX - startX;
        const deltaY = moveEvent.clientY - startY;

        const newWidth = Math.min(Math.max(320, startWidth + deltaX), window.innerWidth * 0.96);
        const newHeight = Math.min(Math.max(160, startHeight + deltaY), window.innerHeight * 0.92);

        modalElement.style.width = `${newWidth}px`;
        modalElement.style.height = `${newHeight}px`;
        modalElement.style.maxWidth = 'none';
        modalElement.style.maxHeight = 'none';
      };

      const onMouseUp = () => {
        handleElement.classList.remove('active');
        document.body.style.cursor = '';
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    });
  }

  private initDropdownResize(dropdownElement: HTMLElement, handleElement: HTMLElement): void {
    handleElement.addEventListener('mousedown', (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      handleElement.classList.add('active');
      document.body.style.cursor = 'nesw-resize';

      const startX = e.clientX;
      const startY = e.clientY;
      const rect = dropdownElement.getBoundingClientRect();
      const startWidth = rect.width;
      const startHeight = rect.height;

      const onMouseMove = (moveEvent: MouseEvent) => {
        moveEvent.preventDefault();
        const deltaX = startX - moveEvent.clientX;
        const deltaY = moveEvent.clientY - startY;

        const newWidth = Math.min(Math.max(320, startWidth + deltaX), window.innerWidth - 16);
        const newHeight = Math.min(Math.max(180, startHeight + deltaY), window.innerHeight - 50);

        dropdownElement.style.width = `${newWidth}px`;
        dropdownElement.style.height = `${newHeight}px`;
        dropdownElement.style.maxHeight = 'none';
      };

      const onMouseUp = () => {
        handleElement.classList.remove('active');
        document.body.style.cursor = '';
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    });
  }

  private initDropdownBottomResize(dropdownElement: HTMLElement, handleElement: HTMLElement): void {
    handleElement.addEventListener('mousedown', (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      document.body.style.cursor = 'ns-resize';

      const startY = e.clientY;
      const rect = dropdownElement.getBoundingClientRect();
      const startHeight = rect.height;

      const onMouseMove = (moveEvent: MouseEvent) => {
        moveEvent.preventDefault();
        const deltaY = moveEvent.clientY - startY;

        const newHeight = Math.min(Math.max(180, startHeight + deltaY), window.innerHeight - 50);
        dropdownElement.style.height = `${newHeight}px`;
        dropdownElement.style.maxHeight = 'none';
      };

      const onMouseUp = () => {
        document.body.style.cursor = '';
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    });
  }

  private openSaveCommandModal(commandId?: string): void {
    this.closeDropdown();
    this.editingCommandId = commandId || null;
    this.activeModal = 'saveCommand';
    this.renderModal();
  }

  private openSettingsModal(): void {
    this.closeDropdown();
    this.activeModal = 'settings';
    this.renderModal();
  }

  private closeModal(): void {
    this.activeModal = null;
    this.editingCommandId = null;
    this.inspectingPort = null;
    this.inspectingProcess = null;
    this.pendingKillTarget = null;
    this.renderModal();
  }

  private applySettings(): void {
    for (const inst of this.terminalInstances.values()) {
      inst.xterm.options.fontSize = this.settings.terminalFontSize || 13;
      if (this.settings.terminalFontFamily) {
        inst.xterm.options.fontFamily = this.settings.terminalFontFamily;
      }
      inst.fitAddon.fit();
    }
  }

  private showToast(message: string, level: 'info' | 'warning' | 'error' = 'info'): void {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    const borderColor = level === 'error' ? 'var(--dcc-danger)' : level === 'warning' ? 'var(--dcc-warning)' : 'var(--dcc-active-tab-border)';

    toast.style.cssText = `
      background: var(--dcc-card-bg);
      color: var(--dcc-fg);
      border: 1px solid var(--dcc-card-border);
      border-left: 3px solid ${borderColor};
      padding: 6px 12px;
      border-radius: 3px;
      font-size: 12px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      animation: slideUp 0.15s ease-out;
      display: flex;
      align-items: center;
      gap: 6px;
    `;

    toast.innerHTML = `
      <i class="codicon codicon-${level === 'error' ? 'error' : level === 'warning' ? 'warning' : 'info'}"></i>
      <span>${this.escapeHtml(message)}</span>
    `;

    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.2s';
      setTimeout(() => toast.remove(), 200);
    }, 2600);
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}

function startApp(): void {
  try {
    new DevControlCenterApp();
  } catch (err) {
    console.error('Failed to initialize DevControlCenterApp:', err);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startApp);
} else {
  startApp();
}
