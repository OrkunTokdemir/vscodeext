// Copyright (C) 2026 The Qt Company Ltd.
// SPDX-License-Identifier: LicenseRef-Qt-Commercial OR LGPL-3.0-only

import * as vscode from 'vscode';
import type { QtNewItemProvider } from 'qt-lib';

const providers = new Map<string, QtNewItemProvider>();

export function registerNewItemProvider(provider: QtNewItemProvider) {
  if (providers.has(provider.id)) {
    throw new Error(`New Item provider '${provider.id}' is already registered`);
  }
  providers.set(provider.id, provider);
  return new vscode.Disposable(() => providers.delete(provider.id));
}

export function getNewItemProviders() {
  return [...providers.values()];
}
