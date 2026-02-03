/**
 * @module CommandConstants
 * @description Command ID constants to prevent typos and ensure consistency
 */

/**
 * All command IDs used in the extension
 * Using const assertion for better type safety
 */
export const COMMANDS = {
    // Configuration commands
    GET_STARTED: 'flint.getStarted',
    OPEN_CONFIG: 'flint.openConfig',
    ADD_GATEWAY: 'flint.addGateway',
    REMOVE_GATEWAY: 'flint.removeGateway',
    ADD_PROJECT_PATHS: 'flint.addProjectPaths',
    EDIT_GATEWAY: 'flint.editGateway',

    // Gateway commands
    SELECT_GATEWAY: 'flint.selectGateway',
    REFRESH_GATEWAYS: 'flint.refreshGateways',
    NAVIGATE_TO_GATEWAY: 'flint.navigateToGateway',
    OPEN_DESIGNER: 'flint.navigateToDesigner',
    TEST_GATEWAY_CONNECTION: 'flint.testGatewayConnection',

    // Environment commands
    SELECT_ENVIRONMENT: 'flint.selectEnvironment',

    // Project commands
    SELECT_PROJECT: 'flint.selectProject',
    REFRESH_PROJECTS: 'flint.refreshProjects',
    VALIDATE_PROJECT: 'flint.validateProject',
    SCAN_PROJECTS: 'flint.scanProjects',
    OPEN_PROJECT_FOLDER: 'flint.openProjectFolder',
    OPEN_PROJECT_JSON: 'flint.openProjectJson',

    // Resource commands
    CREATE_RESOURCE: 'flint.createResource',
    CREATE_FOLDER: 'flint.createFolder',
    DELETE_RESOURCE: 'flint.deleteResource',
    RENAME_RESOURCE: 'flint.renameResource',
    DUPLICATE_RESOURCE: 'flint.duplicateResource',
    COPY_RESOURCE_PATH: 'flint.copyResourcePath',
    OPEN_RESOURCE: 'flint.openResource',
    OPEN_RESOURCE_IN_EDITOR: 'flint.openResourceInEditor',

    // Resource JSON commands
    CREATE_RESOURCE_JSON: 'flint.createResourceJson',
    CREATE_ALL_MISSING_RESOURCE_JSON: 'flint.createAllMissingResourceJson',
    VALIDATE_RESOURCE_JSON: 'flint.validateResourceJson',
    FIX_RESOURCE_JSON: 'flint.fixResourceJson',

    // Search commands
    SEARCH_RESOURCES: 'flint.searchResources',
    FIND_IN_RESOURCES: 'flint.findInResources',
    SEARCH_BY_TYPE: 'flint.searchByType',
    CLEAR_SEARCH_HISTORY: 'flint.clearSearchHistory',
    SEARCH_IN_PROJECT: 'flint.searchInProject',
    ADVANCED_SEARCH: 'flint.advancedSearch',

    // Tool integration commands
    OPEN_WITH_KINDLING: 'flint.openWithKindling',
    RESET_TOOL_SETTINGS: 'flint.resetToolSettings',
    CONFIGURE_EXTERNAL_TOOLS: 'flint.configureExternalTools',

    // Tree view commands
    REFRESH_TREE: 'flint.refreshTree',
    COLLAPSE_ALL: 'flint.collapseAll',
    EXPAND_ALL: 'flint.expandAll',
    FILTER_TREE: 'flint.filterTree',
    SORT_TREE: 'flint.sortTree',
    HANDLE_NODE_CLICK: 'flint.handleNodeClick',

    // Development commands
    RELOAD_EXTENSION: 'flint.reloadExtension',
    SHOW_OUTPUT: 'flint.showOutput',
    TOGGLE_DEBUG_MODE: 'flint.toggleDebugMode',
    EXPORT_LOGS: 'flint.exportLogs',
    DEBUG_CONFIG: 'flint.debugConfig',
    CLEAR_IGNITION_STUBS_CACHE: 'flint.clearIgnitionStubsCache',
    DOWNLOAD_IGNITION_STUBS: 'flint.downloadIgnitionStubs',

    // Import/Export commands
    EXPORT_CONFIGURATION: 'flint.exportConfiguration',
    IMPORT_CONFIGURATION: 'flint.importConfiguration',
    EXPORT_PROJECT_STRUCTURE: 'flint.exportProjectStructure',

    // Decoded JSON commands
    COMPARE_DECODED_WITH_GIT: 'flint.compareDecodedWithGit',
    EDIT_EMBEDDED_SCRIPT: 'flint.editEmbeddedScript',
    PASTE_AS_JSON: 'flint.pasteAsJson',

    // Conflict resolution commands
    COMPARE_CONFLICT_SCRIPTS: 'flint.compareConflictScripts',
    ACCEPT_CURRENT_SCRIPT: 'flint.acceptCurrentScript',
    ACCEPT_INCOMING_SCRIPT: 'flint.acceptIncomingScript',

    // Script Console commands
    OPEN_SCRIPT_CONSOLE: 'flint.openScriptConsole',
    RUN_IN_FLINT: 'flint.runInFlint'
} as const;

/**
 * Command categories for organization
 */
export const COMMAND_CATEGORIES = {
    CONFIGURATION: 'Configuration',
    GATEWAY: 'Gateway',
    PROJECT: 'Project',
    RESOURCE: 'Resource',
    SEARCH: 'Search',
    TOOLS: 'Tools',
    TREE: 'Tree View',
    DEVELOPMENT: 'Development',
    WORKSPACE: 'Workspace',
    DECODE: 'Decode'
} as const;

/**
 * Command titles for display in UI
 */
export const COMMAND_TITLES = {
    [COMMANDS.GET_STARTED]: 'Get Started with Flint',
    [COMMANDS.OPEN_CONFIG]: 'Open Configuration',
    [COMMANDS.ADD_GATEWAY]: 'Add Gateway',
    [COMMANDS.REMOVE_GATEWAY]: 'Remove Gateway',
    [COMMANDS.ADD_PROJECT_PATHS]: 'Add Project Paths',
    [COMMANDS.EDIT_GATEWAY]: 'Edit Gateway',

    [COMMANDS.SELECT_GATEWAY]: 'Select Gateway',
    [COMMANDS.REFRESH_GATEWAYS]: 'Refresh Gateways',
    [COMMANDS.NAVIGATE_TO_GATEWAY]: 'Navigate to Gateway',
    [COMMANDS.OPEN_DESIGNER]: 'Open Designer',
    [COMMANDS.TEST_GATEWAY_CONNECTION]: 'Test Gateway Connection',

    [COMMANDS.SELECT_ENVIRONMENT]: 'Select Environment',

    [COMMANDS.SELECT_PROJECT]: 'Select Project',
    [COMMANDS.REFRESH_PROJECTS]: 'Refresh Projects',
    [COMMANDS.VALIDATE_PROJECT]: 'Validate Project',
    [COMMANDS.SCAN_PROJECTS]: 'Scan Projects',
    [COMMANDS.OPEN_PROJECT_FOLDER]: 'Open Project Folder',
    [COMMANDS.OPEN_PROJECT_JSON]: 'Open project.json',

    [COMMANDS.CREATE_RESOURCE]: 'Create Resource',
    [COMMANDS.CREATE_FOLDER]: 'Create Folder',
    [COMMANDS.DELETE_RESOURCE]: 'Delete Resource',
    [COMMANDS.RENAME_RESOURCE]: 'Rename Resource',
    [COMMANDS.DUPLICATE_RESOURCE]: 'Duplicate Resource',
    [COMMANDS.COPY_RESOURCE_PATH]: 'Copy Resource Path',
    [COMMANDS.OPEN_RESOURCE]: 'Open Resource',
    [COMMANDS.OPEN_RESOURCE_IN_EDITOR]: 'Open in Editor',

    [COMMANDS.CREATE_RESOURCE_JSON]: 'Create resource.json',
    [COMMANDS.CREATE_ALL_MISSING_RESOURCE_JSON]: 'Create All Missing resource.json',
    [COMMANDS.VALIDATE_RESOURCE_JSON]: 'Validate resource.json',
    [COMMANDS.FIX_RESOURCE_JSON]: 'Fix resource.json',

    [COMMANDS.SEARCH_RESOURCES]: 'Search Resources',
    [COMMANDS.FIND_IN_RESOURCES]: 'Find in Resources',
    [COMMANDS.SEARCH_BY_TYPE]: 'Search by Type',
    [COMMANDS.CLEAR_SEARCH_HISTORY]: 'Clear Search History',
    [COMMANDS.SEARCH_IN_PROJECT]: 'Search in Project',
    [COMMANDS.ADVANCED_SEARCH]: 'Advanced Search',

    [COMMANDS.OPEN_WITH_KINDLING]: 'Open with Kindling',
    [COMMANDS.RESET_TOOL_SETTINGS]: 'Reset Tool Settings',
    [COMMANDS.CONFIGURE_EXTERNAL_TOOLS]: 'Configure External Tools',

    [COMMANDS.REFRESH_TREE]: 'Refresh',
    [COMMANDS.COLLAPSE_ALL]: 'Collapse All',
    [COMMANDS.EXPAND_ALL]: 'Expand All',
    [COMMANDS.FILTER_TREE]: 'Filter Tree',
    [COMMANDS.SORT_TREE]: 'Sort Tree',
    [COMMANDS.HANDLE_NODE_CLICK]: 'Handle Node Click',

    [COMMANDS.RELOAD_EXTENSION]: 'Reload Extension',
    [COMMANDS.SHOW_OUTPUT]: 'Show Output',
    [COMMANDS.TOGGLE_DEBUG_MODE]: 'Toggle Debug Mode',
    [COMMANDS.EXPORT_LOGS]: 'Export Logs',
    [COMMANDS.DEBUG_CONFIG]: 'Debug Configuration',
    [COMMANDS.CLEAR_IGNITION_STUBS_CACHE]: 'Clear Ignition Stubs Cache',
    [COMMANDS.DOWNLOAD_IGNITION_STUBS]: 'Download Ignition Stubs',

    [COMMANDS.EXPORT_CONFIGURATION]: 'Export Configuration',
    [COMMANDS.IMPORT_CONFIGURATION]: 'Import Configuration',
    [COMMANDS.EXPORT_PROJECT_STRUCTURE]: 'Export Project Structure',

    [COMMANDS.COMPARE_DECODED_WITH_GIT]: 'Compare Decoded with Git',
    [COMMANDS.EDIT_EMBEDDED_SCRIPT]: 'Edit Script',
    [COMMANDS.PASTE_AS_JSON]: 'Paste as JSON',

    [COMMANDS.COMPARE_CONFLICT_SCRIPTS]: 'Compare Conflict Scripts',
    [COMMANDS.ACCEPT_CURRENT_SCRIPT]: 'Accept Current Script',
    [COMMANDS.ACCEPT_INCOMING_SCRIPT]: 'Accept Incoming Script',

    [COMMANDS.OPEN_SCRIPT_CONSOLE]: 'Open Script Console',
    [COMMANDS.RUN_IN_FLINT]: 'Run in Flint'
} as const;

/**
 * Type for command IDs to ensure type safety
 */
export type CommandId = (typeof COMMANDS)[keyof typeof COMMANDS];

/**
 * Type for command categories
 */
export type CommandCategory = (typeof COMMAND_CATEGORIES)[keyof typeof COMMAND_CATEGORIES];
