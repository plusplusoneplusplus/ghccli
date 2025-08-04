/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import { PluginSandbox, ResourceLimits } from './StepTypePlugin.js';

export interface SandboxOptions {
  enableResourceLimits?: boolean;
  enableNetworkRestrictions?: boolean;
  enableFileSystemRestrictions?: boolean;
  defaultTimeout?: number;
  allowedModules?: string[];
  blockedModules?: string[];
}

export class BasicPluginSandbox implements PluginSandbox {
  private options: SandboxOptions;
  private activeExecutions: Set<Promise<any>>;

  constructor(options: SandboxOptions = {}) {
    this.options = {
      enableResourceLimits: true,
      enableNetworkRestrictions: true,
      enableFileSystemRestrictions: true,
      defaultTimeout: 30000,
      allowedModules: ['path', 'util', 'crypto'],
      blockedModules: ['fs', 'child_process', 'cluster', 'os', 'process'],
      ...options
    };
    this.activeExecutions = new Set();
  }

  async executeInSandbox<T>(fn: () => Promise<T>, limits?: ResourceLimits): Promise<T> {
    const timeout = limits?.timeout || this.options.defaultTimeout || 30000;
    const executionPromise = this.createSandboxedExecution(fn, limits);
    
    this.activeExecutions.add(executionPromise);
    
    try {
      const result = await Promise.race([
        executionPromise,
        this.createTimeoutPromise<T>(timeout)
      ]);
      
      return result;
    } finally {
      this.activeExecutions.delete(executionPromise);
    }
  }

  private async createSandboxedExecution<T>(fn: () => Promise<T>, limits?: ResourceLimits): Promise<T> {
    const originalConsole = global.console;
    const originalProcess = global.process;
    const originalRequire = global.require;

    try {
      if (this.options.enableResourceLimits && limits) {
        this.applyResourceLimits(limits);
      }

      if (this.options.enableNetworkRestrictions) {
        this.restrictNetworkAccess();
      }

      if (this.options.enableFileSystemRestrictions) {
        this.restrictFileSystemAccess(limits?.fileSystemAccess);
      }

      global.console = this.createRestrictedConsole(originalConsole);
      
      if (this.options.blockedModules || this.options.allowedModules) {
        global.require = this.createRestrictedRequire.call(this, originalRequire);
      }

      return await fn();

    } finally {
      global.console = originalConsole;
      global.process = originalProcess;
      global.require = originalRequire;
    }
  }

  private createTimeoutPromise<T>(timeout: number): Promise<T> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Plugin execution timed out after ${timeout}ms`));
      }, timeout);
    });
  }

  private applyResourceLimits(limits: ResourceLimits): void {
    if (limits.memory && process.memoryUsage) {
      const initialMemory = process.memoryUsage().heapUsed;
      const maxMemory = limits.memory * 1024 * 1024; // Convert MB to bytes
      
      const checkMemory = () => {
        const currentMemory = process.memoryUsage().heapUsed;
        if (currentMemory - initialMemory > maxMemory) {
          throw new Error(`Plugin exceeded memory limit of ${limits.memory}MB`);
        }
      };
      
      const intervalId = setInterval(checkMemory, 1000);
      setTimeout(() => clearInterval(intervalId), limits.timeout || 30000);
    }
  }

  private restrictNetworkAccess(): void {
    const restrictedMessage = 'Network access is restricted in plugin sandbox';
    
    if (typeof global !== 'undefined') {
      (global as any).fetch = () => Promise.reject(new Error(restrictedMessage));
      (global as any).XMLHttpRequest = function() {
        throw new Error(restrictedMessage);
      };
    }
  }

  private restrictFileSystemAccess(fileSystemAccess?: { read?: string[]; write?: string[] }): void {
    const originalRequire = global.require;
    
    if (originalRequire) {
      global.require = function(id: string) {
        if (id === 'fs' || id === 'fs/promises' || id === 'node:fs' || id === 'node:fs/promises') {
          if (!fileSystemAccess) {
            throw new Error('File system access is restricted in plugin sandbox');
          }
          
          const fs = originalRequire(id);
          return createRestrictedFs(fs, fileSystemAccess);
        }
        
        return originalRequire(id);
      } as NodeRequire;
    }
  }

  private createRestrictedConsole(originalConsole: Console): Console {
    const restrictedConsole = Object.create(originalConsole);
    
    restrictedConsole.log = (...args: any[]) => {
      originalConsole.log('[PLUGIN]', ...args);
    };
    
    restrictedConsole.warn = (...args: any[]) => {
      originalConsole.warn('[PLUGIN WARNING]', ...args);
    };
    
    restrictedConsole.error = (...args: any[]) => {
      originalConsole.error('[PLUGIN ERROR]', ...args);
    };
    
    restrictedConsole.debug = () => {}; // Disable debug output
    restrictedConsole.trace = () => {}; // Disable trace output
    
    return restrictedConsole;
  }

  private createRestrictedRequire(originalRequire: NodeRequire): NodeRequire {
    const self = this;
    return function(id: string) {
      const { allowedModules = [], blockedModules = [] } = self.options;
      
      if (blockedModules.includes(id)) {
        throw new Error(`Module '${id}' is blocked in plugin sandbox`);
      }
      
      if (allowedModules.length > 0 && !allowedModules.includes(id) && !id.startsWith('./') && !id.startsWith('../')) {
        throw new Error(`Module '${id}' is not allowed in plugin sandbox`);
      }
      
      return originalRequire(id);
    } as NodeRequire;
  }

  validateAccess(resource: string, operation: string): boolean {
    if (resource === 'network' && this.options.enableNetworkRestrictions) {
      return false;
    }
    
    if (resource === 'filesystem' && this.options.enableFileSystemRestrictions) {
      return operation === 'read'; // Allow read operations by default
    }
    
    if (resource.startsWith('module:')) {
      const moduleName = resource.substring(7);
      const { allowedModules = [], blockedModules = [] } = this.options;
      
      if (blockedModules.includes(moduleName)) {
        return false;
      }
      
      if (allowedModules.length > 0 && !allowedModules.includes(moduleName)) {
        return false;
      }
    }
    
    return true;
  }

  async terminate(): Promise<void> {
    // Wait for all active executions to complete or timeout
    const terminationPromises = Array.from(this.activeExecutions).map(execution =>
      Promise.race([
        execution,
        new Promise(resolve => setTimeout(resolve, 5000)) // 5 second grace period
      ]).catch(() => {}) // Ignore errors during termination
    );
    
    await Promise.all(terminationPromises);
    this.activeExecutions.clear();
  }
}

function createRestrictedFs(fs: any, access: { read?: string[]; write?: string[] }) {
  const restrictedFs = Object.create(fs);
  
  const checkPath = (filePath: string, operation: 'read' | 'write') => {
    const allowedPaths = access[operation] || [];
    const isAllowed = allowedPaths.some(allowedPath => 
      filePath.startsWith(allowedPath) || filePath === allowedPath
    );
    
    if (!isAllowed) {
      throw new Error(`${operation} access to '${filePath}' is not allowed in plugin sandbox`);
    }
  };
  
  const wrapFsMethod = (methodName: string, operation: 'read' | 'write') => {
    const originalMethod = fs[methodName];
    if (typeof originalMethod === 'function') {
      restrictedFs[methodName] = function(filePath: string, ...args: any[]) {
        checkPath(filePath, operation);
        return originalMethod.call(fs, filePath, ...args);
      };
    }
  };
  
  // Wrap read methods
  ['readFile', 'readFileSync', 'readdir', 'readdirSync', 'stat', 'statSync', 'access', 'accessSync'].forEach(method => {
    wrapFsMethod(method, 'read');
  });
  
  // Wrap write methods
  ['writeFile', 'writeFileSync', 'appendFile', 'appendFileSync', 'mkdir', 'mkdirSync', 'rmdir', 'rmdirSync', 'unlink', 'unlinkSync'].forEach(method => {
    wrapFsMethod(method, 'write');
  });
  
  return restrictedFs;
}

export function createPluginSandbox(options?: SandboxOptions): PluginSandbox {
  return new BasicPluginSandbox(options);
}