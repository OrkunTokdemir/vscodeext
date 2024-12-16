// Copyright (C) 2024 The Qt Company Ltd.
// SPDX-License-Identifier: LicenseRef-Qt-Commercial OR LGPL-3.0-only

import * as vscode from 'vscode';
import * as path from 'path';
import * as child_process from 'child_process';

import * as constants from '@/constants';
import {
  IsMacOS,
  IsWindows,
  OSExeSuffix,
  exists,
  locateQmakeExeFilePath,
  QtInfo
} from 'qt-lib';
import { coreAPI } from '@/extension';

export function getConfig<T>(
  key: string,
  defaultValue: T,
  folder?: vscode.WorkspaceFolder
): T {
  return vscode.workspace
    .getConfiguration(constants.EXTENSION_ID, folder)
    .get<T>(key, defaultValue);
}

export function affectsConfig(
  event: vscode.ConfigurationChangeEvent,
  key: string,
  folder?: vscode.WorkspaceFolder
): boolean {
  return event.affectsConfiguration(`${constants.EXTENSION_ID}.${key}`, folder);
}

export async function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const DesignerExeName = IsMacOS ? 'Designer' : 'designer' + OSExeSuffix;

function getDesignerExePath(selectedQtBinPath: string) {
  const macOSPath = path.join(
    'Designer.app',
    'Contents',
    'MacOS',
    DesignerExeName
  );
  return IsMacOS
    ? path.join(selectedQtBinPath, macOSPath)
    : path.join(selectedQtBinPath, DesignerExeName);
}

export async function locateDesigner(selectedQtPath: string) {
  let designerExePath = getDesignerExePath(path.join(selectedQtPath, 'bin'));
  if (await exists(designerExePath)) {
    return designerExePath;
  }
  const qmakeExePath = await locateQmakeExeFilePath(selectedQtPath);
  if (!qmakeExePath) {
    return '';
  }
  const designer = extractDesignerExePathFromQtPath(qmakeExePath);
  if (await designer) {
    return designer;
  }

  if (!IsWindows) {
    designerExePath = '/usr/bin/designer';
    if (await exists(designerExePath)) {
      return designerExePath;
    }
  }

  return '';
}

export async function locateDesignerFromQtPaths(qtPaths: string) {
  const info = coreAPI?.getQtInfoFromPath(qtPaths);
  if (!info) {
    return '';
  }
  const designerExePath = await searchForDesignerInQtInfo(info);
  if (designerExePath) {
    return designerExePath;
  }
  return undefined;
}

async function extractDesignerExePathFromQtPath(qtPathExePath: string) {
  const hostBinDir = await queryHostBinDirPath(qtPathExePath);
  const designerExePath = getDesignerExePath(hostBinDir);
  if (await exists(designerExePath)) {
    return designerExePath;
  }
  return undefined;
}

async function searchForDesignerInQtInfo(info: QtInfo) {
  const keysToCheck = [
    'QT_HOST_BINS',
    'QT_HOST_LIBEXECS',
    'QT_INSTALL_LIBEXECS'
  ];

  const paths = keysToCheck
    .map((key) => info.get(key))
    .filter((p) => {
      return p !== undefined;
    });

  const addVcpkgPaths = (p: string[]) => {
    const keys = ['QT_INSTALL_PREFIX', 'QT_HOST_PREFIX'];
    for (const key of keys) {
      const value = info.get(key);
      if (value) {
        const vcpkgPath = path.join(value, 'tools', 'qttools', 'bin');
        p.push(vcpkgPath);
      }
    }
  };
  // It is a special case for vcpkg because on some platforms, Designer is
  // installed in a different location
  addVcpkgPaths(paths);

  for (const p of paths) {
    if (p) {
      const designerExePath = getDesignerExePath(p);
      if (await exists(designerExePath)) {
        return designerExePath;
      }
    }
  }
  return undefined;
}

async function queryHostBinDirPath(qtpathsExePath: string): Promise<string> {
  const childProcess = child_process.exec(
    qtpathsExePath + ' -query QT_HOST_BINS'
  );
  const promiseFirstLineOfOutput = new Promise<string>((resolve, reject) => {
    childProcess.stdout?.on('data', (data: string) => {
      resolve(data.toString().trim());
    });
    childProcess.stderr?.on('data', (data: string) => {
      reject(new Error(data.toString().trim()));
    });
  });
  const promiseProcessClose = new Promise<string>((resolve, reject) => {
    childProcess.on('close', () => {
      resolve('');
    });
    childProcess.on('error', (err) => {
      reject(err);
    });
  });
  const hostBinDir = await Promise.race([
    promiseFirstLineOfOutput,
    promiseProcessClose
  ]);
  return hostBinDir;
}
