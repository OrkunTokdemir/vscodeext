// Copyright (C) 2024 The Qt Company Ltd.
// SPDX-License-Identifier: LicenseRef-Qt-Commercial OR LGPL-3.0-only

import * as vscode from 'vscode';
import * as cmakeApi from 'vscode-cmake-tools';

import { WorkspaceStateManager } from '@/state';
import { coreAPI, kitManager } from '@/extension';
import {
  createLogger,
  QtWorkspaceConfigMessage,
  QtWorkspaceType
} from 'qt-lib';
import { Project, ProjectManager } from 'qt-lib';
import {
  getQtInsRoot,
  getQtPathsExe,
  getSelectedKit
} from '@cmd/register-qt-path';
import { analyzeKit } from '@/kit-manager';

const logger = createLogger('project');

export async function createCppProject(
  folder: vscode.WorkspaceFolder,
  context: vscode.ExtensionContext
) {
  logger.info('Creating project:"' + folder.uri.fsPath + '"');
  const api = await cmakeApi.getCMakeToolsApi(cmakeApi.Version.latest);
  let cmakeProject: cmakeApi.Project | undefined;
  if (api) {
    cmakeProject = await api.getProject(folder.uri);
  }
  const buildDir = await cmakeProject?.getBuildDirectory();
  return Promise.resolve(
    new CppProject(folder, context, cmakeProject, buildDir)
  );
}

// Project class represents a workspace folder in the extension.
export class CppProject implements Project {
  private readonly _disposables: vscode.Disposable[] = [];
  private readonly _stateManager: WorkspaceStateManager;
  private readonly _cmakeProject: cmakeApi.Project | undefined;
  private _buildDir: string | undefined;
  constructor(
    private readonly _folder: vscode.WorkspaceFolder,
    readonly _context: vscode.ExtensionContext,
    cmakeProject: cmakeApi.Project | undefined,
    buildDir: string | undefined
  ) {
    this._cmakeProject = cmakeProject;
    this._stateManager = new WorkspaceStateManager(_context, _folder);
    this._buildDir = buildDir;

    if (this._cmakeProject) {
      const onSelectedConfigurationChangedHandler =
        this._cmakeProject.onSelectedConfigurationChanged(
          async (configurationType: cmakeApi.ConfigurationType) => {
            if (configurationType === cmakeApi.ConfigurationType.Kit) {
              const kit = await getSelectedKit(this.folder);
              if (kit) {
                analyzeKit(kit);
              }
              const selectedKitPath = kit ? getQtInsRoot(kit) : undefined;
              const message = new QtWorkspaceConfigMessage(this.folder);
              coreAPI?.setValue(
                this.folder,
                'selectedKitPath',
                selectedKitPath
              );
              message.config.add('selectedKitPath');

              const selectedQtPaths = kit ? getQtPathsExe(kit) : undefined;
              coreAPI?.setValue(
                this.folder,
                'selectedQtPaths',
                selectedQtPaths
              );
              message.config.add('selectedQtPaths');
              coreAPI?.notify(message);
            }
          }
        );
      const onCodeModelChangedHandler = this._cmakeProject.onCodeModelChanged(
        async () => {
          const prevbuildDir = this._buildDir;
          const currentBuildDir = await this._cmakeProject?.getBuildDirectory();
          if (prevbuildDir !== currentBuildDir) {
            logger.info(
              'Build directory changed:',
              currentBuildDir ?? 'undefined'
            );
            this._buildDir = currentBuildDir;
            const message = new QtWorkspaceConfigMessage(this.folder);
            coreAPI?.setValue(this.folder, 'buildDir', currentBuildDir);
            message.config.add('buildDir');
            coreAPI?.notify(message);
          }
        }
      );
      this._disposables.push(onCodeModelChangedHandler);
      this._disposables.push(onSelectedConfigurationChangedHandler);
    }
  }
  async initConfigValues() {
    if (!coreAPI) {
      throw new Error('CoreAPI is not initialized');
    }
    const folder = this.folder;
    const kit = await getSelectedKit(folder, true);
    const message = new QtWorkspaceConfigMessage(folder);
    const selectedKitPath = kit ? getQtInsRoot(kit) : undefined;
    logger.info(
      `Setting selected kit path for ${folder.uri.fsPath} to ${selectedKitPath}`
    );
    coreAPI.setValue(folder, 'selectedKitPath', selectedKitPath);
    const selectedQtPaths = kit ? getQtPathsExe(kit) : undefined;
    coreAPI.setValue(folder, 'selectedQtPaths', selectedQtPaths);
    coreAPI.setValue(folder, 'workspaceType', QtWorkspaceType.CMakeExt);
    coreAPI.setValue(folder, 'buildDir', this.buildDir);
    logger.info('Updating coreAPI with message:', message as unknown as string);
  }
  public getStateManager() {
    return this._stateManager;
  }
  get folder() {
    return this._folder;
  }
  get buildDir() {
    return this._buildDir;
  }

  dispose() {
    logger.info('Disposing project:', this._folder.uri.fsPath);
    for (const d of this._disposables) {
      d.dispose();
    }
  }
}

export class CppProjectManager extends ProjectManager<CppProject> {
  constructor(override readonly context: vscode.ExtensionContext) {
    super(context, createCppProject);

    this._disposables.push(
      this.onProjectAdded(async (project: CppProject) => {
        logger.info('Adding project:', project.folder.uri.fsPath);
        await project.initConfigValues();
        kitManager.addProject(project);
        void kitManager.checkForQtInstallations(project);
      })
    );

    this._disposables.push(
      this.onProjectRemoved((project: CppProject) => {
        kitManager.removeProject(project);
      })
    );
  }
  initConfigValues() {
    for (const project of this.getProjects()) {
      void project.initConfigValues();
    }
  }
}
