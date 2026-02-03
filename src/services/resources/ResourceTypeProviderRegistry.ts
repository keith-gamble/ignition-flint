/**
 * @module ResourceTypeProviderRegistry
 * @description Registry for resource type providers that handle resource-specific behavior
 */

import * as vscode from 'vscode';

import { FlintError } from '@/core/errors';
import { ServiceContainer } from '@/core/ServiceContainer';
import {
    ResourceTypeProvider,
    ResourceEditorConfig,
    ResourceSearchConfig,
    ResourceTemplateConfig
} from '@/core/types/resourceProviders';
import { IServiceLifecycle, ServiceStatus } from '@/core/types/services';
// Import built-in providers
import { NamedQueryProvider } from '@/providers/resources/NamedQueryProvider';
import { PerspectivePageConfigProvider } from '@/providers/resources/PerspectivePageConfigProvider';
import { PerspectiveSessionEventsProvider } from '@/providers/resources/PerspectiveSessionEventsProvider';
import { PerspectiveSessionPropsProvider } from '@/providers/resources/PerspectiveSessionPropsProvider';
import { PerspectiveStyleClassProvider } from '@/providers/resources/PerspectiveStyleClassProvider';
import { PerspectiveViewProvider } from '@/providers/resources/PerspectiveViewProvider';
import { PythonScriptProvider } from '@/providers/resources/PythonScriptProvider';

/**
 * Registry service for resource type providers
 */
export class ResourceTypeProviderRegistry implements IServiceLifecycle {
    private providers = new Map<string, ResourceTypeProvider>();
    private isInitialized = false;

    private readonly providerRegisteredEmitter = new vscode.EventEmitter<ResourceTypeProvider>();
    public readonly onProviderRegistered = this.providerRegisteredEmitter.event;

    constructor(private readonly serviceContainer: ServiceContainer) {}

    async initialize(): Promise<void> {
        await this.registerBuiltInProviders();
        this.isInitialized = true;
        // console.log(`ResourceTypeProviderRegistry initialized with ${this.providers.size} providers`);
    }

    start(): Promise<void> {
        if (!this.isInitialized) {
            throw new FlintError(
                'ResourceTypeProviderRegistry must be initialized before starting',
                'SERVICE_NOT_INITIALIZED'
            );
        }
        // console.log('ResourceTypeProviderRegistry started');
        return Promise.resolve();
    }

    stop(): Promise<void> {
        console.log('ResourceTypeProviderRegistry stopped');
        return Promise.resolve();
    }

    dispose(): Promise<void> {
        this.providers.clear();
        this.providerRegisteredEmitter.dispose();
        this.isInitialized = false;
        console.log('ResourceTypeProviderRegistry disposed');
        return Promise.resolve();
    }

    getStatus(): ServiceStatus {
        return this.isInitialized ? ServiceStatus.RUNNING : ServiceStatus.STOPPED;
    }

    /**
     * Registers a resource type provider
     */
    registerProvider(provider: ResourceTypeProvider): void {
        if (this.providers.has(provider.resourceTypeId)) {
            console.warn(`Provider for resource type '${provider.resourceTypeId}' is already registered, replacing...`);
        }

        this.providers.set(provider.resourceTypeId, provider);
        this.providerRegisteredEmitter.fire(provider);

        // Resource type provider registered
    }

    /**
     * Gets a provider for a specific resource type
     */
    getProvider(resourceTypeId: string): ResourceTypeProvider | undefined {
        return this.providers.get(resourceTypeId);
    }

    /**
     * Gets all registered providers
     */
    getAllProviders(): readonly ResourceTypeProvider[] {
        return Object.freeze(Array.from(this.providers.values()));
    }

    /**
     * Gets providers that support content search
     */
    getSearchableProviders(): readonly ResourceTypeProvider[] {
        return Object.freeze(
            Array.from(this.providers.values()).filter(provider => provider.getSearchConfig().supportsContentSearch)
        );
    }

    /**
     * Gets validation rules for a resource type
     */
    getValidationRules(resourceTypeId: string): readonly any[] {
        const provider = this.providers.get(resourceTypeId);
        return provider ? provider.getValidationRules() : [];
    }

    /**
     * Gets editor configuration for a resource type
     */
    getEditorConfig(resourceTypeId: string): ResourceEditorConfig | undefined {
        const provider = this.providers.get(resourceTypeId);
        return provider?.getEditorConfig();
    }

    /**
     * Gets search configuration for a resource type
     */
    getSearchConfig(resourceTypeId: string): ResourceSearchConfig | undefined {
        const provider = this.providers.get(resourceTypeId);
        return provider?.getSearchConfig();
    }

    /**
     * Gets template configuration for a resource type
     */
    getTemplateConfig(resourceTypeId: string): ResourceTemplateConfig | undefined {
        const provider = this.providers.get(resourceTypeId);
        return provider?.getTemplateConfig();
    }

    /**
     * Checks if a resource type has a provider
     */
    hasProvider(resourceTypeId: string): boolean {
        return this.providers.has(resourceTypeId);
    }

    /**
     * Creates a resource using the appropriate provider
     */
    async createResource(
        resourceTypeId: string,
        resourcePath: string,
        templateId?: string,
        context?: unknown
    ): Promise<void> {
        const provider = this.providers.get(resourceTypeId);
        if (!provider) {
            throw new FlintError(`No provider found for resource type: ${resourceTypeId}`, 'PROVIDER_NOT_FOUND');
        }

        if (provider.createResource) {
            await provider.createResource(resourcePath, templateId, context);
        } else {
            throw new FlintError(
                `Provider for '${resourceTypeId}' does not support resource creation`,
                'OPERATION_NOT_SUPPORTED'
            );
        }
    }

    /**
     * Validates a resource using the appropriate provider
     */
    async validateResource(resourceTypeId: string, resourcePath: string, content: string): Promise<any> {
        const provider = this.providers.get(resourceTypeId);
        if (!provider) {
            throw new FlintError(`No provider found for resource type: ${resourceTypeId}`, 'PROVIDER_NOT_FOUND');
        }

        if (provider.validateResource) {
            return provider.validateResource(resourcePath, content);
        }
        // Return default valid result
        return {
            isValid: true,
            errors: [],
            warnings: []
        };
    }

    /**
     * Registers built-in resource type providers
     */
    private registerBuiltInProviders(): Promise<void> {
        const builtInProviders: ResourceTypeProvider[] = [
            // Scripting providers
            new PythonScriptProvider(),

            // Database providers
            new NamedQueryProvider(),

            // Perspective providers
            new PerspectiveViewProvider(),
            new PerspectiveStyleClassProvider(),
            new PerspectivePageConfigProvider(),
            new PerspectiveSessionPropsProvider(),
            new PerspectiveSessionEventsProvider()
        ];

        for (const provider of builtInProviders) {
            this.registerProvider(provider);
        }
        return Promise.resolve();
    }
}
