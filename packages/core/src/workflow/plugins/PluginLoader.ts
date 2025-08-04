/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import { promises as fs } from 'fs';
import path from 'path';
import { StepTypePlugin, StepTypePluginFactory, StepTypePluginConfig } from './StepTypePlugin.js';
import { PluginRegistry, PluginRegistrationResult } from './PluginRegistry.js';

export interface PluginDiscoveryOptions {
  searchPaths: string[];
  fileExtensions: string[];
  maxDepth?: number;
  followSymlinks?: boolean;
  ignoreNodeModules?: boolean;
  includePackageJson?: boolean;
}

export interface PluginLoadOptions {
  enableValidation?: boolean;
  sandbox?: boolean;
  timeout?: number;
  defaultConfig?: Partial<StepTypePluginConfig>;
}

export interface PluginManifest {
  name: string;
  version: string;
  main: string;
  stepTypes: string[];
  description?: string;
  author?: string;
  license?: string;
  keywords?: string[];
  engines?: {
    node?: string;
    ghccli?: string;
  };
  dependencies?: Record<string, string>;
  config?: StepTypePluginConfig;
}

export interface DiscoveredPlugin {
  manifest: PluginManifest;
  pluginPath: string;
  manifestPath: string;
  isValid: boolean;
  errors: string[];
}

export class PluginLoader {
  private registry: PluginRegistry;
  private discoveryOptions: PluginDiscoveryOptions;
  private loadOptions: PluginLoadOptions;

  constructor(
    registry: PluginRegistry,
    discoveryOptions: Partial<PluginDiscoveryOptions> = {},
    loadOptions: PluginLoadOptions = {}
  ) {
    this.registry = registry;
    this.discoveryOptions = {
      searchPaths: ['./plugins', './node_modules'],
      fileExtensions: ['.js', '.mjs', '.ts'],
      maxDepth: 3,
      followSymlinks: false,
      ignoreNodeModules: true,
      includePackageJson: true,
      ...discoveryOptions
    };
    this.loadOptions = {
      enableValidation: true,
      sandbox: true,
      timeout: 30000,
      ...loadOptions
    };
  }

  async discoverPlugins(): Promise<DiscoveredPlugin[]> {
    const discovered: DiscoveredPlugin[] = [];

    for (const searchPath of this.discoveryOptions.searchPaths) {
      try {
        const pathPlugins = await this.discoverPluginsInPath(searchPath, 0);
        discovered.push(...pathPlugins);
      } catch (error) {
        console.warn(`Failed to discover plugins in path '${searchPath}':`, error);
      }
    }

    return discovered;
  }

  private async discoverPluginsInPath(searchPath: string, depth: number): Promise<DiscoveredPlugin[]> {
    if (depth >= (this.discoveryOptions.maxDepth || 3)) {
      return [];
    }

    const discovered: DiscoveredPlugin[] = [];

    try {
      const stat = await fs.stat(searchPath);
      if (!stat.isDirectory()) {
        return [];
      }

      const entries = await fs.readdir(searchPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(searchPath, entry.name);

        if (entry.isDirectory()) {
          if (this.discoveryOptions.ignoreNodeModules && entry.name === 'node_modules') {
            continue;
          }

          if (entry.isSymbolicLink() && !this.discoveryOptions.followSymlinks) {
            continue;
          }

          const pluginManifestPath = path.join(fullPath, 'ghccli-plugin.json');
          const packageJsonPath = path.join(fullPath, 'package.json');

          try {
            await fs.access(pluginManifestPath);
            const plugin = await this.loadPluginManifest(pluginManifestPath, fullPath);
            if (plugin) {
              discovered.push(plugin);
            }
          } catch {
            if (this.discoveryOptions.includePackageJson) {
              try {
                await fs.access(packageJsonPath);
                const plugin = await this.loadPluginFromPackageJson(packageJsonPath, fullPath);
                if (plugin) {
                  discovered.push(plugin);
                }
              } catch {
                // Continue searching in subdirectories
                const subPlugins = await this.discoverPluginsInPath(fullPath, depth + 1);
                discovered.push(...subPlugins);
              }
            }
          }
        }
      }
    } catch (error) {
      console.warn(`Error reading directory '${searchPath}':`, error);
    }

    return discovered;
  }

  private async loadPluginManifest(manifestPath: string, pluginPath: string): Promise<DiscoveredPlugin | null> {
    try {
      const manifestContent = await fs.readFile(manifestPath, 'utf-8');
      const manifest = JSON.parse(manifestContent) as PluginManifest;

      const validation = this.validatePluginManifest(manifest);
      
      return {
        manifest,
        pluginPath,
        manifestPath,
        isValid: validation.valid,
        errors: validation.errors
      };
    } catch (error) {
      return {
        manifest: {} as PluginManifest,
        pluginPath,
        manifestPath,
        isValid: false,
        errors: [`Failed to load plugin manifest: ${error instanceof Error ? error.message : String(error)}`]
      };
    }
  }

  private async loadPluginFromPackageJson(packageJsonPath: string, pluginPath: string): Promise<DiscoveredPlugin | null> {
    try {
      const packageContent = await fs.readFile(packageJsonPath, 'utf-8');
      const packageJson = JSON.parse(packageContent);

      if (packageJson.keywords?.includes('ghccli-plugin') || packageJson.ghccliPlugin) {
        const pluginConfig = packageJson.ghccliPlugin || {};
        
        const manifest: PluginManifest = {
          name: packageJson.name,
          version: packageJson.version,
          main: pluginConfig.main || packageJson.main || 'index.js',
          stepTypes: pluginConfig.stepTypes || [],
          description: packageJson.description,
          author: packageJson.author,
          license: packageJson.license,
          keywords: packageJson.keywords,
          engines: packageJson.engines,
          dependencies: packageJson.dependencies,
          config: pluginConfig.config
        };

        const validation = this.validatePluginManifest(manifest);

        return {
          manifest,
          pluginPath,
          manifestPath: packageJsonPath,
          isValid: validation.valid,
          errors: validation.errors
        };
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  private validatePluginManifest(manifest: PluginManifest): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!manifest.name || typeof manifest.name !== 'string') {
      errors.push('Plugin manifest must include a valid name');
    }

    if (!manifest.version || typeof manifest.version !== 'string') {
      errors.push('Plugin manifest must include a valid version');
    }

    if (!manifest.main || typeof manifest.main !== 'string') {
      errors.push('Plugin manifest must specify a main entry point');
    }

    if (!manifest.stepTypes || !Array.isArray(manifest.stepTypes) || manifest.stepTypes.length === 0) {
      errors.push('Plugin must declare at least one supported step type');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  async loadPlugin(discoveredPlugin: DiscoveredPlugin): Promise<PluginRegistrationResult> {
    if (!discoveredPlugin.isValid) {
      return {
        success: false,
        errors: discoveredPlugin.errors,
        warnings: []
      };
    }

    try {
      const pluginModulePath = path.resolve(discoveredPlugin.pluginPath, discoveredPlugin.manifest.main);
      
      let pluginModule: any;
      try {
        pluginModule = await import(pluginModulePath);
      } catch (importError) {
        if (path.extname(pluginModulePath) === '.ts') {
          const jsPath = pluginModulePath.replace('.ts', '.js');
          try {
            pluginModule = await import(jsPath);
          } catch {
            throw importError;
          }
        } else {
          throw importError;
        }
      }

      let plugin: StepTypePlugin;

      if (pluginModule.default && typeof pluginModule.default === 'function') {
        plugin = new pluginModule.default();
      } else if (pluginModule.createPlugin && typeof pluginModule.createPlugin === 'function') {
        plugin = await pluginModule.createPlugin(discoveredPlugin.manifest.config);
      } else if (pluginModule.plugin && pluginModule.plugin instanceof StepTypePlugin) {
        plugin = pluginModule.plugin;
      } else {
        return {
          success: false,
          errors: [`Plugin '${discoveredPlugin.manifest.name}' does not export a valid plugin class or factory`],
          warnings: []
        };
      }

      const pluginConfig: StepTypePluginConfig = {
        ...this.loadOptions.defaultConfig,
        ...discoveredPlugin.manifest.config,
        enabled: true
      };

      if (pluginConfig) {
        plugin.getConfig().enabled = pluginConfig.enabled ?? true;
        plugin.getConfig().sandboxed = pluginConfig.sandboxed ?? this.loadOptions.sandbox;
      }

      return await this.registry.registerPlugin(plugin);

    } catch (error) {
      return {
        success: false,
        errors: [`Failed to load plugin '${discoveredPlugin.manifest.name}': ${error instanceof Error ? error.message : String(error)}`],
        warnings: []
      };
    }
  }

  async loadAllDiscoveredPlugins(): Promise<{
    loaded: number;
    failed: number;
    results: PluginRegistrationResult[];
  }> {
    const discovered = await this.discoverPlugins();
    const results: PluginRegistrationResult[] = [];
    let loaded = 0;
    let failed = 0;

    for (const plugin of discovered) {
      const result = await this.loadPlugin(plugin);
      results.push(result);
      
      if (result.success) {
        loaded++;
      } else {
        failed++;
      }
    }

    return { loaded, failed, results };
  }

  async loadPluginFromPath(pluginPath: string): Promise<PluginRegistrationResult> {
    const manifestPath = path.join(pluginPath, 'ghccli-plugin.json');
    const packageJsonPath = path.join(pluginPath, 'package.json');

    let discovered: DiscoveredPlugin | null = null;

    try {
      await fs.access(manifestPath);
      discovered = await this.loadPluginManifest(manifestPath, pluginPath);
    } catch {
      try {
        await fs.access(packageJsonPath);
        discovered = await this.loadPluginFromPackageJson(packageJsonPath, pluginPath);
      } catch {
        return {
          success: false,
          errors: [`No valid plugin manifest found in '${pluginPath}'`],
          warnings: []
        };
      }
    }

    if (!discovered) {
      return {
        success: false,
        errors: [`Failed to load plugin from '${pluginPath}'`],
        warnings: []
      };
    }

    return await this.loadPlugin(discovered);
  }

  getDiscoveryOptions(): PluginDiscoveryOptions {
    return { ...this.discoveryOptions };
  }

  getLoadOptions(): PluginLoadOptions {
    return { ...this.loadOptions };
  }
}