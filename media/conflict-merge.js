/**
 * Conflict Merge Webview Script
 * Handles Monaco editor initialization and user interactions
 */

(function () {
    // VS Code API
    const vscode = acquireVsCodeApi();

    // State
    let currentEditor = null;
    let incomingEditor = null;
    let resultEditor = null;
    let currentConflictId = null;
    let currentTheme = 'vs-dark';
    let isInitialized = false;
    let selectedVersion = null; // 'current', 'incoming', or null
    let currentScript = ''; // Store original scripts for diff comparison
    let incomingScript = '';
    let wordWrapEnabled = false; // Word wrap is off by default
    let currentDecorations = []; // Track decorations for current editor
    let incomingDecorations = []; // Track decorations for incoming editor

    // Monaco editor options
    const editorOptions = {
        language: 'python',
        theme: 'vs-dark',
        minimap: { enabled: false },
        lineNumbers: 'on',
        scrollBeyondLastLine: false,
        automaticLayout: true,
        fontSize: 13,
        wordWrap: 'off', // Disabled by default for better readability
        tabSize: 4,
        insertSpaces: true,
        renderWhitespace: 'selection',
        folding: true,
        contextmenu: false, // Use native OS context menu instead of Monaco's
        glyphMargin: true, // Enable for diff highlighting indicators
        scrollbar: {
            verticalScrollbarSize: 10,
            horizontalScrollbarSize: 10
        }
    };

    /**
     * Initialize Monaco editors
     */
    function initializeEditors() {
        require(['vs/editor/editor.main'], function () {
            // Create Current editor (left side)
            currentEditor = monaco.editor.create(document.getElementById('currentEditor'), {
                ...editorOptions,
                value: '',
                readOnly: false
            });

            // Create Incoming editor (right side)
            incomingEditor = monaco.editor.create(document.getElementById('incomingEditor'), {
                ...editorOptions,
                value: '',
                readOnly: false
            });

            // Create Result editor (bottom)
            resultEditor = monaco.editor.create(document.getElementById('resultEditor'), {
                ...editorOptions,
                value: '',
                readOnly: false
            });

            // Apply current theme
            monaco.editor.setTheme(currentTheme);

            // Mark as initialized
            isInitialized = true;

            // Hide loading overlay
            const loadingOverlay = document.getElementById('loadingOverlay');
            if (loadingOverlay) {
                loadingOverlay.classList.add('hidden');
            }

            // Notify extension that we're ready
            vscode.postMessage({ command: 'ready' });
        });
    }

    /**
     * Compute line-by-line diff between two scripts
     * Returns arrays of line numbers that are different
     */
    function computeLineDiff(script1, script2) {
        const lines1 = script1.split('\n');
        const lines2 = script2.split('\n');
        const maxLines = Math.max(lines1.length, lines2.length);

        const differentLines1 = []; // Lines in script1 that differ
        const differentLines2 = []; // Lines in script2 that differ

        for (let i = 0; i < maxLines; i++) {
            const line1 = lines1[i] || '';
            const line2 = lines2[i] || '';

            if (line1 !== line2) {
                if (i < lines1.length) {
                    differentLines1.push(i + 1); // Monaco uses 1-based line numbers
                }
                if (i < lines2.length) {
                    differentLines2.push(i + 1);
                }
            }
        }

        // Mark extra lines as different
        if (lines1.length > lines2.length) {
            for (let i = lines2.length; i < lines1.length; i++) {
                if (!differentLines1.includes(i + 1)) {
                    differentLines1.push(i + 1);
                }
            }
        }
        if (lines2.length > lines1.length) {
            for (let i = lines1.length; i < lines2.length; i++) {
                if (!differentLines2.includes(i + 1)) {
                    differentLines2.push(i + 1);
                }
            }
        }

        return { differentLines1, differentLines2 };
    }

    /**
     * Apply diff decorations to an editor
     * @param {object} editor - Monaco editor instance
     * @param {number[]} lineNumbers - Array of line numbers to highlight
     * @param {string} type - 'current' (green) or 'incoming' (yellow/blue)
     * @returns {string[]} - Decoration IDs for later removal
     */
    function applyDiffDecorations(editor, lineNumbers, type) {
        const decorations = lineNumbers.map(lineNumber => ({
            range: new monaco.Range(lineNumber, 1, lineNumber, 1),
            options: {
                isWholeLine: true,
                className: type === 'current' ? 'diff-line-current' : 'diff-line-incoming',
                glyphMarginClassName: type === 'current' ? 'diff-glyph-current' : 'diff-glyph-incoming'
            }
        }));

        return editor.deltaDecorations([], decorations);
    }

    /**
     * Update diff highlighting between current and incoming editors
     */
    function updateDiffHighlighting() {
        if (!currentEditor || !incomingEditor) return;

        const currentContent = currentEditor.getValue();
        const incomingContent = incomingEditor.getValue();

        const { differentLines1, differentLines2 } = computeLineDiff(currentContent, incomingContent);

        // Clear old decorations and apply new ones
        currentDecorations = currentEditor.deltaDecorations(
            currentDecorations,
            differentLines1.map(lineNumber => ({
                range: new monaco.Range(lineNumber, 1, lineNumber, 1),
                options: {
                    isWholeLine: true,
                    className: 'diff-line-current',
                    glyphMarginClassName: 'diff-glyph-current'
                }
            }))
        );

        incomingDecorations = incomingEditor.deltaDecorations(
            incomingDecorations,
            differentLines2.map(lineNumber => ({
                range: new monaco.Range(lineNumber, 1, lineNumber, 1),
                options: {
                    isWholeLine: true,
                    className: 'diff-line-incoming',
                    glyphMarginClassName: 'diff-glyph-incoming'
                }
            }))
        );
    }

    /**
     * Toggle word wrap in all editors
     */
    function toggleWordWrap() {
        wordWrapEnabled = !wordWrapEnabled;
        const wrapSetting = wordWrapEnabled ? 'on' : 'off';

        if (currentEditor) {
            currentEditor.updateOptions({ wordWrap: wrapSetting });
        }
        if (incomingEditor) {
            incomingEditor.updateOptions({ wordWrap: wrapSetting });
        }
        if (resultEditor) {
            resultEditor.updateOptions({ wordWrap: wrapSetting });
        }

        // Update button state
        updateWrapButtonState();
    }

    /**
     * Update the wrap button visual state
     */
    function updateWrapButtonState() {
        const wrapBtn = document.getElementById('toggleWrapBtn');
        if (wrapBtn) {
            if (wordWrapEnabled) {
                wrapBtn.classList.add('active');
                wrapBtn.title = 'Word wrap is ON - click to disable';
            } else {
                wrapBtn.classList.remove('active');
                wrapBtn.title = 'Word wrap is OFF - click to enable';
            }
        }
    }

    /**
     * Update button selection state
     */
    function updateButtonSelection(version) {
        selectedVersion = version;

        const useCurrentBtn = document.getElementById('useCurrentBtn');
        const useIncomingBtn = document.getElementById('useIncomingBtn');

        // Remove active class from both
        useCurrentBtn.classList.remove('selected');
        useIncomingBtn.classList.remove('selected');

        // Add active class to selected
        if (version === 'current') {
            useCurrentBtn.classList.add('selected');
        } else if (version === 'incoming') {
            useIncomingBtn.classList.add('selected');
        }
    }

    /**
     * Clear button selection (when result is manually edited)
     */
    function clearButtonSelection() {
        selectedVersion = null;
        const useCurrentBtn = document.getElementById('useCurrentBtn');
        const useIncomingBtn = document.getElementById('useIncomingBtn');

        useCurrentBtn.classList.remove('selected');
        useIncomingBtn.classList.remove('selected');
    }

    /**
     * Load conflict data into editors
     */
    function loadConflict(payload) {
        if (!isInitialized) {
            // Queue for later
            setTimeout(() => loadConflict(payload), 100);
            return;
        }

        // Update labels
        document.getElementById('filePathLabel').textContent = payload.filePath;
        document.getElementById('jsonKeyLabel').textContent = payload.jsonKey;
        document.getElementById('currentBranchLabel').textContent = payload.currentBranch;
        document.getElementById('incomingBranchLabel').textContent = payload.incomingBranch;

        // Store original scripts for comparison
        currentScript = payload.currentScript;
        incomingScript = payload.incomingScript;

        // Set editor contents
        currentEditor.setValue(payload.currentScript);
        incomingEditor.setValue(payload.incomingScript);

        // Initialize result with current content (user's choice to start)
        resultEditor.setValue(payload.currentScript);

        // Store conflict ID
        currentConflictId = payload.conflictId;

        // Apply diff highlighting
        updateDiffHighlighting();

        // Set up change listeners for diff updates
        currentEditor.onDidChangeModelContent(() => {
            updateDiffHighlighting();
        });
        incomingEditor.onDidChangeModelContent(() => {
            updateDiffHighlighting();
        });

        // Track manual edits to result to clear button selection
        resultEditor.onDidChangeModelContent(() => {
            // Check if result differs from both stored versions
            const resultContent = resultEditor.getValue();
            if (resultContent !== currentScript && resultContent !== incomingScript) {
                clearButtonSelection();
            }
        });

        // Mark current as selected since we initialized with current content
        updateButtonSelection('current');

        // Focus result editor
        resultEditor.focus();
    }

    /**
     * Set Monaco theme
     */
    function setTheme(theme) {
        currentTheme = theme;
        if (isInitialized) {
            monaco.editor.setTheme(theme);
        }
    }

    /**
     * Copy current editor content to result
     */
    function useCurrent() {
        if (!currentEditor || !resultEditor) return;
        resultEditor.setValue(currentEditor.getValue());
        updateButtonSelection('current');
        resultEditor.focus();
    }

    /**
     * Copy incoming editor content to result
     */
    function useIncoming() {
        if (!incomingEditor || !resultEditor) return;
        resultEditor.setValue(incomingEditor.getValue());
        updateButtonSelection('incoming');
        resultEditor.focus();
    }

    /**
     * Accept the result and close
     */
    function acceptResult() {
        if (!resultEditor || !currentConflictId) return;

        const content = resultEditor.getValue();
        vscode.postMessage({
            command: 'acceptResult',
            conflictId: currentConflictId,
            content: content
        });
    }

    /**
     * Cancel and close
     */
    function cancel() {
        vscode.postMessage({ command: 'cancel' });
    }

    /**
     * Handle messages from extension
     */
    function handleMessage(event) {
        const message = event.data;

        switch (message.command) {
            case 'loadConflict':
                loadConflict(message.payload);
                break;

            case 'setTheme':
                setTheme(message.theme);
                break;
        }
    }

    /**
     * Setup event listeners
     */
    function setupEventListeners() {
        // Button handlers
        document.getElementById('useCurrentBtn').addEventListener('click', useCurrent);
        document.getElementById('useIncomingBtn').addEventListener('click', useIncoming);
        document.getElementById('acceptBtn').addEventListener('click', acceptResult);
        document.getElementById('cancelBtn').addEventListener('click', cancel);
        document.getElementById('toggleWrapBtn').addEventListener('click', toggleWordWrap);

        // Message handler
        window.addEventListener('message', handleMessage);

        // Keyboard shortcuts
        document.addEventListener('keydown', function (e) {
            // Ctrl/Cmd + Enter to accept
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                acceptResult();
            }
            // Escape to cancel
            if (e.key === 'Escape') {
                e.preventDefault();
                cancel();
            }
            // Alt + Z to toggle word wrap (common VS Code shortcut)
            if (e.altKey && e.key === 'z') {
                e.preventDefault();
                toggleWordWrap();
            }
        });
    }

    /**
     * Initialize the webview
     */
    function init() {
        setupEventListeners();
        initializeEditors();
    }

    // Start initialization when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
