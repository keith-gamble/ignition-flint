/**
 * @module ProjectScannerService
 * @description Enhanced project scanning service with caching and monitoring
 * Scans file system for Ignition projects and manages project metadata
 */

import * as fs from 'fs/promises';
import * as path from 'path';

import * as vscode from 'vscode';

import { FlintError, ProjectPathNotFoundError } from '@/core/errors';
import { ServiceContainer } from '@/core/ServiceContainer';
import { ProjectResource, ResourceOrigin } from '@/core/types/models';
import { IServiceLifecycle, ServiceStatus } from '@/core/types/services';
import { ResourceTypeProviderRegistry } from '@/services/resources/ResourceTypeProviderRegistry';

/**
 * Parameters for scanning resource directory
 */
interface ResourceDirectoryParams {
    dirPath: string;
    resourceType: string;
    category: string;
    relativePath: string;
    projectPath: string;
    displayName?: string;
    singleton?: boolean;
}

/**
 * Project metadata from project.json
 */
export interface ProjectMetadata {
    readonly name?: string;
    readonly title?: string;
    readonly description?: string;
    readonly parent?: string;
    readonly enabled?: boolean;
    readonly inheritable?: boolean;
}

/**
 * Project scan result with metadata and inheritance
 */
export interface ProjectScanResult {
    readonly projectPath: string;
    readonly projectName: string;
    readonly metadata: ProjectMetadata;
    readonly resources: readonly ProjectResource[];
    readonly inheritanceChain: readonly string[];
    readonly inheritedResources: readonly ProjectResource[];
    readonly scanTime: number;
    readonly resourceCount: number;
    readonly warnings: readonly string[];
    readonly lastScanned: string;
}

/**
 * Project cache entry
 */
interface ProjectCacheEntry {
    readonly result: ProjectScanResult;
    readonly lastModified: number;
    readonly expiresAt: number;
}

/**
 * Enhanced project scanner service with caching and performance optimizations
 */
export class ProjectScannerService implements IServiceLifecycle {
    private static readonly CACHE_EXPIRATION_MS = 300000; // 5 minutes
    private static readonly PROJECT_INDICATORS = ['project.json', '.project', 'resource.json'];

    private projectCache = new Map<string, ProjectCacheEntry>();
    private fileWatchers = new Map<string, vscode.FileSystemWatcher>();
    private isInitialized = false;
    private scanInProgress = new Set<string>();
    private scanPromises = new Map<string, Promise<ProjectScanResult>>();

    // Cache hit rate tracking
    private cacheHits = 0;
    private cacheMisses = 0;

    private readonly scanCompleteEmitter = new vscode.EventEmitter<ProjectScanResult>();
    public readonly onScanComplete = this.scanCompleteEmitter.event;

    constructor(private readonly serviceContainer: ServiceContainer) {}

    initialize(): Promise<void> {
        this.isInitialized = true;
        // Service initialized
        return Promise.resolve();
    }

    start(): Promise<void> {
        if (!this.isInitialized) {
            throw new FlintError(
                'ProjectScannerService must be initialized before starting',
                'SERVICE_NOT_INITIALIZED'
            );
        }
        // Service started
        return Promise.resolve();
    }

    stop(): Promise<void> {
        // Stop all file watchers
        for (const watcher of this.fileWatchers.values()) {
            watcher.dispose();
        }
        this.fileWatchers.clear();

        // Clear cache
        this.projectCache.clear();
        this.scanInProgress.clear();

        // Service stopped
        return Promise.resolve();
    }

    async dispose(): Promise<void> {
        await this.stop();
        this.scanCompleteEmitter.dispose();
        this.isInitialized = false;
        // Service disposed
    }

    getStatus(): ServiceStatus {
        return this.isInitialized ? ServiceStatus.RUNNING : ServiceStatus.STOPPED;
    }

    /**
     * Scans a project directory for resources
     */
    async scanProject(projectPath: string, useCache = true): Promise<ProjectScanResult> {
        // If a scan is already in progress, wait for it to complete instead of throwing an error
        if (this.scanInProgress.has(projectPath)) {
            const existingPromise = this.scanPromises.get(projectPath);
            if (existingPromise) {
                return existingPromise;
            }
        }

        // Check cache first
        if (useCache) {
            const cachedResult = this.getCachedResult(projectPath);
            if (cachedResult) {
                return cachedResult;
            }
        }

        // Create the scan promise
        const scanPromise = this.executeScan(projectPath);
        this.scanPromises.set(projectPath, scanPromise);
        this.scanInProgress.add(projectPath);

        try {
            const result = await scanPromise;
            return result;
        } finally {
            this.scanInProgress.delete(projectPath);
            this.scanPromises.delete(projectPath);
        }
    }

    /**
     * Executes the actual scan operation
     */
    private async executeScan(projectPath: string): Promise<ProjectScanResult> {
        const scanStartTime = Date.now();

        // Verify project path exists
        await this.verifyProjectPath(projectPath);

        // Get project name
        const metadata = await this.getProjectMetadata(projectPath);
        const projectName = metadata.title || metadata.name || path.basename(projectPath);

        // Scan for resources
        const resources = await this.scanProjectResources(projectPath);

        const scanTime = Date.now() - scanStartTime;
        const warnings = await this.validateProjectStructure(projectPath, resources);

        const result: ProjectScanResult = {
            projectPath,
            projectName,
            metadata,
            resources,
            inheritanceChain: [], // Will be populated below
            inheritedResources: [], // Will be populated below
            scanTime,
            resourceCount: resources.length,
            warnings,
            lastScanned: new Date().toISOString()
        };

        // Build inheritance chain for this single project BEFORE caching
        await this.buildInheritanceChainForProject(result, [projectPath]);

        // NOW cache the result with the inheritance chain populated
        this.cacheResult(projectPath, result);

        // Set up file watcher for this project
        await this.setupProjectWatcher(projectPath);

        // Emit scan complete event
        this.scanCompleteEmitter.fire(result);

        return result;
    }

    /**
     * Scans multiple project directories
     */
    async scanProjects(projectPaths: string[], useCache = true): Promise<ProjectScanResult[]> {
        const results: ProjectScanResult[] = [];
        const errors: string[] = [];

        // Scan projects in parallel with controlled concurrency
        const concurrency = 3;
        for (let i = 0; i < projectPaths.length; i += concurrency) {
            const batch = projectPaths.slice(i, i + concurrency);

            const batchPromises = batch.map(async projectPath => {
                try {
                    return await this.scanProject(projectPath, useCache);
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    errors.push(`Failed to scan ${projectPath}: ${errorMessage}`);
                    console.error(`Project scan failed for ${projectPath}:`, error);
                    return null;
                }
            });

            const batchResults = await Promise.all(batchPromises);

            for (const result of batchResults) {
                if (result) {
                    results.push(result);
                }
            }
        }

        if (errors.length > 0) {
            console.warn(`Project scanning completed with ${errors.length} errors:`, errors);
        }

        // Build inheritance chains and resolve inherited resources
        await this.buildInheritanceChains(results, projectPaths);

        // Filter out invalid projects (those that don't have project.json)
        const validResults = results.filter(result => {
            // Check if this project has proper metadata (indicating it's a real project)
            const hasValidMetadata =
                result.metadata &&
                (result.metadata.title || result.metadata.name || result.metadata.parent !== undefined);

            if (!hasValidMetadata) {
                return false;
            }

            return true;
        });

        return validResults;
    }

    /**
     * Invalidates cache for a specific project
     */
    invalidateCache(projectPath: string): void {
        this.projectCache.delete(projectPath);
        // Cache invalidated
    }

    /**
     * Clears all cached scan results
     */
    clearCache(): void {
        this.projectCache.clear();
        // Cache cleared
    }

    /**
     * Gets cache statistics
     */
    getCacheStats(): {
        entries: number;
        totalSize: number;
        hitRate: number;
        cacheHits: number;
        cacheMisses: number;
        oldestEntry?: string;
        newestEntry?: string;
    } {
        const entries = this.projectCache.size;
        let totalSize = 0;
        let oldestTime = Infinity;
        let newestTime = 0;
        let oldestEntry: string | undefined;
        let newestEntry: string | undefined;

        for (const [path, entry] of this.projectCache.entries()) {
            totalSize += JSON.stringify(entry.result).length;

            if (entry.lastModified < oldestTime) {
                oldestTime = entry.lastModified;
                oldestEntry = path;
            }

            if (entry.lastModified > newestTime) {
                newestTime = entry.lastModified;
                newestEntry = path;
            }
        }

        // Calculate hit rate as percentage
        const totalRequests = this.cacheHits + this.cacheMisses;
        const hitRate = totalRequests > 0 ? (this.cacheHits / totalRequests) * 100 : 0;

        return {
            entries,
            totalSize,
            hitRate: Math.round(hitRate * 100) / 100, // Round to 2 decimal places
            cacheHits: this.cacheHits,
            cacheMisses: this.cacheMisses,
            oldestEntry,
            newestEntry
        };
    }

    /**
     * Checks if a path appears to be an Ignition project
     */
    async isIgnitionProject(projectPath: string): Promise<boolean> {
        try {
            // First, check for project.json - this is the definitive indicator
            const projectJsonPath = path.join(projectPath, 'project.json');
            try {
                await fs.access(projectJsonPath);
                return true;
            } catch {
                // No project.json found - do NOT fallback to resource folder detection
                // This prevents parent directories from being treated as projects
                console.warn(`❌ No project.json found, not a project: ${projectPath}`);
                return false;
            }
        } catch {
            return false;
        }
    }

    /**
     * Gets cached scan result if valid
     */
    private getCachedResult(projectPath: string): ProjectScanResult | null {
        const entry = this.projectCache.get(projectPath);

        if (!entry) {
            this.cacheMisses++;
            return null;
        }

        // Check if cache entry is expired
        if (Date.now() > entry.expiresAt) {
            this.projectCache.delete(projectPath);
            this.cacheMisses++;
            return null;
        }

        // Cache hit!
        this.cacheHits++;
        return entry.result;
    }

    /**
     * Caches a scan result
     */
    private cacheResult(projectPath: string, result: ProjectScanResult): void {
        const entry: ProjectCacheEntry = {
            result,
            lastModified: Date.now(),
            expiresAt: Date.now() + ProjectScannerService.CACHE_EXPIRATION_MS
        };

        this.projectCache.set(projectPath, entry);
    }

    /**
     * Builds inheritance chains and resolves inherited resources for all projects
     */
    private async buildInheritanceChains(results: ProjectScanResult[], projectPaths: string[]): Promise<void> {
        // Create a lookup map for quick project access by directory name and project name
        const projectMap = new Map<string, ProjectScanResult>();
        for (const result of results) {
            // Use directory name (basename) as key for parent matching, not project title
            const directoryName = path.basename(result.projectPath);
            projectMap.set(directoryName, result);
            // Also add by project name for backward compatibility
            projectMap.set(result.projectName, result);
        }

        // Discover and scan missing parent projects
        const allParentProjects = new Set<string>();
        for (const result of results) {
            await this.collectParentProjects(result.metadata, allParentProjects, projectPaths);
        }

        // Scan missing parent projects
        const missingParents: string[] = [];
        for (const parentName of allParentProjects) {
            if (!projectMap.has(parentName)) {
                missingParents.push(parentName);
            }
        }

        if (missingParents.length > 0) {
            // Try to find parent projects by searching in project paths
            const parentProjectPaths = await this.discoverParentProjectPaths(missingParents, projectPaths);

            if (parentProjectPaths.length > 0) {
                // Parent projects discovered

                // Scan parent projects
                const parentResults = await this.scanProjects(parentProjectPaths, true);

                // Add parent results to project map
                for (const parentResult of parentResults) {
                    // Use directory name as key for parent matching
                    const directoryName = path.basename(parentResult.projectPath);
                    projectMap.set(directoryName, parentResult);
                    projectMap.set(parentResult.projectName, parentResult);
                    results.push(parentResult); // Add to main results
                }
            }
        }

        // Build inheritance chains for each project
        for (const result of results) {
            const inheritanceChain = this.resolveInheritanceChain(result.projectName, result.metadata, projectMap);
            const inheritedResources = await this.resolveInheritedResources(inheritanceChain, projectMap);

            // Update the result with inheritance information
            (result as any).inheritanceChain = inheritanceChain;
            (result as any).inheritedResources = inheritedResources;

            // Project inheritance chain built
        }
    }

    /**
     * Builds inheritance chain for a single project
     */
    private async buildInheritanceChainForProject(result: ProjectScanResult, projectPaths: string[]): Promise<void> {
        // Check if this project has a parent
        if (!result.metadata.parent) {
            return;
        }

        // Get all cached results to find existing parent projects
        const allCachedResults = this.getAllCachedResults();
        const projectMap = new Map<string, ProjectScanResult>();
        for (const cachedResult of allCachedResults) {
            // Use directory name (basename) as key for parent matching, not project title
            const directoryName = path.basename(cachedResult.projectPath);
            projectMap.set(directoryName, cachedResult);
            // Also add by project name for backward compatibility
            projectMap.set(cachedResult.projectName, cachedResult);
        }

        // Discover missing parent projects
        const allParentProjects = new Set<string>();
        await this.collectParentProjects(result.metadata, allParentProjects, projectPaths);
        // Parent projects collected

        // Scan missing parent projects
        const missingParents: string[] = [];
        for (const parentName of allParentProjects) {
            if (!projectMap.has(parentName)) {
                missingParents.push(parentName);
            }
        }

        if (missingParents.length > 0) {
            // Try to find parent projects by searching in sibling directories
            const parentProjectPaths = await this.discoverParentProjectPaths(missingParents, projectPaths);

            if (parentProjectPaths.length > 0) {
                // Parent projects discovered

                // Scan parent projects individually
                for (const parentPath of parentProjectPaths) {
                    try {
                        const parentResult = await this.scanProject(parentPath, true);
                        // Use directory name as key for parent matching
                        const directoryName = path.basename(parentResult.projectPath);
                        projectMap.set(directoryName, parentResult);
                        projectMap.set(parentResult.projectName, parentResult);
                    } catch (error) {
                        console.error(`Failed to scan parent project at ${parentPath}:`, error);
                    }
                }
            }
        }

        // Build inheritance chain for this project
        const inheritanceChain = this.resolveInheritanceChain(result.projectName, result.metadata, projectMap);
        const inheritedResources = await this.resolveInheritedResources(inheritanceChain, projectMap);

        // Update the result with inheritance information
        (result as any).inheritanceChain = inheritanceChain;
        (result as any).inheritedResources = inheritedResources;
    }

    /**
     * Resolves the inheritance chain for a project
     */
    private resolveInheritanceChain(
        projectName: string,
        metadata: ProjectMetadata,
        projectMap: Map<string, ProjectScanResult>,
        visited = new Set<string>()
    ): string[] {
        // Prevent circular inheritance
        if (visited.has(projectName)) {
            console.warn(`Circular inheritance detected: ${Array.from(visited).join(' -> ')} -> ${projectName}`);
            return [];
        }

        visited.add(projectName);

        if (!metadata.parent) {
            return [];
        }

        const parentProject = projectMap.get(metadata.parent);
        if (!parentProject) {
            console.warn(`Parent project '${metadata.parent}' not found for project '${projectName}'`);
            return [];
        }

        // Recursively build the chain
        const parentChain = this.resolveInheritanceChain(
            parentProject.projectName,
            parentProject.metadata,
            projectMap,
            new Set(visited)
        );

        return [metadata.parent, ...parentChain];
    }

    /**
     * Resolves inherited resources from the inheritance chain
     */
    private resolveInheritedResources(
        inheritanceChain: string[],
        projectMap: Map<string, ProjectScanResult>
    ): Promise<ProjectResource[]> {
        const inheritedResources: ProjectResource[] = [];

        for (const parentProjectName of inheritanceChain) {
            const parentProject = projectMap.get(parentProjectName);
            if (parentProject) {
                // Mark resources as inherited and include source project
                const parentResources = parentProject.resources.map(resource => ({
                    ...resource,
                    origin: ResourceOrigin.INHERITED,
                    sourceProject: parentProjectName
                }));

                inheritedResources.push(...parentResources);
            }
        }

        return Promise.resolve(inheritedResources);
    }

    /**
     * Collects all parent project names from project metadata recursively
     */
    private async collectParentProjects(
        metadata: ProjectMetadata,
        parentProjects: Set<string>,
        projectPaths: string[]
    ): Promise<void> {
        if (!metadata.parent || metadata.parent.trim() === '' || parentProjects.has(metadata.parent)) {
            return; // No parent or already collected
        }

        parentProjects.add(metadata.parent);

        // Try to find the parent project to get its metadata for recursive collection
        try {
            // First check if we already have this parent cached
            const allCachedResults = this.getAllCachedResults();
            let parentProject = allCachedResults.find(result => path.basename(result.projectPath) === metadata.parent);

            // If not cached, try to discover and scan it
            if (!parentProject) {
                const parentProjectPaths = await this.discoverParentProjectPaths([metadata.parent], projectPaths);
                if (parentProjectPaths.length > 0) {
                    const parentResult = await this.scanProject(parentProjectPaths[0], true);
                    parentProject = parentResult;
                }
            }

            // If we found the parent project, recursively collect its parents
            if (parentProject) {
                await this.collectParentProjects(parentProject.metadata, parentProjects, projectPaths);
            }
        } catch (error) {
            console.warn(`Failed to recursively collect parent projects for ${metadata.parent}:`, error);
        }
    }

    /**
     * Discovers parent project paths by searching in sibling project directories
     */
    private async discoverParentProjectPaths(missingParents: string[], projectPaths: string[]): Promise<string[]> {
        const discoveredPaths: string[] = [];

        // Search in sibling directories of existing project paths
        const searchDirs = new Set<string>();
        for (const projectPath of projectPaths) {
            const parentDir = path.dirname(projectPath);
            searchDirs.add(parentDir);

            // Also search in parent directories in case projects are nested differently
            const grandParentDir = path.dirname(parentDir);
            searchDirs.add(grandParentDir);
        }

        for (const parentName of missingParents) {
            for (const searchDir of searchDirs) {
                // Try direct match first (sibling directory)
                const candidatePath = path.join(searchDir, parentName);

                try {
                    // Check if this is a valid Ignition project
                    const isProject = await this.isIgnitionProject(candidatePath);
                    if (isProject) {
                        // Verify the project name matches by checking project.json
                        const metadata = await this.getProjectMetadata(candidatePath);

                        // Match by title first (preferred), then by directory name
                        if (metadata.title === parentName || path.basename(candidatePath) === parentName) {
                            discoveredPaths.push(candidatePath);
                            break; // Found it, don't search more paths for this parent
                        }
                    }
                } catch (error) {
                    // Continue searching
                    console.error(
                        `Failed to check ${candidatePath}:`,
                        error instanceof Error ? error.message : String(error)
                    );
                }

                // Also try scanning the directory for subdirectories that might contain the parent project
                try {
                    const entries = await fs.readdir(searchDir, { withFileTypes: true });
                    for (const entry of entries) {
                        if (entry.isDirectory()) {
                            const subCandidatePath = path.join(searchDir, entry.name);

                            const isProject = await this.isIgnitionProject(subCandidatePath);
                            if (isProject) {
                                const metadata = await this.getProjectMetadata(subCandidatePath);

                                // Match by title first (preferred), then by directory name
                                if (metadata.title === parentName || entry.name === parentName) {
                                    discoveredPaths.push(subCandidatePath);
                                    break;
                                }
                            }
                        }
                    }
                } catch {
                    // Continue searching
                }
            }

            if (!discoveredPaths.some(path => path.includes(parentName))) {
                console.warn(`❌ Could not find parent project: ${parentName}`);
            }
        }

        return discoveredPaths;
    }

    /**
     * Verifies that a project path exists and is accessible
     */
    private async verifyProjectPath(projectPath: string): Promise<void> {
        try {
            const stats = await fs.stat(projectPath);
            if (!stats.isDirectory()) {
                throw new ProjectPathNotFoundError(projectPath, 'Path exists but is not a directory');
            }
        } catch (error) {
            if (error instanceof ProjectPathNotFoundError) {
                throw error;
            }
            throw new ProjectPathNotFoundError(projectPath, 'Path is not accessible');
        }
    }

    /**
     * Gets the complete project metadata from project.json
     */
    private async getProjectMetadata(projectPath: string): Promise<ProjectMetadata> {
        const projectJsonPath = path.join(projectPath, 'project.json');
        try {
            const content = await fs.readFile(projectJsonPath, 'utf8');
            const projectJson = JSON.parse(content);

            return {
                name: typeof projectJson.name === 'string' ? projectJson.name : undefined,
                title: typeof projectJson.title === 'string' ? projectJson.title : undefined,
                description: typeof projectJson.description === 'string' ? projectJson.description : undefined,
                parent: typeof projectJson.parent === 'string' ? projectJson.parent : undefined,
                enabled: typeof projectJson.enabled === 'boolean' ? projectJson.enabled : true,
                inheritable: typeof projectJson.inheritable === 'boolean' ? projectJson.inheritable : true
            };
        } catch {
            // Return empty metadata if project.json doesn't exist or is invalid
            return {
                enabled: true,
                inheritable: true
            };
        }
    }

    /**
     * Scans project directory for resources using ResourceTypeProviderRegistry
     */
    private async scanProjectResources(projectPath: string): Promise<ProjectResource[]> {
        const resources: ProjectResource[] = [];

        try {
            // Get resource directories from ResourceTypeProviderRegistry
            const resourceDirs = await this.getResourceDirectoriesFromProviders(projectPath);

            // Scanning resource directories

            for (const resourceDirConfig of resourceDirs) {
                const fullPath = path.join(projectPath, resourceDirConfig.dir);

                try {
                    const exists = await fs
                        .access(fullPath)
                        .then(() => true)
                        .catch(() => false);
                    if (exists) {
                        // Found resource directory
                        const dirResources = await this.scanResourceDirectory({
                            dirPath: fullPath,
                            resourceType: resourceDirConfig.type,
                            category: resourceDirConfig.category || 'root', // Use 'root' for null categories
                            relativePath: resourceDirConfig.dir,
                            projectPath,
                            displayName: resourceDirConfig.displayName,
                            singleton: resourceDirConfig.singleton
                        });
                        resources.push(...dirResources);
                    }
                } catch (error) {
                    console.warn(`ProjectScannerService: Error scanning ${resourceDirConfig.dir}:`, error);
                }
            }

            // Resource scan completed
        } catch (error) {
            console.warn(`Failed to scan resources in ${projectPath}:`, error);
        }

        return resources;
    }

    /**
     * Gets resource directory mappings from ResourceTypeProviderRegistry
     */
    private getResourceDirectoriesFromProviders(_projectPath: string): Promise<
        Array<{
            dir: string;
            type: string;
            category: string | null;
            displayName: string;
            singleton: boolean;
        }>
    > {
        const providerRegistry =
            this.serviceContainer.get<ResourceTypeProviderRegistry>('ResourceTypeProviderRegistry');

        if (!providerRegistry) {
            throw new FlintError(
                'ResourceTypeProviderRegistry is unavailable',
                'RESOURCE_PROVIDER_REGISTRY_UNAVAILABLE',
                'Cannot scan project resources without provider registry'
            );
        }

        const allProviders = providerRegistry.getAllProviders();
        const resourceDirs: Array<{
            dir: string;
            type: string;
            category: string | null;
            displayName: string;
            singleton: boolean;
        }> = [];

        for (const provider of allProviders) {
            const searchConfig = provider.getSearchConfig();

            // Get directory paths directly from provider's search configuration
            if (searchConfig.directoryPaths && searchConfig.directoryPaths.length > 0) {
                for (const dirPath of searchConfig.directoryPaths) {
                    resourceDirs.push({
                        dir: dirPath,
                        type: provider.resourceTypeId,
                        category: searchConfig.category || null, // Use provider's category if defined
                        displayName: provider.displayName,
                        singleton: searchConfig.isSingleton || false
                    });
                }
            } else {
                throw new FlintError(
                    `Provider ${provider.resourceTypeId} does not define directory paths in search configuration`,
                    'PROVIDER_MISSING_DIRECTORY_PATHS'
                );
            }
        }

        // Resource directories loaded
        return Promise.resolve(resourceDirs);
    }

    /**
     * Gets common Ignition folder names from ResourceTypeProviderRegistry
     */
    private getCommonIgnitionFolders(): Promise<string[]> {
        const providerRegistry =
            this.serviceContainer.get<ResourceTypeProviderRegistry>('ResourceTypeProviderRegistry');

        if (!providerRegistry) {
            console.warn(
                'ProjectScannerService: ResourceTypeProviderRegistry unavailable, cannot determine common folders'
            );
            return Promise.resolve([]);
        }

        const allProviders = providerRegistry.getAllProviders();
        const folders = new Set<string>();

        // Extract top-level folder names from provider directory paths
        for (const provider of allProviders) {
            const searchConfig = provider.getSearchConfig();
            if (searchConfig.directoryPaths) {
                for (const dirPath of searchConfig.directoryPaths) {
                    const topLevelFolder = dirPath.split('/')[0];
                    folders.add(topLevelFolder);
                }
            }
        }

        return Promise.resolve(Array.from(folders));
    }

    /**
     * Scans a specific resource directory recursively
     */
    private async scanResourceDirectory(params: ResourceDirectoryParams): Promise<ProjectResource[]> {
        const { dirPath, resourceType, category, relativePath, projectPath, displayName, singleton } = params;
        const resources: ProjectResource[] = [];

        try {
            // For singleton resources, check if the directory itself is the resource
            if (singleton) {
                const resourceJsonPath = path.join(dirPath, 'resource.json');
                try {
                    await fs.access(resourceJsonPath);
                    // The directory itself is a singleton resource
                    const stat = await fs.stat(dirPath);
                    const resource: ProjectResource = {
                        type: resourceType,
                        path: relativePath,
                        origin: ResourceOrigin.LOCAL,
                        sourceProject: path.basename(projectPath),
                        files: await this.scanDirectoryFiles(dirPath),
                        metadata: {
                            isFolder: false,
                            key: `${resourceType}:${relativePath}`,
                            name: path.basename(relativePath),
                            category,
                            projectPath,
                            lastModified: stat.mtime.getTime(),
                            size: 0,
                            displayName,
                            singleton
                        }
                    };
                    resources.push(resource);
                    return resources; // Early return for singletons
                } catch {
                    // No resource.json in singleton directory, check for any files
                    try {
                        const entries = await fs.readdir(dirPath);
                        if (entries.length > 0) {
                            // Directory has files, treat as singleton resource even without resource.json
                            const stat = await fs.stat(dirPath);
                            const resource: ProjectResource = {
                                type: resourceType,
                                path: relativePath,
                                origin: ResourceOrigin.LOCAL,
                                sourceProject: path.basename(projectPath),
                                files: await this.scanDirectoryFiles(dirPath),
                                metadata: {
                                    isFolder: false,
                                    key: `${resourceType}:${relativePath}`,
                                    name: path.basename(relativePath),
                                    category,
                                    projectPath,
                                    lastModified: stat.mtime.getTime(),
                                    size: 0,
                                    displayName,
                                    singleton
                                }
                            };
                            resources.push(resource);
                        }
                    } catch {
                        // Directory doesn't exist or can't be read
                    }
                }
                return resources;
            }

            // For non-singleton resources, scan for subdirectories with resource.json and empty folders
            const scanResourceDir = async (currentPath: string, currentRelativePath: string): Promise<void> => {
                const entries = await fs.readdir(currentPath, { withFileTypes: true });

                for (const entry of entries) {
                    const entryPath = path.join(currentPath, entry.name);
                    const entryRelativePath = path.join(currentRelativePath, entry.name);

                    if (entry.isDirectory()) {
                        // Check if this directory contains a resource.json (indicates a resource)
                        const resourceJsonPath = path.join(entryPath, 'resource.json');
                        try {
                            await fs.access(resourceJsonPath);
                            // This is a resource directory
                            const stat = await fs.stat(entryPath);
                            const resource: ProjectResource = {
                                type: resourceType,
                                path: entryRelativePath,
                                origin: ResourceOrigin.LOCAL,
                                sourceProject: path.basename(projectPath),
                                files: [], // Resource directories contain multiple files
                                metadata: {
                                    isFolder: false, // It's a resource, not just a folder
                                    key: `${resourceType}:${entryRelativePath}`,
                                    name: entry.name,
                                    category,
                                    projectPath,
                                    lastModified: stat.mtime.getTime(),
                                    size: 0, // Directory size not meaningful
                                    displayName,
                                    singleton
                                }
                            } as ProjectResource;
                            resources.push(resource);
                            // Resource found - logged at summary level
                        } catch {
                            // No resource.json found, check if directory is empty or contains only subdirectories
                            try {
                                const subdirEntries = await fs.readdir(entryPath, { withFileTypes: true });
                                const hasFiles = subdirEntries.some(subentry => !subentry.isDirectory());

                                // If directory is empty or only contains subdirectories (no files), treat as folder
                                if (!hasFiles) {
                                    const stat = await fs.stat(entryPath);
                                    const folderResource: ProjectResource = {
                                        type: resourceType,
                                        path: entryRelativePath,
                                        origin: ResourceOrigin.LOCAL,
                                        sourceProject: path.basename(projectPath),
                                        files: [], // Empty folders have no files
                                        metadata: {
                                            isFolder: true, // This is a folder for organization
                                            key: `${resourceType}:${entryRelativePath}`,
                                            name: entry.name,
                                            category,
                                            projectPath,
                                            lastModified: stat.mtime.getTime(),
                                            size: 0,
                                            displayName,
                                            singleton
                                        }
                                    };
                                    resources.push(folderResource);
                                }
                            } catch (folderError) {
                                console.warn(`Failed to check folder ${entryPath}:`, folderError);
                            }
                        }

                        // ALWAYS continue scanning subdirectories regardless of whether resource.json was found
                        // This ensures we find nested resources and folders
                        await scanResourceDir(entryPath, entryRelativePath);
                    }
                }
            };

            await scanResourceDir(dirPath, relativePath);
        } catch (error) {
            console.warn(`Failed to scan resource directory ${dirPath}:`, error);
        }

        return resources;
    }

    /**
     * Validates project structure and returns warnings
     */
    private async validateProjectStructure(projectPath: string, resources: ProjectResource[]): Promise<string[]> {
        const warnings: string[] = [];

        // Check for common issues
        if (resources.length === 0) {
            warnings.push('No resources found in project directory');
        }

        // Check for project.json
        const projectJsonPath = path.join(projectPath, 'project.json');
        try {
            await fs.access(projectJsonPath);
        } catch {
            warnings.push('No project.json file found');
        }

        return warnings;
    }

    /**
     * Sets up file system watcher for a project
     */
    private setupProjectWatcher(projectPath: string): Promise<void> {
        // Dispose existing watcher if any
        const existingWatcher = this.fileWatchers.get(projectPath);
        if (existingWatcher) {
            existingWatcher.dispose();
        }

        try {
            const pattern = new vscode.RelativePattern(projectPath, '**/*');
            const watcher = vscode.workspace.createFileSystemWatcher(pattern);

            // Set up event handlers with debouncing
            let debounceTimer: NodeJS.Timeout | null = null;
            const debouncedInvalidate = (): void => {
                if (debounceTimer) {
                    clearTimeout(debounceTimer);
                }
                debounceTimer = setTimeout(() => {
                    this.invalidateCache(projectPath);
                }, 1000); // 1 second debounce
            };

            watcher.onDidCreate(debouncedInvalidate);
            watcher.onDidChange(debouncedInvalidate);
            watcher.onDidDelete(debouncedInvalidate);

            this.fileWatchers.set(projectPath, watcher);
        } catch (error) {
            console.warn(`Failed to set up file watcher for ${projectPath}:`, error);
        }
        return Promise.resolve();
    }

    /**
     * Gets all cached scan results
     */
    getAllCachedResults(): ProjectScanResult[] {
        return Array.from(this.projectCache.values()).map(entry => entry.result);
    }

    /**
     * Gets a project by name or project ID (directory name) from cached results
     */
    getProject(projectNameOrId: string): ProjectScanResult | undefined {
        const results = this.getAllCachedResults();
        return results.find(
            result => result.projectName === projectNameOrId || path.basename(result.projectPath) === projectNameOrId
        );
    }

    /**
     * Scans a specific resource path within a project for new resources
     */
    async scanResourcePath(projectId: string, resourcePath: string): Promise<void> {
        try {
            // Find the project in cached results
            const cachedResults = this.getAllCachedResults();
            const project = cachedResults.find(result => result.projectName === projectId);

            if (!project) {
                return;
            }

            // Invalidate the cache for this project to force a fresh scan
            this.invalidateCache(project.projectPath);

            // Trigger a rescan of this project
            await this.scanProject(project.projectPath, false);
        } catch (error) {
            console.error(`Failed to scan resource path '${resourcePath}' in project '${projectId}':`, error);
        }
    }

    /**
     * Scans a directory and returns all files within it
     */
    private async scanDirectoryFiles(dirPath: string): Promise<Array<{ name: string; path: string; size: number }>> {
        const files: Array<{ name: string; path: string; size: number }> = [];

        try {
            const entries = await fs.readdir(dirPath, { withFileTypes: true });

            for (const entry of entries) {
                if (entry.isFile()) {
                    const filePath = path.join(dirPath, entry.name);
                    try {
                        const stat = await fs.stat(filePath);
                        files.push({
                            name: entry.name,
                            path: filePath,
                            size: stat.size
                        });
                    } catch {
                        // Skip files that can't be accessed
                    }
                }
            }
        } catch {
            // Directory doesn't exist or can't be read - return empty files array
        }

        return files;
    }
}
