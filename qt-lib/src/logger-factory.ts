// Copyright (C) 2024 The Qt Company Ltd.
// SPDX-License-Identifier: LicenseRef-Qt-Commercial OR LGPL-3.0-only

import * as path from 'path';
import { createLogger } from './logger';

/**
 * Creates a logger with automatic name derivation from file path
 * @param filePath The __filename or import.meta.url of the calling file
 * @param prefix Optional prefix to namespace the logger (e.g., 'qt-core')
 * @returns A logger instance with consistent naming

 * @example
 * // Simple usage without prefix
 * const logger = createModuleLogger(__filename);
 * // Creates logger named 'extension'
 */
export function createModuleLogger(
  filePath: string,
  prefix?: string
): ReturnType<typeof createLogger> {
  // Handle both __filename and import.meta.url formats
  const normalizedPath = filePath.startsWith('file://')
    ? new URL(filePath).pathname
    : filePath;

  const fileName = path.basename(normalizedPath, path.extname(normalizedPath));
  const moduleName = prefix ? `${prefix}:${fileName}` : fileName;

  return createLogger(moduleName);
}
