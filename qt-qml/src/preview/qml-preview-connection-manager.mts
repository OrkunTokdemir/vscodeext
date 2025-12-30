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
import { QrcResourceFinder } from './qrc-resource-finder.mjs';
import { createLogger, delay } from 'qt-lib';

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
  private readonly _qrcFinder: QrcResourceFinder;
  private _fileSystemWatcher?: vscode.FileSystemWatcher;
  private _lastLoadedUrl?: string;
  private readonly _settings: QmlPreviewSettings = {};
  private _buildDirs: string[] = [];
  // Map from local file paths to QRC paths
  private readonly _pathMap = new Map<string, string>();

  constructor() {
    super();
    this._qrcFinder = new QrcResourceFinder();
  }

  set buildDirs(dirs: string[]) {
    this._buildDirs = dirs;
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
            `"${requestedPath}"`,
            ' with',
            resource.children?.length.toString() ?? '0',
            ' entries:',
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
            if (!this._lastLoadedUrl && requestedPath.endsWith('.qml')) {
              this._lastLoadedUrl = requestedPath;
              logger.info('Set main URL to:', this._lastLoadedUrl);
            }
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
        const preview = contents
          .slice(0, 100)
          .toString('utf8')
          .replace(/\n/g, '\\n');
        logger.info(
          `===> Reading from open document: "${filename}" bytes: ${contents.length}`
        );
        logger.info(`     Content preview: ${preview}...`);
        return { success: true, contents };
      }

      // Fallback to reading from disk
      const contents = fs.readFileSync(filename);
      const preview = contents
        .slice(0, 100)
        .toString('utf8')
        .replace(/\n/g, '\\n');
      logger.info(
        `===> Reading from disk: "${filename}" bytes: ${contents.length}`
      );
      logger.info(`     Content preview: ${preview}...`);
      return { success: true, contents };
    } catch (error) {
      logger.error(`Error loading file: "${filename}", ${String(error)}`);
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

    this._fileSystemWatcher.onDidChange(async (uri) => {
      logger.info('File changed:', uri.fsPath);
      await this.handleFileChange(uri.fsPath);
    });

    this._fileSystemWatcher.onDidCreate((uri) => {
      logger.info('File created:', uri.fsPath);
      // Clear cache when new files are added
      this._previewClient?.clearCache();
    });
  }

  private async handleFileChange(changedFile: string) {
    if (!this._previewClient) {
      return;
    }

    logger.info(`===> File changed: "${changedFile}"`);

    const loader =
      this._settings.fileLoader ??
      ((f: string) => QmlPreviewConnectionManager.defaultFileLoader(f));
    const { success, contents } = loader(changedFile);

    if (!success) {
      logger.warn('Failed to load changed file:', `"${changedFile}"`);
      return;
    }

    const preview = contents
      .slice(0, 100)
      .toString('utf8')
      .replace(/\n/g, '\\n');
    logger.info(`Loaded content: ${contents.length} bytes`);
    logger.info(`Content preview: ${preview}...`);

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
      logger.info(
        'Announcing file update:',
        `"${remotePath}" for local file:`,
        changedFile
      );
      this._previewClient.announceFile(remotePath, contents);
    } else {
      logger.warn('No QRC path mapping found for:', changedFile);
      this._previewClient.clearCache();
    }

    // Always reload the main URL after announcing file changes
    logger.info(`===> Reloading last loaded URL after file change`);
    if (this._lastLoadedUrl) {
      logger.info('Reloading URL:', `"${this._lastLoadedUrl}"`);
      // delay to ensure file announcement is processed first
      await delay(200);
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
