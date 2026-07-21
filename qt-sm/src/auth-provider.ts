// Copyright (C) 2026 The Qt Company Ltd.
// SPDX-License-Identifier: LicenseRef-Qt-Commercial OR LGPL-3.0-only

import * as vscode from 'vscode';

import {
  QtAccount,
  QtAccountStorage,
  QtLoginOidc,
  OidcError,
  type AuthCredentials,
  type LogLevel
} from 'sms-api';
import { createLogger } from 'qt-lib';
import {
  OIDC_CLIENT_ID,
  LOGIN_TIMEOUT_MS,
  SECRET_REFRESH_TOKEN
} from '@/constants';
import {
  AUTH_CALLBACK_PATH,
  type AuthCallback,
  type AuthUriHandler
} from '@/uri-handler';

const logger = createLogger('auth');

function logCallback(tag: string) {
  return (level: LogLevel, message: string) => {
    switch (level) {
      case 'error':
        logger.error(`[${tag}] ${message}`);
        break;
      case 'warn':
        logger.warn(`[${tag}] ${message}`);
        break;
      case 'info':
        logger.info(`[${tag}] ${message}`);
        break;
      default:
        logger.info(`[${tag}] ${message}`);
    }
  };
}

export const AUTH_PROVIDER_ID = 'qt-account';
const AUTH_PROVIDER_LABEL = 'Qt Account';

/**
 * VS Code AuthenticationProvider backed by a browser-based OIDC
 * authorization-code + PKCE login against login.qt.io (QTPIF-268).
 *
 * The resulting access token is stored as the Qt JWT in qtaccount.ini
 * (shared with the C++ Software Management Service); the refresh token
 * lives in VS Code SecretStorage only.
 *
 * Sessions are keyed by email address with `['qt-account']` scope.
 */
export class QtAccountAuthenticationProvider
  implements vscode.AuthenticationProvider, vscode.Disposable
{
  private readonly _disposables: vscode.Disposable[] = [];
  private readonly _onDidChangeSessions =
    new vscode.EventEmitter<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>();
  readonly onDidChangeSessions = this._onDidChangeSessions.event;

  private readonly _context: vscode.ExtensionContext;
  private readonly _uriHandler: AuthUriHandler;
  private _currentSession: vscode.AuthenticationSession | undefined;

  constructor(context: vscode.ExtensionContext, uriHandler: AuthUriHandler) {
    this._context = context;
    this._uriHandler = uriHandler;

    // Try loading existing credentials at startup
    logger.info('Initializing QtAccountAuthenticationProvider');
    const storage = new QtAccountStorage();
    storage.onLog = logCallback('QtAccountStorage');
    const loaded = storage.load();
    logger.info(
      `Storage load result: ${String(loaded)}, hasCredentials: ${String(storage.hasCredentials())}`
    );
    if (loaded && storage.hasCredentials()) {
      this._currentSession = credentialsToSession(storage.toCredentials());
      logger.info(`Loaded stored Qt Account session for ${storage.email}`);
    } else {
      logger.info('No stored credentials found');
    }
  }

  dispose(): void {
    this._onDidChangeSessions.dispose();
    for (const d of this._disposables) {
      d.dispose();
    }
  }

  async getSessions(
    scopes?: readonly string[]
  ): Promise<vscode.AuthenticationSession[]> {
    logger.info(`getSessions called with scopes: ${JSON.stringify(scopes)}`);
    // If specific scopes are requested and ours isn't included, return empty
    if (scopes && scopes.length > 0 && !scopes.includes(AUTH_PROVIDER_ID)) {
      logger.info('Scopes do not include our provider ID, returning empty');
      return Promise.resolve([]);
    }
    const hasSession = this._currentSession !== undefined;
    logger.info(`Returning ${hasSession ? '1' : '0'} session(s)`);
    return Promise.resolve(this._currentSession ? [this._currentSession] : []);
  }

  async createSession(
    scopes: readonly string[]
  ): Promise<vscode.AuthenticationSession> {
    void scopes;
    const oidc = new QtLoginOidc({ clientId: OIDC_CLIENT_ID });
    oidc.onLog = logCallback('QtLoginOidc');

    // asExternalUri makes the callback work in Remote-SSH / web;
    // env.uriScheme handles Insiders and other VS Code flavors.
    const callbackUri = await vscode.env.asExternalUri(
      vscode.Uri.parse(
        `${vscode.env.uriScheme}://${this._context.extension.id}${AUTH_CALLBACK_PATH}`
      )
    );
    const attempt = await oidc.beginLogin(callbackUri.toString(true));

    logger.info('Opening browser for Qt Account login');
    const opened = await vscode.env.openExternal(
      vscode.Uri.parse(attempt.authorizationUrl)
    );
    if (!opened) {
      const msg = 'Could not open the browser for Qt Account login.';
      logger.error(msg);
      void vscode.window.showErrorMessage(msg);
      throw new Error(msg);
    }

    let callback: AuthCallback;
    try {
      callback = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Signing in to Qt Account in your browser...',
          cancellable: true
        },
        async (_progress, token) =>
          this._uriHandler.waitForCallback(
            attempt.state,
            LOGIN_TIMEOUT_MS,
            token
          )
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`Browser login did not complete: ${msg}`);
      if (msg !== 'Login cancelled') {
        void vscode.window.showErrorMessage(`Qt Account login failed: ${msg}`);
      }
      throw err instanceof Error ? err : new Error(msg);
    }

    if (callback.error ?? !callback.code) {
      const readable = readableOAuthError(callback);
      logger.error(
        `Browser login failed: ${callback.error ?? 'no authorization code returned'}`
      );
      void vscode.window.showErrorMessage(
        `Qt Account login failed: ${readable}`
      );
      throw new Error(readable);
    }

    let credentials: AuthCredentials;
    try {
      const tokens = await oidc.exchangeCode({
        code: callback.code,
        codeVerifier: attempt.codeVerifier,
        redirectUri: attempt.redirectUri
      });
      const identity = await oidc.resolveIdentity(tokens);

      // Restrict alpha access to Qt employees. Checked before anything is
      // persisted so a rejected account leaves no credentials behind.
      if (!identity.email.toLowerCase().endsWith('@qt.io')) {
        throw new Error(
          `Qt Account "${identity.email}" is not in the alpha access list.`
        );
      }

      credentials = oidc.persistCredentials(identity, tokens);
      if (tokens.refreshToken) {
        await this._context.secrets.store(
          SECRET_REFRESH_TOKEN,
          tokens.refreshToken
        );
      } else {
        await this._context.secrets.delete(SECRET_REFRESH_TOKEN);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`Login failed: ${msg}`);
      void vscode.window.showErrorMessage(`Qt Account login failed: ${msg}`);
      throw err instanceof Error ? err : new Error(msg);
    }

    this._currentSession = credentialsToSession(credentials);

    this._onDidChangeSessions.fire({
      added: [this._currentSession],
      removed: [],
      changed: []
    });

    logger.info(`Logged in as ${credentials.email}`);
    void vscode.window.showInformationMessage(
      `Successfully signed in to Qt Account as ${credentials.email}`
    );
    return this._currentSession;
  }

  async removeSession(sessionId: string): Promise<void> {
    logger.info(`removeSession called for sessionId: ${sessionId}`);
    if (this._currentSession?.id === sessionId) {
      const removed = this._currentSession;
      this._currentSession = undefined;

      const account = new QtAccount();
      account.onLog = logCallback('QtAccount');
      account.logout();
      await this._context.secrets.delete(SECRET_REFRESH_TOKEN);

      this._onDidChangeSessions.fire({
        added: [],
        removed: [removed],
        changed: []
      });

      logger.info(`Logged out of Qt Account (${removed.account.label})`);
      void vscode.window.showInformationMessage(
        `Logged out of Qt Account (${removed.account.label})`
      );
    }
  }

  /**
   * Try to renew the stored session using the OIDC refresh token.
   * Returns the session if renewal succeeded, undefined otherwise.
   */
  async tryRenewSession(): Promise<vscode.AuthenticationSession | undefined> {
    logger.info('Attempting to renew session');
    const storage = new QtAccountStorage();
    storage.onLog = logCallback('QtAccountStorage');
    if (!storage.load() || !storage.hasCredentials()) {
      logger.info('No stored credentials available for renewal');
      return undefined;
    }
    const refreshToken = await this._context.secrets.get(SECRET_REFRESH_TOKEN);
    if (!refreshToken) {
      logger.info('No stored refresh token; user must sign in again');
      return undefined;
    }

    const oidc = new QtLoginOidc({ clientId: OIDC_CLIENT_ID });
    oidc.onLog = logCallback('QtLoginOidc');
    try {
      const tokens = await oidc.refresh(refreshToken);
      storage.setCredentials(storage.email, tokens.accessToken, storage.userId);
      storage.save();
      if (tokens.refreshToken && tokens.refreshToken !== refreshToken) {
        // The server rotated the refresh token; keep the latest one.
        await this._context.secrets.store(
          SECRET_REFRESH_TOKEN,
          tokens.refreshToken
        );
      }
      this._currentSession = credentialsToSession(storage.toCredentials());
      this._onDidChangeSessions.fire({
        added: [],
        removed: [],
        changed: [this._currentSession]
      });
      logger.info(`Renewed Qt Account session for ${storage.email}`);
      return this._currentSession;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`Failed to renew Qt Account session: ${msg}`);
      if (err instanceof OidcError && err.oauthError === 'invalid_grant') {
        // Refresh token revoked or expired; drop it so the next renewal
        // attempt doesn't retry a dead token.
        await this._context.secrets.delete(SECRET_REFRESH_TOKEN);
      }
      return undefined;
    }
  }
}

/** Turn an OAuth redirect error into a message fit for a notification. */
function readableOAuthError(callback: AuthCallback): string {
  if (callback.error === 'access_denied') {
    return 'Login was cancelled or denied in the browser.';
  }
  if (callback.errorDescription) {
    return callback.errorDescription;
  }
  if (callback.error) {
    return `The login server reported: ${callback.error}`;
  }
  return 'The browser login did not return an authorization code.';
}

function credentialsToSession(
  credentials: AuthCredentials
): vscode.AuthenticationSession {
  return {
    id: credentials.userId || credentials.email,
    accessToken: credentials.jwt,
    account: {
      id: credentials.userId || credentials.email,
      label: credentials.email
    },
    scopes: [AUTH_PROVIDER_ID]
  };
}

/**
 * Register the Qt Account authentication provider.
 * Call from extension activate().
 */
export function registerAuthenticationProvider(
  context: vscode.ExtensionContext,
  uriHandler: AuthUriHandler
): QtAccountAuthenticationProvider {
  const provider = new QtAccountAuthenticationProvider(context, uriHandler);

  context.subscriptions.push(
    vscode.authentication.registerAuthenticationProvider(
      AUTH_PROVIDER_ID,
      AUTH_PROVIDER_LABEL,
      provider,
      { supportsMultipleAccounts: false }
    )
  );

  context.subscriptions.push(provider);
  return provider;
}
