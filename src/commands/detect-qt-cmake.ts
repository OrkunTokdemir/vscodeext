// Copyright (C) 2023 The Qt Company Ltd.
// SPDX-License-Identifier: LicenseRef-Qt-Commercial OR LGPL-3.0-only

import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';

import * as vscode from 'vscode';
import { CMakeKitFiles as cmake, Kit } from '../util/cmake-kit-files';
import * as qtpath from '../util/get-qt-paths';
import commandExists = require('command-exists');

export let QtCMakeKits: cmake;

export function initCMakeKits(context: vscode.ExtensionContext) {
  QtCMakeKits = new cmake(context.globalStorageUri.fsPath);
  return QtCMakeKits;
}

async function* generateCMakeKitsOfQtInstallationPath(
  installation: string,
  loadedCMakeKits: Kit[]
) {
  const promiseCmakeQtToolchainPath =
    qtpath.locateCMakeQtToolchainFile(installation);

  const qtRootDir = qtpath.qtRootByQtInstallation(installation);
  const promiseMingwPath = qtpath.locateMingwBinDirPath(qtRootDir);
  let qtPathEnv = qtpath.generateEnvPathForQtInstallation(installation);
  let locatedNinjaExePath = '';
  if (!commandExists.sync('ninja')) {
    const promiseNinjaExecutable = qtpath.locateNinjaExecutable(qtRootDir);
    locatedNinjaExePath = await promiseNinjaExecutable;
  }
  if (locatedNinjaExePath) {
    qtPathEnv += path.delimiter + path.dirname(locatedNinjaExePath);
  }

  let newKit: Kit = {
    name: qtpath.mangleQtInstallation(installation),
    environmentVariables: {
      VSCODE_QT_FOLDER: installation,
      PATH: qtPathEnv
    },
    isTrusted: true,
    preferredGenerator: {
      name: cmake.CMakeDefaultGenerator
    }
  };

  const toolchainFilePath = await promiseCmakeQtToolchainPath;
  if (toolchainFilePath) {
    newKit.toolchainFile = toolchainFilePath;
  }
  const toolchain = path.basename(installation);
  const tokens = toolchain.split('_');
  let platform = tokens[0];
  if (platform != 'android') {
    if (platform.startsWith('msvc')) {
      newKit = {
        ...newKit,
        ...{
          visualStudio: toolchain,
          visualStudioArchitecture: tokens[-1]
        }
      };
      const msvcKitsClone: Kit[] = JSON.parse(
        JSON.stringify(loadedCMakeKits)
      ) as Kit[];
      yield* cmake.generateMsvcKits(newKit, msvcKitsClone);
      return;
    } else if (platform.startsWith('mingw')) {
      platform = os.platform();
      const mingwDirPath = await promiseMingwPath;
      if (mingwDirPath) {
        newKit.environmentVariables.PATH = [
          newKit.environmentVariables.PATH,
          mingwDirPath
        ].join(path.delimiter);
        newKit = {
          ...newKit,
          ...{
            compilers: {
              C: path.join(
                mingwDirPath,
                'gcc' + qtpath.PlatformExecutableExtension
              ),
              CXX: path.join(
                mingwDirPath,
                'g++' + qtpath.PlatformExecutableExtension
              )
            }
          }
        };
      }
    } else if (platform.startsWith('linux')) {
      platform = 'linux';
    } else if (platform.startsWith('macos')) {
      platform = 'darwin';
      newKit = {
        ...newKit,
        ...{
          compilers: {
            C: '/usr/bin/clang',
            CXX: '/usr/bin/clang++'
          }
        }
      };
    }
  }

  yield newKit;
}

async function cmakeKitsFromQtInstallations(qtInstallations: string[]) {
  const loadedCMakeKits = await cmake.loadCMakeKitsFileJSON();
  const kits = [];
  for (const path of qtInstallations)
    for await (const kit of generateCMakeKitsOfQtInstallationPath(
      path,
      loadedCMakeKits
    ))
      kits.push(kit);
  return kits;
}

export async function updateCMakeKitsJson(qtInstallations: string[]) {
  const kitsJsonData = await cmakeKitsFromQtInstallations(qtInstallations);

  // Create the parent directories if they don't exist
  const parentDir = path.dirname(QtCMakeKits.qtKitsFilePath);
  await fs.mkdir(parentDir, { recursive: true });

  await fs.writeFile(
    QtCMakeKits.qtKitsFilePath,
    JSON.stringify(kitsJsonData, null, 2)
  );
  await QtCMakeKits.specifyCMakeKitsJsonFileForQt();
}
