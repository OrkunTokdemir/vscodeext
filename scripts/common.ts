// Copyright (C) 2024 The Qt Company Ltd.
// SPDX-License-Identifier: LicenseRef-Qt-Commercial OR LGPL-3.0-only

import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

interface RootPackage {
  version: string;
}

export function getExtensionVersion(extensionRoot: string): string {
  const packageJsonPath = path.join(extensionRoot, 'package.json');
  const packageJson = JSON.parse(
    fs.readFileSync(packageJsonPath, 'utf-8')
  ) as RootPackage;
  return packageJson.version;
}

export function pushTag(
  extensionRoot: string,
  extension: string,
  version: string,
  remote: string
) {
  const tag = `${extension}/${version}`;
  execSync(`git tag -am "${tag}" ${tag}`, {
    cwd: extensionRoot,
    stdio: 'inherit'
  });
  execSync(`git push ${remote} ${tag}`, {
    cwd: extensionRoot,
    stdio: 'inherit'
  });
}

export function checkForUncommittedChanges() {
  const status = execSync('git status --porcelain').toString();
  if (status.trim().length > 0) {
    throw new Error(
      'Uncommitted changes found. Please commit or stash them before proceeding.'
    );
  }
}

/**
 * Regenerates a committed file into a temporary directory and fails if the
 * committed copy differs from the freshly generated one.
 */
export function checkGeneratedFile(
  committedFile: string,
  generate: (outputFile: string) => void,
  updateCommand: string
) {
  const fileName = path.basename(committedFile);
  if (!fs.existsSync(committedFile)) {
    throw new Error(`${committedFile} file not found`);
  }
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vscodeext-'));
  try {
    const tempFile = path.join(tempDir, fileName);
    generate(tempFile);
    const generated = fs.readFileSync(tempFile, 'utf-8');
    const committed = fs.readFileSync(committedFile, 'utf-8');
    if (generated !== committed) {
      throw new Error(
        `${fileName} is out of date. Please run '${updateCommand}' to update it.`
      );
    }
    console.log(`${fileName} is up to date.`);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}
