/**
 * @module ServiceContainer
 * @description Dependency injection container for the Flint extension
 * Manages service registration, retrieval, and lifecycle
 */

import { DependencyError, InvalidArgumentError } from '@/core/errors';
import type { IServiceContainer } from '@/core/types/commands';
import { ServiceStatus, type IServiceLifecycle } from '@/core/types/services';

/**
 * Service registration information
 */
interface ServiceRegistration<T = unknown> {
    /** Service instance */
    readonly instance: T;
    /** Service key */
    readonly key: string;
    /** Registration timestamp */
    readonly registeredAt: Date;
    /** Whether service is singleton */
    readonly singleton: boolean;
    /** Service lifecycle handler if applicable */
    readonly lifecycle?: IServiceLifecycle;
    /** Service dependencies */
    readonly dependencies: readonly string[];
}

/**
 * Service factory function type
 */
type ServiceFactory<T> = (container: IServiceContainer) => T;

/**
 * Dependency injection container implementation
 */
export class ServiceContainer implements IServiceContainer {
    private readonly services = new Map<string, ServiceRegistration>();
    private readonly factories = new Map<string, ServiceFactory<unknown>>();
    private readonly initializing = new Set<string>();
    private readonly initialized = new Set<string>();

    /**
     * Registers a service instance with the container
     * @param key - Service key
     * @param service - Service instance
     * @param options - Registration options
     */
    register<T>(
        key: string,
        service: T,
        options: {
            singleton?: boolean;
            dependencies?: readonly string[];
        } = {}
    ): void {
        this.validateKey(key);

        if (this.services.has(key)) {
            throw new InvalidArgumentError('key', 'unique service key', key, `Service '${key}' is already registered`);
        }

        const registration: ServiceRegistration<T> = {
            instance: service,
            key,
            registeredAt: new Date(),
            singleton: options.singleton ?? true,
            lifecycle: this.isLifecycleService(service) ? service : undefined,
            dependencies: options.dependencies ?? []
        };

        this.services.set(key, registration);
    }

    /**
     * Registers a service factory function
     * @param key - Service key
     * @param factory - Factory function
     * @param options - Registration options
     */
    registerFactory<T>(
        key: string,
        factory: ServiceFactory<T>,
        options: {
            singleton?: boolean;
            dependencies?: readonly string[];
        } = {}
    ): void {
        this.validateKey(key);

        if (this.factories.has(key) || this.services.has(key)) {
            throw new InvalidArgumentError('key', 'unique service key', key, `Service '${key}' is already registered`);
        }

        this.factories.set(key, factory);

        // If not singleton, we don't pre-create the instance
        if (options.singleton !== false) {
            const instance = factory(this);
            this.register(key, instance, options);
            this.factories.delete(key); // Remove factory after creating singleton
        }
    }

    /**
     * Gets a service from the container
     * @param key - Service key
     * @returns Service instance
     */
    get<T>(key: string): T {
        this.validateKey(key);

        // Check for existing service
        const registration = this.services.get(key);
        if (registration) {
            return registration.instance as T;
        }

        // Check for factory
        const factory = this.factories.get(key);
        if (factory) {
            if (this.initializing.has(key)) {
                throw new DependencyError(key, 'circular dependency detected');
            }

            this.initializing.add(key);
            try {
                const instance = factory(this) as T;

                // For non-singleton factories, return instance without registering
                this.initializing.delete(key);
                return instance;
            } catch (error) {
                this.initializing.delete(key);
                throw new DependencyError(
                    key,
                    `factory creation failed: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        }

        throw new DependencyError(key, 'service not registered');
    }

    /**
     * Checks if a service is registered
     * @param key - Service key
     * @returns True if service is registered
     */
    has(key: string): boolean {
        return this.services.has(key) || this.factories.has(key);
    }

    /**
     * Gets a service from the container, returning undefined if not found
     * @param key - Service key
     * @returns Service instance or undefined
     */
    getOptional<T>(key: string): T | undefined {
        if (this.has(key)) {
            return this.get<T>(key);
        }
        return undefined;
    }

    /**
     * Gets all registered service keys
     * @returns Array of service keys
     */
    getServiceKeys(): readonly string[] {
        const keys = new Set<string>();
        this.services.forEach((_, key) => keys.add(key));
        this.factories.forEach((_, key) => keys.add(key));
        return Array.from(keys).sort();
    }

    /**
     * Gets service registration information
     * @param key - Service key
     * @returns Service registration or undefined
     */
    getRegistration(key: string): ServiceRegistration | undefined {
        return this.services.get(key);
    }

    /**
     * Initializes all registered services that support lifecycle
     */
    async initializeServices(): Promise<void> {
        const services = Array.from(this.services.values());
        const lifecycleServices = services.filter(reg => reg.lifecycle);

        // Sort by dependencies (services with no deps first)
        const sortedServices = this.sortByDependencies(lifecycleServices);

        for (const registration of sortedServices) {
            if (registration.lifecycle && !this.initialized.has(registration.key)) {
                try {
                    await registration.lifecycle.initialize();
                    this.initialized.add(registration.key);
                } catch (error) {
                    throw new DependencyError(
                        registration.key,
                        `initialization failed: ${error instanceof Error ? error.message : String(error)}`
                    );
                }
            }
        }
    }

    /**
     * Starts all registered services that support lifecycle
     */
    async startServices(): Promise<void> {
        const services = Array.from(this.services.values());
        const lifecycleServices = services.filter(reg => reg.lifecycle);

        for (const registration of lifecycleServices) {
            if (registration.lifecycle && this.initialized.has(registration.key)) {
                try {
                    await registration.lifecycle.start();
                } catch (error) {
                    throw new DependencyError(
                        registration.key,
                        `start failed: ${error instanceof Error ? error.message : String(error)}`
                    );
                }
            }
        }
    }

    /**
     * Stops all registered services that support lifecycle
     */
    async stopServices(): Promise<void> {
        const services = Array.from(this.services.values());
        const lifecycleServices = services.filter(reg => reg.lifecycle);

        // Stop in reverse order
        for (const registration of lifecycleServices.reverse()) {
            if (registration.lifecycle) {
                try {
                    await registration.lifecycle.stop();
                } catch (error) {
                    // Log error but continue stopping other services
                    console.error(`Failed to stop service '${registration.key}':`, error);
                }
            }
        }
    }

    /**
     * Disposes all registered services and clears the container
     */
    async dispose(): Promise<void> {
        const services = Array.from(this.services.values());
        const lifecycleServices = services.filter(reg => reg.lifecycle);

        // Dispose in reverse order
        for (const registration of lifecycleServices.reverse()) {
            if (registration.lifecycle) {
                try {
                    await registration.lifecycle.dispose();
                } catch (error) {
                    // Log error but continue disposing other services
                    console.error(`Failed to dispose service '${registration.key}':`, error);
                }
            }
        }

        // Clear all registrations
        this.services.clear();
        this.factories.clear();
        this.initializing.clear();
        this.initialized.clear();
    }

    /**
     * Gets service status information
     * @returns Service status map
     */
    getServiceStatus(): ReadonlyMap<string, ServiceStatus> {
        const statusMap = new Map<string, ServiceStatus>();

        this.services.forEach((registration, key) => {
            if (registration.lifecycle) {
                statusMap.set(key, registration.lifecycle.getStatus());
            } else {
                statusMap.set(key, ServiceStatus.RUNNING);
            }
        });

        this.factories.forEach((_, key) => {
            if (!statusMap.has(key)) {
                statusMap.set(key, ServiceStatus.NOT_INITIALIZED);
            }
        });

        return statusMap;
    }

    /**
     * Type-safe getters for common services
     */

    get configurationManager(): unknown {
        return this.get('configurationManager');
    }

    get projectScanner(): unknown {
        return this.get('projectScanner');
    }

    get gatewayManager(): unknown {
        return this.get('gatewayManager');
    }

    get resourceManager(): unknown {
        return this.get('resourceManager');
    }

    get resourceTypeRegistry(): unknown {
        return this.get('resourceTypeRegistry');
    }

    get searchService(): unknown {
        return this.get('searchService');
    }

    get editorService(): unknown {
        return this.get('editorService');
    }

    get templateService(): unknown {
        return this.get('templateService');
    }

    /**
     * Private helper methods
     */

    private validateKey(key: string): void {
        if (!key || typeof key !== 'string' || key.trim().length === 0) {
            throw new InvalidArgumentError('key', 'non-empty string', key, 'Service key must be a non-empty string');
        }
    }

    private isLifecycleService(service: unknown): service is IServiceLifecycle {
        return (
            typeof service === 'object' &&
            service !== null &&
            'initialize' in service &&
            'start' in service &&
            'stop' in service &&
            'dispose' in service &&
            'getStatus' in service
        );
    }

    private sortByDependencies(services: ServiceRegistration[]): ServiceRegistration[] {
        const sorted: ServiceRegistration[] = [];
        const visited = new Set<string>();
        const visiting = new Set<string>();

        const visit = (registration: ServiceRegistration): void => {
            if (visiting.has(registration.key)) {
                throw new DependencyError(registration.key, 'circular dependency detected');
            }

            if (visited.has(registration.key)) {
                return;
            }

            visiting.add(registration.key);

            // Visit dependencies first
            for (const depKey of registration.dependencies) {
                const depRegistration = this.services.get(depKey);
                if (depRegistration) {
                    visit(depRegistration);
                }
            }

            visiting.delete(registration.key);
            visited.add(registration.key);
            sorted.push(registration);
        };

        for (const registration of services) {
            if (!visited.has(registration.key)) {
                visit(registration);
            }
        }

        return sorted;
    }
}

/**
 * Singleton instance of the service container
 * Use this for global access throughout the extension
 */
export const serviceContainer = new ServiceContainer();
