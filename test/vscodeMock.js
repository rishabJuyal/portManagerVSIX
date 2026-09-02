// Mock for vscode module in standalone unit testing
class EventEmitter {
  constructor() {
    this.listeners = [];
  }
  get event() {
    return (listener) => {
      this.listeners.push(listener);
      return {
        dispose: () => {
          this.listeners = this.listeners.filter(l => l !== listener);
        }
      };
    };
  }
  fire(data) {
    for (const l of this.listeners) {
      try { l(data); } catch (e) { console.error(e); }
    }
  }
  dispose() {
    this.listeners = [];
  }
}

const mockVscode = {
  EventEmitter,
  window: {
    createOutputChannel: () => ({
      appendLine: () => {},
      show: () => {},
      dispose: () => {}
    }),
    createStatusBarItem: () => ({
      text: '',
      tooltip: '',
      command: '',
      show: () => {},
      hide: () => {},
      dispose: () => {}
    }),
    showInformationMessage: async () => undefined,
    showWarningMessage: async () => undefined,
    showErrorMessage: async () => undefined,
    showQuickPick: async () => undefined,
    createQuickPick: () => {
      const onDidAcceptEmitter = new EventEmitter();
      const onDidChangeValueEmitter = new EventEmitter();
      const onDidHideEmitter = new EventEmitter();
      return {
        items: [],
        selectedItems: [],
        placeholder: '',
        busy: false,
        value: '',
        onDidAccept: onDidAcceptEmitter.event,
        onDidChangeValue: onDidChangeValueEmitter.event,
        onDidHide: onDidHideEmitter.event,
        _fireAccept: () => onDidAcceptEmitter.fire(),
        show: () => {},
        hide: () => onDidHideEmitter.fire(),
        dispose: () => {}
      };
    },
    showInputBox: async () => undefined,
    setStatusBarMessage: () => ({ dispose: () => {} })
  },
  workspace: {
    workspaceFolders: [],
    onDidChangeConfiguration: () => ({ dispose: () => {} }),
    onDidChangeWorkspaceFolders: () => ({ dispose: () => {} }),
    getConfiguration: () => ({
      get: (key, def) => def,
      update: async () => {}
    })
  },
  commands: {
    registerCommand: () => ({ dispose: () => {} }),
    executeCommand: async () => {}
  },
  env: {
    openExternal: async () => true,
    clipboard: {
      writeText: async () => {}
    }
  },
  Uri: {
    parse: (str) => ({ toString: () => str, fsPath: str }),
    file: (str) => ({ toString: () => str, fsPath: str }),
    joinPath: (base, ...segments) => ({ fsPath: segments.join('/') })
  },
  StatusBarAlignment: {
    Right: 2,
    Left: 1
  },
  ConfigurationTarget: {
    Global: 1,
    Workspace: 2
  }
};

// Inject mock into require cache
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function(id) {
  if (id === 'vscode') {
    return mockVscode;
  }
  return originalRequire.apply(this, arguments);
};
