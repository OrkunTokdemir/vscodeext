// Copyright (C) 2026 The Qt Company Ltd.
// SPDX-License-Identifier: LicenseRef-Qt-Commercial OR LGPL-3.0-only

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import {
  type QtNewItemIssue,
  type QtNewItemPreset,
  type QtNewItemProvider,
  type QtNewItemRequest,
  type QtNewItemResult,
  type QtNewItemType
} from 'qt-lib';

export const QtBridgeProjectPresetId = 'qt-csharp/project';
export const QtBridgeQmlPresetId = 'qt-csharp/qml';

const projectPreset: QtNewItemPreset = {
  id: QtBridgeProjectPresetId,
  name: '@projects/csharp/qtbridge',
  template: 'dotnet-new:qt',
  meta: {
    type: 'project',
    title: 'Qt Bridge for C# application',
    description:
      'Creates a Qt Bridge for C# application with a C# backend and QML user interface.'
  },
  prompt: {
    version: '1',
    steps: [
      {
        id: 'Framework',
        type: 'picker',
        question: 'Target framework:',
        default: 'net8.0',
        items: [{ text: 'net8.0' }, { text: 'net9.0' }, { text: 'net10.0' }]
      },
      {
        id: 'SampleCode',
        type: 'confirm',
        question: 'Add sample code to project?',
        default: false
      }
    ]
  },
  customizable: false
};

const qmlPreset: QtNewItemPreset = {
  id: QtBridgeQmlPresetId,
  name: '@types/qml/qtbridge',
  template: 'dotnet-new:qml',
  meta: {
    type: 'file',
    title: 'Qt Bridge for C# QML file',
    description: 'Creates a QML file for a Qt Bridge for C# project.'
  },
  customizable: false
};

export type DotNetNewRunner = (
  args: readonly string[],
  workingDirectory: string
) => Promise<void>;

async function runDotNetNew(
  args: readonly string[],
  workingDirectory: string
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn('dotnet', args, {
      cwd: workingDirectory,
      shell: false,
      windowsHide: true
    });
    let output = '';

    child.stdout.on('data', (data: Buffer) => {
      output += data.toString();
    });
    child.stderr.on('data', (data: Buffer) => {
      output += data.toString();
    });
    child.on('error', reject);
    child.on('close', (exitCode) => {
      if (exitCode === 0) {
        resolve();
        return;
      }
      const detail = output.trim();
      const templateMissing =
        detail.includes('No templates or subcommands found matching') ||
        detail.includes('No templates found matching');
      const installHint = templateMissing
        ? '\n\nInstall the templates with: dotnet new install QtGroup.Qt.Bridge.CSharp.Templates'
        : '';
      reject(
        new Error(
          detail
            ? `dotnet new failed:\n${detail}${installHint}`
            : `dotnet new exited with code ${String(exitCode)}.`
        )
      );
    });
  });
}

function normalizeQmlName(name: string) {
  return name.toLowerCase().endsWith('.qml') ? name.slice(0, -4) : name;
}

function validateName(name: string): string | undefined {
  if (!name || name === '.' || name === '..') {
    return 'Give the item a name';
  }
  const hasControlCharacter = [...name].some(
    (character) => character.charCodeAt(0) < 32
  );
  if (
    name !== path.basename(name) ||
    /[<>:"/\\|?*]/.test(name) ||
    hasControlCharacter
  ) {
    return 'The name contains invalid path characters';
  }
  return undefined;
}

export class QtBridgeNewItemProvider implements QtNewItemProvider {
  readonly id = 'qt-csharp';
  private readonly presets = [projectPreset, qmlPreset];

  constructor(private readonly runner: DotNetNewRunner = runDotNetNew) {}

  getPresets(type: QtNewItemType) {
    return this.presets.filter((preset) => preset.meta.type === type);
  }

  getPreset(id: string) {
    return this.presets.find((preset) => preset.id === id);
  }

  async validate(request: QtNewItemRequest): Promise<QtNewItemIssue[]> {
    const preset = this.getPreset(request.presetId);
    const issues: QtNewItemIssue[] = [];
    const name = request.name.trim();
    const nameError = validateName(name);
    if (nameError) {
      issues.push({ level: 'error', field: 'name', message: nameError });
    }

    if (!path.isAbsolute(request.workingDir)) {
      issues.push({
        level: 'error',
        field: 'workingDir',
        message: 'The path must be absolute'
      });
    } else {
      try {
        const stat = await fs.promises.stat(request.workingDir);
        if (!stat.isDirectory()) {
          issues.push({
            level: 'error',
            field: 'workingDir',
            message: 'The path must identify a directory'
          });
        }
      } catch {
        issues.push({
          level: 'error',
          field: 'workingDir',
          message: 'The directory does not exist'
        });
      }
    }

    if (issues.length === 0) {
      const outputPath =
        preset?.meta.type === 'project'
          ? path.join(request.workingDir, name)
          : path.join(request.workingDir, `${normalizeQmlName(name)}.qml`);
      if (fs.existsSync(outputPath)) {
        issues.push({
          level: 'error',
          field: 'name',
          message: 'A file or directory with this name already exists'
        });
      }
    }
    return issues;
  }

  async create(request: QtNewItemRequest): Promise<QtNewItemResult> {
    const issues = await this.validate(request);
    const error = issues.find((issue) => issue.level === 'error');
    if (error) {
      throw new Error(error.message);
    }

    if (request.presetId === QtBridgeProjectPresetId) {
      return this.createProject(request);
    }
    if (request.presetId === QtBridgeQmlPresetId) {
      return this.createQmlFile(request);
    }
    throw new Error(`Unknown Qt Bridge template: ${request.presetId}`);
  }

  private async createProject(
    request: QtNewItemRequest
  ): Promise<QtNewItemResult> {
    const name = request.name.trim();
    const outputDirectory = path.join(request.workingDir, name);
    const args = [
      'new',
      'qt',
      '--name',
      name,
      '--output',
      outputDirectory,
      '--language',
      'C#'
    ];
    const framework = request.options.Framework;
    if (typeof framework === 'string' && framework) {
      args.push('--Framework', framework);
    }
    if (request.options.SampleCode === true) {
      args.push('--SampleCode');
    }
    await this.runner(args, request.workingDir);
    return {
      type: 'project',
      files: [`${name}.csproj`, 'Program.cs', 'Main.qml'],
      filesDir: outputDirectory,
      workingDir: request.workingDir,
      generateProjectConfigs: false
    };
  }

  private async createQmlFile(
    request: QtNewItemRequest
  ): Promise<QtNewItemResult> {
    const name = normalizeQmlName(request.name.trim());
    const args = [
      'new',
      'qml',
      '--name',
      name,
      '--output',
      request.workingDir,
      '--language',
      'C#'
    ];
    await this.runner(args, request.workingDir);
    return {
      type: 'file',
      files: [`${name}.qml`],
      filesDir: request.workingDir,
      workingDir: request.workingDir
    };
  }
}
