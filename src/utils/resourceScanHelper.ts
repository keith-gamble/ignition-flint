import * as fs from 'fs/promises';
import * as path from 'path';
import { promisify } from 'util';

import { glob as globCallback } from 'glob';

import { ResourceTypeDefinition, ResourcePattern, ResourceCategory } from '@/core/types/resources';

/**
 * Resource scan result type
 */
type ResourceScanResult = Array<{
    path: string;
    files: Array<{ name: string; path: string }>;
    metadata?: unknown;
}>;

const glob = promisify(globCallback);

/**
 * Centralized helper for resource scanning operations
 * Consolidates logic from ProjectScanner and DefaultResourceProvider
 */
export class ResourceScanHelper {
    // ============================================================================
    // PATTERN SCANNING
    // ============================================================================

    /**
     * Scans files matching a specific pattern
     */
    static async scanPattern(
        projectPath: string,
        pattern: ResourcePattern,
        categoryPrefix?: string
    ): Promise<Array<{ path: string; files: Array<{ name: string; path: string }> }>> {
        const resources: Array<{ path: string; files: Array<{ name: string; path: string }> }> = [];

        try {
            const matchedFiles = await glob(pattern.pattern, {
                cwd: projectPath,
                absolute: true,
                ignore: ['**/node_modules/**', '**/.*/**']
            });

            // Group files by their resource directory
            const resourceDirMap = new Map<string, Array<{ name: string; path: string }>>();

            for (const filePath of matchedFiles) {
                const fileName = path.basename(filePath);
                const relativePath = path.relative(projectPath, filePath);

                let resourcePath = this.getResourcePath(relativePath, pattern, categoryPrefix);
                if (categoryPrefix !== undefined && categoryPrefix.length > 0) {
                    resourcePath = `${categoryPrefix}/${resourcePath}`;
                }

                // Group files by resource directory
                if (!resourceDirMap.has(resourcePath)) {
                    resourceDirMap.set(resourcePath, []);
                }

                resourceDirMap.get(resourcePath)!.push({
                    name: fileName,
                    path: filePath
                });
            }

            // Now scan for resource.json files in each resource directory
            for (const [resourcePath, files] of resourceDirMap) {
                const resourceDir = files.length > 0 ? path.dirname(files[0].path) : '';

                if (resourceDir) {
                    const resourceJsonPath = path.join(resourceDir, 'resource.json');
                    try {
                        await fs.access(resourceJsonPath);
                        // resource.json exists, add it to the files
                        files.push({
                            name: 'resource.json',
                            path: resourceJsonPath
                        });
                    } catch {
                        // resource.json doesn't exist, that's OK
                    }
                }

                resources.push({
                    path: resourcePath,
                    files
                });
            }
        } catch (error) {
            console.warn(`Failed to scan pattern ${pattern.pattern}:`, error);
        }

        return resources;
    }

    /**
     * Scans for all resource types in a project
     */
    static async scanAllResourceTypes(
        projectPath: string,
        resourceTypes: ResourceTypeDefinition[]
    ): Promise<Map<string, Array<{ path: string; files: Array<{ name: string; path: string }>; metadata?: unknown }>>> {
        const results = new Map<
            string,
            Array<{
                path: string;
                files: Array<{ name: string; path: string }>;
                metadata?: unknown;
            }>
        >();

        for (const resourceType of resourceTypes) {
            const typeResults = await this.scanResourceType(projectPath, resourceType);
            if (typeResults.length > 0) {
                results.set(resourceType.id, typeResults);
            }
        }

        return results;
    }

    /**
     * Scans a specific resource type
     */
    static async scanResourceType(
        projectPath: string,
        resourceType: ResourceTypeDefinition
    ): Promise<ResourceScanResult> {
        const resources: ResourceScanResult = [];

        // Scan direct patterns
        if (resourceType.patterns) {
            for (const pattern of resourceType.patterns) {
                const patternResources = await this.scanPattern(projectPath, pattern);
                resources.push(...patternResources);
            }
        }

        // Scan categories
        if (resourceType.categories) {
            for (const [categoryId, category] of Object.entries(resourceType.categories)) {
                // Scan pattern-based resources in category
                for (const pattern of category.patterns) {
                    const categoryResources = await this.scanPattern(projectPath, pattern, categoryId);
                    resources.push(...categoryResources);
                }

                // Scan empty folders in category
                const emptyFolders = await this.scanEmptyFoldersInCategory(
                    projectPath,
                    categoryId,
                    category,
                    resources
                );
                resources.push(...emptyFolders);
            }
        } else {
            // Scan empty folders for non-categorized types
            const emptyFolders = await this.scanEmptyFoldersForType(projectPath, resourceType, resources);
            resources.push(...emptyFolders);
        }

        // Now scan for orphaned resource.json files (resource.json files without primary files)
        const orphanedResourceJsons = await this.scanOrphanedResourceJsonFiles(projectPath, resourceType, resources);
        resources.push(...orphanedResourceJsons);

        return resources;
    }

    /**
     * Scans for orphaned resource.json files that don't have corresponding primary files
     */
    static async scanOrphanedResourceJsonFiles(
        projectPath: string,
        resourceType: ResourceTypeDefinition,
        existingResources: Array<{ path: string; files: Array<{ name: string; path: string }> }>
    ): Promise<ResourceScanResult> {
        const orphanedResources: ResourceScanResult = [];

        try {
            // Get base paths for this resource type
            const basePaths = this.getResourceBasePaths(resourceType);

            for (const basePath of basePaths) {
                const fullBasePath = path.join(projectPath, basePath);

                // Check if base path exists
                if (!(await this.directoryExists(fullBasePath))) {
                    continue;
                }

                // Find all resource.json files in this base path
                const resourceJsonPattern = path.join(fullBasePath, '**/resource.json').replace(/\\/g, '/');
                const resourceJsonFiles = await glob(resourceJsonPattern, {
                    cwd: projectPath,
                    absolute: true
                });

                for (const resourceJsonPath of resourceJsonFiles) {
                    const resourceDir = path.dirname(resourceJsonPath);
                    const relativePath = path.relative(path.join(projectPath, basePath), resourceDir);

                    // Check if we already have a resource for this path
                    const normalizedPath = this.normalizePath(relativePath);
                    const existingResource = existingResources.find(r => this.normalizePath(r.path) === normalizedPath);

                    if (!existingResource) {
                        // This is an orphaned resource.json - create a resource for it
                        const resourcePath = this.buildOrphanedResourcePath(resourceType, relativePath);

                        // Scan for all files in this directory
                        const dirFiles = await this.getAllFilesInDirectory(resourceDir);

                        orphanedResources.push({
                            path: resourcePath,
                            files: dirFiles,
                            metadata: {
                                isOrphanedResourceJson: true
                            }
                        });
                    }
                }
            }
        } catch (error) {
            console.warn(`Failed to scan orphaned resource.json files for ${resourceType.id}:`, error);
        }

        return orphanedResources;
    }

    /**
     * Gets all files in a directory
     */
    static async getAllFilesInDirectory(dirPath: string): Promise<Array<{ name: string; path: string }>> {
        const files: Array<{ name: string; path: string }> = [];

        try {
            const entries = await fs.readdir(dirPath, { withFileTypes: true });

            for (const entry of entries) {
                if (entry.isFile()) {
                    files.push({
                        name: entry.name,
                        path: path.join(dirPath, entry.name)
                    });
                }
            }
        } catch (error) {
            console.warn(`Failed to read directory ${dirPath}:`, error);
        }

        return files;
    }

    /**
     * Builds resource path for orphaned resource.json
     */
    private static buildOrphanedResourcePath(resourceType: ResourceTypeDefinition, relativePath: string): string {
        // For categorized types, try to determine category from path
        if (resourceType.categories) {
            for (const [categoryId] of Object.entries(resourceType.categories)) {
                if (relativePath.startsWith(`${categoryId}/`)) {
                    return relativePath;
                }
            }

            // If no category match, assume it's in the first category
            const firstCategoryId = Object.keys(resourceType.categories)[0];
            return relativePath.length > 0 ? `${firstCategoryId}/${relativePath}` : firstCategoryId;
        }

        return relativePath;
    }

    /**
     * Gets all base paths for a resource type
     */
    private static getResourceBasePaths(resourceType: ResourceTypeDefinition): string[] {
        const basePaths = new Set<string>();

        // Add paths from direct patterns
        if (resourceType.patterns) {
            for (const pattern of resourceType.patterns) {
                basePaths.add(this.extractBaseFromPattern(pattern.pattern));
            }
        }

        // Add paths from categories
        if (resourceType.categories) {
            for (const category of Object.values(resourceType.categories)) {
                for (const pattern of category.patterns) {
                    basePaths.add(this.extractBaseFromPattern(pattern.pattern));
                }
            }
        }

        return Array.from(basePaths);
    }

    /**
     * Simple path normalization helper
     */
    private static normalizePath(inputPath: string): string {
        if (!inputPath) {
            return '';
        }

        // Replace backslashes with forward slashes
        let normalized = inputPath.replace(/\\/g, '/');

        // Remove leading and trailing slashes
        normalized = normalized.replace(/^\/+|\/+$/g, '');

        // Collapse multiple slashes
        normalized = normalized.replace(/\/+/g, '/');

        return normalized;
    }

    /**
     * Gets base path for a resource type
     */
    private static getResourceTypeBasePath(resourceType: ResourceTypeDefinition): string {
        if (resourceType.patterns && resourceType.patterns.length > 0) {
            const pattern = resourceType.patterns[0].pattern;
            const basePath = pattern.includes('/**/') ? pattern.split('/**/')[0] : path.dirname(pattern);
            return this.normalizePath(basePath);
        }

        if (resourceType.categories) {
            const firstCategory = Object.values(resourceType.categories)[0];
            if (firstCategory.patterns.length > 0) {
                const pattern = firstCategory.patterns[0].pattern;
                const basePath = pattern.includes('/**/') ? pattern.split('/**/')[0] : path.dirname(pattern);
                return this.normalizePath(basePath);
            }
        }

        return '';
    }

    /**
     * Extracts base path from a glob pattern
     */
    private static extractBaseFromPattern(pattern: string): string {
        const normalized = pattern.replace(/\\/g, '/');

        if (normalized.includes('/**/')) {
            return normalized.split('/**/')[0];
        }

        return path.dirname(normalized);
    }

    // ============================================================================
    // EMPTY FOLDER SCANNING
    // ============================================================================

    /**
     * Scans for empty folders in a specific category
     */
    static async scanEmptyFoldersInCategory(
        projectPath: string,
        categoryId: string,
        category: ResourceCategory,
        existingResources: Array<{ path: string; files: Array<{ name: string; path: string }> }>
    ): Promise<ResourceScanResult> {
        const categoryBasePath = this.getCategoryBasePath(category);
        if (!categoryBasePath) {
            return [];
        }

        const fullCategoryPath = path.join(projectPath, categoryBasePath);

        try {
            const baseExists = await this.directoryExists(fullCategoryPath);
            if (!baseExists) {
                return [];
            }

            return await this.findEmptyDirectoriesInCategory(
                fullCategoryPath,
                fullCategoryPath,
                { categoryId, categoryBasePath, category },
                existingResources
            );
        } catch (error) {
            console.warn(`Failed to scan empty folders in category ${categoryId}:`, error);
            return [];
        }
    }

    /**
     * Scans for empty folders for a non-categorized resource type
     */
    static async scanEmptyFoldersForType(
        projectPath: string,
        resourceType: ResourceTypeDefinition,
        existingResources: Array<{ path: string; files: Array<{ name: string; path: string }> }>
    ): Promise<ResourceScanResult> {
        const basePath = this.getResourceTypeBasePath(resourceType);
        if (!basePath) {
            return [];
        }

        const fullBasePath = path.join(projectPath, basePath);

        try {
            const baseExists = await this.directoryExists(fullBasePath);
            if (!baseExists) {
                return [];
            }

            return await this.findEmptyDirectoriesForType(fullBasePath, fullBasePath, resourceType, existingResources);
        } catch (error) {
            console.warn(`Failed to scan empty folders for type ${resourceType.id}:`, error);
            return [];
        }
    }

    // ============================================================================
    // DIRECTORY TRAVERSAL
    // ============================================================================

    /**
     * Recursively finds empty directories in a category
     */
    private static async findEmptyDirectoriesInCategory(
        currentDir: string,
        baseDir: string,
        options: {
            categoryId: string;
            categoryBasePath: string;
            category: ResourceCategory;
        },
        existingResources: Array<{ path: string; files: Array<{ name: string; path: string }> }>
    ): Promise<ResourceScanResult> {
        const folders: ResourceScanResult = [];
        const existingFilePaths = new Set(existingResources.filter(r => r.files.length > 0).map(r => r.path));

        try {
            const entries = await fs.readdir(currentDir, { withFileTypes: true });

            // Check if this directory has resource files
            const hasResourceFiles = entries.some(entry => {
                if (!entry.isFile()) {
                    return false;
                }

                return options.category.patterns.some(pattern => entry.name === pattern.primaryFile);
            });

            // If no resource files, add as empty folder
            if (!hasResourceFiles) {
                const relativePath = path.relative(baseDir, currentDir).replace(/\\/g, '/');
                if (relativePath && relativePath !== '.') {
                    const folderPath = `${options.categoryId}/${relativePath}`;

                    if (!existingFilePaths.has(folderPath)) {
                        folders.push({
                            path: folderPath,
                            files: [],
                            metadata: {
                                isFolder: true,
                                sourceCategory: options.categoryId,
                                categoryBasePath: options.categoryBasePath
                            }
                        });
                    }
                }
            }

            // Recursively scan subdirectories
            for (const entry of entries) {
                if (entry.isDirectory()) {
                    const subDirPath = path.join(currentDir, entry.name);
                    const subFolders = await this.findEmptyDirectoriesInCategory(
                        subDirPath,
                        baseDir,
                        options,
                        existingResources
                    );
                    folders.push(...subFolders);
                }
            }
        } catch (error) {
            console.warn(`Failed to scan directory ${currentDir}:`, error);
        }

        return folders;
    }

    /**
     * Recursively finds empty directories for a resource type
     */
    private static async findEmptyDirectoriesForType(
        currentDir: string,
        baseDir: string,
        resourceType: ResourceTypeDefinition,
        existingResources: Array<{ path: string; files: Array<{ name: string; path: string }> }>
    ): Promise<ResourceScanResult> {
        const folders: ResourceScanResult = [];
        const existingFilePaths = new Set(existingResources.filter(r => r.files.length > 0).map(r => r.path));

        try {
            const entries = await fs.readdir(currentDir, { withFileTypes: true });

            // Check if this directory has resource files
            const hasResourceFiles = entries.some(entry => {
                if (!entry.isFile()) {
                    return false;
                }

                return resourceType.patterns?.some(pattern => entry.name === pattern.primaryFile) ?? false;
            });

            // If no resource files, add as empty folder
            if (!hasResourceFiles) {
                const relativePath = path.relative(baseDir, currentDir).replace(/\\/g, '/');
                if (relativePath && relativePath !== '.') {
                    if (!existingFilePaths.has(relativePath)) {
                        folders.push({
                            path: relativePath,
                            files: [],
                            metadata: {
                                isFolder: true
                            }
                        });
                    }
                }
            }

            // Recursively scan subdirectories
            for (const entry of entries) {
                if (entry.isDirectory()) {
                    const subDirPath = path.join(currentDir, entry.name);
                    const subFolders = await this.findEmptyDirectoriesForType(
                        subDirPath,
                        baseDir,
                        resourceType,
                        existingResources
                    );
                    folders.push(...subFolders);
                }
            }
        } catch (error) {
            console.warn(`Failed to scan directory ${currentDir}:`, error);
        }

        return folders;
    }

    // ============================================================================
    // PATH OPERATIONS
    // ============================================================================

    /**
     * Extracts resource path from file pattern match
     */
    private static getResourcePath(relativePath: string, pattern: ResourcePattern, categoryPrefix?: string): string {
        relativePath = relativePath.replace(/\\/g, '/');
        let resourcePath = path.dirname(relativePath).replace(/\\/g, '/');

        // Extract base from pattern
        const patternStr = pattern.pattern.replace(/\\/g, '/');
        const prefix = patternStr.includes('/**/') ? patternStr.split('/**/')[0] : `${path.dirname(patternStr)}/`;

        // Remove pattern prefix from resource path
        if (prefix && resourcePath.startsWith(prefix)) {
            resourcePath = resourcePath.substring(prefix.length);
        }

        // Remove category prefix if it was already included
        if (
            categoryPrefix !== undefined &&
            categoryPrefix.length > 0 &&
            resourcePath.startsWith(`${categoryPrefix}/`)
        ) {
            resourcePath = resourcePath.substring(categoryPrefix.length + 1);
        }

        // Clean up the path
        resourcePath = resourcePath.replace(/^\/+|\/+$/g, '');

        // If empty, use filename without extension as resource name
        if (!resourcePath || resourcePath === '.' || resourcePath === '') {
            resourcePath = path.basename(relativePath, path.extname(relativePath));
        }

        return this.normalizePath(resourcePath);
    }

    /**
     * Gets the base path for a category from its patterns
     */
    private static getCategoryBasePath(category: ResourceCategory): string {
        if (category.patterns.length > 0) {
            const pattern = category.patterns[0].pattern;
            const basePath = pattern.includes('/**/') ? pattern.split('/**/')[0] : path.dirname(pattern);
            return this.normalizePath(basePath);
        }
        return '';
    }

    // ============================================================================
    // FILE SYSTEM UTILITIES
    // ============================================================================

    /**
     * Checks if a directory exists
     */
    static async directoryExists(dirPath: string): Promise<boolean> {
        try {
            const stat = await fs.stat(dirPath);
            return stat.isDirectory();
        } catch {
            return false;
        }
    }

    /**
     * Checks if a file exists
     */
    static async fileExists(filePath: string): Promise<boolean> {
        try {
            await fs.access(filePath);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Gets all directories recursively from a base path
     */
    static async getAllDirectories(basePath: string): Promise<string[]> {
        const dirs: string[] = [];

        const traverse = async (dir: string): Promise<void> => {
            try {
                const entries = await fs.readdir(dir, { withFileTypes: true });
                for (const entry of entries) {
                    if (entry.isDirectory()) {
                        const subDir = path.join(dir, entry.name);
                        dirs.push(subDir);
                        await traverse(subDir);
                    }
                }
            } catch (error) {
                console.warn(`Failed to traverse directory ${dir}:`, error);
            }
        };

        await traverse(basePath);
        return dirs;
    }

    /**
     * Gets primary file from a resource's files based on type definition
     */
    static getPrimaryFile(
        files: Array<{ name: string; path: string }>,
        resourceType: ResourceTypeDefinition
    ): string | undefined {
        // Try type-level patterns first
        if (resourceType.patterns && resourceType.patterns.length > 0) {
            const primaryFileName = resourceType.patterns[0].primaryFile;
            if (primaryFileName) {
                const primaryFile = files.find(f => f.name === primaryFileName);
                if (primaryFile) {
                    return primaryFile.path;
                }
            }
        }

        // Try category patterns
        if (resourceType.categories) {
            for (const category of Object.values(resourceType.categories)) {
                for (const pattern of category.patterns) {
                    const primaryFile = files.find(f => f.name === pattern.primaryFile);
                    if (primaryFile) {
                        return primaryFile.path;
                    }
                }
            }
        }

        // Fallback to first file that's not resource.json
        const nonResourceJsonFiles = files.filter(f => f.name !== 'resource.json');
        return nonResourceJsonFiles.length > 0 ? nonResourceJsonFiles[0].path : undefined;
    }

    /**
     * Validates that a project directory contains valid Ignition project structure
     */
    static async validateProjectStructure(projectPath: string): Promise<{
        isValid: boolean;
        projectJson?: { title?: string; [key: string]: unknown };
        errors: string[];
    }> {
        const errors: string[] = [];

        try {
            // Check if directory exists
            if (!(await this.directoryExists(projectPath))) {
                return {
                    isValid: false,
                    errors: ['Project directory does not exist']
                };
            }

            // Check for project.json
            const projectJsonPath = path.join(projectPath, 'project.json');
            if (!(await this.fileExists(projectJsonPath))) {
                errors.push('project.json not found');
            } else {
                try {
                    const content = await fs.readFile(projectJsonPath, 'utf-8');
                    const projectJson = JSON.parse(content) as { title?: string; [key: string]: unknown };

                    // Basic validation of project.json structure
                    if (
                        (projectJson.title === undefined || projectJson.title.length === 0) &&
                        !path.basename(projectPath)
                    ) {
                        errors.push('Project must have a title or valid directory name');
                    }

                    return {
                        isValid: errors.length === 0,
                        projectJson,
                        errors
                    };
                } catch (error: unknown) {
                    errors.push(`Invalid project.json: ${String(error)}`);
                }
            }
        } catch (error: unknown) {
            errors.push(`Failed to validate project: ${String(error)}`);
        }

        return {
            isValid: false,
            errors
        };
    }

    /**
     * Scans for all project.json files in a directory tree
     */
    static async findProjectFiles(basePath: string): Promise<string[]> {
        try {
            const projectFiles = await glob('**/project.json', {
                cwd: basePath,
                absolute: true,
                ignore: ['**/node_modules/**', '**/.*/**']
            });

            return projectFiles;
        } catch (error: unknown) {
            console.warn(`Failed to find project files in ${basePath}:`, error);
            return [];
        }
    }
}
