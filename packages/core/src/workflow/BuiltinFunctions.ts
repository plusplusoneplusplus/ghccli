/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync, existsSync, statSync } from 'fs';
import { resolve, dirname, basename, extname, join } from 'path';
import { WorkflowContext } from './WorkflowContext.js';

/**
 * Built-in functions available for variable interpolation
 * Functions include date/time, environment, file operations, string manipulation, etc.
 */
export class BuiltinFunctions {
  private functions: Map<string, Function>;
  private currentContext?: WorkflowContext;
  
  constructor() {
    this.functions = new Map();
    this.registerBuiltinFunctions();
  }
  
  /**
   * Check if a function exists
   */
  hasFunction(name: string): boolean {
    return this.functions.has(name);
  }
  
  /**
   * Call a function with arguments
   */
  callFunction(name: string, args: unknown[], context: WorkflowContext): unknown {
    const func = this.functions.get(name);
    if (!func) {
      throw new Error(`Unknown function: ${name}`);
    }
    
    try {
      // Store context for functions that might need it
      this.currentContext = context;
      return func(...args);
    } catch (error) {
      throw new Error(`Function ${name} failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.currentContext = undefined;
    }
  }
  
  /**
   * Register all built-in functions
   */
  private registerBuiltinFunctions(): void {
    // Date and time functions
    this.functions.set('now', this.now);
    this.functions.set('date', this.date);
    this.functions.set('time', this.time);
    this.functions.set('timestamp', this.timestamp);
    this.functions.set('formatDate', this.formatDate);
    this.functions.set('addDays', this.addDays);
    this.functions.set('addHours', this.addHours);
    this.functions.set('addMinutes', this.addMinutes);
    
    // Environment functions
    this.functions.set('env', this.env);
    this.functions.set('hasEnv', this.hasEnv);
    this.functions.set('envDefault', this.envDefault);
    
    // File system functions
    this.functions.set('fileExists', this.fileExists);
    this.functions.set('readFile', this.readFile);
    this.functions.set('readJson', this.readJson);
    this.functions.set('fileSize', this.fileSize);
    this.functions.set('fileName', this.fileName);
    this.functions.set('fileExt', this.fileExt);
    this.functions.set('filePath', this.filePath);
    this.functions.set('joinPath', this.joinPath);
    
    // String manipulation functions
    this.functions.set('upper', this.upper);
    this.functions.set('lower', this.lower);
    this.functions.set('trim', this.trim);
    this.functions.set('replace', this.replace);
    this.functions.set('substring', this.substring);
    this.functions.set('length', this.length);
    this.functions.set('split', this.split);
    this.functions.set('join', this.joinStrings);
    this.functions.set('startsWith', this.startsWith);
    this.functions.set('endsWith', this.endsWith);
    this.functions.set('contains', this.contains);
    
    // Array functions
    this.functions.set('first', this.first);
    this.functions.set('last', this.last);
    this.functions.set('at', this.at);
    this.functions.set('slice', this.slice);
    this.functions.set('filter', this.filter);
    this.functions.set('map', this.map);
    
    // Math functions
    this.functions.set('add', this.add);
    this.functions.set('subtract', this.subtract);
    this.functions.set('multiply', this.multiply);
    this.functions.set('divide', this.divide);
    this.functions.set('round', this.round);
    this.functions.set('floor', this.floor);
    this.functions.set('ceil', this.ceil);
    this.functions.set('random', this.random);
    
    // Utility functions
    this.functions.set('default', this.defaultValue);
    this.functions.set('empty', this.empty);
    this.functions.set('notEmpty', this.notEmpty);
    this.functions.set('toNumber', this.toNumber);
    this.functions.set('toString', this.toString);
    this.functions.set('toBoolean', this.toBoolean);
    this.functions.set('toJson', this.toJson);
    this.functions.set('fromJson', this.fromJson);
  }
  
  // Date and time functions
  private now = (): string => new Date().toISOString();
  
  private date = (format?: string): string => {
    const now = new Date();
    return this.formatDateInternal(now, format || 'YYYY-MM-DD');
  };
  
  private time = (format?: string): string => {
    const now = new Date();
    return this.formatDateInternal(now, format || 'HH:mm:ss');
  };
  
  private timestamp = (): number => Date.now();
  
  private formatDate = (date: string | number, format?: string): string => {
    const d = new Date(date);
    if (isNaN(d.getTime())) {
      throw new Error(`Invalid date: ${date}`);
    }
    return this.formatDateInternal(d, format || 'YYYY-MM-DD');
  };
  
  private addDays = (date: string | number, days: number): string => {
    const d = new Date(date);
    if (isNaN(d.getTime())) {
      throw new Error(`Invalid date: ${date}`);
    }
    d.setDate(d.getDate() + days);
    return d.toISOString();
  };
  
  private addHours = (date: string | number, hours: number): string => {
    const d = new Date(date);
    if (isNaN(d.getTime())) {
      throw new Error(`Invalid date: ${date}`);
    }
    d.setHours(d.getHours() + hours);
    return d.toISOString();
  };
  
  private addMinutes = (date: string | number, minutes: number): string => {
    const d = new Date(date);
    if (isNaN(d.getTime())) {
      throw new Error(`Invalid date: ${date}`);
    }
    d.setMinutes(d.getMinutes() + minutes);
    return d.toISOString();
  };
  
  // Environment functions
  private env = (name: string): string | undefined => {
    return process.env[name];
  };
  
  private hasEnv = (name: string): boolean => {
    return name in process.env;
  };
  
  private envDefault = (name: string, defaultValue: string): string => {
    return process.env[name] || defaultValue;
  };
  
  // File system functions
  private fileExists = (path: string): boolean => {
    try {
      return existsSync(resolve(path));
    } catch {
      return false;
    }
  };
  
  private readFile = (path: string, encoding: string = 'utf8'): string => {
    try {
      return readFileSync(resolve(path), encoding as BufferEncoding);
    } catch (error) {
      throw new Error(`Failed to read file ${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  
  private readJson = (path: string): unknown => {
    try {
      const content = readFileSync(resolve(path), 'utf8');
      return JSON.parse(content);
    } catch (error) {
      throw new Error(`Failed to read JSON file ${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  
  private fileSize = (path: string): number => {
    try {
      const stats = statSync(resolve(path));
      return stats.size;
    } catch (error) {
      throw new Error(`Failed to get file size for ${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  
  private fileName = (path: string): string => {
    return basename(path);
  };
  
  private fileExt = (path: string): string => {
    return extname(path);
  };
  
  private filePath = (path: string): string => {
    return dirname(path);
  };
  
  private joinPath = (...paths: string[]): string => {
    return join(...paths);
  };
  
  // String manipulation functions
  private upper = (str: string): string => String(str).toUpperCase();
  
  private lower = (str: string): string => String(str).toLowerCase();
  
  private trim = (str: string): string => String(str).trim();
  
  private replace = (str: string, searchValue: string, replaceValue: string): string => {
    return String(str).replace(new RegExp(searchValue, 'g'), replaceValue);
  };
  
  private substring = (str: string, start: number, end?: number): string => {
    return String(str).substring(start, end);
  };
  
  private length = (value: string | unknown[]): number => {
    if (typeof value === 'string' || Array.isArray(value)) {
      return value.length;
    }
    throw new Error('Length function requires string or array input');
  };
  
  private split = (str: string, separator: string): string[] => {
    return String(str).split(separator);
  };
  
  private joinStrings = (arr: string[], separator: string = ''): string => {
    if (!Array.isArray(arr)) {
      throw new Error('Join function requires array input');
    }
    return arr.map(String).join(separator);
  };
  
  private startsWith = (str: string, prefix: string): boolean => {
    return String(str).startsWith(prefix);
  };
  
  private endsWith = (str: string, suffix: string): boolean => {
    return String(str).endsWith(suffix);
  };
  
  private contains = (str: string, searchValue: string): boolean => {
    return String(str).includes(searchValue);
  };
  
  // Array functions
  private first = (arr: unknown[]): unknown => {
    if (!Array.isArray(arr)) {
      throw new Error('First function requires array input');
    }
    return arr[0];
  };
  
  private last = (arr: unknown[]): unknown => {
    if (!Array.isArray(arr)) {
      throw new Error('Last function requires array input');
    }
    return arr[arr.length - 1];
  };
  
  private at = (arr: unknown[], index: number): unknown => {
    if (!Array.isArray(arr)) {
      throw new Error('At function requires array input');
    }
    return arr[index];
  };
  
  private slice = (arr: unknown[], start: number, end?: number): unknown[] => {
    if (!Array.isArray(arr)) {
      throw new Error('Slice function requires array input');
    }
    return arr.slice(start, end);
  };
  
  private filter = (arr: unknown[], predicate: string): unknown[] => {
    if (!Array.isArray(arr)) {
      throw new Error('Filter function requires array input');
    }
    // Simple filtering based on truthiness for now
    // Could be extended to support more complex predicates
    return arr.filter(item => !!item);
  };
  
  private map = (arr: unknown[], transform: string): unknown[] => {
    if (!Array.isArray(arr)) {
      throw new Error('Map function requires array input');
    }
    // Simple identity mapping for now
    // Could be extended to support transformation expressions
    return [...arr];
  };
  
  // Math functions
  private add = (a: number, b: number): number => Number(a) + Number(b);
  
  private subtract = (a: number, b: number): number => Number(a) - Number(b);
  
  private multiply = (a: number, b: number): number => Number(a) * Number(b);
  
  private divide = (a: number, b: number): number => {
    const divisor = Number(b);
    if (divisor === 0) {
      throw new Error('Division by zero');
    }
    return Number(a) / divisor;
  };
  
  private round = (num: number, decimals: number = 0): number => {
    const multiplier = Math.pow(10, decimals);
    return Math.round(Number(num) * multiplier) / multiplier;
  };
  
  private floor = (num: number): number => Math.floor(Number(num));
  
  private ceil = (num: number): number => Math.ceil(Number(num));
  
  private random = (min: number = 0, max: number = 1): number => {
    return Math.random() * (Number(max) - Number(min)) + Number(min);
  };
  
  // Utility functions
  private defaultValue = (value: unknown, defaultVal: unknown): unknown => {
    return value ?? defaultVal;
  };
  
  private empty = (value: unknown): boolean => {
    if (value === null || value === undefined) return true;
    if (typeof value === 'string') return value.length === 0;
    if (Array.isArray(value)) return value.length === 0;
    if (typeof value === 'object') return Object.keys(value).length === 0;
    return false;
  };
  
  private notEmpty = (value: unknown): boolean => {
    return !this.empty(value);
  };
  
  private toNumber = (value: unknown): number => {
    const num = Number(value);
    if (isNaN(num)) {
      throw new Error(`Cannot convert ${value} to number`);
    }
    return num;
  };
  
  private toString = (value: unknown): string => {
    return String(value);
  };
  
  private toBoolean = (value: unknown): boolean => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      return value.toLowerCase() === 'true';
    }
    return Boolean(value);
  };
  
  private toJson = (value: unknown): string => {
    try {
      return JSON.stringify(value);
    } catch (error) {
      throw new Error(`Cannot convert to JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  
  private fromJson = (jsonStr: string): unknown => {
    try {
      return JSON.parse(String(jsonStr));
    } catch (error) {
      throw new Error(`Invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  
  /**
   * Internal date formatting function
   */
  private formatDateInternal(date: Date, format: string): string {
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const hours = date.getHours();
    const minutes = date.getMinutes();
    const seconds = date.getSeconds();
    
    return format
      .replace('YYYY', year.toString())
      .replace('MM', month.toString().padStart(2, '0'))
      .replace('DD', day.toString().padStart(2, '0'))
      .replace('HH', hours.toString().padStart(2, '0'))
      .replace('mm', minutes.toString().padStart(2, '0'))
      .replace('ss', seconds.toString().padStart(2, '0'));
  }
}