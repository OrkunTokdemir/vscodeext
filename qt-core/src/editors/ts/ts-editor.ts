// Copyright (C) 2024 The Qt Company Ltd.
// SPDX-License-Identifier: LicenseRef-Qt-Commercial OR LGPL-3.0-only

import * as vscode from 'vscode';

import {
  //   askForKitSelection,
  createLogger,
  //   QtWorkspaceType,
  telemetry
} from 'qt-lib';
// import { getNonce, getUri } from '@/editors/util';
// import { projectManager } from '@/extension';
// import { delay } from '@/util';
import { EXTENSION_ID } from '@/constants';

const logger = createLogger('ts-editor');

export class TSEditorProvider implements vscode.CustomTextEditorProvider {
  constructor(private readonly context: vscode.ExtensionContext) {
    void this.context;
  }

  private static readonly viewType = `${EXTENSION_ID}.tsEditor`;
  public static register(context: vscode.ExtensionContext): vscode.Disposable {
    const provider = new TSEditorProvider(context);
    const providerRegistration = vscode.window.registerCustomEditorProvider(
      TSEditorProvider.viewType,
      provider
    );
    return providerRegistration;
  }
  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ) {
    void _token;
    void this;
    webviewPanel.webview.options = {
      enableScripts: true
    };
    // webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);
    webviewPanel.webview.onDidReceiveMessage((e: { type: string }) => {
      switch (e.type) {
        case 'run': {
          telemetry.sendAction('openWithLinguist');
          logger.info('File is opened with linguist: ' + document.uri.fsPath);
          break;
        }
        case 'openWithTextEditor': {
          void TSEditorProvider.openWithTextEditor(document);
          break;
        }
        default:
          logger.error('Unknown message type');
          return;
      }
    });
    return Promise.resolve();
  }
  private static async openWithTextEditor(
    document: vscode.TextDocument
  ): Promise<void> {
    // Reveal the file in the current editor tab instead of opening a new one
    await vscode.commands.executeCommand(
      'workbench.action.revertAndCloseActiveEditor'
    );
    await vscode.commands.executeCommand(
      'vscode.openWith',
      document.uri,
      'default',
      {
        preview: false,
        preserveFocus: false
      }
    );
    telemetry.sendAction('openWithTSTextEditor');
    logger.info(
      'File opened with text editor in current tab: ' + document.uri.fsPath
    );
  }
}
