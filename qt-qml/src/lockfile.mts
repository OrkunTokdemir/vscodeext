// Copyright (C) 2024 The Qt Company Ltd.
// SPDX-License-Identifier: LicenseRef-Qt-Commercial OR LGPL-3.0-only

import { lock, check } from 'proper-lockfile';
import type { LockOptions, CheckOptions } from 'proper-lockfile';
import * as path from 'path';
import { createLogger } from 'qt-lib';
import { installerDir } from '@/installer.mjs';

const logger = createLogger('lockfile');

// Type alias for the release function returned by proper-lockfile's lock()
export type ReleaseFunction = () => Promise<void>;

/**
 * Get the path to the qmlls installation lock file
 */
export function getQmllsLockFilePath(): string {
  return path.join(installerDir(), '.install.lock');
}

/**
 * Acquire a lock for qmlls installation
 * @returns A release function to call when done, or null if lock acquisition failed
 */
export async function acquireLock(): Promise<ReleaseFunction | null> {
  const lockPath = getQmllsLockFilePath();

  try {
    logger.info(`Attempting to acquire lock: ${lockPath}`);

    const options: LockOptions = {
      retries: {
        retries: 0 // Don't retry, fail immediately if locked
      },
      realpath: false, // Don't resolve symlinks
      stale: 30000 // Consider lock stale after 30 seconds
    };

    const release: ReleaseFunction = await lock(lockPath, options);

    logger.info('Lock acquired successfully');
    return release;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ELOCKED') {
      logger.info('Lock is already held by another process');
      return null;
    }
    // For other errors, log and rethrow
    logger.error(`Failed to acquire lock: ${String(error)}`);
    throw error;
  }
}

/**
 * Check if the qmlls installation is currently locked
 * @returns true if locked by another process, false otherwise
 */
export async function isLocked(): Promise<boolean> {
  const lockPath = getQmllsLockFilePath();

  try {
    const options: CheckOptions = {
      realpath: false,
      stale: 30000
    };

    const locked: boolean = await check(lockPath, options);
    return locked;
  } catch (error) {
    // If file doesn't exist or other error, it's not locked
    logger.debug(`Lock check failed: ${String(error)}`);
    return false;
  }
}

/**
 * Release a previously acquired lock
 * @param release The release function returned from acquireLock
 */
export async function releaseLock(
  release: ReleaseFunction | null
): Promise<void> {
  if (!release) {
    return;
  }

  try {
    await release();
    logger.info('Lock released successfully');
  } catch (error) {
    logger.warn(`Failed to release lock: ${String(error)}`);
  }
}
