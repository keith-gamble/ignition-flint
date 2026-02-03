# Flint Test Plan

This document defines the testing strategy, priorities, and category definitions for comprehensive test coverage.

---

## Testing Priorities

| Priority | Category | Files | Rationale |
|----------|----------|-------|-----------|
| P0 | Utilities | 16 | Foundation - used by all other code, easy to unit test |
| P1 | Services | 20 | Core business logic, everything depends on these |
| P2 | Commands | 38 | User-facing operations, critical paths |
| P3 | Providers | 8 | Resource-specific behavior |
| P4 | Views | 12 | UI components, harder to test |

---

## Category Definitions

### P0: Utilities

**Purpose:** Pure functions and helpers with no VS Code dependencies. Easiest to test, provides foundation for other tests.

**Testing Approach:** Unit tests with standard Mocha/assert. No mocks needed.

**Files to Test:**
```
src/utils/
├── path/
│   ├── PathUtilities.ts      - Path manipulation functions
│   ├── PathValidator.ts      - Path validation logic
│   └── ResourcePathResolver.ts - Resource path resolution
├── search/
│   ├── SearchResultFormatter.ts - Format search results
│   └── SearchUtilities.ts    - Search helper functions
├── validation/
│   ├── ConfigValidator.ts    - Config validation helpers
│   └── ValidationUtilities.ts - General validation
├── designerLauncherHelper.ts - Designer URL construction
├── errorHelper.ts            - Error formatting/handling
├── kindlingHelper.ts         - Kindling tool integration
├── resourceScanHelper.ts     - Resource scanning helpers
└── searchHelper.ts           - Search query parsing
```

**Test Focus:**
- Input/output validation
- Edge cases (empty strings, null, undefined)
- Error conditions
- Boundary conditions

---

### P1: Services

**Purpose:** Core business logic services. These are the backbone of the extension.

**Testing Approach:** Unit tests with mocked dependencies. Use dependency injection to swap real services with mocks.

**Sub-priorities:**

#### P1.1: Config Services (Critical - everything depends on config)
```
src/services/config/
├── WorkspaceConfigService.ts    - Load/save flint.config.json
├── ConfigValidationService.ts   - Validate config against schema
├── ConfigMigrationService.ts    - Migrate old config versions
└── ProjectScannerService.ts     - Scan filesystem for projects
```

#### P1.2: Resource Services
```
src/services/resources/
├── ResourceTypeProviderRegistry.ts - Registry for resource providers
├── ResourceValidationService.ts    - Validate resources
├── ResourceSearchService.ts        - Search within resources
└── ResourceEditorManagerService.ts - Manage resource editors
```

#### P1.3: Gateway Services
```
src/services/gateways/
├── GatewayManagerService.ts     - Active gateway management
└── GatewayValidationService.ts  - Gateway config validation
```

#### P1.4: Search Services
```
src/services/search/
├── SearchProviderService.ts  - Main search provider
├── SearchIndexService.ts     - Search indexing
├── SearchResultService.ts    - Search result handling
└── SearchHistoryService.ts   - Search history management
```

#### P1.5: Python Services
```
src/services/python/
├── PythonASTService.ts           - Parse Python AST
├── ScriptModuleIndexService.ts   - Index script modules
├── IgnitionStubsManagerService.ts - Manage Ignition stubs
└── IgnitionStubParser.ts         - Parse stub files
```

#### P1.6: Environment Service
```
src/services/environments/
└── EnvironmentService.ts - Environment management
```

**Test Focus:**
- Service initialization/lifecycle
- Core method functionality
- Error handling
- Event emission
- State management

**Mock Requirements:**
- VS Code workspace API
- File system operations
- Other dependent services

---

### P2: Commands

**Purpose:** User-facing operations triggered via command palette or UI.

**Testing Approach:** Unit tests with mocked ServiceContainer and VS Code APIs.

**Sub-priorities:**

#### P2.1: Resource Commands (Most used)
```
src/commands/resources/
├── CreateResourceCommand.ts   - Create new resources
├── DeleteResourceCommand.ts   - Delete resources
├── RenameResourceCommand.ts   - Rename resources
├── DuplicateResourceCommand.ts - Duplicate resources
├── CreateFolderCommand.ts     - Create folders
├── OpenResourceCommand.ts     - Open resource files
└── CopyPathCommand.ts         - Copy resource paths
```

#### P2.2: Config Commands
```
src/commands/config/
├── GetStartedCommand.ts      - Initial setup wizard
├── OpenConfigCommand.ts      - Open config file
├── AddGatewayCommand.ts      - Add gateway to config
├── RemoveGatewayCommand.ts   - Remove gateway
└── AddProjectPathsCommand.ts - Add project paths
```

#### P2.3: Gateway Commands
```
src/commands/gateway/
├── SelectGatewayCommand.ts      - Select active gateway
├── NavigateToGatewayCommand.ts  - Open gateway in browser
└── OpenDesignerCommand.ts       - Launch Ignition Designer
```

#### P2.4: Search Commands
```
src/commands/search/
├── SearchResourcesCommand.ts    - Main search
├── FindInResourcesCommand.ts    - Find in files
├── SearchByTypeCommand.ts       - Filter by type
└── ClearSearchHistoryCommand.ts - Clear history
```

#### P2.5: Project Commands
```
src/commands/project/
├── SelectProjectCommand.ts    - Select active project
├── RefreshProjectsCommand.ts  - Refresh project list
├── ValidateProjectCommand.ts  - Validate project structure
└── OpenProjectJsonCommand.ts  - Open project.json
```

#### P2.6: Python Commands
```
src/commands/python/
├── CopyQualifiedPathCommand.ts      - Copy full module path
├── CopySymbolPathCommand.ts         - Copy symbol path
└── NavigateToScriptElementCommand.ts - Go to definition
```

#### P2.7: ResourceJson Commands
```
src/commands/resourceJson/
├── CreateResourceJsonCommand.ts  - Create resource.json
├── CreateAllMissingCommand.ts    - Create all missing
└── ValidateResourceJsonCommand.ts - Validate resource.json
```

#### P2.8: Other Commands
```
src/commands/environments/SelectEnvironmentCommand.ts
src/commands/tools/OpenWithKindlingCommand.ts
src/commands/tools/ResetToolSettingsCommand.ts
src/commands/debug/DebugConfigCommand.ts
src/commands/debug/DownloadIgnitionStubsCommand.ts
src/commands/debug/ClearIgnitionStubsCacheCommand.ts
```

**Test Focus:**
- Command execution with valid inputs
- Input validation
- Error handling
- User prompts/confirmations
- Side effects (file changes, state updates)

**Mock Requirements:**
- ServiceContainer with mock services
- VS Code window API (showInputBox, showQuickPick, etc.)
- VS Code workspace API
- File system

---

### P3: Providers

**Purpose:** Resource-type specific behavior and completion providers.

**Testing Approach:** Unit tests with mocked contexts.

**Files to Test:**
```
src/providers/resources/
├── PythonScriptProvider.ts         - Python script handling
├── NamedQueryProvider.ts           - Named query handling
├── PerspectiveViewProvider.ts      - Perspective views
├── PerspectiveStyleClassProvider.ts - Style classes
├── PerspectivePageConfigProvider.ts - Page configs
├── PerspectiveSessionPropsProvider.ts - Session props
└── PerspectiveSessionEventsProvider.ts - Session events

src/providers/completion/
└── PythonCompletionProvider.ts     - Python autocomplete
```

**Test Focus:**
- Resource type identification
- Icon/label generation
- File associations
- Template generation
- Completion item generation

---

### P4: Views

**Purpose:** UI components for tree views, quick picks, and status bar.

**Testing Approach:** Integration-style tests with VS Code test utilities.

**Files to Test:**
```
src/views/projectBrowser/
├── ProjectTreeDataProvider.ts  - Main tree provider
├── TreeNodeBuilder.ts          - Build tree nodes
├── TreeStateManager.ts         - Expansion state
├── TreeDecorationProvider.ts   - Decorations
└── TreeCommandHandler.ts       - Tree commands

src/views/quickPick/
├── GatewayQuickPick.ts   - Gateway selection
├── ResourceQuickPick.ts  - Resource selection
└── SearchQuickPick.ts    - Search interface

src/views/statusBar/
├── GatewayStatusBarItem.ts     - Gateway status
├── EnvironmentStatusBarItem.ts - Environment status
└── SearchStatusBarItem.ts      - Search status

src/views/webview/
└── ResourceEditorWebview.ts    - Resource editor
```

**Test Focus:**
- Tree node generation
- State persistence
- UI updates on data changes
- User interaction handling

---

## Mock Infrastructure Needed

### VS Code API Mocks
```typescript
// Mock workspace
const mockWorkspace = {
  workspaceFolders: [],
  getConfiguration: () => mockConfig,
  fs: mockFs,
  onDidChangeConfiguration: mockEvent
};

// Mock window
const mockWindow = {
  showInputBox: stub(),
  showQuickPick: stub(),
  showInformationMessage: stub(),
  showErrorMessage: stub(),
  showWarningMessage: stub(),
  createTreeView: stub(),
  createStatusBarItem: stub()
};
```

### Service Mocks
```typescript
// Mock ServiceContainer
class MockServiceContainer {
  private services = new Map();

  register<T>(key: string, instance: T): void {
    this.services.set(key, instance);
  }

  get<T>(key: string): T {
    return this.services.get(key);
  }
}
```

---

## Test File Structure

```
src/test/
├── suite/
│   ├── core/
│   │   └── ServiceContainer.test.ts  (existing)
│   ├── utils/
│   │   ├── path/
│   │   │   ├── PathUtilities.test.ts
│   │   │   ├── PathValidator.test.ts
│   │   │   └── ResourcePathResolver.test.ts
│   │   ├── search/
│   │   │   └── SearchUtilities.test.ts
│   │   ├── validation/
│   │   │   └── ValidationUtilities.test.ts
│   │   └── helpers.test.ts
│   ├── services/
│   │   ├── config/
│   │   │   ├── WorkspaceConfigService.test.ts
│   │   │   ├── ConfigValidationService.test.ts
│   │   │   └── ProjectScannerService.test.ts
│   │   ├── resources/
│   │   │   └── ResourceTypeProviderRegistry.test.ts
│   │   ├── gateways/
│   │   │   └── GatewayManagerService.test.ts
│   │   ├── search/
│   │   │   └── SearchProviderService.test.ts
│   │   └── python/
│   │       └── PythonASTService.test.ts
│   ├── commands/
│   │   ├── resources/
│   │   │   ├── CreateResourceCommand.test.ts
│   │   │   └── DeleteResourceCommand.test.ts
│   │   └── config/
│   │       └── AddGatewayCommand.test.ts
│   ├── providers/
│   │   ├── resources/
│   │   │   └── PythonScriptProvider.test.ts
│   │   └── completion/
│   │       └── PythonCompletionProvider.test.ts
│   ├── views/
│   │   └── projectBrowser/
│   │       └── TreeNodeBuilder.test.ts
│   └── integration/
│       └── ProjectBrowser.integration.test.ts  (existing)
├── mocks/
│   ├── vscode.mock.ts        - VS Code API mocks
│   ├── services.mock.ts      - Service mocks
│   └── fixtures/             - Test data
└── helpers/
    └── testUtils.ts          - Test utilities
```

---

## Implementation Order

### Phase 1: Foundation
1. [ ] Create mock infrastructure (`src/test/mocks/`)
2. [ ] Create test utilities (`src/test/helpers/`)
3. [ ] P0: Utilities tests

### Phase 2: Core Services
4. [ ] P1.1: Config Services
5. [ ] P1.2: Resource Services
6. [ ] P1.3: Gateway Services

### Phase 3: Extended Services
7. [ ] P1.4: Search Services
8. [ ] P1.5: Python Services
9. [ ] P1.6: Environment Service

### Phase 4: Commands
10. [ ] P2.1: Resource Commands
11. [ ] P2.2: Config Commands
12. [ ] P2.3-P2.8: Remaining Commands

### Phase 5: UI
13. [ ] P3: Providers
14. [ ] P4: Views

---

## Success Criteria

- All tests pass with `npm run test`
- Zero linting errors in test files
- Each test file has >80% coverage of its target
- Tests run in <30 seconds total
- Clear test descriptions that document behavior
