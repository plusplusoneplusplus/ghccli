/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import semver from 'semver';

// Re-export getPackageJson from the correct location
export { getPackageJson } from '../../utils/package.js';

interface UpdateInfo {
  name: string;
  latest: string;
  current: string;
}

/**
 * Given two update info objects (e.g., from nightly and latest channels),
 * returns the one with the newer version.
 */
export function getBestAvailableUpdate(
  nightlyUpdateInfo: UpdateInfo | null,
  latestUpdateInfo: UpdateInfo | null,
): UpdateInfo | null {
  // If neither has an update, return null
  if (!nightlyUpdateInfo && !latestUpdateInfo) {
    return null;
  }

  // If only one has an update, return that one
  if (!nightlyUpdateInfo) {
    return latestUpdateInfo;
  }
  if (!latestUpdateInfo) {
    return nightlyUpdateInfo;
  }

  // Both have updates, return the newer one
  if (semver.gt(nightlyUpdateInfo.latest, latestUpdateInfo.latest)) {
    return nightlyUpdateInfo;
  }
  
  return latestUpdateInfo;
}