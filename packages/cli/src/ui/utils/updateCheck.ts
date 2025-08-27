/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */


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
    return null;
  } catch (e) {
    console.warn('Failed to check for updates: ' + e);
    return null;
  }
}
