// Copyright (C) 2024 The Qt Company Ltd.
// SPDX-License-Identifier: LicenseRef-Qt-Commercial OR LGPL-3.0-only

import * as vscode from 'vscode';

import { getNonce, getUri } from '@/editors/util';
import { projectManager } from '@/extension';
import { DesignerServer } from '@/designer-server';
import { DesignerClient } from '@/designer-client';
import { getQtDesignerPath } from '@util/get-qt-paths';
import { createLogger } from '@/logger';

const logger = createLogger('ui-editor');

export class UIEditorProvider implements vscode.CustomTextEditorProvider {
  constructor(private readonly context: vscode.ExtensionContext) {}

  private static readonly viewType = 'qt-official.uiEditor';
  public static register(context: vscode.ExtensionContext): vscode.Disposable {
    const provider = new UIEditorProvider(context);
    const providerRegistration = vscode.window.registerCustomEditorProvider(
      UIEditorProvider.viewType,
      provider
    );
    return providerRegistration;
  }
  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    void _token;
    webviewPanel.webview.options = {
      enableScripts: true
    };
    webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);
    function updateWebview() {
      void webviewPanel.webview.postMessage({
        type: 'update',
        text: document.getText()
      });
    }
    const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(
      (e) => {
        if (e.document.uri.toString() === document.uri.toString()) {
          updateWebview();
        }
      }
    );

    webviewPanel.onDidDispose(() => {
      changeDocumentSubscription.dispose();
    });
    const delay = async (ms: number) =>
      new Promise((resolve) => setTimeout(resolve, ms));
    webviewPanel.webview.onDidReceiveMessage(async (e: { type: string }) => {
      const project = projectManager.findProjectContainingFile(document.uri);
      let designerServer: DesignerServer | undefined;
      let designerClient: DesignerClient | undefined;
      if (project) {
        designerServer = project.designerServer;
        if (project.designerClient) {
          designerClient = project.designerClient;
        } else {
          // If a kit is selected/changed after the project is opened, we need
          // to create a DesignerClient instance when a kit is selected
          // instead of waiting for the user to open a .ui file. The reason is
          // `cmake.onSelectedKitChanged()` does not exist, we need to create
          // a DesignerClient instance here.
          const qtDesignerPath = await getQtDesignerPath(project.folder);
          if (qtDesignerPath) {
            designerClient = new DesignerClient(
              qtDesignerPath,
              designerServer.getPort()
            );
            project.designerClient = designerClient;
          }
        }
      } else {
        // This means that the file is not part of a workspace folder. So
        // we start a new DesignerServer and DesignerClient
        // TODO: Add fallback Qt Widgets Designer for this case
        logger.error('Project not found');
        throw new Error('Project not found');
      }

      switch (e.type) {
        case 'run':
          if (designerClient === undefined) {
            logger.error('Designer client not found');
            throw new Error('Designer client not found');
          }
          if (!designerClient.isRunning()) {
            logger.info('Starting designer client');
            designerClient.start(designerServer.getPort());
          }
          // wait for the client to connect
          while (!designerServer.isClientConnected()) {
            await delay(100);
          }
          designerServer.sendFile(document.uri.fsPath);
          logger.info('File sent to designer server: ' + document.uri.fsPath);
          break;
        default:
          logger.error('Unknown message type');
          throw new Error('Unknown message type');
      }
    });

    updateWebview();
    return Promise.resolve();
  }

  private getHtmlForWebview(webview: vscode.Webview): string {
    // Use a nonce to whitelist which scripts can be run
    const nonce = getNonce();
    const scriptUri = getUri(webview, this.context.extensionUri, [
      'out',
      'editors',
      'ui',
      'webview-ui',
      'main.js'
    ]);

    // prettier-ignore
    const html =
    `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Open this file with Qt Widgets Designer</title>
      <style>
        body {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100vh;
          margin: 0;
        }
    </style>
    </head>
    <body>
      <div>
        <vscode-button id="openWithDesignerButton" tabindex="0">Open this file with Qt Widgets Designer</vscode-button>
      </div>
      <script type="module" nonce="${nonce}" src="${scriptUri.toString()}"></script>
    </body>
    </html>`;
    return html;
  }
}
