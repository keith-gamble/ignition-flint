/**
 * @module IgnitionStubsManagerService
 * @description Manages downloading, caching, and indexing of Ignition Python stubs by version
 * Downloads specific ignition-api versions from PyPI and caches them locally
 */

import { exec } from 'child_process';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';

import * as vscode from 'vscode';

import { FlintError } from '@/core/errors';
import { ServiceContainer } from '@/core/ServiceContainer';
import { IServiceLifecycle, ServiceStatus } from '@/core/types/services';

const execAsync = promisify(exec);

/**
 * Stub metadata for a specific Ignition version
 */
export interface IgnitionStubMetadata {
    /** Ignition version (e.g., '8.1.33') */
    readonly version: string;
    /** Path to cached stubs */
    readonly stubPath: string;
    /** Date when stubs were downloaded */
    readonly downloadedAt: Date;
    /** Size of stub directory in bytes */
    readonly size: number;
    /** Whether stubs are currently being downloaded */
    readonly downloading: boolean;
    /** List of available system modules */
    readonly systemModules: readonly string[];
}

/**
 * Service for managing Ignition Python stubs
 * Downloads and caches version-specific stubs from PyPI
 */
export class IgnitionStubsManagerService implements IServiceLifecycle {
    private static readonly CACHE_DIR = path.join(os.homedir(), '.flint', 'ignition-stubs');
    private static readonly METADATA_FILE = 'metadata.json';

    private isInitialized = false;
    private stubMetadata = new Map<string, IgnitionStubMetadata>();
    private downloadPromises = new Map<string, Promise<void>>();

    private readonly stubUpdateEmitter = new vscode.EventEmitter<IgnitionStubMetadata>();
    public readonly onStubUpdate = this.stubUpdateEmitter.event;

    constructor(private readonly serviceContainer: ServiceContainer) {}

    async initialize(): Promise<void> {
        try {
            // Ensure cache directory exists
            await fs.mkdir(IgnitionStubsManagerService.CACHE_DIR, { recursive: true });

            // Load cached stub metadata
            await this.loadMetadata();

            this.isInitialized = true;
        } catch (error) {
            throw new FlintError(
                'Failed to initialize IgnitionStubsManagerService',
                'STUBS_MANAGER_INIT_FAILED',
                'Could not set up Ignition stubs cache',
                error instanceof Error ? error : undefined
            );
        }
    }

    start(): Promise<void> {
        if (!this.isInitialized) {
            throw new FlintError('Service must be initialized before starting', 'SERVICE_NOT_INITIALIZED');
        }
        return Promise.resolve();
    }

    async stop(): Promise<void> {
        // Wait for any ongoing downloads to complete
        const downloads = Array.from(this.downloadPromises.values());
        if (downloads.length > 0) {
            await Promise.allSettled(downloads);
        }
    }

    async dispose(): Promise<void> {
        await this.stop();
        this.stubUpdateEmitter.dispose();
        this.isInitialized = false;
    }

    getStatus(): ServiceStatus {
        return this.isInitialized ? ServiceStatus.RUNNING : ServiceStatus.STOPPED;
    }

    /**
     * Gets stub metadata for a specific version
     */
    getStubMetadata(version: string): IgnitionStubMetadata | undefined {
        return this.stubMetadata.get(this.normalizeVersion(version));
    }

    /**
     * Ensures stubs are available for a specific version
     * Downloads if not cached
     */
    async ensureStubs(version: string, prompt = true): Promise<IgnitionStubMetadata | undefined> {
        const normalizedVersion = this.normalizeVersion(version);

        // Check if already cached
        const existing = this.stubMetadata.get(normalizedVersion);
        if (existing && !existing.downloading) {
            // Verify the stubs still exist on disk
            try {
                await fs.access(existing.stubPath);
                return existing;
            } catch {
                console.log(`Cached stubs for ${normalizedVersion} not found on disk, re-downloading...`);
                this.stubMetadata.delete(normalizedVersion);
            }
        }

        // Check if download is already in progress
        const downloadPromise = this.downloadPromises.get(normalizedVersion);
        if (downloadPromise) {
            await downloadPromise;
            const metadata = this.stubMetadata.get(normalizedVersion);
            if (metadata) {
                return metadata;
            }
        }

        // Prompt user before downloading
        if (prompt) {
            const response = await vscode.window.showInformationMessage(
                `Ignition system function IntelliSense requires downloading Python stubs for version ${version}. Download now?`,
                'Download',
                'Not Now'
            );

            if (response !== 'Download') {
                return undefined;
            }
        }

        // Start new download with progress indicator
        return vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `Downloading Ignition ${normalizedVersion} stubs...`,
                cancellable: false
            },
            async () => {
                return this.downloadStubs(normalizedVersion);
            }
        );
    }

    /**
     * Downloads stubs for a specific version
     */
    private async downloadStubs(version: string): Promise<IgnitionStubMetadata> {
        const versionPath = path.join(IgnitionStubsManagerService.CACHE_DIR, version);

        // Mark as downloading
        const tempMetadata: IgnitionStubMetadata = {
            version,
            stubPath: versionPath,
            downloadedAt: new Date(),
            size: 0,
            downloading: true,
            systemModules: []
        };
        this.stubMetadata.set(version, tempMetadata);

        // Create download promise
        const downloadPromise = this.performDownload(version, versionPath);
        this.downloadPromises.set(version, downloadPromise);

        try {
            await downloadPromise;

            // Update metadata after successful download
            const systemModules = await this.scanSystemModules(versionPath);
            const size = await this.getDirectorySize(versionPath);

            const metadata: IgnitionStubMetadata = {
                version,
                stubPath: versionPath,
                downloadedAt: new Date(),
                size,
                downloading: false,
                systemModules
            };

            this.stubMetadata.set(version, metadata);
            await this.saveMetadata();

            // Emit update event
            this.stubUpdateEmitter.fire(metadata);

            return metadata;
        } finally {
            this.downloadPromises.delete(version);
        }
    }

    /**
     * Performs the actual download of stubs from PyPI
     */
    private async performDownload(version: string, targetPath: string): Promise<void> {
        console.log(`Downloading ignition-api stubs for version ${version}...`);

        // Create temp directory for download
        const tempDir = path.join(os.tmpdir(), `flint-stubs-${version}-${Date.now()}`);
        await fs.mkdir(tempDir, { recursive: true });

        try {
            // Construct package name based on version
            // ignition-api uses specific version formatting
            // For 8.1.x versions: ignition-api==8.1.x
            // For 8.3.x versions: ignition-api==8.3.x
            const packageVersion = this.getPackageVersion(version);

            // Try to download the wheel file directly from PyPI without version checks
            // First, we need to find the exact wheel file name
            let wheelFile: string | undefined;

            try {
                // Fallback to pip download with more relaxed options
                const downloadCmd = `pip download --no-deps --python-version 2.7 --implementation py --only-binary :all: --dest "${tempDir}" ignition-api==${packageVersion}`;
                console.log(`Running: ${downloadCmd}`);

                const { stderr } = await execAsync(downloadCmd);
                if (stderr && !stderr.includes('WARNING')) {
                    console.warn(`pip download warnings: ${stderr}`);
                }
            } catch {
                // If pip fails due to Python version requirements, try direct download
                console.log('pip download failed, trying direct download from PyPI...');

                // Use PyPI JSON API to get the actual wheel URL
                const apiUrl = `https://pypi.org/pypi/ignition-api/${packageVersion}/json`;
                const apiCmd = `curl -s "${apiUrl}"`;

                try {
                    const { stdout: apiResponse } = await execAsync(apiCmd);
                    const packageData = JSON.parse(apiResponse);

                    // Find a py2 wheel
                    interface WheelInfo {
                        filename: string;
                        url: string;
                        python_version?: string;
                    }
                    const urls = packageData.urls as WheelInfo[] | undefined;
                    const py2Wheel = urls?.find(
                        url =>
                            url.filename.endsWith('.whl') &&
                            (url.python_version === 'py2' || url.filename.includes('-py2-'))
                    );

                    if (py2Wheel) {
                        const downloadUrl = py2Wheel.url;
                        wheelFile = py2Wheel.filename;
                        const directDownloadCmd = `curl -f -L -o "${tempDir}/${wheelFile}" "${downloadUrl}"`;
                        await execAsync(directDownloadCmd);
                        console.log(`Successfully downloaded ${wheelFile} directly from PyPI`);
                    } else {
                        throw new Error(`No Python 2 wheel found for ignition-api version ${packageVersion}`);
                    }
                } catch (apiError) {
                    throw new Error(
                        `Failed to download ignition-api wheel: ${apiError instanceof Error ? apiError.message : String(apiError)}`
                    );
                }
            }

            // Find the downloaded wheel file if not already set
            if (!wheelFile) {
                const files = await fs.readdir(tempDir);
                wheelFile = files.find(f => f.endsWith('.whl'));

                if (!wheelFile) {
                    throw new Error(`No wheel file found after download. Files: ${files.join(', ')}`);
                }
            }

            // Extract the wheel file (it's a zip archive)
            const wheelPath = path.join(tempDir, wheelFile);
            const extractCmd =
                process.platform === 'win32'
                    ? `powershell -command "Expand-Archive -Path '${wheelPath}' -DestinationPath '${tempDir}/extracted'"`
                    : `unzip -q "${wheelPath}" -d "${tempDir}/extracted"`;

            await execAsync(extractCmd);

            // Move the extracted stubs to target location
            await fs.mkdir(targetPath, { recursive: true });

            // The wheel contains multiple directories:
            // - system/ (Ignition system functions)
            // - java/ (Java stubs)
            // - javax/ (JavaX stubs)
            // - com/ (Java com.* packages)
            // - ch/ (Other Java packages)
            // - ignition_api-*.dist-info/ (metadata - ignore)

            const extractedPath = path.join(tempDir, 'extracted');
            const extractedFiles = await fs.readdir(extractedPath, { withFileTypes: true });

            // Copy all directories except dist-info
            for (const entry of extractedFiles) {
                if (entry.isDirectory() && !entry.name.includes('dist-info')) {
                    const srcPath = path.join(extractedPath, entry.name);
                    const destPath = path.join(targetPath, entry.name);
                    await this.copyDirectory(srcPath, destPath);
                }
            }

            console.log(`Successfully downloaded and extracted stubs for version ${version}`);
        } catch (error) {
            // Clean up target directory on failure
            try {
                await fs.rm(targetPath, { recursive: true, force: true });
            } catch {
                // Ignore cleanup errors
            }

            throw new FlintError(
                `Failed to download ignition-api stubs for version ${version}`,
                'STUBS_DOWNLOAD_FAILED',
                `Could not download or extract stubs. ${error instanceof Error ? error.message : String(error)}`,
                error instanceof Error ? error : undefined
            );
        } finally {
            // Clean up temp directory
            try {
                await fs.rm(tempDir, { recursive: true, force: true });
            } catch {
                // Ignore cleanup errors
            }
        }
    }

    /**
     * Recursively copies a directory
     */
    private async copyDirectory(src: string, dest: string): Promise<void> {
        await fs.mkdir(dest, { recursive: true });

        const entries = await fs.readdir(src, { withFileTypes: true });

        for (const entry of entries) {
            const srcPath = path.join(src, entry.name);
            const destPath = path.join(dest, entry.name);

            if (entry.isDirectory()) {
                await this.copyDirectory(srcPath, destPath);
            } else {
                await fs.copyFile(srcPath, destPath);
            }
        }
    }

    /**
     * Scans for system modules in the stub directory
     */
    private async scanSystemModules(stubPath: string): Promise<string[]> {
        const modules: string[] = [];

        try {
            // Look for the system directory
            const systemPath = path.join(stubPath, 'system');
            const entries = await fs.readdir(systemPath);

            for (const entry of entries) {
                // Skip __pycache__ and special files
                if (entry.startsWith('__') || !entry.endsWith('.py')) {
                    continue;
                }

                // Remove .py extension
                const moduleName = entry.slice(0, -3);
                if (moduleName && moduleName !== '__init__') {
                    modules.push(`system.${moduleName}`);
                }
            }
        } catch (error) {
            console.warn(`Could not scan system modules in ${stubPath}:`, error);
        }

        return modules.sort();
    }

    /**
     * Gets the total size of a directory
     */
    private async getDirectorySize(dirPath: string): Promise<number> {
        let totalSize = 0;

        try {
            const entries = await fs.readdir(dirPath, { withFileTypes: true });

            for (const entry of entries) {
                const fullPath = path.join(dirPath, entry.name);

                if (entry.isDirectory()) {
                    totalSize += await this.getDirectorySize(fullPath);
                } else {
                    const stats = await fs.stat(fullPath);
                    totalSize += stats.size;
                }
            }
        } catch {
            // Ignore errors
        }

        return totalSize;
    }

    /**
     * Normalizes version string to a consistent format
     */
    private normalizeVersion(version: string): string {
        // Handle versions like "8.1" -> "8.1.0" for consistency
        const parts = version.split('.');
        if (parts.length === 2) {
            return `${parts[0]}.${parts[1]}.0`;
        }
        return version;
    }

    /**
     * Gets the PyPI package version for a given Ignition version
     */
    private getPackageVersion(ignitionVersion: string): string {
        // ignition-api package versions correspond to Ignition versions
        // but may have post-release suffixes (e.g., 8.1.33.post1)
        // We'll try the exact version first, pip will find the latest post-release
        return ignitionVersion;
    }

    /**
     * Loads cached metadata from disk
     */
    private async loadMetadata(): Promise<void> {
        const metadataPath = path.join(
            IgnitionStubsManagerService.CACHE_DIR,
            IgnitionStubsManagerService.METADATA_FILE
        );

        try {
            const data = await fs.readFile(metadataPath, 'utf-8');
            const metadata = JSON.parse(data) as Record<string, any>;

            this.stubMetadata.clear();
            for (const [version, data] of Object.entries(metadata)) {
                this.stubMetadata.set(version, {
                    ...data,
                    downloadedAt: new Date(data.downloadedAt),
                    downloading: false
                });
            }
        } catch {
            // No metadata file yet or invalid, start fresh
            this.stubMetadata.clear();
        }
    }

    /**
     * Saves metadata to disk
     */
    private async saveMetadata(): Promise<void> {
        const metadataPath = path.join(
            IgnitionStubsManagerService.CACHE_DIR,
            IgnitionStubsManagerService.METADATA_FILE
        );

        const metadata: Record<string, any> = {};
        for (const [version, data] of this.stubMetadata.entries()) {
            if (!data.downloading) {
                metadata[version] = {
                    ...data,
                    downloadedAt: data.downloadedAt.toISOString()
                };
            }
        }

        await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
    }

    /**
     * Gets all cached stub versions
     */
    getCachedVersions(): string[] {
        return Array.from(this.stubMetadata.keys()).filter(version => !this.stubMetadata.get(version)?.downloading);
    }

    /**
     * Clears cached stubs for a specific version
     */
    async clearVersion(version: string): Promise<void> {
        const normalizedVersion = this.normalizeVersion(version);
        const metadata = this.stubMetadata.get(normalizedVersion);

        if (metadata) {
            try {
                await fs.rm(metadata.stubPath, { recursive: true, force: true });
                this.stubMetadata.delete(normalizedVersion);
                await this.saveMetadata();
                console.log(`Cleared cached stubs for version ${normalizedVersion}`);
            } catch (error) {
                console.error(`Failed to clear stubs for version ${normalizedVersion}:`, error);
            }
        }
    }

    /**
     * Clears all cached stubs
     */
    async clearAllVersions(): Promise<void> {
        try {
            await fs.rm(IgnitionStubsManagerService.CACHE_DIR, { recursive: true, force: true });
            await fs.mkdir(IgnitionStubsManagerService.CACHE_DIR, { recursive: true });
            this.stubMetadata.clear();
            console.log('Cleared all cached Ignition stubs');
        } catch (error) {
            console.error('Failed to clear all stubs:', error);
        }
    }
}
