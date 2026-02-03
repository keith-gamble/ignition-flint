/**
 * Script Console Webview JavaScript
 * Split view: Multiline Buffer (left) + Interactive Interpreter (right)
 */

/* eslint-disable no-undef */
// @ts-nocheck

(function () {
    'use strict';

    // VS Code API for communication with extension
    const vscode = acquireVsCodeApi();

    // State
    let bufferEditor = null;
    let currentTheme = 'vs-dark';
    let isExecuting = false;
    let interpreterHistory = [];
    let historyIndex = -1;

    // Debug state
    let debugModeEnabled = false;
    let isDebugging = false;
    let breakpoints = new Set(); // Set of line numbers with breakpoints
    let breakpointDecorations = []; // Monaco decoration IDs
    let currentDebugLine = null; // Line currently paused on
    let currentDebugLineDecoration = []; // Decoration for current debug line

    // Completion state
    let completionRequestCounter = 0;
    let pendingCompletionRequests = new Map();

    // Perspective state
    let perspectiveAvailable = false;
    let perspectiveContext = {
        sessionId: null,
        pageId: null,
        viewInstanceId: null,
        componentPath: null
    };

    // DOM Elements
    const loadingOverlay = document.getElementById('loadingOverlay');
    const bufferEditorContainer = document.getElementById('bufferEditor');
    const interpreterOutput = document.getElementById('interpreterOutput');
    const interpreterInput = document.getElementById('interpreterInput');
    const executeBufferBtn = document.getElementById('executeBufferBtn');
    const resetBtn = document.getElementById('resetBtn');
    const clearBtn = document.getElementById('clearBtn');
    const connectBtn = document.getElementById('connectBtn');
    const scopeSelect = document.getElementById('scopeSelect');
    const connectionStatus = document.getElementById('connectionStatus');
    const executionStatus = document.getElementById('executionStatus');

    // Resize handle elements
    const resizeHandle = document.querySelector('.resize-handle');
    const splitPane = document.querySelector('.split-pane');
    const bufferPane = document.querySelector('.buffer-pane');
    const interpreterPane = document.querySelector('.interpreter-pane');

    // Word wrap toggle
    const toggleWrapBtn = document.getElementById('toggleWrapBtn');
    let wordWrapEnabled = false;

    // Debug toggle button (will be created dynamically)
    let debugToggleBtn = null;

    // Perspective DOM Elements
    const perspectiveContextDiv = document.getElementById('perspectiveContext');
    const perspectiveSessionSelect = document.getElementById('perspectiveSessionSelect');
    const perspectivePageSelect = document.getElementById('perspectivePageSelect');
    const perspectiveViewSelect = document.getElementById('perspectiveViewSelect');
    const refreshPerspectiveBtn = document.getElementById('refreshPerspectiveBtn');

    // Component tree picker elements
    const componentPickerBtn = document.getElementById('componentPickerBtn');
    const componentPickerLabel = document.getElementById('componentPickerLabel');
    const componentTreeModal = document.getElementById('componentTreeModal');
    const componentTree = document.getElementById('componentTree');
    const componentTreeCloseBtn = document.getElementById('componentTreeCloseBtn');
    const componentClearBtn = document.getElementById('componentClearBtn');

    // Component tree data
    let componentTreeData = [];

    /**
     * Initialize Monaco Editor for the buffer pane
     */
    function initializeMonaco() {
        require(['vs/editor/editor.main'], function () {
            // Create the buffer editor with glyph margin enabled for breakpoints
            bufferEditor = monaco.editor.create(bufferEditorContainer, {
                value: '# Write your script here\n# Press Execute or Ctrl+Enter to run\n\n',
                language: 'python',
                theme: currentTheme,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                wordWrap: 'on',
                lineNumbers: 'on',
                glyphMargin: true, // Enable glyph margin for breakpoints
                folding: true,
                showFoldingControls: 'mouseover', // Only show on hover to reduce gutter width
                lineDecorationsWidth: 0,
                lineNumbersMinChars: 3,
                renderLineHighlight: 'line',
                scrollbar: {
                    vertical: 'auto',
                    horizontal: 'auto',
                    verticalScrollbarSize: 8,
                    horizontalScrollbarSize: 8
                },
                padding: { top: 8, bottom: 8 },
                fontSize: 13,
                fontFamily: "Consolas, 'Courier New', monospace",
                automaticLayout: true,
                tabSize: 4,
                insertSpaces: true,
                // Fix suggest widget positioning - render with fixed position so it doesn't get clipped
                fixedOverflowWidgets: true
            });

            // Add Ctrl+Enter to execute buffer (or debug if debug mode enabled)
            bufferEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, function () {
                if (debugModeEnabled && !isDebugging) {
                    debugBuffer();
                } else if (isDebugging) {
                    stopDebugging();
                } else {
                    executeBuffer();
                }
            });

            // Add mouse handler for glyph margin clicks (breakpoint toggle)
            bufferEditor.onMouseDown(function (e) {
                if (e.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) {
                    const lineNumber = e.target.position.lineNumber;
                    toggleBreakpoint(lineNumber);
                }
            });

            // Register completion provider for Python
            registerCompletionProvider();

            // Create debug toggle button in buffer footer
            createDebugToggleButton();

            // Hide loading overlay
            loadingOverlay.classList.add('hidden');

            // Focus the editor
            bufferEditor.focus();

            // Notify extension that we're ready
            vscode.postMessage({ command: 'ready' });
        });
    }

    // ============================================================================
    // COMPLETION PROVIDER
    // ============================================================================

    /**
     * Registers the Monaco completion provider for Python
     */
    function registerCompletionProvider() {
        monaco.languages.registerCompletionItemProvider('python', {
            triggerCharacters: ['.'],
            provideCompletionItems: function (model, position) {
                return new Promise(function (resolve) {
                    const requestId = ++completionRequestCounter;
                    const extracted = extractCompletionPrefix(model, position);
                    const lineContent = model.getLineContent(position.lineNumber);

                    // Set a timeout to avoid hanging
                    const timeout = setTimeout(function () {
                        pendingCompletionRequests.delete(requestId);
                        resolve({ suggestions: [] });
                    }, 5000);

                    pendingCompletionRequests.set(requestId, {
                        resolve: resolve,
                        timeout: timeout
                    });

                    vscode.postMessage({
                        command: 'requestCompletion',
                        requestId: requestId,
                        prefix: extracted.modulePrefix,
                        partialWord: extracted.partialWord,
                        scope: scopeSelect.value,
                        lineContent: lineContent,
                        perspectiveContext:
                            scopeSelect.value === 'perspective'
                                ? {
                                      sessionId: perspectiveContext.sessionId,
                                      pageId: perspectiveContext.pageId,
                                      viewInstanceId: perspectiveContext.viewInstanceId,
                                      componentPath: perspectiveContext.componentPath
                                  }
                                : null
                    });
                });
            }
        });
    }

    /**
     * Extracts the completion prefix from the cursor position
     * For "system.tag.read", extracts "system.tag" when cursor is after the last dot
     * For "system.tag.rea", extracts "system.tag" as the module prefix
     * Also returns the partial word being typed for deep search support
     */
    function extractCompletionPrefix(model, position) {
        const lineContent = model.getLineContent(position.lineNumber);
        const textBeforeCursor = lineContent.substring(0, position.column - 1);

        // Find the start of the identifier chain
        // Match Python identifier characters and dots going backwards
        const match = textBeforeCursor.match(/([a-zA-Z_][a-zA-Z0-9_.]*)?$/);
        if (!match || !match[0]) {
            return { modulePrefix: '', partialWord: '' };
        }

        const fullText = match[0];

        // Find the last dot to get the module prefix
        const lastDotIndex = fullText.lastIndexOf('.');
        if (lastDotIndex >= 0) {
            // Return everything before the last dot as the prefix, and the partial word after
            return {
                modulePrefix: fullText.substring(0, lastDotIndex),
                partialWord: fullText.substring(lastDotIndex + 1)
            };
        }

        // No dot - return empty prefix but include the partial word for deep search
        return { modulePrefix: '', partialWord: fullText };
    }

    /**
     * Handles completion response from the extension
     */
    function handleCompletionResponse(requestId, items, isIncomplete) {
        const pending = pendingCompletionRequests.get(requestId);
        if (!pending) {
            return;
        }

        clearTimeout(pending.timeout);
        pendingCompletionRequests.delete(requestId);

        // Convert completion items to Monaco format
        const suggestions = items.map(function (item) {
            // For deep search results with qualified names (like "Test.calculateArea"),
            // use the function name portion as filterText so Monaco can match partial input.
            // When user types "calc", it should match against "calculateArea" from "Test.calculateArea"
            let filterText = item.filterText || item.label;
            if (filterText.includes('.')) {
                const lastDotIndex = filterText.lastIndexOf('.');
                filterText = filterText.substring(lastDotIndex + 1);
            }

            return {
                label: item.label,
                kind: mapCompletionKind(item.kind),
                detail: item.detail || '',
                documentation: item.documentation
                    ? {
                          value: item.documentation,
                          isTrusted: true
                      }
                    : undefined,
                insertText: item.insertText || item.label,
                insertTextRules:
                    item.insertTextFormat === 2
                        ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
                        : undefined,
                sortText: item.sortText || item.label,
                filterText: filterText
            };
        });

        pending.resolve({
            suggestions: suggestions,
            incomplete: isIncomplete
        });
    }

    /**
     * Maps LSP completion kinds to Monaco completion kinds
     */
    function mapCompletionKind(lspKind) {
        const kindMap = {
            1: monaco.languages.CompletionItemKind.Text, // Text
            2: monaco.languages.CompletionItemKind.Method, // Method
            3: monaco.languages.CompletionItemKind.Function, // Function
            4: monaco.languages.CompletionItemKind.Constructor, // Constructor
            5: monaco.languages.CompletionItemKind.Field, // Field
            6: monaco.languages.CompletionItemKind.Variable, // Variable
            7: monaco.languages.CompletionItemKind.Class, // Class
            8: monaco.languages.CompletionItemKind.Interface, // Interface
            9: monaco.languages.CompletionItemKind.Module, // Module
            10: monaco.languages.CompletionItemKind.Property, // Property
            21: monaco.languages.CompletionItemKind.Constant // Constant
        };
        return kindMap[lspKind] || monaco.languages.CompletionItemKind.Text;
    }

    /**
     * Execute the buffer code
     */
    function executeBuffer() {
        if (isExecuting || !bufferEditor) return;

        const code = bufferEditor.getValue().trim();
        if (!code) return;

        executeCode(code, 'buffer');
    }

    /**
     * Execute code from the interactive interpreter
     */
    function executeInterpreterCode() {
        if (isExecuting) return;

        const code = interpreterInput.value.trim();
        if (!code) return;

        // Add to history
        if (interpreterHistory.length === 0 || interpreterHistory[interpreterHistory.length - 1] !== code) {
            interpreterHistory.push(code);
        }
        historyIndex = interpreterHistory.length;

        // Clear input
        interpreterInput.value = '';
        autoResizeInput();

        executeCode(code, 'interpreter');
    }

    /**
     * Execute code and send to extension
     */
    function executeCode(code, source) {
        const scope = scopeSelect.value;

        const message = {
            command: 'executeCode',
            code: code,
            scope: scope,
            source: source
        };

        // Include Perspective context if scope is perspective
        if (scope === 'perspective' && perspectiveContext.sessionId) {
            message.perspectiveContext = {
                sessionId: perspectiveContext.sessionId,
                pageId: perspectiveContext.pageId || undefined,
                viewInstanceId: perspectiveContext.viewInstanceId || undefined,
                componentPath: perspectiveContext.componentPath || undefined
            };
        }

        vscode.postMessage(message);
    }

    /**
     * Navigate interpreter history
     */
    function navigateHistory(direction) {
        if (interpreterHistory.length === 0) return;

        historyIndex += direction;

        if (historyIndex < 0) {
            historyIndex = 0;
        } else if (historyIndex >= interpreterHistory.length) {
            historyIndex = interpreterHistory.length;
            interpreterInput.value = '';
            autoResizeInput();
            return;
        }

        if (historyIndex < interpreterHistory.length) {
            interpreterInput.value = interpreterHistory[historyIndex];
            autoResizeInput();
            // Move cursor to end
            interpreterInput.selectionStart = interpreterInput.selectionEnd = interpreterInput.value.length;
        }
    }

    /**
     * Auto-resize the interpreter input
     */
    function autoResizeInput() {
        interpreterInput.style.height = 'auto';
        interpreterInput.style.height = Math.min(interpreterInput.scrollHeight, 100) + 'px';
    }

    /**
     * Add an entry to the interpreter output
     */
    function addOutputEntry(type, content, showPrompt = true) {
        const entry = document.createElement('div');
        entry.className = `output-entry ${type}`;

        if (type === 'input' && content.includes('\n')) {
            // Handle multiline input
            const lines = content.split('\n');
            lines.forEach((line, index) => {
                const lineDiv = document.createElement('div');
                lineDiv.className = `output-entry input${index > 0 ? ' multiline' : ''}`;
                lineDiv.textContent = line;
                interpreterOutput.appendChild(lineDiv);
            });
        } else {
            entry.textContent = content;
            interpreterOutput.appendChild(entry);
        }

        // Scroll to bottom
        interpreterOutput.scrollTop = interpreterOutput.scrollHeight;
    }

    /**
     * Clear the interpreter output
     */
    function clearOutput() {
        interpreterOutput.innerHTML = '';
        vscode.postMessage({ command: 'clearOutput' });
    }

    /**
     * Reset the session
     */
    function resetSession() {
        interpreterOutput.innerHTML = '';
        interpreterHistory = [];
        historyIndex = -1;
        interpreterInput.value = '';
        autoResizeInput();
        vscode.postMessage({ command: 'resetSession' });
    }

    /**
     * Connect to Designer
     */
    function connectToDesigner() {
        vscode.postMessage({ command: 'connect' });
    }

    // ============================================================================
    // PERSPECTIVE UI HANDLERS
    // ============================================================================

    /**
     * Handle scope selection change
     */
    function onScopeChanged() {
        const scope = scopeSelect.value;

        if (scope === 'perspective') {
            perspectiveContextDiv.style.display = 'flex';
            // Check availability and fetch sessions
            vscode.postMessage({ command: 'checkPerspectiveAvailability' });
            vscode.postMessage({ command: 'fetchPerspectiveSessions' });
        } else {
            perspectiveContextDiv.style.display = 'none';
        }
    }

    /**
     * Handle session selection change
     */
    function onSessionChanged() {
        const sessionId = perspectiveSessionSelect.value;
        perspectiveContext.sessionId = sessionId || null;
        perspectiveContext.pageId = null;
        perspectiveContext.viewInstanceId = null;
        perspectiveContext.componentPath = null;

        // Reset dependent selects
        perspectivePageSelect.innerHTML = '<option value="">Select Page...</option>';
        perspectivePageSelect.disabled = !sessionId;
        perspectiveViewSelect.innerHTML = '<option value="">Select View...</option>';
        perspectiveViewSelect.disabled = true;

        // Reset component picker
        componentPickerBtn.disabled = true;
        componentPickerLabel.textContent = 'No component';
        componentTreeData = [];

        if (sessionId) {
            vscode.postMessage({ command: 'fetchPerspectivePages', sessionId: sessionId });
        }
    }

    /**
     * Handle page selection change
     */
    function onPageChanged() {
        const pageId = perspectivePageSelect.value;
        perspectiveContext.pageId = pageId || null;
        perspectiveContext.viewInstanceId = null;
        perspectiveContext.componentPath = null;

        // Reset dependent selects
        perspectiveViewSelect.innerHTML = '<option value="">Select View...</option>';
        perspectiveViewSelect.disabled = !pageId;

        // Reset component picker
        componentPickerBtn.disabled = true;
        componentPickerLabel.textContent = 'No component';
        componentTreeData = [];

        if (pageId && perspectiveContext.sessionId) {
            vscode.postMessage({
                command: 'fetchPerspectiveViews',
                sessionId: perspectiveContext.sessionId,
                pageId: pageId
            });
        }
    }

    /**
     * Handle view selection change
     */
    function onViewChanged() {
        const viewInstanceId = perspectiveViewSelect.value;
        perspectiveContext.viewInstanceId = viewInstanceId || null;
        perspectiveContext.componentPath = null;

        // Reset component picker
        componentPickerBtn.disabled = !viewInstanceId;
        componentPickerLabel.textContent = 'No component';
        componentTreeData = [];

        if (viewInstanceId && perspectiveContext.sessionId && perspectiveContext.pageId) {
            vscode.postMessage({
                command: 'fetchPerspectiveComponents',
                sessionId: perspectiveContext.sessionId,
                pageId: perspectiveContext.pageId,
                viewInstanceId: viewInstanceId
            });
        }
    }

    /**
     * Open the component tree modal
     */
    function openComponentTreeModal() {
        if (componentTreeData.length === 0) {
            return;
        }
        renderComponentTree(componentTreeData);
        componentTreeModal.classList.remove('hidden');
    }

    /**
     * Close the component tree modal
     */
    function closeComponentTreeModal() {
        componentTreeModal.classList.add('hidden');
    }

    /**
     * Render the component tree
     */
    function renderComponentTree(components) {
        componentTree.innerHTML = '';
        for (const component of components) {
            const node = createTreeNode(component);
            componentTree.appendChild(node);
        }
    }

    /**
     * Create a tree node element
     */
    function createTreeNode(component) {
        const node = document.createElement('div');
        node.className = 'tree-node';
        node.dataset.path = component.path;

        const content = document.createElement('div');
        content.className = 'tree-node-content';
        if (perspectiveContext.componentPath === component.path) {
            content.classList.add('selected');
        }

        // Toggle arrow
        const toggle = document.createElement('span');
        toggle.className = 'tree-toggle';
        const hasChildren = component.children && component.children.length > 0;
        if (hasChildren) {
            toggle.classList.add('has-children');
            toggle.textContent = '▼';
        }
        content.appendChild(toggle);

        // Icon based on component type
        const icon = document.createElement('span');
        icon.className = 'tree-icon';
        icon.textContent = getComponentIcon(component.type);
        content.appendChild(icon);

        // Label
        const label = document.createElement('span');
        label.className = 'tree-label';
        label.textContent = component.name;
        content.appendChild(label);

        // Type (shortened)
        const type = document.createElement('span');
        type.className = 'tree-type';
        type.textContent = getShortType(component.type);
        content.appendChild(type);

        node.appendChild(content);

        // Children
        if (hasChildren) {
            const childrenContainer = document.createElement('div');
            childrenContainer.className = 'tree-children';
            for (const child of component.children) {
                childrenContainer.appendChild(createTreeNode(child));
            }
            node.appendChild(childrenContainer);

            // Toggle expand/collapse on arrow click
            toggle.addEventListener('click', e => {
                e.stopPropagation();
                childrenContainer.classList.toggle('collapsed');
                toggle.textContent = childrenContainer.classList.contains('collapsed') ? '▶' : '▼';
            });
        }

        // Select on click
        content.addEventListener('click', () => {
            selectComponent(component.path, component.name);
        });

        return node;
    }

    /**
     * Get icon for component type (simple text-based icon)
     */
    function getComponentIcon(type) {
        // Use simple text symbols instead of emojis
        if (!type) return '•';
        const lowerType = type.toLowerCase();
        if (
            lowerType.includes('container') ||
            lowerType.includes('flex') ||
            lowerType.includes('column') ||
            lowerType.includes('row')
        )
            return '▢';
        if (lowerType.includes('view') || lowerType.includes('embed')) return '◫';
        return '•';
    }

    /**
     * Get full type name for display
     */
    function getShortType(type) {
        // Return the full type - don't shorten it
        return type || '';
    }

    /**
     * Select a component
     */
    function selectComponent(path, name) {
        perspectiveContext.componentPath = path;
        componentPickerLabel.textContent = name || path;

        // Update selected state in tree
        const allContents = componentTree.querySelectorAll('.tree-node-content');
        allContents.forEach(el => el.classList.remove('selected'));
        const selectedNode = componentTree.querySelector(`[data-path="${path}"] > .tree-node-content`);
        if (selectedNode) {
            selectedNode.classList.add('selected');
        }

        closeComponentTreeModal();
    }

    /**
     * Clear component selection
     */
    function clearComponentSelection() {
        perspectiveContext.componentPath = null;
        componentPickerLabel.textContent = 'No component';
        closeComponentTreeModal();
    }

    /**
     * Refresh Perspective sessions (preserves current selections)
     */
    function refreshPerspectiveSessions() {
        // Store current selections before refresh
        const savedContext = {
            sessionId: perspectiveContext.sessionId,
            pageId: perspectiveContext.pageId,
            viewInstanceId: perspectiveContext.viewInstanceId,
            componentPath: perspectiveContext.componentPath
        };

        // Store in a global so message handlers can access it
        window._pendingPerspectiveRestore = savedContext;

        vscode.postMessage({ command: 'fetchPerspectiveSessions' });
    }

    /**
     * Try to restore a selection in a dropdown after refresh
     * Returns true if the value was found and selected
     */
    function tryRestoreSelection(selectElement, value) {
        if (!value) return false;

        for (let i = 0; i < selectElement.options.length; i++) {
            if (selectElement.options[i].value === value) {
                selectElement.value = value;
                return true;
            }
        }
        return false;
    }

    /**
     * Mark a dropdown as having an invalid/stale selection
     */
    function markDropdownStale(selectElement, staleName) {
        // Add a disabled option showing the stale value
        const staleOption = document.createElement('option');
        staleOption.value = '__stale__';
        staleOption.textContent = `${staleName} (not found)`;
        staleOption.disabled = true;
        staleOption.selected = true;
        staleOption.style.fontStyle = 'italic';
        staleOption.style.color = 'var(--vscode-disabledForeground, #808080)';
        selectElement.insertBefore(staleOption, selectElement.firstChild.nextSibling);
    }

    /**
     * Find a component in the tree by path
     */
    function findComponentInTree(components, path) {
        for (const comp of components) {
            if (comp.path === path) {
                return comp;
            }
            if (comp.children && comp.children.length > 0) {
                const found = findComponentInTree(comp.children, path);
                if (found) return found;
            }
        }
        return null;
    }

    /**
     * Populate a select element with options
     */
    function populateSelect(selectElement, options, valueKey, labelKey, descriptionKey, placeholder) {
        selectElement.innerHTML = `<option value="">${placeholder}</option>`;
        for (const option of options) {
            const opt = document.createElement('option');
            opt.value = option[valueKey];
            opt.textContent =
                descriptionKey && option[descriptionKey]
                    ? `${option[labelKey]} (${option[descriptionKey]})`
                    : option[labelKey];
            selectElement.appendChild(opt);
        }
        selectElement.disabled = options.length === 0;
    }

    /**
     * Update the connection status display
     */
    function updateConnectionStatus(connected, projectName, gatewayHost) {
        const statusText = connectionStatus.querySelector('.status-text');

        connectionStatus.classList.remove('connected', 'disconnected', 'connecting');

        if (connected) {
            connectionStatus.classList.add('connected');
            statusText.textContent = projectName ? `${projectName}` : 'Connected';
            connectBtn.style.display = 'none';
        } else {
            connectionStatus.classList.add('disconnected');
            statusText.textContent = 'Disconnected';
            connectBtn.style.display = 'block';
        }
    }

    /**
     * Set the Monaco editor theme
     */
    function setTheme(theme) {
        currentTheme = theme;
        if (bufferEditor) {
            monaco.editor.setTheme(theme);
        }
    }

    /**
     * Handle messages from the extension
     */
    function handleMessage(event) {
        const message = event.data;

        switch (message.command) {
            case 'updateConnectionStatus':
                updateConnectionStatus(message.connected, message.projectName, message.gatewayHost);
                break;

            case 'executionStarted':
                isExecuting = true;
                executeBufferBtn.disabled = true;
                executionStatus.textContent = 'Executing...';
                executionStatus.className = 'execution-status executing';
                break;

            case 'executionResult':
                isExecuting = false;
                executeBufferBtn.disabled = false;

                // Show separator if from file execution
                if (message.fromFile) {
                    addOutputEntry('separator', `Running: ${message.fileName || 'script'}`);
                }

                // Add input echo (only for interpreter, not buffer)
                if (message.source === 'interpreter' && message.code) {
                    addOutputEntry('input', message.code);
                }

                // Add stdout if present
                if (message.stdout) {
                    addOutputEntry('output', message.stdout);
                }

                // Add stderr if present
                if (message.stderr) {
                    addOutputEntry('error', message.stderr);
                }

                // Add error if present
                if (message.error) {
                    addOutputEntry('error', message.error);
                }

                // Add execution time
                if (message.executionTimeMs !== undefined && message.executionTimeMs > 0) {
                    addOutputEntry('execution-time', `Executed in ${message.executionTimeMs}ms`);
                }

                // Update status
                executionStatus.textContent = message.success ? '' : 'Error';
                executionStatus.className = message.success ? 'execution-status' : 'execution-status error';

                // Focus interpreter input for quick follow-up
                interpreterInput.focus();
                break;

            case 'setTheme':
                setTheme(message.theme);
                break;

            case 'sessionReset':
                addOutputEntry('info', 'Session reset. All variables cleared.');
                break;

            case 'clearAndExecute':
                // Clear output and execute code (for Run in Flint)
                interpreterOutput.innerHTML = '';
                if (message.code) {
                    executeCode(message.code, 'file');
                }
                break;

            case 'setBufferContent':
                // Set the buffer editor content (for loading scripts)
                if (bufferEditor && message.content) {
                    bufferEditor.setValue(message.content);
                }
                break;

            // Perspective discovery responses
            case 'perspectiveAvailability':
                perspectiveAvailable = message.available;
                if (!perspectiveAvailable && scopeSelect.value === 'perspective') {
                    addOutputEntry('error', 'Perspective is not available on the connected Gateway.');
                }
                break;

            case 'perspectiveSessions':
                populateSelect(
                    perspectiveSessionSelect,
                    message.sessions,
                    'sessionId',
                    'label',
                    'description',
                    'Select Session...'
                );
                if (message.sessions.length === 0) {
                    addOutputEntry(
                        'info',
                        'No active Perspective sessions found. Open a Perspective session in a browser first.'
                    );
                }

                // Try to restore previous selection if this was a refresh
                if (window._pendingPerspectiveRestore && window._pendingPerspectiveRestore.sessionId) {
                    const saved = window._pendingPerspectiveRestore;
                    if (tryRestoreSelection(perspectiveSessionSelect, saved.sessionId)) {
                        // Session still exists - restore the context and fetch pages
                        perspectiveContext.sessionId = saved.sessionId;
                        perspectivePageSelect.disabled = false;
                        vscode.postMessage({ command: 'fetchPerspectivePages', sessionId: saved.sessionId });
                    } else {
                        // Session no longer exists - clear the pending restore
                        window._pendingPerspectiveRestore = null;
                    }
                }
                break;

            case 'perspectivePages':
                populateSelect(
                    perspectivePageSelect,
                    message.pages,
                    'pageId',
                    'label',
                    'description',
                    'Select Page...'
                );

                // Try to restore previous selection if this was a refresh
                if (window._pendingPerspectiveRestore && window._pendingPerspectiveRestore.pageId) {
                    const saved = window._pendingPerspectiveRestore;
                    if (tryRestoreSelection(perspectivePageSelect, saved.pageId)) {
                        // Page still exists - restore the context and fetch views
                        perspectiveContext.pageId = saved.pageId;
                        perspectiveViewSelect.disabled = false;
                        vscode.postMessage({
                            command: 'fetchPerspectiveViews',
                            sessionId: perspectiveContext.sessionId,
                            pageId: saved.pageId
                        });
                    } else {
                        // Page no longer exists - stop the cascade
                        window._pendingPerspectiveRestore = null;
                    }
                }
                break;

            case 'perspectiveViews':
                populateSelect(
                    perspectiveViewSelect,
                    message.views,
                    'viewInstanceId',
                    'label',
                    'description',
                    'Select View...'
                );

                // Try to restore previous selection if this was a refresh
                if (window._pendingPerspectiveRestore && window._pendingPerspectiveRestore.viewInstanceId) {
                    const saved = window._pendingPerspectiveRestore;
                    if (tryRestoreSelection(perspectiveViewSelect, saved.viewInstanceId)) {
                        // View still exists - restore the context and fetch components
                        perspectiveContext.viewInstanceId = saved.viewInstanceId;
                        componentPickerBtn.disabled = false;
                        vscode.postMessage({
                            command: 'fetchPerspectiveComponents',
                            sessionId: perspectiveContext.sessionId,
                            pageId: perspectiveContext.pageId,
                            viewInstanceId: saved.viewInstanceId
                        });
                    } else {
                        // View no longer exists - stop the cascade
                        window._pendingPerspectiveRestore = null;
                    }
                }
                break;

            case 'perspectiveComponents':
                // Store the tree data for the picker modal
                componentTreeData = message.components || [];
                componentPickerBtn.disabled = componentTreeData.length === 0;

                // Try to restore previous component selection if this was a refresh
                if (window._pendingPerspectiveRestore && window._pendingPerspectiveRestore.componentPath) {
                    const saved = window._pendingPerspectiveRestore;
                    // Check if the component path exists in the tree
                    const componentExists = findComponentInTree(componentTreeData, saved.componentPath);
                    if (componentExists) {
                        perspectiveContext.componentPath = saved.componentPath;
                        componentPickerLabel.textContent = componentExists.name || saved.componentPath;
                    }
                    // Clear pending restore - we're done
                    window._pendingPerspectiveRestore = null;
                }
                break;

            case 'completionResponse':
                handleCompletionResponse(message.requestId, message.items || [], message.isIncomplete || false);
                break;

            // Debug-related messages
            case 'debugStarted':
                isDebugging = true;
                updateDebugModeUI();
                addOutputEntry('info', 'Debug session started');
                break;

            case 'debugStopped':
                // Debug session paused at a breakpoint or step
                if (message.line) {
                    highlightDebugLine(message.line);
                    addOutputEntry('info', `Paused at line ${message.line}: ${message.reason || 'breakpoint'}`);
                }
                break;

            case 'debugContinued':
                // Debug session resumed
                clearDebugLineHighlight();
                break;

            case 'debugEnded':
                onDebugSessionEnded();
                addOutputEntry('info', 'Debug session ended');
                break;

            case 'debugOutput':
                // Output from the debug session
                if (message.output) {
                    const category = message.category === 'stderr' ? 'error' : 'output';
                    addOutputEntry(category, message.output);
                }
                break;

            case 'setBreakpointsFromExtension':
                // Extension syncing breakpoints to webview
                if (message.breakpoints) {
                    setBreakpoints(message.breakpoints);
                }
                break;
        }
    }

    // ============================================================================
    // WORD WRAP TOGGLE
    // ============================================================================

    /**
     * Toggle word wrap in the buffer editor
     */
    function toggleWordWrap() {
        wordWrapEnabled = !wordWrapEnabled;
        const wrapSetting = wordWrapEnabled ? 'on' : 'off';

        if (bufferEditor) {
            bufferEditor.updateOptions({ wordWrap: wrapSetting });
        }

        updateWrapButtonState();
    }

    /**
     * Update the wrap button visual state
     */
    function updateWrapButtonState() {
        if (toggleWrapBtn) {
            if (wordWrapEnabled) {
                toggleWrapBtn.classList.add('active');
                toggleWrapBtn.title = 'Word wrap is ON - click to disable (Alt+Z)';
            } else {
                toggleWrapBtn.classList.remove('active');
                toggleWrapBtn.title = 'Word wrap is OFF - click to enable (Alt+Z)';
            }
        }
    }

    // ============================================================================
    // DEBUG MODE FUNCTIONALITY
    // ============================================================================

    /**
     * Creates the debug toggle button in the buffer footer
     */
    function createDebugToggleButton() {
        const bufferFooter = document.querySelector('.buffer-footer');
        if (!bufferFooter) return;

        // Create container divs for left and right alignment
        const footerLeft = document.createElement('div');
        footerLeft.className = 'buffer-footer-left';

        const footerRight = document.createElement('div');
        footerRight.className = 'buffer-footer-right';

        // Create debug toggle button
        debugToggleBtn = document.createElement('button');
        debugToggleBtn.className = 'debug-toggle';
        debugToggleBtn.title = 'Enable debug mode to set breakpoints and step through code';
        debugToggleBtn.innerHTML = `
            <svg class="debug-toggle-icon" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1z"/>
                <path d="M8 5v3h3"/>
            </svg>
            <span>Debug</span>
        `;
        debugToggleBtn.addEventListener('click', toggleDebugMode);
        footerLeft.appendChild(debugToggleBtn);

        // Move the execute button to the right container
        const executeBtn = bufferFooter.querySelector('#executeBufferBtn');
        if (executeBtn) {
            footerRight.appendChild(executeBtn);
        }

        // Clear and rebuild footer
        bufferFooter.innerHTML = '';
        bufferFooter.appendChild(footerLeft);
        bufferFooter.appendChild(footerRight);
    }

    /**
     * Toggles debug mode on/off
     */
    function toggleDebugMode() {
        debugModeEnabled = !debugModeEnabled;
        updateDebugModeUI();

        // Notify extension about debug mode change
        vscode.postMessage({
            command: 'debugModeChanged',
            enabled: debugModeEnabled,
            breakpoints: Array.from(breakpoints)
        });
    }

    /**
     * Updates the UI to reflect debug mode state
     */
    function updateDebugModeUI() {
        if (debugToggleBtn) {
            if (debugModeEnabled) {
                debugToggleBtn.classList.add('active');
                debugToggleBtn.title = 'Debug mode is ON - click to disable';
            } else {
                debugToggleBtn.classList.remove('active');
                debugToggleBtn.title = 'Enable debug mode to set breakpoints and step through code';
            }
        }

        // Update execute button
        if (executeBufferBtn) {
            if (isDebugging) {
                executeBufferBtn.textContent = 'Stop (Ctrl+Enter)';
                executeBufferBtn.classList.remove('debug-mode');
                executeBufferBtn.classList.add('stop-debug');
            } else if (debugModeEnabled) {
                executeBufferBtn.textContent = 'Debug (Ctrl+Enter)';
                executeBufferBtn.classList.add('debug-mode');
                executeBufferBtn.classList.remove('stop-debug');
            } else {
                executeBufferBtn.textContent = 'Execute (Ctrl+Enter)';
                executeBufferBtn.classList.remove('debug-mode', 'stop-debug');
            }
        }
    }

    /**
     * Toggles a breakpoint at the specified line
     */
    function toggleBreakpoint(lineNumber) {
        if (breakpoints.has(lineNumber)) {
            breakpoints.delete(lineNumber);
        } else {
            breakpoints.add(lineNumber);
        }
        updateBreakpointDecorations();

        // Notify extension about breakpoint change
        vscode.postMessage({
            command: 'breakpointsChanged',
            breakpoints: Array.from(breakpoints)
        });
    }

    /**
     * Updates Monaco decorations to show breakpoints
     */
    function updateBreakpointDecorations() {
        if (!bufferEditor) return;

        // Create new decorations for all breakpoints
        const newDecorations = Array.from(breakpoints).map(function (lineNumber) {
            return {
                range: new monaco.Range(lineNumber, 1, lineNumber, 1),
                options: {
                    isWholeLine: false,
                    glyphMarginClassName: 'breakpoint-decoration',
                    glyphMarginHoverMessage: { value: 'Click to remove breakpoint' }
                }
            };
        });

        // Apply decorations
        breakpointDecorations = bufferEditor.deltaDecorations(breakpointDecorations, newDecorations);
    }

    /**
     * Clears all breakpoints
     */
    function clearBreakpoints() {
        breakpoints.clear();
        updateBreakpointDecorations();
    }

    /**
     * Sets breakpoints from an array of line numbers
     */
    function setBreakpoints(lines) {
        breakpoints = new Set(lines);
        updateBreakpointDecorations();
    }

    /**
     * Debug the buffer code
     */
    function debugBuffer() {
        if (isExecuting || isDebugging || !bufferEditor) return;

        const code = bufferEditor.getValue().trim();
        if (!code) return;

        const scope = scopeSelect.value;

        isDebugging = true;
        updateDebugModeUI();

        const message = {
            command: 'debugBuffer',
            code: code,
            scope: scope,
            breakpoints: Array.from(breakpoints)
        };

        // Include Perspective context if scope is perspective (for future)
        if (scope === 'perspective' && perspectiveContext.sessionId) {
            message.perspectiveContext = {
                sessionId: perspectiveContext.sessionId,
                pageId: perspectiveContext.pageId || undefined,
                viewInstanceId: perspectiveContext.viewInstanceId || undefined,
                componentPath: perspectiveContext.componentPath || undefined
            };
        }

        vscode.postMessage(message);
    }

    /**
     * Stop the current debug session
     */
    function stopDebugging() {
        if (!isDebugging) return;

        vscode.postMessage({ command: 'stopDebugging' });
        onDebugSessionEnded();
    }

    /**
     * Called when debug session ends (from extension or user action)
     */
    function onDebugSessionEnded() {
        isDebugging = false;
        currentDebugLine = null;
        clearDebugLineHighlight();
        updateDebugModeUI();
    }

    /**
     * Highlights the current debug line in the editor
     */
    function highlightDebugLine(lineNumber) {
        if (!bufferEditor) return;

        currentDebugLine = lineNumber;

        const newDecorations = [
            {
                range: new monaco.Range(lineNumber, 1, lineNumber, 1),
                options: {
                    isWholeLine: true,
                    className: 'debug-current-line',
                    glyphMarginClassName: 'debug-current-line-glyph'
                }
            }
        ];

        currentDebugLineDecoration = bufferEditor.deltaDecorations(currentDebugLineDecoration, newDecorations);

        // Scroll to the line
        bufferEditor.revealLineInCenter(lineNumber);
    }

    /**
     * Clears the debug line highlight
     */
    function clearDebugLineHighlight() {
        if (bufferEditor) {
            currentDebugLineDecoration = bufferEditor.deltaDecorations(currentDebugLineDecoration, []);
        }
    }

    // ============================================================================
    // RESIZE HANDLE FUNCTIONALITY
    // ============================================================================

    let isResizing = false;
    let isVerticalLayout = false;

    /**
     * Check if the layout is vertical (narrow screen)
     */
    function checkVerticalLayout() {
        isVerticalLayout = window.innerWidth <= 500;
    }

    /**
     * Initialize resize handle drag functionality
     */
    function initializeResizeHandle() {
        if (!resizeHandle || !splitPane || !bufferPane || !interpreterPane) {
            return;
        }

        checkVerticalLayout();
        window.addEventListener('resize', checkVerticalLayout);

        resizeHandle.addEventListener('mousedown', startResize);
        resizeHandle.addEventListener('touchstart', startResizeTouch, { passive: false });
    }

    /**
     * Start resize operation (mouse)
     */
    function startResize(e) {
        e.preventDefault();
        isResizing = true;
        resizeHandle.classList.add('active');
        document.body.style.cursor = isVerticalLayout ? 'row-resize' : 'col-resize';
        document.body.style.userSelect = 'none';

        document.addEventListener('mousemove', doResize);
        document.addEventListener('mouseup', stopResize);
    }

    /**
     * Start resize operation (touch)
     */
    function startResizeTouch(e) {
        e.preventDefault();
        isResizing = true;
        resizeHandle.classList.add('active');

        document.addEventListener('touchmove', doResizeTouch, { passive: false });
        document.addEventListener('touchend', stopResizeTouch);
    }

    /**
     * Perform resize (mouse)
     */
    function doResize(e) {
        if (!isResizing) return;

        const splitPaneRect = splitPane.getBoundingClientRect();
        const handleSize = 4;

        if (isVerticalLayout) {
            // Vertical layout - resize heights
            const mouseY = e.clientY;
            const offsetY = mouseY - splitPaneRect.top;
            const totalHeight = splitPaneRect.height;
            const minBufferHeight = 150;
            const minInterpreterHeight = 150;
            const maxBufferHeight = totalHeight - handleSize - minInterpreterHeight;

            // Calculate new heights with constraints on both sides
            const bufferHeight = Math.max(minBufferHeight, Math.min(offsetY, maxBufferHeight));
            const interpreterHeight = totalHeight - bufferHeight - handleSize;

            // Apply styles
            bufferPane.style.flex = 'none';
            bufferPane.style.height = bufferHeight + 'px';
            interpreterPane.style.flex = 'none';
            interpreterPane.style.height = interpreterHeight + 'px';
        } else {
            // Horizontal layout - resize widths
            const mouseX = e.clientX;
            const offsetX = mouseX - splitPaneRect.left;
            const totalWidth = splitPaneRect.width;
            const minBufferWidth = 200;
            const minInterpreterWidth = 280; // Larger to fit header buttons
            const maxBufferWidth = totalWidth - handleSize - minInterpreterWidth;

            // Calculate new widths with constraints on both sides
            const bufferWidth = Math.max(minBufferWidth, Math.min(offsetX, maxBufferWidth));
            const interpreterWidth = totalWidth - bufferWidth - handleSize;

            // Apply styles
            bufferPane.style.flex = 'none';
            bufferPane.style.width = bufferWidth + 'px';
            interpreterPane.style.flex = 'none';
            interpreterPane.style.width = interpreterWidth + 'px';
        }

        // Trigger Monaco editor resize
        if (bufferEditor) {
            bufferEditor.layout();
        }
    }

    /**
     * Perform resize (touch)
     */
    function doResizeTouch(e) {
        if (!isResizing || !e.touches[0]) return;
        doResize({ clientX: e.touches[0].clientX, clientY: e.touches[0].clientY });
    }

    /**
     * Stop resize operation (mouse)
     */
    function stopResize() {
        isResizing = false;
        resizeHandle.classList.remove('active');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';

        document.removeEventListener('mousemove', doResize);
        document.removeEventListener('mouseup', stopResize);
    }

    /**
     * Stop resize operation (touch)
     */
    function stopResizeTouch() {
        isResizing = false;
        resizeHandle.classList.remove('active');

        document.removeEventListener('touchmove', doResizeTouch);
        document.removeEventListener('touchend', stopResizeTouch);
    }

    /**
     * Initialize the webview
     */
    function initialize() {
        // Set up event listeners
        executeBufferBtn.addEventListener('click', function () {
            if (debugModeEnabled && !isDebugging) {
                debugBuffer();
            } else if (isDebugging) {
                stopDebugging();
            } else {
                executeBuffer();
            }
        });
        resetBtn.addEventListener('click', resetSession);
        clearBtn.addEventListener('click', clearOutput);
        connectBtn.addEventListener('click', connectToDesigner);

        // Scope selector handler
        scopeSelect.addEventListener('change', onScopeChanged);

        // Perspective context handlers
        if (perspectiveSessionSelect) {
            perspectiveSessionSelect.addEventListener('change', onSessionChanged);
        }
        if (perspectivePageSelect) {
            perspectivePageSelect.addEventListener('change', onPageChanged);
        }
        if (perspectiveViewSelect) {
            perspectiveViewSelect.addEventListener('change', onViewChanged);
        }
        if (refreshPerspectiveBtn) {
            refreshPerspectiveBtn.addEventListener('click', refreshPerspectiveSessions);
        }

        // Component tree picker handlers
        if (componentPickerBtn) {
            componentPickerBtn.addEventListener('click', openComponentTreeModal);
        }
        if (componentTreeCloseBtn) {
            componentTreeCloseBtn.addEventListener('click', closeComponentTreeModal);
        }
        if (componentClearBtn) {
            componentClearBtn.addEventListener('click', clearComponentSelection);
        }
        // Close modal when clicking outside
        if (componentTreeModal) {
            componentTreeModal.addEventListener('click', e => {
                if (e.target === componentTreeModal) {
                    closeComponentTreeModal();
                }
            });
        }

        // Interpreter input handlers
        interpreterInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                executeInterpreterCode();
            } else if (e.key === 'ArrowUp' && interpreterInput.selectionStart === 0) {
                e.preventDefault();
                navigateHistory(-1);
            } else if (e.key === 'ArrowDown' && interpreterInput.selectionStart === interpreterInput.value.length) {
                e.preventDefault();
                navigateHistory(1);
            }
        });

        interpreterInput.addEventListener('input', autoResizeInput);

        // Listen for messages from extension
        window.addEventListener('message', handleMessage);

        // Word wrap toggle
        if (toggleWrapBtn) {
            toggleWrapBtn.addEventListener('click', toggleWordWrap);
        }

        // Alt+Z keyboard shortcut for word wrap toggle
        document.addEventListener('keydown', function (e) {
            if (e.altKey && e.key === 'z') {
                e.preventDefault();
                toggleWordWrap();
            }
        });

        // Initialize resize handle
        initializeResizeHandle();

        // Initialize Monaco
        initializeMonaco();
    }

    // Start initialization
    initialize();
})();
