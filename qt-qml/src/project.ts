// Copyright (C) 2024 The Qt Company Ltd.
// SPDX-License-Identifier: LicenseRef-Qt-Commercial OR LGPL-3.0-only

import * as vscode from 'vscode';
import path from 'path';

import { Project, ProjectManager, createLogger } from 'qt-lib';
import { Qmlls } from '@/qmlls';
import { coreAPI } from '@/extension';

const logger = createLogger('project');

export async function createQMLProject(
  folder: vscode.WorkspaceFolder,
  context: vscode.ExtensionContext
) {
  return Promise.resolve(new QMLProject(folder, context));
}

export class QMLProjectManager extends ProjectManager<QMLProject> {
  constructor(override readonly context: vscode.ExtensionContext) {
    super(context, createQMLProject);
  }
  async stopQmlls() {
    const promises = [];
    for (const project of this.getProjects()) {
      promises.push(project.qmlls.stop());
    }
    return Promise.all(promises);
  }
  async startQmlls() {
    const promises = [];
    for (const project of this.getProjects()) {
      promises.push(project.qmlls.start());
    }
    return Promise.all(promises);
  }
  async restartQmlls() {
    const promises = [];
    for (const project of this.getProjects()) {
      promises.push(project.qmlls.restart());
    }
    return Promise.all(promises);
  }
}
// Project class represents a workspace folder in the extension.
export class QMLProject implements Project {
  _qmlls: Qmlls;
  _qtpathsExe: string | undefined;
  _kitPath: string | undefined;
  _buildDir: string | undefined;
  public constructor(
    readonly _folder: vscode.WorkspaceFolder,
    readonly _context: vscode.ExtensionContext
  ) {
    logger.info('Creating project:', _folder.uri.fsPath);
    this._qmlls = new Qmlls(_folder);
    void this.qmlls.start();
  }
  get kitPath() {
    return this._kitPath;
  }
  set kitPath(kitPath: string | undefined) {
    this._kitPath = kitPath;
  }
  get qtpathsExe() {
    return this._qtpathsExe;
  }
  set qtpathsExe(qtpathsExe: string | undefined) {
    this._qtpathsExe = qtpathsExe;
  }
  updateQmlls() {
    this.qmlls.clearImportPaths();
    if (this.kitPath) {
      this.qmlls.addImportPath(path.join(this.kitPath, 'qml'));
    } else if (this.qtpathsExe) {
      const info = coreAPI?.getQtInfoFromPath(this.qtpathsExe);
      if (!info) {
        throw new Error('Could not find Qt info');
      }
      const qmlImportPath = info.get('QT_INSTALL_QML');
      if (!qmlImportPath) {
        throw new Error('Could not find QT_INSTALL_QML');
      }
      this.qmlls.addImportPath(qmlImportPath);
    }
    void this.qmlls.restart();
  }
  set buildDir(buildDir: string | undefined) {
    this._buildDir = buildDir;
    this.qmlls.buildDir = buildDir;
  }
  get buildDir() {
    return this._buildDir;
  }
  get folder() {
    return this._folder;
  }
  get qmlls() {
    return this._qmlls;
  }
  dispose() {
    logger.info('Disposing project:', this.folder.uri.fsPath);
    void this.qmlls.stop();
  }
}
