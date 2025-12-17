// Copyright (C) 2025 The Qt Company Ltd.
// SPDX-License-Identifier: LicenseRef-Qt-Commercial OR LGPL-3.0-only

import * as vscode from 'vscode';
import * as fs from 'fs';
// import * as path from 'path';

import {
  QmlDebugConnection,
  QmlDebugConnectionManager
} from '@debug/debug-connection.mjs';
import { QmlPreviewClient, FpsInfo } from './qml-preview-client.mjs';
import { FileFinder } from '@debug/file-finder.js';
import { QrcResourceFinder } from './qrc-resource-finder.mjs';
import { createLogger } from 'qt-lib';

const logger = createLogger('qml-preview-manager');

export type FileLoader = (filename: string) => {
  success: boolean;
  contents: Buffer;
};
export type FileClassifier = (filename: string) => boolean;
export type FpsHandler = (fps: FpsInfo) => void;

export interface QmlPreviewSettings {
  fileLoader?: FileLoader;
  fileClassifier?: FileClassifier;
  fpsHandler?: FpsHandler;
}

export class QmlPreviewConnectionManager extends QmlDebugConnectionManager {
  private _previewClient?: QmlPreviewClient;
  private readonly _fileFinder: FileFinder;
  private readonly _qrcFinder: QrcResourceFinder;
  private _fileSystemWatcher?: vscode.FileSystemWatcher;
  private _lastLoadedUrl?: URL;
  private readonly _settings: QmlPreviewSettings = {};
  private _buildDirs: string[] = [];
  // Map from local file paths to QRC paths
  private readonly _pathMap = new Map<string, string>();

  constructor() {
    super();
    this._fileFinder = new FileFinder();
    this._qrcFinder = new QrcResourceFinder();
  }

  set buildDirs(dirs: string[]) {
    this._buildDirs = dirs;
    this._fileFinder.buildDirs = dirs;
    this._qrcFinder.buildDirs = dirs;
  }

  get buildDirs() {
    return this._buildDirs;
  }

  setFileLoader(loader: FileLoader) {
    this._settings.fileLoader = loader;
  }

  setFileClassifier(classifier: FileClassifier) {
    this._settings.fileClassifier = classifier;
  }

  setFpsHandler(handler: FpsHandler) {
    this._settings.fpsHandler = handler;
  }

  override createConnection() {
    super.createConnection();
    if (this.connection) {
      this.createPreviewClient(this.connection);
    }
  }

  private createPreviewClient(connection: QmlDebugConnection) {
    this._previewClient = new QmlPreviewClient(connection);

    // Handle file/directory requests from the app
    this._previewClient.onPathRequested(async (requestPath) => {
      await this.handlePathRequest(requestPath);
    });

    // Handle errors
    this._previewClient.onErrorReported((error) => {
      logger.error('QML Preview error:', error);
      void vscode.window.showErrorMessage(`QML Preview: ${error}`);
    });

    // Handle FPS reports
    this._previewClient.onFpsReported((fps) => {
      if (this._settings.fpsHandler) {
        this._settings.fpsHandler(fps);
      } else {
        logger.info(`QML Preview: ${fps.numSyncs} fps`);
      }
    });

    // Handle service unavailable
    this._previewClient.onDebugServiceUnavailable(() => {
      void vscode.window.showWarningMessage(
        'QML Preview is not available for this version of Qt.'
      );
    });
  }

  async loadFile(filename: string, changedFile: string, contents: Buffer) {
    if (!this._previewClient) {
      logger.warn('Preview client not initialized');
      return;
    }

    // Check if file can be hot-reloaded
    const classifier =
      this._settings.fileClassifier ??
      ((f: string) => QmlPreviewConnectionManager.defaultFileClassifier(f));
    if (!classifier(changedFile)) {
      logger.info('File requires app restart:', changedFile);
      this._previewClient.rerun();
      return;
    }

    // Find the remote path for the changed file
    const remotePath = QmlPreviewConnectionManager.findRemotePath(changedFile);
    if (remotePath) {
      this._previewClient.announceFile(remotePath, contents);
    } else {
      logger.warn('Could not find remote path for:', changedFile);
      this._previewClient.clearCache();
    }

    // Load the main file
    const url = await this.findUrl(filename);
    if (url) {
      this._lastLoadedUrl = url;
      this._previewClient.loadUrl(url);
    }
  }

  rerun() {
    this._previewClient?.rerun();
  }

  zoom(factor: number) {
    this._previewClient?.zoom(factor);
  }

  private async handlePathRequest(requestedPath: string) {
    logger.info('Path requested:', requestedPath);

    if (!this._previewClient) {
      return;
    }

    // Check if this is a QRC path (starts with : or qrc:)
    const isQrcPath =
      requestedPath.startsWith(':') || requestedPath.startsWith('qrc:');

    if (isQrcPath) {
      // Handle QRC resource
      const resource = await this._qrcFinder.findResource(requestedPath);

      if (resource) {
        if (resource.type === 'directory') {
          // It's a virtual directory - return synthesized directory listing
          logger.info(
            'Announcing QRC directory:',
            requestedPath,
            'with',
            resource.children?.length.toString() ?? '0',
            'entries:',
            resource.children?.join(', ') ?? ''
          );
          this._previewClient.announceDirectory(
            requestedPath,
            resource.children ?? []
          );
          return;
        } else if (resource.realPath) {
          // It's a file - map it and load contents
          this._pathMap.set(resource.realPath, requestedPath);
          logger.info('Mapped QRC:', resource.realPath, '->', requestedPath);

          const loader =
            this._settings.fileLoader ??
            ((f: string) => QmlPreviewConnectionManager.defaultFileLoader(f));
          const { success, contents } = loader(resource.realPath);

          if (success) {
            logger.info('Announcing QRC file:', requestedPath);
            this._previewClient.announceFile(requestedPath, contents);
            return;
          }
        }
      }

      // QRC path not found
      logger.warn('QRC path not found:', requestedPath);
      this._previewClient.announceError(requestedPath);
      return;
    }
    // It is a real path
    // Check if it's a directory or file
    const fsPath = requestedPath;
    if (fs.existsSync(fsPath)) {
      const stats = fs.statSync(fsPath);
      if (stats.isDirectory()) {
        // It's a directory - read contents
        const entries = fs.readdirSync(fsPath);
        logger.info(
          'Announcing directory:',
          requestedPath,
          'with',
          entries.length.toString(),
          'entries: ',
          entries.join(', ')
        );
        this._previewClient.announceDirectory(requestedPath, entries);
        return;
      } else if (stats.isFile()) {
        // It's a file - load contents
        const loader =
          this._settings.fileLoader ??
          ((f: string) => QmlPreviewConnectionManager.defaultFileLoader(f));
        const { success, contents } = loader(fsPath);

        if (success) {
          logger.info('Announcing file:', requestedPath);
          this._previewClient.announceFile(requestedPath, contents);
          return;
        }
      }
    }

    // Path not found
    logger.warn('Path not found:', requestedPath);
    this._previewClient.announceError(requestedPath);
  }

  // private async findDirectoryFromQrc(
  //   dirPrefix: string
  // ): Promise<string | undefined> {
  //   // Try to find any file that starts with this directory prefix
  //   // For example, if looking for "/demos/calqlatr/content/",
  //   // find files ending with "/demos/calqlatr/content/Display.qml" in QRC

  //   // Get all QRC files
  //   const allQrcFiles = await vscode.workspace.findFiles('**/*.qrc');
  //   if (this._buildDirs.length > 0) {
  //     for (const buildDir of this._buildDirs) {
  //       const pattern = new vscode.RelativePattern(buildDir, '**/*.qrc');
  //       const additionalQrcFiles = await vscode.workspace.findFiles(pattern);
  //       allQrcFiles.push(...additionalQrcFiles);
  //     }
  //   }

  //   // Parse all QRC files and find entries that match this directory
  //   const parser = new QRCParser();
  //   for (const qrcFile of allQrcFiles) {
  //     const mapping = parser.parseQRCFile(qrcFile.fsPath);
  //     if (!mapping) {
  //       continue;
  //     }

  //     // Look for any entry where the QRC path ends with the directory prefix
  //     for (const [qrcPath, fsPath] of mapping.entries()) {
  //       // Check if this entry is inside the requested directory
  //       // e.g., qrcPath="/qt/qml/demos/calqlatr/content/Display.qml" should match dirPrefix="/demos/calqlatr/content/"
  //       if (
  //         qrcPath.endsWith(dirPrefix.substring(0, dirPrefix.length - 1)) ||
  //         qrcPath.includes(dirPrefix)
  //       ) {
  //         // Extract the directory from the filesystem path
  //         const dirPath = path.dirname(fsPath);
  //         if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
  //           return dirPath;
  //         }
  //       }
  //     }
  //   }

  //   // Try a different approach: search workspace for a directory matching the pattern
  //   const pathParts = dirPrefix.split('/').filter((p) => p);
  //   if (pathParts.length > 0) {
  //     const lastPart = pathParts[pathParts.length - 1];
  //     const dirs = await vscode.workspace.findFiles(
  //       `**/${lastPart}`,
  //       '**/node_modules/**',
  //       10
  //     );

  //     for (const dir of dirs) {
  //       const dirPath = dir.fsPath;
  //       if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
  //         return dirPath;
  //       }
  //       // Check parent directory
  //       const parentDir = dirPath.substring(0, dirPath.lastIndexOf('/'));
  //       const parentName = parentDir.substring(parentDir.lastIndexOf('/') + 1);
  //       if (
  //         parentName === lastPart &&
  //         fs.existsSync(parentDir) &&
  //         fs.statSync(parentDir).isDirectory()
  //       ) {
  //         return parentDir;
  //       }
  //     }
  //   }

  //   return undefined;
  // }

  private static findRemotePath(localPath: string): string | undefined {
    // For now, use the local path as remote path
    // In a real implementation, this would handle build directory mappings
    // similar to Qt Creator's TargetFileFinder
    return localPath;
  }

  private async findUrl(filename: string): Promise<URL | undefined> {
    try {
      // Try to find the file
      const foundPath = await this._fileFinder.findFile(filename);
      if (foundPath) {
        return new URL(`file://${foundPath}`);
      }

      // If it starts with qrc:, handle it
      if (filename.startsWith('qrc:') || filename.startsWith(':')) {
        return new URL(filename);
      }

      return undefined;
    } catch (error) {
      logger.error('Error finding URL:', String(error));
      return undefined;
    }
  }

  private static defaultFileLoader(filename: string): {
    success: boolean;
    contents: Buffer;
  } {
    try {
      // Try to get from open editor first (unsaved changes)
      const uri = vscode.Uri.file(filename);
      const doc = vscode.workspace.textDocuments.find(
        (d) => d.uri.toString() === uri.toString()
      );

      if (doc && !doc.isClosed) {
        const contents = Buffer.from(doc.getText(), 'utf8');
        return { success: true, contents };
      }

      // Fallback to reading from disk
      const contents = fs.readFileSync(filename);
      return { success: true, contents };
    } catch (error) {
      logger.error(`Error loading file: ${filename}, ${String(error)}`);
      return { success: false, contents: Buffer.alloc(0) };
    }
  }

  private static defaultFileClassifier(filename: string): boolean {
    // qtquickcontrols2.conf changes require full restart
    if (filename.endsWith('qtquickcontrols2.conf')) {
      return false;
    }
    // Most QML files can be hot-reloaded
    return true;
  }

  setupFileWatcher() {
    // Watch for QML and JS file changes
    this._fileSystemWatcher = vscode.workspace.createFileSystemWatcher(
      '**/*.{qml,js}',
      false, // ignoreCreateEvents
      false, // ignoreChangeEvents
      true // ignoreDeleteEvents
    );

    this._fileSystemWatcher.onDidChange((uri) => {
      logger.info('File changed:', uri.fsPath);
      this.handleFileChange(uri.fsPath);
    });

    this._fileSystemWatcher.onDidCreate((uri) => {
      logger.info('File created:', uri.fsPath);
      // Clear cache when new files are added
      this._previewClient?.clearCache();
    });
  }

  private handleFileChange(changedFile: string) {
    if (!this._previewClient) {
      return;
    }

    logger.info('Processing file change:', changedFile);

    const loader =
      this._settings.fileLoader ??
      ((f: string) => QmlPreviewConnectionManager.defaultFileLoader(f));
    const { success, contents } = loader(changedFile);

    if (!success) {
      logger.warn('Failed to load changed file:', changedFile);
      return;
    }

    const classifier =
      this._settings.fileClassifier ??
      ((f: string) => QmlPreviewConnectionManager.defaultFileClassifier(f));
    if (!classifier(changedFile)) {
      logger.info('File requires full restart:', changedFile);
      this._previewClient.rerun();
      return;
    }

    // Use the path mapping to find the QRC path
    const remotePath = this._pathMap.get(changedFile);
    if (remotePath) {
      logger.info('Announcing file update:', remotePath);
      this._previewClient.announceFile(remotePath, contents);
    } else {
      logger.warn('No QRC path mapping found for:', changedFile);
      this._previewClient.clearCache();
    }

    // Always reload the main URL after announcing file changes
    if (this._lastLoadedUrl) {
      logger.info('Reloading URL:', this._lastLoadedUrl.toString());
      this._previewClient.loadUrl(this._lastLoadedUrl);
    }
  }
  clearCache() {
    this._previewClient?.clearCache();
  }

  override isConnected(): boolean {
    return this._previewClient !== undefined && super.isConnected();
  }

  override dispose() {
    this._fileSystemWatcher?.dispose();
    this._previewClient?.dispose();
    super.dispose();
  }
}
