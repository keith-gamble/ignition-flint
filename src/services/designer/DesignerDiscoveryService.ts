/**
 * @module DesignerDiscoveryService
 * @description Discovers running Designer instances by reading registry files
 */

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import { FlintError } from '@/core/errors';
import { ServiceContainer } from '@/core/ServiceContainer';
import { IServiceLifecycle, ServiceStatus } from '@/core/types/services';

/**
 * Information about a discovered Designer instance
 */
export interface DesignerInstance {
    readonly pid: number;
    readonly port: number;
    readonly startTime: string;
    readonly gateway: {
        readonly host: string;
        readonly port: number;
        readonly ssl: boolean;
        readonly name: string;
    };
    readonly project: {
        readonly name: string;
        readonly title: string;
    };
    readonly user: {
        readonly username: string;
    };
    readonly designerVersion: string;
    readonly moduleVersion: string;
    readonly capabilities: {
        readonly scriptExecution: boolean;
        readonly gatewayScope: boolean;
    };
    readonly secret: string;
    readonly registryFilePath: string;
    /** The matched gateway ID from configuration, if any (set by DesignerGatewayMatcher) */
    readonly matchedGatewayId?: string;
    /** Whether the Designer's project is in the matched gateway's project list */
    readonly projectMatchedInGateway?: boolean;
}

/**
 * Service for discovering running Designer instances
 */
export class DesignerDiscoveryService implements IServiceLifecycle {
    private static readonly REGISTRY_DIR = path.join(os.homedir(), '.ignition', 'flint', 'designers');
    private static readonly SCAN_INTERVAL_MS = 5000;

    private status: ServiceStatus = ServiceStatus.NOT_INITIALIZED;
    private scanInterval?: NodeJS.Timeout;
    private discoveredDesigners: Map<number, DesignerInstance> = new Map();
    private onDesignersChangedCallbacks: Array<(designers: DesignerInstance[]) => void> = [];

    constructor(private readonly _serviceContainer: ServiceContainer) {}

    async initialize(): Promise<void> {
        this.status = ServiceStatus.INITIALIZING;
        try {
            // Ensure registry directory exists
            await fs.mkdir(DesignerDiscoveryService.REGISTRY_DIR, { recursive: true });
            this.status = ServiceStatus.INITIALIZED;
        } catch (error) {
            this.status = ServiceStatus.FAILED;
            throw new FlintError(
                'Failed to initialize designer discovery service',
                'DESIGNER_DISCOVERY_INIT_FAILED',
                'Could not create registry directory',
                error instanceof Error ? error : undefined
            );
        }
    }

    async start(): Promise<void> {
        if (this.status !== ServiceStatus.INITIALIZED && this.status !== ServiceStatus.STOPPED) {
            await this.initialize();
        }

        this.status = ServiceStatus.STARTING;

        // Initial scan
        await this.scanForDesigners();

        // Start periodic scanning
        this.scanInterval = setInterval(() => {
            void this.scanForDesigners();
        }, DesignerDiscoveryService.SCAN_INTERVAL_MS);

        this.status = ServiceStatus.RUNNING;
    }

    stop(): Promise<void> {
        this.status = ServiceStatus.STOPPING;

        if (this.scanInterval) {
            clearInterval(this.scanInterval);
            this.scanInterval = undefined;
        }

        this.status = ServiceStatus.STOPPED;
        return Promise.resolve();
    }

    async dispose(): Promise<void> {
        await this.stop();
        this.discoveredDesigners.clear();
        this.onDesignersChangedCallbacks = [];
    }

    getStatus(): ServiceStatus {
        return this.status;
    }

    /**
     * Gets all discovered Designer instances
     */
    getDiscoveredDesigners(): DesignerInstance[] {
        return Array.from(this.discoveredDesigners.values());
    }

    /**
     * Gets a specific Designer instance by PID
     */
    getDesignerByPid(pid: number): DesignerInstance | undefined {
        return this.discoveredDesigners.get(pid);
    }

    /**
     * Registers a callback to be called when the list of designers changes
     */
    onDesignersChanged(callback: (designers: DesignerInstance[]) => void): void {
        this.onDesignersChangedCallbacks.push(callback);
    }

    /**
     * Forces an immediate scan for designers
     */
    async refreshDesigners(): Promise<DesignerInstance[]> {
        await this.scanForDesigners();
        return this.getDiscoveredDesigners();
    }

    /**
     * Scans the registry directory for Designer instances
     */
    private async scanForDesigners(): Promise<void> {
        try {
            const files = await fs.readdir(DesignerDiscoveryService.REGISTRY_DIR);
            const registryFiles = files.filter(f => f.startsWith('designer-') && f.endsWith('.json'));

            const previousPids = new Set(this.discoveredDesigners.keys());
            const currentPids = new Set<number>();
            let hasChanges = false;

            for (const file of registryFiles) {
                const filePath = path.join(DesignerDiscoveryService.REGISTRY_DIR, file);
                const designer = await this.readRegistryFile(filePath);

                if (designer) {
                    currentPids.add(designer.pid);

                    // Check if this is a new designer or if the info changed
                    const existing = this.discoveredDesigners.get(designer.pid);
                    if (!existing || existing.port !== designer.port) {
                        this.discoveredDesigners.set(designer.pid, designer);
                        hasChanges = true;
                    }
                }
            }

            // Remove designers that no longer exist
            for (const pid of previousPids) {
                if (!currentPids.has(pid)) {
                    this.discoveredDesigners.delete(pid);
                    hasChanges = true;
                }
            }

            // Notify listeners if there were changes
            if (hasChanges) {
                this.notifyDesignersChanged();
            }
        } catch (error) {
            // Directory might not exist yet, which is fine
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                console.error('Error scanning for designers:', error);
            }
        }
    }

    /**
     * Reads and validates a registry file
     */
    private async readRegistryFile(filePath: string): Promise<DesignerInstance | null> {
        try {
            const content = await fs.readFile(filePath, 'utf-8');
            const data = JSON.parse(content) as DesignerInstance;

            // Validate required fields
            if (!data.pid || !data.port || !data.secret) {
                return null;
            }

            // Check if the process is still running by trying to test the file lock
            // If we can't read the file, the Designer is still holding the lock
            const isValid = this.isDesignerAlive(data.pid);
            if (!isValid) {
                // Clean up stale registry file
                await fs.unlink(filePath).catch(() => {
                    // Ignore errors when deleting stale files
                });
                return null;
            }

            return {
                ...data,
                registryFilePath: filePath
            };
        } catch {
            // File might be locked (being written) or corrupted
            return null;
        }
    }

    /**
     * Checks if a Designer process is still alive
     */
    private isDesignerAlive(pid: number): boolean {
        try {
            // On Unix, sending signal 0 checks if process exists without killing it
            process.kill(pid, 0);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Notifies all listeners that the designer list has changed
     */
    private notifyDesignersChanged(): void {
        const designers = this.getDiscoveredDesigners();
        for (const callback of this.onDesignersChangedCallbacks) {
            try {
                callback(designers);
            } catch (error) {
                console.error('Error in designers changed callback:', error);
            }
        }
    }
}
