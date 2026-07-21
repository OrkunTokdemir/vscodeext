/* Copyright (C) 2026 The Qt Company Ltd.
 *
 * SPDX-License-Identifier: LicenseRef-Qt-Commercial OR GPL-3.0-only WITH Qt-GPL-exception-1.0
 */

/**
 * Unit tests for the OIDC login module (PKCE, discovery, token exchange,
 * identity resolution, credential persistence).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as http from 'http';
import type { AddressInfo } from 'net';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import {
  computeS256Challenge,
  generatePkcePair,
  generateState,
  QtLoginOidc,
  OidcError,
  OIDC_SCOPES
} from '../../src/oidc';

// ── PKCE utilities ───────────────────────────────────────────────────────────

describe('PKCE utilities', () => {
  it('computes the RFC 7636 Appendix B challenge', () => {
    // Official test vector from RFC 7636 Appendix B.
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    assert.equal(
      computeS256Challenge(verifier),
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'
    );
  });

  it('generates a verifier of valid length and charset', () => {
    const { verifier, challenge } = generatePkcePair();
    // RFC 7636: 43-128 chars of [A-Za-z0-9-._~]; base64url gives a subset.
    assert.ok(verifier.length >= 43 && verifier.length <= 128);
    assert.match(verifier, /^[A-Za-z0-9\-._~]+$/);
    assert.equal(challenge, computeS256Challenge(verifier));
  });

  it('generates unique verifiers and states', () => {
    assert.notEqual(generatePkcePair().verifier, generatePkcePair().verifier);
    const state = generateState();
    assert.ok(state.length >= 16);
    assert.notEqual(state, generateState());
  });
});

// ── Test HTTP server helper ──────────────────────────────────────────────────

interface TestServer {
  url: string;
  close: () => void;
}

async function startServer(handler: http.RequestListener): Promise<TestServer> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${String(address.port)}`,
    close: () => server.close()
  };
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
  });
}

// ── Discovery & authorization URL ────────────────────────────────────────────

describe('QtLoginOidc.beginLogin', () => {
  it('builds the authorization URL from the discovery document', async () => {
    let discoveryHits = 0;
    let baseUrl = '';
    const srv = await startServer((req, res) => {
      if (req.url === '/.well-known/openid-configuration') {
        discoveryHits++;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            authorization_endpoint: `${baseUrl}/custom/authorize`,
            token_endpoint: `${baseUrl}/custom/token`,
            userinfo_endpoint: `${baseUrl}/custom/userinfo`
          })
        );
        return;
      }
      res.writeHead(404);
      res.end();
    });
    baseUrl = srv.url;

    const oidc = new QtLoginOidc({ clientId: 'cid-1', serverUrl: srv.url });
    const attempt = await oidc.beginLogin(
      'vscode://theqtcompany.qt-sm/authenticate'
    );

    const url = new URL(attempt.authorizationUrl);
    assert.equal(url.origin + url.pathname, `${srv.url}/custom/authorize`);
    assert.equal(url.searchParams.get('response_type'), 'code');
    assert.equal(url.searchParams.get('client_id'), 'cid-1');
    assert.equal(
      url.searchParams.get('redirect_uri'),
      'vscode://theqtcompany.qt-sm/authenticate'
    );
    assert.equal(url.searchParams.get('scope'), OIDC_SCOPES);
    assert.equal(url.searchParams.get('state'), attempt.state);
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(
      url.searchParams.get('code_challenge'),
      computeS256Challenge(attempt.codeVerifier)
    );
    assert.equal(
      attempt.redirectUri,
      'vscode://theqtcompany.qt-sm/authenticate'
    );

    // Discovery result is cached across calls.
    await oidc.beginLogin('vscode://theqtcompany.qt-sm/authenticate');
    assert.equal(discoveryHits, 1);
    srv.close();
  });

  it('falls back to default endpoints when discovery fails', async () => {
    const srv = await startServer((_req, res) => {
      res.writeHead(404);
      res.end();
    });

    const oidc = new QtLoginOidc({ clientId: 'cid-1', serverUrl: srv.url });
    const attempt = await oidc.beginLogin(
      'vscode://theqtcompany.qt-sm/authenticate'
    );
    assert.ok(attempt.authorizationUrl.startsWith(`${srv.url}/authorize?`));
    srv.close();
  });

  it('times out an unresponsive discovery server and falls back', async () => {
    // Server accepts connections but never responds.
    const srv = await startServer(() => {
      /* never respond */
    });

    const oidc = new QtLoginOidc({
      clientId: 'cid-1',
      serverUrl: srv.url,
      requestTimeoutMs: 100
    });
    const attempt = await oidc.beginLogin(
      'vscode://theqtcompany.qt-sm/authenticate'
    );
    assert.ok(attempt.authorizationUrl.startsWith(`${srv.url}/authorize?`));
    srv.close();
  });
});

// ── Token endpoint ───────────────────────────────────────────────────────────

describe('QtLoginOidc token endpoint', () => {
  it('exchanges the authorization code with PKCE verifier', async () => {
    let capturedBody = '';
    let capturedContentType = '';
    const srv = await startServer((req, res) => {
      if (req.method === 'POST' && req.url === '/oauth/token') {
        capturedContentType = req.headers['content-type'] ?? '';
        void readBody(req).then((body) => {
          capturedBody = body;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              access_token: 'access-1',
              id_token: 'id-1',
              refresh_token: 'refresh-1',
              expires_in: 3600,
              token_type: 'Bearer'
            })
          );
        });
        return;
      }
      res.writeHead(404);
      res.end();
    });

    const oidc = new QtLoginOidc({ clientId: 'cid-1', serverUrl: srv.url });
    const tokens = await oidc.exchangeCode({
      code: 'code-123',
      codeVerifier: 'verifier-123',
      redirectUri: 'vscode://theqtcompany.qt-sm/authenticate'
    });

    assert.equal(capturedContentType, 'application/x-www-form-urlencoded');
    const params = new URLSearchParams(capturedBody);
    assert.equal(params.get('grant_type'), 'authorization_code');
    assert.equal(params.get('client_id'), 'cid-1');
    assert.equal(params.get('code'), 'code-123');
    assert.equal(params.get('code_verifier'), 'verifier-123');
    assert.equal(
      params.get('redirect_uri'),
      'vscode://theqtcompany.qt-sm/authenticate'
    );
    assert.deepEqual(tokens, {
      accessToken: 'access-1',
      idToken: 'id-1',
      refreshToken: 'refresh-1',
      expiresIn: 3600
    });
    srv.close();
  });

  it('surfaces OAuth errors with the RFC 6749 error code', async () => {
    const srv = await startServer((req, res) => {
      if (req.method === 'POST' && req.url === '/oauth/token') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: 'invalid_grant',
            error_description: 'Authorization code expired'
          })
        );
        return;
      }
      res.writeHead(404);
      res.end();
    });

    const oidc = new QtLoginOidc({ clientId: 'cid-1', serverUrl: srv.url });
    await assert.rejects(
      () =>
        oidc.exchangeCode({
          code: 'stale',
          codeVerifier: 'v',
          redirectUri: 'vscode://theqtcompany.qt-sm/authenticate'
        }),
      (err: unknown) => {
        assert.ok(err instanceof OidcError);
        assert.equal(err.oauthError, 'invalid_grant');
        assert.equal(err.message, 'Authorization code expired');
        return true;
      }
    );
    srv.close();
  });

  it('refreshes the access token', async () => {
    let capturedBody = '';
    const srv = await startServer((req, res) => {
      if (req.method === 'POST' && req.url === '/oauth/token') {
        void readBody(req).then((body) => {
          capturedBody = body;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              access_token: 'access-2',
              refresh_token: 'refresh-2',
              expires_in: 3600
            })
          );
        });
        return;
      }
      res.writeHead(404);
      res.end();
    });

    const oidc = new QtLoginOidc({ clientId: 'cid-1', serverUrl: srv.url });
    const tokens = await oidc.refresh('refresh-1');

    const params = new URLSearchParams(capturedBody);
    assert.equal(params.get('grant_type'), 'refresh_token');
    assert.equal(params.get('client_id'), 'cid-1');
    assert.equal(params.get('refresh_token'), 'refresh-1');
    assert.equal(tokens.accessToken, 'access-2');
    assert.equal(tokens.refreshToken, 'refresh-2');
    srv.close();
  });

  it('rejects a non-JSON token response', async () => {
    const srv = await startServer((_req, res) => {
      res.writeHead(502, { 'Content-Type': 'text/html' });
      res.end('<html>Bad gateway</html>');
    });

    const oidc = new QtLoginOidc({ clientId: 'cid-1', serverUrl: srv.url });
    await assert.rejects(
      () => oidc.refresh('refresh-1'),
      (err: unknown) => {
        assert.ok(err instanceof OidcError);
        assert.ok(err.message.includes('502'));
        return true;
      }
    );
    srv.close();
  });
});

// ── Identity resolution & persistence ────────────────────────────────────────

function makeJwt(payload: Record<string, unknown>): string {
  return [
    Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString(
      'base64url'
    ),
    Buffer.from(JSON.stringify(payload)).toString('base64url'),
    'fake-signature'
  ].join('.');
}

describe('QtLoginOidc identity & persistence', () => {
  it('resolves identity from ID token claims', async () => {
    const oidc = new QtLoginOidc({
      clientId: 'cid-1',
      serverUrl: 'http://127.0.0.1:1' // must not be contacted
    });
    const identity = await oidc.resolveIdentity({
      accessToken: 'access-1',
      idToken: makeJwt({ email: 'dev@qt.io', sub: 'user-42' })
    });
    assert.deepEqual(identity, { email: 'dev@qt.io', userId: 'user-42' });
  });

  it('falls back to the userinfo endpoint when there is no ID token', async () => {
    let capturedAuth = '';
    const srv = await startServer((req, res) => {
      if (req.method === 'GET' && req.url === '/api/userinfo') {
        capturedAuth = req.headers.authorization ?? '';
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ email: 'dev@qt.io', sub: 'user-42' }));
        return;
      }
      res.writeHead(404);
      res.end();
    });

    const oidc = new QtLoginOidc({ clientId: 'cid-1', serverUrl: srv.url });
    const identity = await oidc.resolveIdentity({ accessToken: 'access-1' });
    assert.equal(capturedAuth, 'Bearer access-1');
    assert.deepEqual(identity, { email: 'dev@qt.io', userId: 'user-42' });
    srv.close();
  });

  it('rejects when no email can be determined', async () => {
    const srv = await startServer((req, res) => {
      if (req.method === 'GET' && req.url === '/api/userinfo') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ sub: 'user-42' }));
        return;
      }
      res.writeHead(404);
      res.end();
    });

    const oidc = new QtLoginOidc({ clientId: 'cid-1', serverUrl: srv.url });
    await assert.rejects(
      () => oidc.resolveIdentity({ accessToken: 'access-1' }),
      (err: unknown) => {
        assert.ok(err instanceof OidcError);
        assert.ok(err.message.includes('email'));
        return true;
      }
    );
    srv.close();
  });

  it('persists credentials to qtaccount.ini', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sms-oidc-test-'));
    const iniPath = path.join(dir, 'qtaccount.ini');
    try {
      const oidc = new QtLoginOidc({
        clientId: 'cid-1',
        serverUrl: 'http://127.0.0.1:1',
        storagePath: iniPath
      });
      const credentials = oidc.persistCredentials(
        { email: 'dev@qt.io', userId: 'user-42' },
        { accessToken: 'access-jwt-1' }
      );
      assert.deepEqual(credentials, {
        email: 'dev@qt.io',
        jwt: 'access-jwt-1',
        userId: 'user-42'
      });
      const content = fs.readFileSync(iniPath, 'utf-8');
      assert.ok(content.includes('[QtAccount]'));
      assert.ok(content.includes('email=dev@qt.io'));
      assert.ok(content.includes('jwt=access-jwt-1'));
      assert.ok(content.includes('u=user-42'));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('derives the user id from the access token when identity lacks one', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sms-oidc-test-'));
    const iniPath = path.join(dir, 'qtaccount.ini');
    try {
      const oidc = new QtLoginOidc({
        clientId: 'cid-1',
        serverUrl: 'http://127.0.0.1:1',
        storagePath: iniPath
      });
      const credentials = oidc.persistCredentials(
        { email: 'dev@qt.io', userId: '' },
        { accessToken: makeJwt({ sub: 'user-77' }) }
      );
      assert.equal(credentials.userId, 'user-77');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
