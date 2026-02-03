/**
 * @module ContextConstants
 * @description Context keys for when clauses in package.json
 * Used for enabling/disabling commands and menu items
 */

/**
 * Context keys used in when clauses
 */
export const CONTEXTS = {
    // Extension state contexts
    EXTENSION_ACTIVATED: 'flint:extensionActivated',
    CONFIGURATION_LOADED: 'flint:configurationLoaded',
    WORKSPACE_HAS_CONFIG: 'flint:workspaceHasConfig',

    // Gateway contexts
    GATEWAY_SELECTED: 'flint:gatewaySelected',
    GATEWAY_CONNECTED: 'flint:gatewayConnected',
    HAS_GATEWAYS: 'flint:hasGateways',
    GATEWAY_AVAILABLE: 'flint:gatewayAvailable',

    // Project contexts
    PROJECT_SELECTED: 'flint:projectSelected',
    PROJECT_LOADED: 'flint:projectLoaded',
    HAS_PROJECTS: 'flint:hasProjects',
    PROJECT_VALID: 'flint:projectValid',

    // Resource contexts
    RESOURCE_SELECTED: 'flint:resourceSelected',
    RESOURCE_EDITABLE: 'flint:resourceEditable',
    RESOURCE_DELETABLE: 'flint:resourceDeletable',
    RESOURCE_COPYABLE: 'flint:resourceCopyable',
    RESOURCE_HAS_JSON: 'flint:resourceHasJson',
    RESOURCE_JSON_MISSING: 'flint:resourceJsonMissing',
    RESOURCE_JSON_INVALID: 'flint:resourceJsonInvalid',

    // Tree view contexts
    TREE_VIEW_VISIBLE: 'flint:treeViewVisible',
    TREE_VIEW_FOCUSED: 'flint:treeViewFocused',
    TREE_HAS_SELECTION: 'flint:treeHasSelection',
    TREE_MULTI_SELECTION: 'flint:treeMultiSelection',

    // Tree node type contexts
    TREE_NODE_GATEWAY: 'flint:treeNode:gateway',
    TREE_NODE_PROJECT: 'flint:treeNode:project',
    TREE_NODE_RESOURCE_TYPE: 'flint:treeNode:resourceType',
    TREE_NODE_RESOURCE_CATEGORY: 'flint:treeNode:resourceCategory',
    TREE_NODE_RESOURCE_FOLDER: 'flint:treeNode:resourceFolder',
    TREE_NODE_RESOURCE_ITEM: 'flint:treeNode:resourceItem',
    TREE_NODE_ERROR: 'flint:treeNode:error',

    // Resource origin contexts
    RESOURCE_ORIGIN_LOCAL: 'flint:resourceOrigin:local',
    RESOURCE_ORIGIN_INHERITED: 'flint:resourceOrigin:inherited',
    RESOURCE_ORIGIN_OVERRIDDEN: 'flint:resourceOrigin:overridden',

    // Search contexts
    SEARCH_ACTIVE: 'flint:searchActive',
    SEARCH_HAS_RESULTS: 'flint:searchHasResults',
    SEARCH_IN_PROGRESS: 'flint:searchInProgress',

    // Tool integration contexts
    KINDLING_AVAILABLE: 'flint:kindlingAvailable',
    DESIGNER_AVAILABLE: 'flint:designerAvailable',
    EXTERNAL_TOOLS_CONFIGURED: 'flint:externalToolsConfigured',

    // Development contexts
    DEBUG_MODE: 'flint:debugMode',
    DEVELOPMENT_MODE: 'flint:developmentMode',

    // Feature flag contexts
    FEATURE_ADVANCED_SEARCH: 'flint:feature:advancedSearch',
    FEATURE_BULK_OPERATIONS: 'flint:feature:bulkOperations',
    FEATURE_RESOURCE_TEMPLATES: 'flint:feature:resourceTemplates',

    // Permission contexts
    CAN_CREATE_RESOURCES: 'flint:permissions:canCreateResources',
    CAN_DELETE_RESOURCES: 'flint:permissions:canDeleteResources',
    CAN_MODIFY_CONFIG: 'flint:permissions:canModifyConfig',

    // View state contexts
    VIEW_MODE_TREE: 'flint:viewMode:tree',
    VIEW_MODE_LIST: 'flint:viewMode:list',
    VIEW_FILTER_ACTIVE: 'flint:viewFilterActive',
    VIEW_SORT_ACTIVE: 'flint:viewSortActive'
} as const;

/**
 * Context value patterns for tree items
 * Used to match against contextValue in tree items
 */
export const CONTEXT_VALUES = {
    // Gateway context values
    GATEWAY_DISCONNECTED: 'gateway:disconnected',
    GATEWAY_CONNECTED: 'gateway:connected',
    GATEWAY_ERROR: 'gateway:error',

    // Project context values
    PROJECT_ENABLED: 'project:enabled',
    PROJECT_DISABLED: 'project:disabled',
    PROJECT_PARENT: 'project:parent',
    PROJECT_CHILD: 'project:child',
    PROJECT_INVALID: 'project:invalid',

    // Resource type context values
    RESOURCE_TYPE_SEARCHABLE: 'resourceType:searchable',
    RESOURCE_TYPE_NON_SEARCHABLE: 'resourceType:nonSearchable',
    RESOURCE_TYPE_CUSTOM: 'resourceType:custom',

    // Resource context values
    RESOURCE_LOCAL: 'resource:local',
    RESOURCE_INHERITED: 'resource:inherited',
    RESOURCE_OVERRIDDEN: 'resource:overridden',
    RESOURCE_MISSING_JSON: 'resource:missingJson',
    RESOURCE_INVALID_JSON: 'resource:invalidJson',

    // Folder context values
    FOLDER_EMPTY: 'folder:empty',
    FOLDER_HAS_RESOURCES: 'folder:hasResources',
    FOLDER_HAS_SUBFOLDERS: 'folder:hasSubfolders',

    // Special context values
    ERROR_NODE: 'errorNode',
    LOADING_NODE: 'loadingNode',
    EMPTY_NODE: 'emptyNode'
} as const;

/**
 * Menu contribution point identifiers
 */
export const MENU_CONTEXTS = {
    // Tree view menus
    TREE_ITEM_CONTEXT: 'flint/treeItem/context',
    TREE_VIEW_TITLE: 'flint/treeView/title',
    TREE_VIEW_CONTEXT: 'flint/treeView/context',

    // Editor menus
    EDITOR_CONTEXT: 'flint/editor/context',
    EDITOR_TITLE: 'flint/editor/title',

    // Explorer menus
    EXPLORER_CONTEXT: 'flint/explorer/context',

    // Command palette
    COMMAND_PALETTE: 'flint/commandPalette'
} as const;

/**
 * When clause expressions for complex conditions
 */
export const WHEN_CLAUSES = {
    // Complex gateway conditions
    GATEWAY_READY: `${CONTEXTS.GATEWAY_SELECTED} && ${CONTEXTS.GATEWAY_CONNECTED}`,
    GATEWAY_CONFIGURABLE: `${CONTEXTS.CONFIGURATION_LOADED} && ${CONTEXTS.CAN_MODIFY_CONFIG}`,

    // Complex project conditions
    PROJECT_READY: `${CONTEXTS.PROJECT_SELECTED} && ${CONTEXTS.PROJECT_LOADED}`,
    PROJECT_OPERATIONS_AVAILABLE: `${CONTEXTS.PROJECT_SELECTED} && ${CONTEXTS.PROJECT_LOADED} && ${CONTEXTS.CAN_CREATE_RESOURCES}`,

    // Complex resource conditions
    RESOURCE_OPERATIONS_AVAILABLE: `${CONTEXTS.RESOURCE_SELECTED} && ${CONTEXTS.RESOURCE_EDITABLE}`,
    RESOURCE_JSON_OPERATIONS: `${CONTEXTS.RESOURCE_SELECTED} && (${CONTEXTS.RESOURCE_JSON_MISSING} || ${CONTEXTS.RESOURCE_JSON_INVALID})`,

    // Tree view conditions
    TREE_OPERATIONS_AVAILABLE: `${CONTEXTS.TREE_VIEW_VISIBLE} && ${CONTEXTS.TREE_HAS_SELECTION}`,
    BULK_OPERATIONS_AVAILABLE: `${CONTEXTS.TREE_MULTI_SELECTION} && ${CONTEXTS.FEATURE_BULK_OPERATIONS}`,

    // Search conditions
    SEARCH_OPERATIONS_AVAILABLE: `${CONTEXTS.PROJECT_LOADED} || ${CONTEXTS.SEARCH_HAS_RESULTS}`,

    // Development conditions
    DEVELOPMENT_FEATURES: `${CONTEXTS.DEVELOPMENT_MODE} || ${CONTEXTS.DEBUG_MODE}`
} as const;

/**
 * Type for context keys to ensure type safety
 */
export type ContextKey = (typeof CONTEXTS)[keyof typeof CONTEXTS];

/**
 * Type for context values
 */
export type ContextValue = (typeof CONTEXT_VALUES)[keyof typeof CONTEXT_VALUES];

/**
 * Type for menu contexts
 */
export type MenuContext = (typeof MENU_CONTEXTS)[keyof typeof MENU_CONTEXTS];
