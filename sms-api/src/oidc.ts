/* Copyright (C) 2026 The Qt Company Ltd.
 *
 * SPDX-License-Identifier: LicenseRef-Qt-Commercial OR GPL-3.0-only WITH Qt-GPL-exception-1.0
 */

/**
 * Browser-based Qt Account login — OIDC authorization code + PKCE against
 * login.qt.io. Client side of QTPIF-268 (SMS: Qt login OIDC support to
 * client).
 *
 * Provides:
 *   - PKCE / state helpers (RFC 7636)
 *   - QtLoginOidc: discovery, authorization URL, code exchange, token
 *     refresh, identity resolution, credential persistence via
 *     QtAccountStorage (qtaccount.ini — shared with the C++ service)
 */

import * as crypto from 'crypto';
import * as http from 'http';
import * as https from 'https';

import type { LogCallback, LogLevel } from './qt-account';

// ── Constants ────────────────────────────────────────────────────────────────

export const OIDC_SCOPES = 'openid email offline_access';

// ── PKCE / state helpers (RFC 7636) ──────────────────────────────────────────

export interface PkcePair {
  verifier: string;
  challenge: string;
}

/** S256 code challenge for a given verifier (RFC 7636 §4.2). */
export function computeS256Challenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

/** Random PKCE verifier (43 base64url chars) and its S256 challenge. */
export function generatePkcePair(): PkcePair {
  const verifier = crypto.randomBytes(32).toString('base64url');
  return { verifier, challenge: computeS256Challenge(verifier) };
}

/** Random opaque `state` value binding a callback to a login attempt. */
export function generateState(): string {
  return crypto.randomBytes(16).toString('base64url');
}

// ── Server constants ─────────────────────────────────────────────────────────

const DEFAULT_LOGIN_SERVER = 'https://login.qt.io';
const DISCOVERY_PATH = '/.well-known/openid-configuration';
// Fallbacks mirror the published login.qt.io discovery document.
const FALLBACK_AUTHORIZE_PATH = '/authorize';
const FALLBACK_TOKEN_PATH = '/oauth/token';
const FALLBACK_USERINFO_PATH = '/api/userinfo';

// ── HTTP helper (scheme-aware: https in production, http for tests) ─────────

interface HttpResponse {
  statusCode: number;
  body: string;
}

async function request(
  url: string,
  options: {
    method: 'GET' | 'POST';
    headers?: Record<string, string>;
    body?: string;
  }
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const lib = urlObj.protocol === 'http:' ? http : https;
    const req = lib.request(
      {
        hostname: urlObj.hostname,
        port: urlObj.port || (urlObj.protocol === 'http:' ? 80 : 443),
        path: urlObj.pathname + urlObj.search,
        method: options.method,
        headers: options.headers
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf-8')
          });
        });
      }
    );
    req.on('error', (err) => {
      reject(err);
    });
    if (options.body !== undefined) {
      req.write(options.body);
    }
    req.end();
  });
}

// ── QtLoginOidc ──────────────────────────────────────────────────────────────

export interface QtLoginOidcOptions {
  /** OIDC client id registered with login.qt.io. */
  clientId: string;
  /** Login server base URL; defaults to QT_LOGIN_SERVER_URL or login.qt.io. */
  serverUrl?: string;
  /** qtaccount.ini path override (tests); defaults to the shared location. */
  storagePath?: string;
}

export interface OidcEndpoints {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  userinfoEndpoint: string;
}

export interface LoginAttempt {
  authorizationUrl: string;
  state: string;
  codeVerifier: string;
  redirectUri: string;
}

export class QtLoginOidc {
  private readonly _clientId: string;
  private readonly _serverUrl: string;
  private _endpoints: OidcEndpoints | undefined;

  onLog: LogCallback | undefined;

  constructor(options: QtLoginOidcOptions) {
    this._clientId = options.clientId;
    this._serverUrl =
      options.serverUrl ??
      process.env.QT_LOGIN_SERVER_URL ??
      DEFAULT_LOGIN_SERVER;
  }

  private log(level: LogLevel, message: string): void {
    this.onLog?.(level, message);
  }

  private fallbackEndpoints(): OidcEndpoints {
    return {
      authorizationEndpoint: this._serverUrl + FALLBACK_AUTHORIZE_PATH,
      tokenEndpoint: this._serverUrl + FALLBACK_TOKEN_PATH,
      userinfoEndpoint: this._serverUrl + FALLBACK_USERINFO_PATH
    };
  }

  /**
   * Fetch the OIDC discovery document (cached). Falls back to the known
   * login.qt.io endpoint paths when discovery is unavailable.
   */
  async discover(): Promise<OidcEndpoints> {
    if (this._endpoints) {
      return this._endpoints;
    }
    const fallback = this.fallbackEndpoints();
    try {
      const res = await request(this._serverUrl + DISCOVERY_PATH, {
        method: 'GET',
        headers: { Accept: 'application/json' }
      });
      if (res.statusCode !== 200) {
        throw new Error(`HTTP ${String(res.statusCode)}`);
      }
      const parsed: unknown = JSON.parse(res.body);
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        throw new Error('Unexpected discovery document format');
      }
      const doc = parsed as Record<string, unknown>;
      this._endpoints = {
        authorizationEndpoint:
          typeof doc.authorization_endpoint === 'string'
            ? doc.authorization_endpoint
            : fallback.authorizationEndpoint,
        tokenEndpoint:
          typeof doc.token_endpoint === 'string'
            ? doc.token_endpoint
            : fallback.tokenEndpoint,
        userinfoEndpoint:
          typeof doc.userinfo_endpoint === 'string'
            ? doc.userinfo_endpoint
            : fallback.userinfoEndpoint
      };
      this.log('info', `OIDC discovery succeeded (${this._serverUrl})`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log(
        'warn',
        `OIDC discovery failed (${msg}); using default endpoints`
      );
      this._endpoints = fallback;
    }
    return this._endpoints;
  }

  /**
   * Start a login attempt: generates state + PKCE pair and builds the
   * authorization URL to open in the browser.
   */
  async beginLogin(redirectUri: string): Promise<LoginAttempt> {
    const endpoints = await this.discover();
    const { verifier, challenge } = generatePkcePair();
    const state = generateState();
    const url = new URL(endpoints.authorizationEndpoint);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', this._clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('scope', OIDC_SCOPES);
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    this.log('info', 'Prepared OIDC authorization request');
    return {
      authorizationUrl: url.toString(),
      state,
      codeVerifier: verifier,
      redirectUri
    };
  }
}
