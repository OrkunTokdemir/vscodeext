// Copyright (C) 2026 The Qt Company Ltd.
// SPDX-License-Identifier: LicenseRef-Qt-Commercial OR LGPL-3.0-only

import * as path from 'path';
import { program } from 'commander';
import { execSync } from 'child_process';
import { checkGeneratedFile } from './common';

function main() {
  program.requiredOption('-d, --dir <string>', 'Path to target extension root');
  program.parse(process.argv);
  const options = program.opts();
  const extensionRoot = path.resolve(__dirname, '../');
  // --dir is relative to the repository root, or absolute.
  const targetExtensionRoot = path.resolve(
    extensionRoot,
    options.dir as string
  );
  console.log('Checking SBOM...');
  try {
    checkGeneratedFile(
      path.join(targetExtensionRoot, 'sbom.cdx.json'),
      (outputFile) => {
        execSync(
          `npm run generateSbom -- --output="${outputFile}" --dir="${targetExtensionRoot}"`,
          {
            cwd: extensionRoot,
            stdio: 'inherit'
          }
        );
      },
      'npm run generateSbom:all'
    );
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

main();
