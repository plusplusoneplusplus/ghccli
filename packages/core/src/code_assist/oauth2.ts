/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  OAuth2Client,
  Credentials,
  // CodeChallengeMethod, // unused
} from 'google-auth-library';
// import * as http from 'http'; // unused
// import * as url from 'url'; // unused
// import * as crypto from 'crypto'; // unused
import * as net from 'net';
import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import * as os from 'os';
import { Config } from '../config/config.js';
import {
  cacheGoogleAccount,
  getCachedGoogleAccount,
  clearCachedGoogleAccount,
} from '../utils/user_account.js';
import { AuthType } from '../core/contentGenerator.js';
// import * as readline from 'node:readline'; // unused

//  OAuth Client ID used to initiate OAuth2Client class.
const OAUTH_CLIENT_ID =
  '681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com';

// OAuth Secret value used to initiate OAuth2Client class.
// Note: It's ok to save this in git because this is an installed application
// as described here: https://developers.google.com/identity/protocols/oauth2#installed
// "The process results in a client ID and, in some cases, a client secret,
// which you embed in the source code of your application. (In this context,
// the client secret is obviously not treated as a secret.)"
const OAUTH_CLIENT_SECRET = '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';

// OAuth Scopes for Cloud Code authorization.
// const OAUTH_SCOPE = [ // unused
//   'https://www.googleapis.com/auth/cloud-platform',
//   'https://www.googleapis.com/auth/userinfo.email',
//   'https://www.googleapis.com/auth/userinfo.profile',
// ];

// const HTTP_REDIRECT = 301; // unused
// const SIGN_IN_SUCCESS_URL = // unused
//   'https://developers.google.com/gemini-code-assist/auth_success_gemini';
// const SIGN_IN_FAILURE_URL = // unused
//   'https://developers.google.com/gemini-code-assist/auth_failure_gemini';

const GEMINI_DIR = '.gemini';
const CREDENTIAL_FILENAME = 'oauth_creds.json';

/**
 * An Authentication URL for updating the credentials of a Oauth2Client
 * as well as a promise that will resolve when the credentials have
 * been refreshed (or which throws error when refreshing credentials failed).
 */
export interface OauthWebLogin {
  authUrl: string;
  loginCompletePromise: Promise<void>;
}

const oauthClientPromises = new Map<AuthType, Promise<OAuth2Client>>();

async function initOauthClient(
  authType: AuthType,
  config: Config,
): Promise<OAuth2Client> {
  // Check if the authentication type is disabled for privacy reasons
  if (
    authType === AuthType.LOGIN_WITH_GOOGLE ||
    authType === AuthType.CLOUD_SHELL
  ) {
    throw new Error('LOGIN_WITH_GOOGLE and CLOUD_SHELL authentication methods have been disabled for privacy reasons. Please use GEMINI_API_KEY, VERTEX_AI, GITHUB_COPILOT, or OPENAI instead.');
  }

  const client = new OAuth2Client({
    clientId: OAUTH_CLIENT_ID,
    clientSecret: OAUTH_CLIENT_SECRET,
    transporterOptions: {
      proxy: config.getProxy(),
    },
  });

  if (
    process.env['GOOGLE_GENAI_USE_GCA'] &&
    process.env['GOOGLE_CLOUD_ACCESS_TOKEN']
  ) {
    client.setCredentials({
      access_token: process.env['GOOGLE_CLOUD_ACCESS_TOKEN'],
    });
    await fetchAndCacheUserInfo(client);
    return client;
  }

  client.on('tokens', async (tokens: Credentials) => {
    await cacheCredentials(tokens);
  });

  // If there are cached creds on disk, they always take precedence
  if (await loadCachedCredentials(client)) {
    // Found valid cached credentials.
    // Check if we need to retrieve Google Account ID or Email
    if (!getCachedGoogleAccount()) {
      try {
        await fetchAndCacheUserInfo(client);
      } catch {
        // Non-fatal, continue with existing auth.
      }
    }
    console.log('Loaded cached credentials.');
    return client;
  }

  // Since LOGIN_WITH_GOOGLE and CLOUD_SHELL are disabled, 
  // we should never reach this point
  throw new Error('Unsupported authentication type reached in getOauthClient');
}

export async function getOauthClient(
  authType: AuthType,
  config: Config,
): Promise<OAuth2Client> {
  if (!oauthClientPromises.has(authType)) {
    oauthClientPromises.set(authType, initOauthClient(authType, config));
  }
  return oauthClientPromises.get(authType)!;
}

export function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    let port = 0;
    try {
      const portStr = process.env['OAUTH_CALLBACK_PORT'];
      if (portStr) {
        port = parseInt(portStr, 10);
        if (isNaN(port) || port <= 0 || port > 65535) {
          return reject(
            new Error(`Invalid value for OAUTH_CALLBACK_PORT: "${portStr}"`),
          );
        }
        return resolve(port);
      }
      const server = net.createServer();
      server.listen(0, () => {
        const address = server.address()! as net.AddressInfo;
        port = address.port;
      });
      server.on('listening', () => {
        server.close();
        server.unref();
      });
      server.on('error', (e) => reject(e));
      server.on('close', () => resolve(port));
    } catch (e) {
      reject(e);
    }
  });
}

async function loadCachedCredentials(client: OAuth2Client): Promise<boolean> {
  const pathsToTry = [
    getCachedCredentialPath(),
    process.env['GOOGLE_APPLICATION_CREDENTIALS'],
  ].filter((p): p is string => !!p);

  for (const keyFile of pathsToTry) {
    try {
      const creds = await fs.readFile(keyFile, 'utf-8');
      client.setCredentials(JSON.parse(creds));

      // This will verify locally that the credentials look good.
      const { token } = await client.getAccessToken();
      if (!token) {
        continue;
      }

      // This will check with the server to see if it hasn't been revoked.
      await client.getTokenInfo(token);

      return true;
    } catch (_) {
      // Ignore and try next path.
    }
  }

  return false;
}

async function cacheCredentials(credentials: Credentials) {
  const filePath = getCachedCredentialPath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  const credString = JSON.stringify(credentials, null, 2);
  await fs.writeFile(filePath, credString, { mode: 0o600 });
}

function getCachedCredentialPath(): string {
  return path.join(os.homedir(), GEMINI_DIR, CREDENTIAL_FILENAME);
}

export async function clearCachedCredentialFile() {
  try {
    await fs.rm(getCachedCredentialPath(), { force: true });
    // Clear the Google Account ID cache when credentials are cleared
    await clearCachedGoogleAccount();
  } catch (_) {
    /* empty */
  }
}

async function fetchAndCacheUserInfo(client: OAuth2Client): Promise<void> {
  try {
    const { token } = await client.getAccessToken();
    if (!token) {
      return;
    }

    const response = await fetch(
      'https://www.googleapis.com/oauth2/v2/userinfo',
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    );

    if (!response.ok) {
      console.error(
        'Failed to fetch user info:',
        response.status,
        response.statusText,
      );
      return;
    }

    const userInfo = await response.json();
    if (userInfo.email) {
      await cacheGoogleAccount(userInfo.email);
    }
  } catch (error) {
    console.error('Error retrieving user info:', error);
  }
}

// Helper to ensure test isolation
export function resetOauthClientForTesting() {
  oauthClientPromises.clear();
}
