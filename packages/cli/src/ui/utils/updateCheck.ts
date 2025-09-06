/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import updateNotifier from 'update-notifier';
import semver from 'semver';
import { getPackageJson, getBestAvailableUpdate } from './updateHelpers.js';


export interface UpdateObject {
  message: string;
  update: {
    name: string;
    latest: string;
    current: string;
  };
}

export async function checkForUpdates(): Promise<UpdateObject | null> {
  try {
    // Skip update check when running from source (development mode)
    if (process.env['DEV'] === 'true') {
      return null;
    }
    const packageJson = await getPackageJson();
    if (!packageJson || !packageJson.name || !packageJson.version) {
      return null;
    }

    const { name, version: currentVersion } = packageJson;
    
    // Skip update check for ghccli (fork)
    if (name === 'ghccli') {
      return null;
    }
    
    const isNightly = currentVersion.includes('nightly');
    const createNotifier = (distTag: 'latest' | 'nightly') =>
      updateNotifier({
        pkg: {
          name,
          version: currentVersion,
        },
        updateCheckInterval: 0,
        shouldNotifyInNpmScript: true,
        distTag,
      });

    if (isNightly) {
      const [nightlyUpdateInfo, latestUpdateInfo] = await Promise.all([
        createNotifier('nightly').fetchInfo(),
        createNotifier('latest').fetchInfo(),
      ]);

      const bestUpdate = getBestAvailableUpdate(
        nightlyUpdateInfo,
        latestUpdateInfo,
      );

      if (bestUpdate && semver.gt(bestUpdate.latest, currentVersion)) {
        const message = `A new version of Gemini CLI is available! ${currentVersion} → ${bestUpdate.latest}`;
        return {
          message,
          update: { ...bestUpdate, current: currentVersion },
        };
      }
    } else {
      const updateInfo = await createNotifier('latest').fetchInfo();

      if (updateInfo && semver.gt(updateInfo.latest, currentVersion)) {
        const message = `Gemini CLI update available! ${currentVersion} → ${updateInfo.latest}`;
        return {
          message,
          update: { ...updateInfo, current: currentVersion },
        };
      }
    }

    return null;
  } catch (e) {
    console.warn('Failed to check for updates: ' + e);
    return null;
  }
}
