/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import { getOauthClient, resetOauthClientForTesting } from './oauth2.js';
import { OAuth2Client } from 'google-auth-library';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { AuthType } from '../core/contentGenerator.js';
import { Config } from '../config/config.js';

vi.mock('os', async (importOriginal) => {
  const os = await importOriginal<typeof import('os')>();
  return {
    ...os,
    homedir: vi.fn(),
  };
});

vi.mock('google-auth-library');
vi.mock('http');
vi.mock('open');
vi.mock('crypto');
vi.mock('node:readline');
vi.mock('../utils/browser.js', () => ({
  shouldAttemptBrowserLaunch: () => true,
}));

const mockConfig = {
  getNoBrowser: () => false,
  getProxy: () => 'http://test.proxy.com:8080',
  isBrowserLaunchSuppressed: () => false,
} as unknown as Config;

// Mock fetch globally
global.fetch = vi.fn();

describe('oauth2', () => {
  let tempHomeDir: string;

  beforeEach(() => {
    tempHomeDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'gemini-cli-test-home-'),
    );
    (os.homedir as Mock).mockReturnValue(tempHomeDir);
  });
  afterEach(() => {
    fs.rmSync(tempHomeDir, { recursive: true, force: true });
    vi.clearAllMocks();
    resetOauthClientForTesting();
    vi.unstubAllEnvs();
  });

  // These tests are disabled because LOGIN_WITH_GOOGLE auth method has been disabled

  describe('disabled authentication methods', () => {
    it('should throw error for LOGIN_WITH_GOOGLE', async () => {
      await expect(
        getOauthClient(AuthType.LOGIN_WITH_GOOGLE, mockConfig),
      ).rejects.toThrow(
        'LOGIN_WITH_GOOGLE and CLOUD_SHELL authentication methods have been disabled for privacy reasons',
      );
    });

    it('should throw error for CLOUD_SHELL', async () => {
      await expect(
        getOauthClient(AuthType.CLOUD_SHELL, mockConfig),
      ).rejects.toThrow(
        'LOGIN_WITH_GOOGLE and CLOUD_SHELL authentication methods have been disabled for privacy reasons',
      );
    });
  });

  describe('with GCP environment variables', () => {
    it('should use GOOGLE_CLOUD_ACCESS_TOKEN when GOOGLE_GENAI_USE_GCA is true', async () => {
      vi.stubEnv('GOOGLE_GENAI_USE_GCA', 'true');
      vi.stubEnv('GOOGLE_CLOUD_ACCESS_TOKEN', 'gcp-access-token');

      const mockSetCredentials = vi.fn();
      const mockGetAccessToken = vi
        .fn()
        .mockResolvedValue({ token: 'gcp-access-token' });
      const mockOAuth2Client = {
        setCredentials: mockSetCredentials,
        getAccessToken: mockGetAccessToken,
        on: vi.fn(),
      } as unknown as OAuth2Client;
      (OAuth2Client as unknown as Mock).mockImplementation(
        () => mockOAuth2Client,
      );

      // Mock the UserInfo API response for fetchAndCacheUserInfo
      (global.fetch as Mock).mockResolvedValue({
        ok: true,
        json: vi
          .fn()
          .mockResolvedValue({ email: 'test-gcp-account@gmail.com' }),
      } as unknown as Response);

      const client = await getOauthClient(
        AuthType.LOGIN_WITH_GOOGLE,
        mockConfig,
      );

      expect(client).toBe(mockOAuth2Client);
      expect(mockSetCredentials).toHaveBeenCalledWith({
        access_token: 'gcp-access-token',
      });

      // Verify fetchAndCacheUserInfo was effectively called
      expect(mockGetAccessToken).toHaveBeenCalled();
      expect(global.fetch).toHaveBeenCalledWith(
        'https://www.googleapis.com/oauth2/v2/userinfo',
        {
          headers: {
            Authorization: 'Bearer gcp-access-token',
          },
        },
      );

      // Verify Google Account was cached
      const googleAccountPath = path.join(
        tempHomeDir,
        '.gemini',
        'google_accounts.json',
      );
      const cachedContent = fs.readFileSync(googleAccountPath, 'utf-8');
      expect(JSON.parse(cachedContent)).toEqual({
        active: 'test-gcp-account@gmail.com',
        old: [],
      });
    });

    it('should not use GCP token if GOOGLE_CLOUD_ACCESS_TOKEN is not set', async () => {
      vi.stubEnv('GOOGLE_GENAI_USE_GCA', 'true');

      const mockSetCredentials = vi.fn();
      const mockGetAccessToken = vi
        .fn()
        .mockResolvedValue({ token: 'cached-access-token' });
      const mockGetTokenInfo = vi.fn().mockResolvedValue({});
      const mockOAuth2Client = {
        setCredentials: mockSetCredentials,
        getAccessToken: mockGetAccessToken,
        getTokenInfo: mockGetTokenInfo,
        on: vi.fn(),
      } as unknown as OAuth2Client;
      (OAuth2Client as unknown as Mock).mockImplementation(
        () => mockOAuth2Client,
      );

      // Make it fall through to cached credentials path
      const cachedCreds = { refresh_token: 'cached-token' };
      const credsPath = path.join(tempHomeDir, '.gemini', 'oauth_creds.json');
      await fs.promises.mkdir(path.dirname(credsPath), { recursive: true });
      await fs.promises.writeFile(credsPath, JSON.stringify(cachedCreds));

      await getOauthClient(AuthType.LOGIN_WITH_GOOGLE, mockConfig);

      // It should be called with the cached credentials, not the GCP access token.
      expect(mockSetCredentials).toHaveBeenCalledTimes(1);
      expect(mockSetCredentials).toHaveBeenCalledWith(cachedCreds);
    });

    it('should not use GCP token if GOOGLE_GENAI_USE_GCA is not set', async () => {
      vi.stubEnv('GOOGLE_CLOUD_ACCESS_TOKEN', 'gcp-access-token');

      const mockSetCredentials = vi.fn();
      const mockGetAccessToken = vi
        .fn()
        .mockResolvedValue({ token: 'cached-access-token' });
      const mockGetTokenInfo = vi.fn().mockResolvedValue({});
      const mockOAuth2Client = {
        setCredentials: mockSetCredentials,
        getAccessToken: mockGetAccessToken,
        getTokenInfo: mockGetTokenInfo,
        on: vi.fn(),
      } as unknown as OAuth2Client;
      (OAuth2Client as unknown as Mock).mockImplementation(
        () => mockOAuth2Client,
      );

      // Make it fall through to cached credentials path
      const cachedCreds = { refresh_token: 'cached-token' };
      const credsPath = path.join(tempHomeDir, '.gemini', 'oauth_creds.json');
      await fs.promises.mkdir(path.dirname(credsPath), { recursive: true });
      await fs.promises.writeFile(credsPath, JSON.stringify(cachedCreds));

      await getOauthClient(AuthType.LOGIN_WITH_GOOGLE, mockConfig);

      // It should be called with the cached credentials, not the GCP access token.
      expect(mockSetCredentials).toHaveBeenCalledTimes(1);
      expect(mockSetCredentials).toHaveBeenCalledWith(cachedCreds);
    });
  });
});
