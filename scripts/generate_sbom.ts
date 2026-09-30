// Copyright (C) 2026 The Qt Company Ltd.
// SPDX-License-Identifier: LicenseRef-Qt-Commercial OR LGPL-3.0-only

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { program } from 'commander';
import { execSync, spawnSync } from 'child_process';

interface Property {
  name: string;
  value: string;
}

interface Component {
  name: string;
  'bom-ref': string;
  licenses?: unknown[];
  properties?: Property[];
  components?: Component[];
}

interface Dependency {
  ref: string;
  dependsOn?: string[];
}

interface Sbom {
  metadata: {
    tools: {
      components: { name: string; group?: string }[];
    };
    component: Component;
  };
  components: Component[];
  dependencies: Dependency[];
}

interface PackageJson {
  dependencies?: Record<string, string>;
}

interface LinkedPackage {
  name: string;
  root: string;
}

interface NpmLsOutput {
  problems?: string[];
}

const packagePathProperty = 'cdx:npm:package:path';

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, 'utf-8')) as T;
}

function runCyclonedx(
  packageRoot: string,
  outputFile: string,
  ignoreNpmErrors: boolean
) {
  const args = [
    '--package-lock-only',
    '--omit dev',
    '--output-reproducible',
    '--output-format JSON',
    `--output-file "${outputFile}"`
  ];
  if (ignoreNpmErrors) {
    args.push('--ignore-npm-errors');
  }
  // npx (npm >= 9) walks up parent directories looking for node_modules/.bin,
  // so the root-pinned cyclonedx-npm is found although cwd is the extension
  // root. --no makes it fail instead of fetching "latest" from the registry.
  execSync(`npx --no -- cyclonedx-npm ${args.join(' ')}`, {
    cwd: packageRoot,
    stdio: 'inherit'
  });
}

// Problems npm ls reports look like
//   missing: winston@^3.15.0, required by qt-lib@1.19.0
//   invalid: eslint@8.57.1 /repo/qt-lib/node_modules/eslint
function isLinkProblem(problem: string, links: LinkedPackage[]): boolean {
  const normalized = problem.replace(/\\/g, '/');
  return links.some(
    (link) =>
      normalized.includes(`required by ${link.name}@`) ||
      normalized.includes(`/${link.name}/node_modules/`)
  );
}

// --ignore-npm-errors makes cyclonedx-npm swallow every problem npm found in
// the tree, and each problem means a component is missing from the SBOM. The
// ones caused by a file: link are expected, see graftLinkedPackage. Anything
// else fails the run. npm's JSON output is used rather than its stderr because
// the log level, for example npm run -s, decides whether stderr shows them.
function checkNpmProblems(packageRoot: string, links: LinkedPackage[]) {
  const result = spawnSync(
    'npm ls --json --all --package-lock-only --omit=dev',
    {
      cwd: packageRoot,
      shell: true,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore']
    }
  );
  if (result.error) {
    throw result.error;
  }
  const problems = (JSON.parse(result.stdout) as NpmLsOutput).problems ?? [];
  const unexpected = problems.filter(
    (problem) => !isLinkProblem(problem, links)
  );
  if (unexpected.length > 0) {
    throw new Error(
      `npm reported problems the SBOM would not reflect:\n${unexpected.join('\n')}`
    );
  }
}

// Runtime dependencies declared with a file: spec, currently only qt-lib.
function findLinkedPackages(packageRoot: string): LinkedPackage[] {
  const pkg = readJson<PackageJson>(path.join(packageRoot, 'package.json'));
  return Object.entries(pkg.dependencies ?? {})
    .filter(([, spec]) => spec.startsWith('file:'))
    .map(([name, spec]) => ({
      name,
      root: path.resolve(packageRoot, spec.slice('file:'.length))
    }));
}

function packagePath(component: Component): string | undefined {
  return component.properties
    ?.find((property) => property.name === packagePathProperty)
    ?.value.replace(/\\/g, '/');
}

function collectRefs(components: Component[], refs: Set<string>) {
  for (const component of components) {
    refs.add(component['bom-ref']);
    collectRefs(component.components ?? [], refs);
  }
}

// Drops every component whose package path starts with pathPrefix and records
// the bom-refs that were dropped.
function removeComponentsUnder(
  components: Component[],
  pathPrefix: string,
  removed: Set<string>
): Component[] {
  const kept: Component[] = [];
  for (const component of components) {
    if (packagePath(component)?.startsWith(pathPrefix)) {
      collectRefs([component], removed);
      continue;
    }
    if (component.components) {
      component.components = removeComponentsUnder(
        component.components,
        pathPrefix,
        removed
      );
    }
    kept.push(component);
  }
  return kept;
}

function remapComponents(
  components: Component[],
  remapRef: (ref: string) => string,
  remapPath: (value: string) => string
) {
  for (const component of components) {
    component['bom-ref'] = remapRef(component['bom-ref']);
    for (const property of component.properties ?? []) {
      if (property.name === packagePathProperty) {
        property.value = remapPath(property.value);
      }
    }
    remapComponents(component.components ?? [], remapRef, remapPath);
  }
}

// npm cannot describe a file: dependency from the depending package's lock
// file. It either reports the link target's dependencies as missing, or, if
// the target's node_modules existed when the lock file was last written,
// copies whatever was on disk into the lock file, dev dependencies and stale
// versions included. Neither matches what ships. So the link target is
// described from its own lock file and grafted in under its component, named
// the way cyclonedx-npm names nested packages.
function graftLinkedPackage(
  sbom: Sbom,
  link: LinkedPackage,
  linkSbom: Sbom,
  linkRelativeRoot: string
) {
  const linkComponent = sbom.components.find(
    (component) => packagePath(component) === `node_modules/${link.name}`
  );
  if (!linkComponent) {
    throw new Error(`${link.name} is missing from the SBOM`);
  }
  const linkRef = linkComponent['bom-ref'];
  const linkRootRef = linkSbom.metadata.component['bom-ref'];

  const removed = new Set<string>();
  sbom.components = removeComponentsUnder(
    sbom.components,
    `${linkRelativeRoot}/`,
    removed
  );
  sbom.dependencies = sbom.dependencies.filter(
    (dependency) => !removed.has(dependency.ref)
  );
  for (const dependency of sbom.dependencies) {
    if (dependency.dependsOn) {
      dependency.dependsOn = dependency.dependsOn.filter(
        (ref) => !removed.has(ref)
      );
    }
  }

  const remapRef = (ref: string) => {
    if (ref !== linkRootRef && !ref.startsWith(`${linkRootRef}|`)) {
      throw new Error(`Unexpected bom-ref ${ref} in the ${link.name} SBOM`);
    }
    return linkRef + ref.slice(linkRootRef.length);
  };
  const remapPath = (value: string) => `node_modules/${link.name}/${value}`;
  remapComponents(linkSbom.components, remapRef, remapPath);
  sbom.components.push(...linkSbom.components);

  for (const dependency of linkSbom.dependencies) {
    const dependsOn = (dependency.dependsOn ?? []).map(remapRef);
    if (dependency.ref === linkRootRef) {
      const existing = sbom.dependencies.find((d) => d.ref === linkRef);
      if (existing) {
        existing.dependsOn = dependsOn;
      } else {
        sbom.dependencies.push({ ref: linkRef, dependsOn });
      }
    } else {
      sbom.dependencies.push({ ref: remapRef(dependency.ref), dependsOn });
    }
  }

  // The lock file entry for the link carries no license, its package.json does.
  if (linkSbom.metadata.component.licenses) {
    linkComponent.licenses = linkSbom.metadata.component.licenses;
  }
}

function compareStrings(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}

function sortComponents(components: Component[]) {
  components.sort((a, b) => compareStrings(a['bom-ref'], b['bom-ref']));
  for (const component of components) {
    if (component.components) {
      sortComponents(component.components);
    }
  }
}

// Restores the ordering cyclonedx-npm produces with --output-reproducible.
function sortSbom(sbom: Sbom) {
  sortComponents(sbom.components);
  sbom.dependencies.sort((a, b) => compareStrings(a.ref, b.ref));
  for (const dependency of sbom.dependencies) {
    dependency.dependsOn?.sort(compareStrings);
  }
}

// The npm version is the only part of the document that depends on the machine
// rather than on the committed lock file, so drop it to keep the SBOM diffable.
function removeNpmToolEntry(sbom: Sbom) {
  sbom.metadata.tools.components = sbom.metadata.tools.components.filter(
    (tool) => tool.name !== 'npm' || tool.group !== undefined
  );
}

function main() {
  program.option('-o, --output <string>', 'Path to output file');
  program.requiredOption('-d, --dir <string>', 'Path to target extension root');
  program.parse(process.argv);
  const options = program.opts();
  const outputFile = options.output as string | undefined;
  // --dir is relative to the repository root, or absolute.
  const repoRoot = path.resolve(__dirname, '../');
  const targetExtensionRoot = path.resolve(repoRoot, options.dir as string);
  const sbomFile = outputFile
    ? path.resolve(outputFile)
    : path.resolve(targetExtensionRoot, 'sbom.cdx.json');

  console.log('Generating SBOM...');
  const links = findLinkedPackages(targetExtensionRoot);
  // npm reports the dependencies of a file: link as missing or invalid, see
  // graftLinkedPackage. Without links every npm error is a real problem and
  // cyclonedx-npm fails on it by itself.
  if (links.length > 0) {
    checkNpmProblems(targetExtensionRoot, links);
  }
  runCyclonedx(targetExtensionRoot, sbomFile, links.length > 0);
  const sbom = readJson<Sbom>(sbomFile);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sbom-'));
  try {
    for (const link of links) {
      console.log(`Describing ${link.name} from its own lock file...`);
      const linkSbomFile = path.join(tempDir, 'linked.cdx.json');
      runCyclonedx(link.root, linkSbomFile, false);
      const linkRelativeRoot = path
        .relative(targetExtensionRoot, link.root)
        .split(path.sep)
        .join('/');
      graftLinkedPackage(
        sbom,
        link,
        readJson<Sbom>(linkSbomFile),
        linkRelativeRoot
      );
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  sortSbom(sbom);
  removeNpmToolEntry(sbom);
  fs.writeFileSync(sbomFile, JSON.stringify(sbom, null, 2));
  console.log(`SBOM generated successfully: ${sbomFile}`);
}

main();
