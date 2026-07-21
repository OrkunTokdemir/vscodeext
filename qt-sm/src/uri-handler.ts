// Copyright (C) 2026 The Qt Company Ltd.
// SPDX-License-Identifier: LicenseRef-Qt-Commercial OR LGPL-3.0-only

import * as vscode from 'vscode';

import { createLogger } from 'qt-lib';

const logger = createLogger('uri-handler');

export const AUTH_CALLBACK_PATH = '/authenticate';

/** Query parameters of the OAuth redirect back into VS Code. */
export interface AuthCallback {
  code?: string;
  error?: string;
  errorDescription?: string;
}

type PendingResolver = (result: AuthCallback) => void;

/**
 * Routes vscode://theqtcompany.qt-sm/authenticate callbacks to the login
 * attempt waiting for them, matched by the OAuth `state` parameter.
 * VS Code allows a single UriHandler per extension, so one instance is
 * registered at activation and shared.
 */
export class AuthUriHandler implements vscode.UriHandler {
  private readonly _pending = new Map<string, PendingResolver>();

  handleUri(uri: vscode.Uri): void {
    if (uri.path !== AUTH_CALLBACK_PATH) {
      logger.warn(`Ignoring URI with unexpected path: ${uri.path}`);
      return;
    }
    const params = new URLSearchParams(uri.query);
    const state = params.get('state');
    const resolver = state ? this._pending.get(state) : undefined;
    if (!state || !resolver) {
      // Unknown state: stale, duplicate, or forged callback (CSRF guard).
      logger.warn('Ignoring auth callback with unknown or missing state');
      return;
    }
    this._pending.delete(state);
    logger.info('Received auth callback from browser');
    const callback: AuthCallback = {};
    const code = params.get('code');
    if (code) {
      callback.code = code;
    }
    const error = params.get('error');
    if (error) {
      callback.error = error;
    }
    const errorDescription = params.get('error_description');
    if (errorDescription) {
      callback.errorDescription = errorDescription;
    }
    resolver(callback);
  }

  /**
   * Wait for the browser to redirect back with the given `state`.
   * Rejects on timeout or when the user cancels the progress notification.
   */
  async waitForCallback(
    state: string,
    timeoutMs: number,
    token: vscode.CancellationToken
  ): Promise<AuthCallback> {
    return new Promise<AuthCallback>((resolve, reject) => {
      const cleanup = (
        timer?: NodeJS.Timeout,
        cancelSub?: vscode.Disposable
      ) => {
        if (timer) {
          clearTimeout(timer);
        }
        cancelSub?.dispose();
        this._pending.delete(state);
      };
      const timer = setTimeout(() => {
        cleanup(timer, cancelSub);
        reject(new Error('Login timed out. Please try again.'));
      }, timeoutMs);
      const cancelSub = token.onCancellationRequested(() => {
        cleanup(timer, cancelSub);
        reject(new Error('Login cancelled'));
      });
      this._pending.set(state, (result) => {
        cleanup(timer, cancelSub);
        resolve(result);
      });
    });
  }
}

/** Register the auth URI handler. Call once from extension activate(). */
export function registerAuthUriHandler(
  context: vscode.ExtensionContext
): AuthUriHandler {
  const handler = new AuthUriHandler();
  context.subscriptions.push(vscode.window.registerUriHandler(handler));
  return handler;
}
