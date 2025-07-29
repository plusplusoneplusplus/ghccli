/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

const TAVILY_TOKEN_FILE = path.join(os.homedir(), '.ghccli', '.tavily_token');

/**
 * Reads the Tavily API token from the cache file.
 * @returns The cached token or null if not found or error occurs
 */
export function getTavilyToken(): string | null {
  try {
    if (fs.existsSync(TAVILY_TOKEN_FILE)) {
      const token = fs.readFileSync(TAVILY_TOKEN_FILE, 'utf8').trim();
      return token || null;
    }
    return null;
  } catch (error) {
    console.error('Error reading Tavily token:', error);
    return null;
  }
}

/**
 * Saves the Tavily API token to the cache file.
 * @param token The token to cache
 * @returns True if successful, false otherwise
 */
export function setTavilyToken(token: string): boolean {
  try {
    const tokenDir = path.dirname(TAVILY_TOKEN_FILE);
    if (!fs.existsSync(tokenDir)) {
      fs.mkdirSync(tokenDir, { recursive: true });
    }
    fs.writeFileSync(TAVILY_TOKEN_FILE, token.trim(), 'utf8');
    // Set restrictive permissions (readable only by owner)
    fs.chmodSync(TAVILY_TOKEN_FILE, 0o600);
    return true;
  } catch (error) {
    console.error('Error saving Tavily token:', error);
    return false;
  }
}

/**
 * Clears the cached Tavily API token.
 * @returns True if successful or file doesn't exist, false on error
 */
export function clearTavilyToken(): boolean {
  try {
    if (fs.existsSync(TAVILY_TOKEN_FILE)) {
      fs.unlinkSync(TAVILY_TOKEN_FILE);
    }
    return true;
  } catch (error) {
    console.error('Error clearing Tavily token:', error);
    return false;
  }
}