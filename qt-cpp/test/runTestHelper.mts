// Copyright (C) 2025 The Qt Company Ltd.
// SPDX-License-Identifier: LicenseRef-Qt-Commercial OR LGPL-3.0-only

import * as fs from 'fs';
import * as path from 'path';
import { resolveCliArgsFromVSCodeExecutablePath } from '@vscode/test-electron';
import {
  getLocalQtCore,
  getQuietVSCodeArgs
} from '../../qt-lib/src/test-constants.js';
import {
  parseVSCodeDirs,
  installExtensionWithRetry,
  debugListExtensions,
  assertExtensionsInstalled,
  getDebugLevel,
  ExtensionInstallInfo
} from '../../qt-lib/src/test-vscode-install.js';

const QT_INS_ROOT_CONFIG_NAME = 'qtInstallationRoot';

export function getPlatformCMakeGenerator(): string {
  return process.platform === 'win32' ? 'Ninja' : 'Unix Makefiles';
}

/**
 * Resolve the CMake executable to use in the test VS Code instance.
 *
 * The test instance runs with a fresh user profile, so CMake Tools falls back
 * to its default `cmake.cmakePath` ("cmake") which only works when cmake is on
 * PATH (as on CI). On developer machines cmake is often installed outside PATH
 * (e.g. the Qt installer's Tools dir or CMake.app on macOS), which makes
 * `cmake.configure` fail with rc=-1 without any log output.
 *
 * Resolution order:
 *  1. `QT_TEST_CMAKE` environment variable (explicit override).
 *  2. `undefined` if cmake is already on PATH (keep CMake Tools' default).
 *  3. Qt installer layout under `<qtRoot>/Tools`, then platform-standard
 *     locations.
 *
 * @returns An absolute cmake path to write into `cmake.cmakePath`, or
 *          `undefined` if the default ("cmake" on PATH) should be kept.
 */
export function resolveCMakeExecutable(qtRoot: string): string | undefined {
  const override = process.env.QT_TEST_CMAKE?.trim();
  if (override) return override;

  const exe = process.platform === 'win32' ? 'cmake.exe' : 'cmake';
  const onPath = (process.env.PATH ?? '')
    .split(path.delimiter)
    .some((dir) => dir && fs.existsSync(path.join(dir, exe)));
  if (onPath) return undefined;

  const candidates =
    process.platform === 'darwin'
      ? [
          path.join(
            qtRoot,
            'Tools',
            'CMake',
            'CMake.app',
            'Contents',
            'bin',
            'cmake'
          ),
          '/Applications/CMake.app/Contents/bin/cmake'
        ]
      : process.platform === 'win32'
        ? [path.join(qtRoot, 'Tools', 'CMake_64', 'bin', 'cmake.exe')]
        : [path.join(qtRoot, 'Tools', 'CMake', 'bin', 'cmake')];

  return candidates.find((p) => fs.existsSync(p));
}

/**
 * Parse a CLI argument by name (e.g., --qt-root or --qt-root=/path)
 */
export function getCliArg(name: string): string | undefined {
  const flag = `--${name}`;
  const argv = process.argv.slice(2);

  for (let i = 0; i < argv.length; i++) {
    const a: string = argv[i]!;
    if (a === flag) {
      const next = argv[i + 1];
      return next ? next.trim() : undefined;
    }
    if (a.startsWith(flag + '=')) {
      return a.slice(flag.length + 1).trim();
    }
  }
  return undefined;
}

/**
 * Get and validate the Qt root path from CLI or environment
 */
export function getQtRoot(): string {
  const cliQtRoot = getCliArg('qt-root');
  const envQtRoot = process.env.QT_TEST_QT_ROOT?.trim();
  const qtRoot = (cliQtRoot ?? envQtRoot)?.trim();

  if (!qtRoot) {
    console.error(
      [
        'Qt root is required. Provide either:',
        '  1) CLI:   --qt-root /absolute/path/to/Qt',
        '  2) ENV:   QT_TEST_QT_ROOT=/absolute/path/to/Qt',
        '',
        'Examples:',
        '  npm run test -- --qt-root=/Users/me/Qt',
        '  QT_TEST_QT_ROOT=/Users/me/Qt npm run test'
      ].join('\n')
    );
    process.exit(1);
  }

  return qtRoot;
}

/**
 * Verify that the required qt-core .vsix file exists
 */
export function verifyQtCoreVsix(): string {
  const localQtCoreVsix = path.normalize(
    path.resolve(__dirname, getLocalQtCore())
  );

  if (!fs.existsSync(localQtCoreVsix)) {
    console.error(`Required extension not found: ${localQtCoreVsix}`);
    process.exit(1);
  }

  return localQtCoreVsix;
}

/**
 * Setup VS Code settings for testing
 */
export function setupVSCodeSettings(
  userDataDir: string,
  qtRoot: string,
  additionalSettings: Record<string, unknown> = {}
): void {
  const userDir = path.join(userDataDir, 'User');
  fs.mkdirSync(userDir, { recursive: true });

  const settingsPath = path.join(userDir, 'settings.json');
  const settings: Record<string, unknown> = {
    [`qt-core.${QT_INS_ROOT_CONFIG_NAME}`]: qtRoot,
    'cmake.loggingLevel': 'error',
    ...additionalSettings
  };

  if (settings['cmake.cmakePath'] === undefined) {
    const cmakePath = resolveCMakeExecutable(qtRoot);
    if (cmakePath) {
      settings['cmake.cmakePath'] = cmakePath;
      console.log('[runTest] cmake not found on PATH; using:', cmakePath);
    }
  }

  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
  console.log('[runTest] Wrote settings to:', settingsPath);
}

/**
 * Install required extensions for testing
 */
export function installRequiredExtensions(
  cli: string,
  args: string[],
  extensions: ExtensionInstallInfo[],
  requiredIDs: string[] = ['ms-vscode.cmake-tools', 'theqtcompany.qt-core']
): void {
  const quietArgs = [...args, ...getQuietVSCodeArgs()];

  for (const ext of extensions) {
    installExtensionWithRetry(cli, quietArgs, ext);
  }

  debugListExtensions(cli, args);
  assertExtensionsInstalled(cli, args, requiredIDs);
}

/**
 * Setup common test infrastructure
 */
export async function setupTestInfrastructure(
  vscodeExecutablePath: string
): Promise<{
  qtRoot: string;
  localQtCoreVsix: string;
  cli: string;
  args: string[];
  userDataDir: string;
  extensionsDir: string;
}> {
  const qtRoot = getQtRoot();
  const localQtCoreVsix = verifyQtCoreVsix();

  const [cli, ...args] =
    resolveCliArgsFromVSCodeExecutablePath(vscodeExecutablePath);

  const { userDataDir, extensionsDir } = parseVSCodeDirs(args);

  if (getDebugLevel() >= 1) {
    console.log('[runTest][qt-cpp] CLI:', cli, 'args:', args.join(' '));
    console.log('[runTest][qt-cpp] userDataDir:', userDataDir);
    console.log('[runTest][qt-cpp] extensionsDir:', extensionsDir);
  }

  if (!userDataDir) {
    console.error(
      '[runTest] Could not determine userDataDir from VS Code args.'
    );
    process.exit(1);
  }

  if (!extensionsDir) {
    console.error(
      '[runTest] Could not determine extensionsDir from VS Code args.'
    );
    process.exit(1);
  }

  return {
    qtRoot,
    localQtCoreVsix,
    cli: cli!,
    args,
    userDataDir,
    extensionsDir
  };
}
