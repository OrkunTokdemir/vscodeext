// Copyright (C) 2024 The Qt Company Ltd.
// SPDX-License-Identifier: LicenseRef-Qt-Commercial OR LGPL-3.0-only

import * as vscode from 'vscode';

// import {
//   //   askForKitSelection,
//   createLogger,
//   //   QtWorkspaceType,
//   telemetry
// } from 'qt-lib';
import {
  createWebviewHtml,
  createWebviewOptions,
  basicWebviewAppConfig
} from '@/webview/utils';
// import { getNonce, getUri } from '@/editors/util';
// import { projectManager } from '@/extension';
// import { delay } from '@/util';
import { EXTENSION_ID } from '@/constants';

// const logger = createLogger('ts-editor');

export class TSEditorProvider implements vscode.CustomTextEditorProvider {
  private readonly _context: vscode.ExtensionContext;
  constructor(context: vscode.ExtensionContext) {
    this._context = context;
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
    doc: vscode.TextDocument,
    panel: vscode.WebviewPanel,
    token: vscode.CancellationToken
  ): Promise<void> {
    void token;
    void doc;

    // view
    const config = {
      app: 'ts-editor',
      title: 'TS editor',
      context: this._context,
      ...basicWebviewAppConfig
    };

    const view = panel.webview;
    view.html = createWebviewHtml(view, config);
    view.options = createWebviewOptions(config);

    // // doc
    // this._docsManager.add(doc);

    // // controller
    // const controller = new QrcEditorController(
    //   view,
    //   this._docsManager,
    //   doc.uri.fsPath
    // );
    // this._controllers.set(panel, controller);
    // panel.onDidDispose(() => {
    //   controller.dispose();
    //   this._controllers.delete(panel);
    // });
    return Promise.resolve();
  }
}
