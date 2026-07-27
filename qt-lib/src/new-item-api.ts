// Copyright (C) 2026 The Qt Company Ltd.
// SPDX-License-Identifier: LicenseRef-Qt-Commercial OR LGPL-3.0-only

import * as vscode from 'vscode';

export type QtNewItemType = 'project' | 'file';

export interface QtNewItemPresetMeta {
  type: QtNewItemType;
  title: string;
  description: string;
}

export interface QtNewItemPromptItem {
  text: string;
  data?: unknown;
  description?: string;
  checked?: string;
}

export interface QtNewItemPromptStep {
  id: string;
  type: 'input' | 'picker' | 'confirm';
  question: string;
  default: unknown;
  items?: readonly QtNewItemPromptItem[];
}

export interface QtNewItemPreset {
  id: string;
  name: string;
  template: string;
  meta: QtNewItemPresetMeta;
  prompt?: {
    version: string;
    steps: readonly QtNewItemPromptStep[];
    consts?: readonly object[];
  };
  customizable?: boolean;
}

export interface QtNewItemRequest {
  type: QtNewItemType;
  name: string;
  workingDir: string;
  presetId: string;
  options: Readonly<Record<string, unknown>>;
}

export interface QtNewItemIssue {
  level: 'error' | 'warning';
  field: string;
  message: string;
}

export interface QtNewItemResult {
  type: QtNewItemType;
  files: readonly string[];
  filesDir: string;
  workingDir: string;
  generateProjectConfigs?: boolean;
}

export interface QtNewItemProvider {
  readonly id: string;
  getPresets(
    type: QtNewItemType
  ): readonly QtNewItemPreset[] | Promise<readonly QtNewItemPreset[]>;
  getPreset(
    id: string
  ): QtNewItemPreset | undefined | Promise<QtNewItemPreset | undefined>;
  validate(
    request: QtNewItemRequest
  ): readonly QtNewItemIssue[] | Promise<readonly QtNewItemIssue[]>;
  create(request: QtNewItemRequest): QtNewItemResult | Promise<QtNewItemResult>;
}

export interface QtNewItemProviderRegistry {
  registerNewItemProvider(provider: QtNewItemProvider): vscode.Disposable;
}
