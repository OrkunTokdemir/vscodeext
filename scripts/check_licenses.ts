// Copyright (C) 2024 The Qt Company Ltd.
// SPDX-License-Identifier: LicenseRef-Qt-Commercial OR LGPL-3.0-only

import * as path from 'path';
import { program } from 'commander';
import { execSync } from 'child_process';
import { checkGeneratedFile } from './common';

function main() {
  program.requiredOption('-d, --dir <string>', 'Path to target extension root');
  program.option('-e, --exclude <string>', 'Exclude packages');
  program.parse(process.argv);
  const options = program.opts();
  const extensionRoot = path.resolve(__dirname, '../');
  // --dir is relative to the repository root, or absolute.
  const targetExtensionRoot = path.resolve(
    extensionRoot,
    options.dir as string
  );
  const exclude = options.exclude as string;
  console.log('Checking licenses...');
  try {
    checkGeneratedFile(
      path.join(targetExtensionRoot, 'ThirdPartyNotices.txt'),
      (outputFile) => {
        execSync(
          `npm run generateLicenses -- --output="${outputFile}" --dir="${targetExtensionRoot}" --exclude="${exclude}, qt-lib"`,
          {
            cwd: extensionRoot,
            stdio: 'inherit'
          }
        );
      },
      'npm run generateLicenses:all'
    );
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

main();
