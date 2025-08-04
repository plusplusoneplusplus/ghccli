/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import updateNotifier, { UpdateInfo } from 'update-notifier';
import semver from 'semver';
import { getPackageJson } from '../../utils/package.js';

// Set to false to disable update checks
const UPDATE_CHECK_ENABLED = false;

export async function checkForUpdates(): Promise<string | null> {
  try {
    return null;
  } catch (e) {
    console.warn('Failed to check for updates: ' + e);
    return null;
  }
}
