// Copyright (C) 2024 The Qt Company Ltd.
// SPDX-License-Identifier: LicenseRef-Qt-Commercial OR LGPL-3.0-only

import * as path from 'path';
import * as fs from 'fs';
import { execSync, spawnSync } from 'child_process';
import { program } from 'commander';

interface PackageJson {
  name: string;
  version: string;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
}

interface RootPackage {
  version: string;
}

interface PackageLockJson {
  name: string;
  version: string;
  packages: {
    '': RootPackage;
  };
}

function main() {
  program.option('-d, --dir <string>', 'Path to target extension root');
  program.parse(process.argv);
  const options = program.opts();
  const targetExtensionRoot = options.dir as string;
  const packageJsonPath = path.join(targetExtensionRoot, 'package.json');
  const packageLockJsonPath = path.join(
    targetExtensionRoot,
    'package-lock.json'
  );
  const packageJson = JSON.parse(
    fs.readFileSync(packageJsonPath, 'utf-8')
  ) as PackageJson;
  const packageLockJson = JSON.parse(
    fs.readFileSync(packageLockJsonPath, 'utf-8')
  ) as PackageLockJson;
  process.chdir(targetExtensionRoot);
  console.log('Checking package versions...');
  if (
    packageJson.version !== packageLockJson.version ||
    packageJson.version !== packageLockJson.packages[''].version
  ) {
    const errorMessage =
      'Package versions do not match. Please run `npm install` to update package-lock.json';
    console.error(errorMessage);
    process.exit(1);
  }
  console.log('Package versions match');

  console.log('Checking for missing dependencies...');
  try {
    execSync('npm ls');
  } catch (error) {
    const errorMessage =
      "Missing dependencies found. Please run 'npm install' to install missing dependencies.";
    console.error(errorMessage);
    process.exit(1);
  }
  // Check if package-lock.json needs to be updated

  console.log(`Checking if "${packageLockJsonPath}" is up to date...`);

  spawnSync('npm install --package-lock-only --ignore-scripts', {
    shell: true,
    stdio: 'inherit'
  });

  const gitDiff = spawnSync(`git diff --quiet -- ${packageLockJsonPath}`, {
    shell: true,
    stdio: 'pipe',
    cwd: targetExtensionRoot
  });

  if (gitDiff.status !== 0) {
    console.error(
      `${packageLockJsonPath} changed! Please run 'npm run install:${targetExtensionRoot}' to update it.`
    );
    // remove any changes made to package-lock.json
    spawnSync(`git checkout -- ${packageLockJsonPath}`, {
      shell: true,
      stdio: 'inherit',
      cwd: targetExtensionRoot
    });
    process.exit(1);
  }

  console.log(`${packageLockJsonPath} is up to date`);
  console.log('All dependencies are installed');
}

main();
