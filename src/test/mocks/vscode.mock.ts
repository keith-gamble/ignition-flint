/**
 * @module vscode.mock
 * @description Mock implementations for VS Code API used in unit tests
 * Works with Mocha test framework (no Jest dependency)
 */

/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/explicit-function-return-type */
/* eslint-disable @typescript-eslint/require-await */
/* eslint-disable @typescript-eslint/no-this-alias */
/* eslint-disable @typescript-eslint/no-redundant-type-constituents */

/**
 * Simple spy function for tracking calls without Jest
 */
export function createMockFn<T extends (...args: any[]) => any>(): T & {
    calls: Parameters<T>[];
    mockReturnValue: (value: ReturnType<T>) => void;
    mockImplementation: (impl: T) => void;
    mockResolvedValue: (value: unknown) => void;
    reset: () => void;
} {
    let returnValue: ReturnType<T> | undefined;
    let implementation: T | undefined;
    const calls: Parameters<T>[] = [];

    const fn = ((...args: Parameters<T>): ReturnType<T> => {
        calls.push(args);
        if (implementation) {
            return implementation(...args);
        }
        return returnValue as ReturnType<T>;
    }) as T & {
        calls: Parameters<T>[];
        mockReturnValue: (value: ReturnType<T>) => void;
        mockImplementation: (impl: T) => void;
        mockResolvedValue: (value: unknown) => void;
        reset: () => void;
    };

    fn.calls = calls;
    fn.mockReturnValue = (value: ReturnType<T>) => {
        returnValue = value;
    };
    fn.mockImplementation = (impl: T) => {
        implementation = impl;
    };
    fn.mockResolvedValue = (value: unknown) => {
        returnValue = Promise.resolve(value) as ReturnType<T>;
    };
    fn.reset = () => {
        calls.length = 0;
        returnValue = undefined;
        implementation = undefined;
    };

    return fn;
}

/**
 * Mock EventEmitter that mimics VS Code's EventEmitter
 */
export class MockEventEmitter<T> {
    private listeners: ((e: T) => void)[] = [];

    get event(): (listener: (e: T) => void) => { dispose: () => void } {
        return (listener: (e: T) => void) => {
            this.listeners.push(listener);
            return {
                dispose: () => {
                    const index = this.listeners.indexOf(listener);
                    if (index > -1) {
                        this.listeners.splice(index, 1);
                    }
                }
            };
        };
    }

    fire(data: T): void {
        this.listeners.forEach(listener => listener(data));
    }

    dispose(): void {
        this.listeners = [];
    }
}

/**
 * Mock Disposable
 */
export class MockDisposable {
    private disposed = false;
    private onDisposeCallback?: () => void;

    constructor(onDispose?: () => void) {
        this.onDisposeCallback = onDispose;
    }

    dispose(): void {
        if (!this.disposed) {
            this.disposed = true;
            this.onDisposeCallback?.();
        }
    }

    get isDisposed(): boolean {
        return this.disposed;
    }
}

/**
 * Mock Uri implementation
 */
export class MockUri {
    readonly scheme: string;
    readonly authority: string;
    readonly path: string;
    readonly query: string;
    readonly fragment: string;
    readonly fsPath: string;

    constructor(
        scheme: string = 'file',
        authority: string = '',
        path: string = '',
        query: string = '',
        fragment: string = ''
    ) {
        this.scheme = scheme;
        this.authority = authority;
        this.path = path;
        this.query = query;
        this.fragment = fragment;
        this.fsPath = path;
    }

    static file(path: string): MockUri {
        return new MockUri('file', '', path);
    }

    static parse(value: string): MockUri {
        // Simple parsing for tests
        const url = new URL(value, 'file:///');
        return new MockUri(url.protocol.replace(':', ''), url.host, url.pathname, url.search, url.hash);
    }

    with(change: { scheme?: string; authority?: string; path?: string; query?: string; fragment?: string }): MockUri {
        return new MockUri(
            change.scheme ?? this.scheme,
            change.authority ?? this.authority,
            change.path ?? this.path,
            change.query ?? this.query,
            change.fragment ?? this.fragment
        );
    }

    toString(): string {
        return `${this.scheme}://${this.authority}${this.path}`;
    }
}

/**
 * Mock workspace configuration
 */
export class MockWorkspaceConfiguration {
    private config: Map<string, any> = new Map();

    constructor(initialConfig?: Record<string, any>) {
        if (initialConfig) {
            Object.entries(initialConfig).forEach(([key, value]) => {
                this.config.set(key, value);
            });
        }
    }

    get<T>(section: string, defaultValue?: T): T | undefined {
        if (this.config.has(section)) {
            return this.config.get(section) as T;
        }
        return defaultValue;
    }

    has(section: string): boolean {
        return this.config.has(section);
    }

    inspect<T>(_section: string): { key: string; defaultValue?: T; globalValue?: T; workspaceValue?: T } | undefined {
        return undefined;
    }

    async update(section: string, value: any, _configurationTarget?: any): Promise<void> {
        this.config.set(section, value);
    }

    // Test helper to set config values
    setConfig(section: string, value: any): void {
        this.config.set(section, value);
    }
}

/**
 * Mock workspace folder
 */
export interface MockWorkspaceFolder {
    readonly uri: MockUri;
    readonly name: string;
    readonly index: number;
}

/**
 * Mock window API
 */
export class MockWindow {
    private inputBoxQueue: (string | undefined)[] = [];
    private quickPickQueue: (any | undefined)[] = [];
    private messageQueue: (string | undefined)[] = [];

    showInformationMessage = this.createMessageFn();
    showWarningMessage = this.createMessageFn();
    showErrorMessage = this.createMessageFn();
    showInputBox = this.createInputBoxFn();
    showQuickPick = this.createQuickPickFn();
    showOpenDialog = createMockFn<() => Promise<undefined>>();
    showSaveDialog = createMockFn<() => Promise<undefined>>();

    createOutputChannel = (() => {
        const fn = createMockFn();
        fn.mockReturnValue({
            appendLine: createMockFn(),
            append: createMockFn(),
            clear: createMockFn(),
            show: createMockFn(),
            hide: createMockFn(),
            dispose: createMockFn()
        });
        return fn;
    })();

    createTreeView = (() => {
        const fn = createMockFn();
        fn.mockReturnValue({
            onDidChangeSelection: new MockEventEmitter().event,
            onDidChangeVisibility: new MockEventEmitter().event,
            onDidCollapseElement: new MockEventEmitter().event,
            onDidExpandElement: new MockEventEmitter().event,
            reveal: createMockFn(),
            dispose: createMockFn()
        });
        return fn;
    })();

    createStatusBarItem = (() => {
        const fn = createMockFn();
        fn.mockReturnValue({
            text: '',
            tooltip: '',
            command: undefined,
            show: createMockFn(),
            hide: createMockFn(),
            dispose: createMockFn()
        });
        return fn;
    })();

    withProgress = (() => {
        const fn = createMockFn<(_options: any, task: any) => Promise<any>>();
        fn.mockImplementation(async (_options, task) => {
            return task(
                { report: createMockFn() },
                { isCancellationRequested: false, onCancellationRequested: createMockFn() }
            );
        });
        return fn;
    })();

    private createMessageFn() {
        const self = this;
        const fn = createMockFn<(...args: any[]) => Promise<string | undefined>>();
        fn.mockImplementation(async () => self.messageQueue.shift());
        return fn;
    }

    private createInputBoxFn() {
        const self = this;
        const fn = createMockFn<(...args: any[]) => Promise<string | undefined>>();
        fn.mockImplementation(async () => self.inputBoxQueue.shift());
        return fn;
    }

    private createQuickPickFn() {
        const self = this;
        const fn = createMockFn<(...args: any[]) => Promise<any>>();
        fn.mockImplementation(async () => self.quickPickQueue.shift());
        return fn;
    }

    // Test helpers
    queueInputBox(value: string | undefined): void {
        this.inputBoxQueue.push(value);
    }

    queueQuickPick(value: any): void {
        this.quickPickQueue.push(value);
    }

    queueMessage(value: string | undefined): void {
        this.messageQueue.push(value);
    }

    reset(): void {
        this.inputBoxQueue = [];
        this.quickPickQueue = [];
        this.messageQueue = [];
        // Reset all mock functions
        this.showInformationMessage.reset();
        this.showWarningMessage.reset();
        this.showErrorMessage.reset();
        this.showInputBox.reset();
        this.showQuickPick.reset();
    }
}

/**
 * Mock workspace API
 */
export class MockWorkspace {
    private configSections: Map<string, MockWorkspaceConfiguration> = new Map();
    workspaceFolders: MockWorkspaceFolder[] | undefined = undefined;
    readonly onDidChangeConfiguration = new MockEventEmitter<any>().event;
    readonly onDidChangeWorkspaceFolders = new MockEventEmitter<any>().event;

    fs = {
        readFile: (() => {
            const fn = createMockFn<() => Promise<Buffer>>();
            fn.mockResolvedValue(Buffer.from(''));
            return fn;
        })(),
        writeFile: (() => {
            const fn = createMockFn<() => Promise<void>>();
            fn.mockResolvedValue(undefined);
            return fn;
        })(),
        delete: (() => {
            const fn = createMockFn<() => Promise<void>>();
            fn.mockResolvedValue(undefined);
            return fn;
        })(),
        rename: (() => {
            const fn = createMockFn<() => Promise<void>>();
            fn.mockResolvedValue(undefined);
            return fn;
        })(),
        copy: (() => {
            const fn = createMockFn<() => Promise<void>>();
            fn.mockResolvedValue(undefined);
            return fn;
        })(),
        createDirectory: (() => {
            const fn = createMockFn<() => Promise<void>>();
            fn.mockResolvedValue(undefined);
            return fn;
        })(),
        readDirectory: (() => {
            const fn = createMockFn<() => Promise<never[]>>();
            fn.mockResolvedValue([]);
            return fn;
        })(),
        stat: (() => {
            const fn = createMockFn<() => Promise<{ type: number; ctime: number; mtime: number; size: number }>>();
            fn.mockResolvedValue({ type: 1, ctime: 0, mtime: 0, size: 0 });
            return fn;
        })()
    };

    getConfiguration(section?: string): MockWorkspaceConfiguration {
        const key = section || '__default__';
        if (!this.configSections.has(key)) {
            this.configSections.set(key, new MockWorkspaceConfiguration());
        }
        return this.configSections.get(key)!;
    }

    openTextDocument = (() => {
        const fn = createMockFn<() => Promise<any>>();
        fn.mockResolvedValue({
            getText: () => '',
            uri: MockUri.file('/test'),
            languageId: 'plaintext',
            lineCount: 0,
            fileName: '/test'
        });
        return fn;
    })();

    findFiles = (() => {
        const fn = createMockFn<() => Promise<never[]>>();
        fn.mockResolvedValue([]);
        return fn;
    })();

    saveAll = (() => {
        const fn = createMockFn<() => Promise<boolean>>();
        fn.mockResolvedValue(true);
        return fn;
    })();

    // Test helpers
    setWorkspaceFolders(folders: { uri: string; name: string }[]): void {
        this.workspaceFolders = folders.map((f, i) => ({
            uri: MockUri.file(f.uri),
            name: f.name,
            index: i
        }));
    }

    setConfiguration(section: string, config: Record<string, any>): void {
        this.configSections.set(section, new MockWorkspaceConfiguration(config));
    }

    reset(): void {
        this.configSections.clear();
        this.workspaceFolders = undefined;
        // Reset fs mocks
        Object.values(this.fs).forEach(fn => fn.reset());
        this.openTextDocument.reset();
        this.findFiles.reset();
        this.saveAll.reset();
    }
}

/**
 * Mock commands API
 */
export class MockCommands {
    private registeredCommands: Map<string, (...args: any[]) => any> = new Map();

    registerCommand = (() => {
        const self = this;
        const fn = createMockFn<(command: string, callback: (...args: any[]) => any) => MockDisposable>();
        fn.mockImplementation((command: string, callback: (...args: any[]) => any) => {
            self.registeredCommands.set(command, callback);
            return new MockDisposable(() => {
                self.registeredCommands.delete(command);
            });
        });
        return fn;
    })();

    executeCommand = (() => {
        const self = this;
        const fn = createMockFn<(command: string, ...args: any[]) => Promise<any>>();
        fn.mockImplementation(async (command: string, ...args: any[]) => {
            const handler = self.registeredCommands.get(command);
            if (handler) {
                return handler(...args);
            }
            return undefined;
        });
        return fn;
    })();

    getCommands = (() => {
        const self = this;
        const fn = createMockFn<() => Promise<string[]>>();
        fn.mockImplementation(async () => [...self.registeredCommands.keys()]);
        return fn;
    })();

    // Test helpers
    hasCommand(command: string): boolean {
        return this.registeredCommands.has(command);
    }

    reset(): void {
        this.registeredCommands.clear();
        this.registerCommand.reset();
        this.executeCommand.reset();
        this.getCommands.reset();
    }
}

/**
 * Mock VS Code module - use this to replace vscode import in tests
 */
export function createMockVSCode(): {
    window: MockWindow;
    workspace: MockWorkspace;
    commands: MockCommands;
    Uri: typeof MockUri;
    EventEmitter: typeof MockEventEmitter;
    Disposable: typeof MockDisposable;
    TreeItemCollapsibleState: { None: 0; Collapsed: 1; Expanded: 2 };
    ThemeIcon: new (id: string) => { id: string };
    ProgressLocation: { Notification: 15; SourceControl: 1; Window: 10 };
    ConfigurationTarget: { Global: 1; Workspace: 2; WorkspaceFolder: 3 };
    FileType: { Unknown: 0; File: 1; Directory: 2; SymbolicLink: 64 };
} {
    return {
        window: new MockWindow(),
        workspace: new MockWorkspace(),
        commands: new MockCommands(),
        Uri: MockUri,
        EventEmitter: MockEventEmitter,
        Disposable: MockDisposable,
        TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
        ThemeIcon: class {
            constructor(public id: string) {}
        },
        ProgressLocation: { Notification: 15, SourceControl: 1, Window: 10 },
        ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
        FileType: { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 }
    };
}

// Note: These mocks can be used directly with dependency injection or module replacement
