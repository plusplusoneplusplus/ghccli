/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { BuiltinFunctions } from './BuiltinFunctions.js';
import { WorkflowContext } from './WorkflowContext.js';
import { writeFileSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';

describe('BuiltinFunctions', () => {
  let functions: BuiltinFunctions;
  let context: WorkflowContext;
  const testFilePath = join(process.cwd(), 'test-file.txt');
  const testJsonPath = join(process.cwd(), 'test-data.json');

  beforeEach(() => {
    functions = new BuiltinFunctions();
    context = new WorkflowContext('test-workflow');
    
    // Clean up test files
    if (existsSync(testFilePath)) unlinkSync(testFilePath);
    if (existsSync(testJsonPath)) unlinkSync(testJsonPath);
  });

  afterEach(() => {
    // Clean up test files
    if (existsSync(testFilePath)) unlinkSync(testFilePath);
    if (existsSync(testJsonPath)) unlinkSync(testJsonPath);
  });

  describe('Date and time functions', () => {
    test('now() should return current timestamp', () => {
      const result = functions.callFunction('now', [], context);
      expect(typeof result).toBe('string');
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    test('date() should return formatted date', () => {
      const result = functions.callFunction('date', [], context);
      expect(typeof result).toBe('string');
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    test('time() should return formatted time', () => {
      const result = functions.callFunction('time', [], context);
      expect(typeof result).toBe('string');
      expect(result).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    });

    test('timestamp() should return numeric timestamp', () => {
      const result = functions.callFunction('timestamp', [], context);
      expect(typeof result).toBe('number');
      expect(result).toBeGreaterThan(0);
    });

    test('formatDate() should format date with custom format', () => {
      const result = functions.callFunction('formatDate', ['2023-12-25T10:30:45Z', 'DD/MM/YYYY'], context);
      expect(result).toBe('25/12/2023');
    });

    test('addDays() should add days to date', () => {
      const result = functions.callFunction('addDays', ['2023-12-25T00:00:00Z', 5], context);
      expect(typeof result).toBe('string');
      expect(result).toMatch(/2023-12-30/);
    });

    test('addHours() should add hours to date', () => {
      const result = functions.callFunction('addHours', ['2023-12-25T10:00:00Z', 2], context);
      expect(typeof result).toBe('string');
      expect(result).toMatch(/2023-12-25T12:00:00/);
    });

    test('should handle invalid dates', () => {
      expect(() => functions.callFunction('formatDate', ['invalid-date'], context))
        .toThrow('Invalid date');
    });
  });

  describe('Environment functions', () => {
    test('env() should get environment variable', () => {
      process.env.TEST_VAR = 'test-value';
      const result = functions.callFunction('env', ['TEST_VAR'], context);
      expect(result).toBe('test-value');
      delete process.env.TEST_VAR;
    });

    test('hasEnv() should check environment variable existence', () => {
      process.env.TEST_VAR = 'test-value';
      const result = functions.callFunction('hasEnv', ['TEST_VAR'], context);
      expect(result).toBe(true);
      
      const result2 = functions.callFunction('hasEnv', ['NON_EXISTENT_VAR'], context);
      expect(result2).toBe(false);
      delete process.env.TEST_VAR;
    });

    test('envDefault() should return default for missing var', () => {
      const result = functions.callFunction('envDefault', ['NON_EXISTENT_VAR', 'default-value'], context);
      expect(result).toBe('default-value');
    });
  });

  describe('File system functions', () => {
    test('fileExists() should check file existence', () => {
      expect(functions.callFunction('fileExists', [testFilePath], context)).toBe(false);
      
      writeFileSync(testFilePath, 'test content');
      expect(functions.callFunction('fileExists', [testFilePath], context)).toBe(true);
    });

    test('readFile() should read file content', () => {
      writeFileSync(testFilePath, 'test content');
      const result = functions.callFunction('readFile', [testFilePath], context);
      expect(result).toBe('test content');
    });

    test('readJson() should parse JSON file', () => {
      const testData = { name: 'test', value: 42 };
      writeFileSync(testJsonPath, JSON.stringify(testData));
      
      const result = functions.callFunction('readJson', [testJsonPath], context);
      expect(result).toEqual(testData);
    });

    test('fileSize() should return file size', () => {
      const content = 'test content';
      writeFileSync(testFilePath, content);
      
      const result = functions.callFunction('fileSize', [testFilePath], context);
      expect(result).toBe(content.length);
    });

    test('fileName() should extract filename', () => {
      const result = functions.callFunction('fileName', ['/path/to/file.txt'], context);
      expect(result).toBe('file.txt');
    });

    test('fileExt() should extract extension', () => {
      const result = functions.callFunction('fileExt', ['/path/to/file.txt'], context);
      expect(result).toBe('.txt');
    });

    test('filePath() should extract directory', () => {
      const result = functions.callFunction('filePath', ['/path/to/file.txt'], context);
      expect(result).toBe('/path/to');
    });

    test('joinPath() should join paths', () => {
      const result = functions.callFunction('joinPath', ['path', 'to', 'file.txt'], context);
      expect(result).toBe(join('path', 'to', 'file.txt'));
    });

    test('should handle file errors gracefully', () => {
      expect(() => functions.callFunction('readFile', ['/non/existent/file.txt'], context))
        .toThrow();
    });
  });

  describe('String manipulation functions', () => {
    test('upper() should convert to uppercase', () => {
      const result = functions.callFunction('upper', ['hello world'], context);
      expect(result).toBe('HELLO WORLD');
    });

    test('lower() should convert to lowercase', () => {
      const result = functions.callFunction('lower', ['HELLO WORLD'], context);
      expect(result).toBe('hello world');
    });

    test('trim() should remove whitespace', () => {
      const result = functions.callFunction('trim', ['  hello world  '], context);
      expect(result).toBe('hello world');
    });

    test('replace() should replace text', () => {
      const result = functions.callFunction('replace', ['hello world', 'world', 'universe'], context);
      expect(result).toBe('hello universe');
    });

    test('substring() should extract substring', () => {
      const result = functions.callFunction('substring', ['hello world', 6, 11], context);
      expect(result).toBe('world');
    });

    test('length() should return string length', () => {
      const result = functions.callFunction('length', ['hello'], context);
      expect(result).toBe(5);
    });

    test('split() should split string', () => {
      const result = functions.callFunction('split', ['a,b,c', ','], context);
      expect(result).toEqual(['a', 'b', 'c']);
    });

    test('join() should join array', () => {
      const result = functions.callFunction('join', [['a', 'b', 'c'], '-'], context);
      expect(result).toBe('a-b-c');
    });

    test('startsWith() should check prefix', () => {
      const result = functions.callFunction('startsWith', ['hello world', 'hello'], context);
      expect(result).toBe(true);
    });

    test('endsWith() should check suffix', () => {
      const result = functions.callFunction('endsWith', ['hello world', 'world'], context);
      expect(result).toBe(true);
    });

    test('contains() should check substring', () => {
      const result = functions.callFunction('contains', ['hello world', 'lo wo'], context);
      expect(result).toBe(true);
    });
  });

  describe('Array functions', () => {
    test('first() should return first element', () => {
      const result = functions.callFunction('first', [['a', 'b', 'c']], context);
      expect(result).toBe('a');
    });

    test('last() should return last element', () => {
      const result = functions.callFunction('last', [['a', 'b', 'c']], context);
      expect(result).toBe('c');
    });

    test('at() should return element at index', () => {
      const result = functions.callFunction('at', [['a', 'b', 'c'], 1], context);
      expect(result).toBe('b');
    });

    test('slice() should slice array', () => {
      const result = functions.callFunction('slice', [['a', 'b', 'c', 'd'], 1, 3], context);
      expect(result).toEqual(['b', 'c']);
    });

    test('length() should return array length', () => {
      const result = functions.callFunction('length', [['a', 'b', 'c']], context);
      expect(result).toBe(3);
    });

    test('should handle non-array inputs', () => {
      expect(() => functions.callFunction('first', ['not-array'], context))
        .toThrow('First function requires array input');
    });
  });

  describe('Math functions', () => {
    test('add() should add numbers', () => {
      const result = functions.callFunction('add', [10, 5], context);
      expect(result).toBe(15);
    });

    test('subtract() should subtract numbers', () => {
      const result = functions.callFunction('subtract', [10, 3], context);
      expect(result).toBe(7);
    });

    test('multiply() should multiply numbers', () => {
      const result = functions.callFunction('multiply', [6, 7], context);
      expect(result).toBe(42);
    });

    test('divide() should divide numbers', () => {
      const result = functions.callFunction('divide', [15, 3], context);
      expect(result).toBe(5);
    });

    test('divide() should handle division by zero', () => {
      expect(() => functions.callFunction('divide', [10, 0], context))
        .toThrow('Division by zero');
    });

    test('round() should round numbers', () => {
      const result = functions.callFunction('round', [3.7], context);
      expect(result).toBe(4);
    });

    test('round() should round with decimals', () => {
      const result = functions.callFunction('round', [3.14159, 2], context);
      expect(result).toBe(3.14);
    });

    test('floor() should floor numbers', () => {
      const result = functions.callFunction('floor', [3.7], context);
      expect(result).toBe(3);
    });

    test('ceil() should ceil numbers', () => {
      const result = functions.callFunction('ceil', [3.2], context);
      expect(result).toBe(4);
    });

    test('random() should generate random numbers', () => {
      const result = functions.callFunction('random', [], context) as number;
      expect(typeof result).toBe('number');
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThan(1);
    });

    test('random() should generate random numbers in range', () => {
      const result = functions.callFunction('random', [5, 10], context) as number;
      expect(typeof result).toBe('number');
      expect(result).toBeGreaterThanOrEqual(5);
      expect(result).toBeLessThan(10);
    });
  });

  describe('Utility functions', () => {
    test('default() should return value or default', () => {
      const result1 = functions.callFunction('default', ['value', 'default'], context);
      expect(result1).toBe('value');
      
      const result2 = functions.callFunction('default', [null, 'default'], context);
      expect(result2).toBe('default');
      
      const result3 = functions.callFunction('default', [undefined, 'default'], context);
      expect(result3).toBe('default');
    });

    test('empty() should check if value is empty', () => {
      expect(functions.callFunction('empty', [''], context)).toBe(true);
      expect(functions.callFunction('empty', [null], context)).toBe(true);
      expect(functions.callFunction('empty', [undefined], context)).toBe(true);
      expect(functions.callFunction('empty', [[]], context)).toBe(true);
      expect(functions.callFunction('empty', [{}], context)).toBe(true);
      expect(functions.callFunction('empty', ['hello'], context)).toBe(false);
      expect(functions.callFunction('empty', [[1, 2]], context)).toBe(false);
    });

    test('notEmpty() should check if value is not empty', () => {
      expect(functions.callFunction('notEmpty', ['hello'], context)).toBe(true);
      expect(functions.callFunction('notEmpty', [''], context)).toBe(false);
    });

    test('toNumber() should convert to number', () => {
      expect(functions.callFunction('toNumber', ['42'], context)).toBe(42);
      expect(functions.callFunction('toNumber', ['3.14'], context)).toBe(3.14);
      expect(() => functions.callFunction('toNumber', ['not-a-number'], context))
        .toThrow('Cannot convert');
    });

    test('toString() should convert to string', () => {
      expect(functions.callFunction('toString', [42], context)).toBe('42');
      expect(functions.callFunction('toString', [true], context)).toBe('true');
    });

    test('toBoolean() should convert to boolean', () => {
      expect(functions.callFunction('toBoolean', ['true'], context)).toBe(true);
      expect(functions.callFunction('toBoolean', ['false'], context)).toBe(false);
      expect(functions.callFunction('toBoolean', [1], context)).toBe(true);
      expect(functions.callFunction('toBoolean', [0], context)).toBe(false);
    });

    test('toJson() should convert to JSON', () => {
      const obj = { name: 'test', value: 42 };
      const result = functions.callFunction('toJson', [obj], context);
      expect(result).toBe('{"name":"test","value":42}');
    });

    test('fromJson() should parse JSON', () => {
      const result = functions.callFunction('fromJson', ['{"name":"test","value":42}'], context);
      expect(result).toEqual({ name: 'test', value: 42 });
    });

    test('fromJson() should handle invalid JSON', () => {
      expect(() => functions.callFunction('fromJson', ['{invalid json}'], context))
        .toThrow('Invalid JSON');
    });
  });

  describe('Function registry', () => {
    test('hasFunction() should check function existence', () => {
      expect(functions.hasFunction('upper')).toBe(true);
      expect(functions.hasFunction('nonexistent')).toBe(false);
    });

    test('callFunction() should throw for unknown functions', () => {
      expect(() => functions.callFunction('nonexistent', [], context))
        .toThrow('Unknown function: nonexistent');
    });
  });

  describe('Error handling', () => {
    test('should wrap function errors', () => {
      expect(() => functions.callFunction('divide', [10, 0], context))
        .toThrow('Function divide failed: Division by zero');
    });
  });
});