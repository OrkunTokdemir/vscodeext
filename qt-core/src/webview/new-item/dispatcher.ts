// Copyright (C) 2025 The Qt Company Ltd.
// SPDX-License-Identifier: LicenseRef-Qt-Commercial OR LGPL-3.0-only

import _ from 'lodash';
import * as path from 'path';
import * as vscode from 'vscode';

import { createLogger, telemetry } from 'qt-lib';
import type {
  QtNewItemProvider,
  QtNewItemRequest,
  QtNewItemType
} from 'qt-lib';
import * as texts from '@/texts';
import { QtcliRestClient, QtcliRestError } from '@/qtcli/rest';
import { openFilesUnder, openUri } from '@/qtcli/common';
import { getNewProjectBaseDir, setDefaultProjectDir } from '@/qtcli/commands';
import { generateProjectConfigs } from '@/project-config-generator';
import { WebviewChannel } from '@/webview/channel';
import { Command, CommandId, IsCommand } from '@/webview/shared/message';
import { GlobalStateManager } from '@/state';
import type { NewItemPanel } from './panel';
import { getNewItemProviders } from './provider';

const logger = createLogger('new-item-handler');
type CommandHandler = (command: Command) => void | Promise<void>;

export class NewItemDispatcher {
  private readonly _qtcliRest: QtcliRestClient;
  private readonly _handlers: Map<CommandId, CommandHandler> | undefined;
  private _comm: WebviewChannel | undefined;
  private _panel: NewItemPanel | undefined = undefined;
  private _uiConfigs: unknown = {};
  private _context: vscode.ExtensionContext | undefined;
  private readonly _presetProviders = new Map<string, QtNewItemProvider>();

  public constructor(qtcliSocketName: string) {
    this._handlers = new Map<CommandId, CommandHandler>([
      [CommandId.UiClosed, this.onUiClosed],
      [CommandId.UiItemCreationRequested, this.onUiItemCreationRequested],
      [CommandId.UiHasError, this.onUiHasError],
      [CommandId.UiCheckIfQtcliReady, this.onUiCheckIfQtcliReady],
      [CommandId.UiGetConfigs, this.onUiGetConfigs],
      [CommandId.UiGetAllPresets, this.onUiGetAllPresets],
      [CommandId.UiGetPresetById, this.onUiGetPresetById],
      [CommandId.UiValidateInputs, this.onUiValidateInputs],
      [CommandId.UiManageCustomPreset, this.onUiManageCustomPreset],
      [CommandId.UiSelectWorkingDir, this.onUiSelectWorkingDir],
      [CommandId.UiSaveOpenInPreference, this.onUiSaveOpenInPreference]
    ]);

    this._qtcliRest = new QtcliRestClient(qtcliSocketName);
  }

  public dispose() {
    this._qtcliRest.dispose();
  }

  public setPanel(p: NewItemPanel) {
    this._panel = p;
  }

  public setComm(c: WebviewChannel) {
    this._comm = c;
  }

  public setUiConfigs(c: unknown) {
    this._uiConfigs = c;
  }

  public setContext(context: vscode.ExtensionContext) {
    this._context = context;
  }

  public dispatch(cmd: unknown) {
    if (!this._panel || !IsCommand(cmd)) {
      return;
    }

    const handler = this._handlers?.get(cmd.id);
    if (!handler) {
      logger.warn(`unhandled command: id = ${String(cmd.id)}`);
      return;
    }

    try {
      void handler(cmd);
    } catch (e) {
      logger.error(
        `Error while handling command '${String(cmd.id)}': ${String(e)}`
      );
    }
  }

  private readonly onUiClosed = () => {
    this._panel?.close();
  };

  private readonly onUiItemCreationRequested = async (cmd: Command) => {
    try {
      const provider = this.getPresetProvider(cmd);
      const data = provider
        ? await provider.create(this.getProviderRequest(cmd))
        : await this._qtcliRest.call({
            method: 'post',
            url: '/items',
            data: cmd.payload
          });

      const openIn = _.get(cmd.payload, 'openIn', 'addToWorkspace') as
        | 'addToWorkspace'
        | 'newWindow';
      openItemsFromQtcliResponseData(data, openIn);

      const type = _.get(cmd.payload, 'type', '') as string;
      const save = _.get(cmd.payload, 'saveProjectDir', false) as boolean;
      const workingDir = _.get(data, 'workingDir', '') as string;

      if (type === 'project' && save && workingDir.length !== 0) {
        await setDefaultProjectDir(workingDir);
      }

      // Save the openIn preference for projects
      if (type === 'project' && this._context) {
        const globalState = new GlobalStateManager(this._context);
        await globalState.setNewProjectOpenIn(openIn);
      }

      telemetry.sendEvent('Wizard:createItem', {
        type,
        template: String(_.get(cmd.payload, 'template', '')).trim()
      });

      this._panel?.close();
    } catch (e) {
      await vscode.window.showErrorMessage(
        e instanceof QtcliRestError ? e.toString() : String(e)
      );
    }
  };

  // eslint-disable-next-line @typescript-eslint/class-methods-use-this
  private readonly onUiHasError = (cmd: Command) => {
    const msg = _.toString(cmd.payload);
    logger.error(`UI Error: ${msg}`);
  };

  private readonly onUiCheckIfQtcliReady = async (cmd: Command) => {
    try {
      const data = await this._qtcliRest.retryCall({
        method: 'get',
        url: '/ready'
      });
      this._comm?.postDataReply(cmd, data);
    } catch {
      await vscode.window.showErrorMessage(texts.newItem.errorQtCliNotReady);
    }
  };

  private readonly onUiGetConfigs = (cmd: Command) => {
    this._comm?.postDataReply(cmd, this._uiConfigs);
  };

  private readonly onUiGetAllPresets = async (cmd: Command) => {
    const data = await this._qtcliRest.get('/presets', { type: cmd.payload });
    const presets: unknown[] = Array.isArray(data)
      ? (data as unknown[]).slice()
      : [];
    const type = cmd.payload as QtNewItemType;
    this._presetProviders.clear();

    for (const provider of getNewItemProviders()) {
      try {
        for (const preset of await provider.getPresets(type)) {
          if (this._presetProviders.has(preset.id)) {
            logger.warn(`Duplicate external preset ID: ${preset.id}`);
            continue;
          }
          this._presetProviders.set(preset.id, provider);
          presets.push(preset);
        }
      } catch (error) {
        logger.error(
          `Failed to load New Item presets from ${provider.id}: ${String(error)}`
        );
      }
    }

    this._comm?.postDataReply(cmd, presets);
  };

  private readonly onUiGetPresetById = async (cmd: Command) => {
    const id = _.toString(cmd.payload);
    const provider = this._presetProviders.get(id);
    const data = provider
      ? await provider.getPreset(id)
      : await this._qtcliRest.get(`/presets/${id}`);
    this._comm?.postDataReply(cmd, data);
  };

  private readonly onUiManageCustomPreset = async (cmd: Command) => {
    const action = _.get(cmd.payload, 'action', '') as string;
    const presetId = _.get(cmd.payload, 'presetId', '') as string;
    if (presetId.length === 0) {
      return;
    }

    try {
      switch (action) {
        case 'create': {
          const data = await this._qtcliRest.post('/presets', cmd.payload);
          this._comm?.postDataReply(cmd, data);
          break;
        }

        case 'rename': {
          await this._qtcliRest.post('/presets', cmd.payload);
          await this._qtcliRest.delete(`/presets/${presetId}`);
          this._comm?.postDataReply(cmd, cmd.payload);
          break;
        }

        case 'update': {
          await this._qtcliRest.patch(`/presets/${presetId}`, cmd.payload);
          this._comm?.postDataReply(cmd, cmd.payload);
          break;
        }

        case 'delete': {
          const data = await this._qtcliRest.delete(`/presets/${presetId}`);
          this._comm?.postDataReply(cmd, data);
          break;
        }
      }
    } catch (e) {
      if (e instanceof QtcliRestError) {
        await vscode.window.showErrorMessage(e.toString());
        this._comm?.postErrorReplyFrom(cmd, e.message, e.details);
      }
    }
  };

  private readonly onUiValidateInputs = async (cmd: Command) => {
    try {
      const provider = this.getPresetProvider(cmd);
      if (provider) {
        const issues = await provider.validate(this.getProviderRequest(cmd));
        if (issues.length > 0) {
          this._comm?.postErrorReplyFrom(cmd, 'Input has issues', [...issues]);
        } else {
          this._comm?.postDataReply(cmd, {});
        }
      } else {
        const data = await this._qtcliRest.post('/items/validate', cmd.payload);
        this._comm?.postDataReply(cmd, data);
      }
    } catch (e) {
      if (e instanceof QtcliRestError) {
        this._comm?.postErrorReplyFrom(cmd, e.message, e.details);
      } else {
        this._comm?.postErrorReply(cmd, String(e));
      }
    }
  };

  private getPresetProvider(cmd: Command) {
    const presetId = _.get(cmd.payload, 'presetId', '') as string;
    return this._presetProviders.get(presetId);
  }

  // eslint-disable-next-line @typescript-eslint/class-methods-use-this
  private getProviderRequest(cmd: Command): QtNewItemRequest {
    const type = _.get(cmd.payload, 'type', '') as QtNewItemType;
    return {
      type,
      name: _.get(cmd.payload, 'name', '') as string,
      workingDir: _.get(cmd.payload, 'workingDir', '') as string,
      presetId: _.get(cmd.payload, 'presetId', '') as string,
      options: _.get(cmd.payload, 'options', {}) as Record<string, unknown>
    };
  }

  private readonly onUiSelectWorkingDir = async (cmd: Command) => {
    const dir = cmd.payload?.toString() ?? getNewProjectBaseDir();
    const options: vscode.OpenDialogOptions = {
      canSelectMany: false,
      canSelectFolders: true,
      canSelectFiles: false,
      openLabel: texts.newItem.workingDirDialogTitle,
      defaultUri: vscode.Uri.file(dir)
    };

    const folderUri = await vscode.window.showOpenDialog(options);
    if (folderUri && folderUri.length > 0) {
      let folder = folderUri[0]?.fsPath ?? '';
      if (process.platform === 'win32' && /^[a-z]:/.test(folder)) {
        folder = folder.charAt(0).toUpperCase() + folder.slice(1);
      }

      this._comm?.postDataReply(cmd, folder);
    }
  };

  private readonly onUiSaveOpenInPreference = async (cmd: Command) => {
    const value = cmd.payload as 'addToWorkspace' | 'newWindow';
    if (this._context) {
      const globalState = new GlobalStateManager(this._context);
      await globalState.setNewProjectOpenIn(value);
    }
  };
}

// helpers
function openItemsFromQtcliResponseData(
  data: unknown,
  openIn = 'addToWorkspace'
) {
  const type = _.get(data, 'type', '') as string;
  const files = _.get(data, 'files', []) as string[];
  const filesDir = _.get(data, 'filesDir', '') as string;
  if (type.length === 0 || filesDir.length === 0) {
    return;
  }

  if (type === 'project') {
    if (_.get(data, 'generateProjectConfigs', true) as boolean) {
      generateProjectConfigs(path.normalize(filesDir));
    }
    const uri = vscode.Uri.file(path.normalize(filesDir));
    if (openIn === 'newWindow') {
      void vscode.commands.executeCommand('vscode.openFolder', uri, true);
    } else {
      void openUri(uri);
    }
  } else {
    void openFilesUnder(path.normalize(filesDir), files);
  }
}
