// Copyright (C) 2026 The Qt Company Ltd.
// SPDX-License-Identifier: LicenseRef-Qt-Commercial OR LGPL-3.0-only

export * from 'qt-lib/src/constants';
export const EXTENSION_ID = 'qt-sm';
export const CONF_INSTALLATION_PATH = 'installationPath';
export const CONF_USER_AGENT = 'qt-visual-studio-code-gui';
export const CONF_RESET_LICENSE_AFTER_INSTALL = 'resetLicenseBeforeInstall';
// Global flag (ConfigurationTarget.Global) that the "Get Started with Qt"
// walkthrough sets when the user marks it done. Other extensions (e.g. qt-core)
// read it via workspace.getConfiguration('qt-sm').get('getStartedDone').
export const CONF_GET_STARTED_DONE = 'getStartedDone';
export const DEFAULT_BACKEND_URL = 'https://api.install.qt.io';
// Qt Account "Forgot password" page, opened from the walkthrough sign-in step.
export const RESET_PASSWORD_URL = 'https://login.qt.io/forgot';
// OIDC client registered with login.qt.io for this extension. Placeholder
// until the registration exists (see the web-auth design spec); override
// for testing via the QT_OIDC_CLIENT_ID environment variable.
export const OIDC_CLIENT_ID = process.env.QT_OIDC_CLIENT_ID ?? 'qt-vscode-sm';
// How long the browser sign-in may take before the attempt is abandoned.
export const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
// SecretStorage key holding the OIDC refresh token.
export const SECRET_REFRESH_TOKEN = 'qtAccountRefreshToken';

// Survey popup constants
export const SURVEY_URL = 'https://www.surveymonkey.com/r/BMQH2W3';
// TODO: Make this 30 minutes before the alpha release
export const SURVEY_DELAY_MS = 30 * 60 * 1000; // 30 minutes

// State keys for survey
export const STATE_SURVEY_COMPLETED = 'surveyCompleted';
export const STATE_SURVEY_DISMISSED = 'surveyDismissed';
export const STATE_SURVEY_LAST_PROMPT = 'surveyLastPrompt';

// State keys for the walkthrough
export const STATE_WALKTHROUGH_FIRST_APP_DONE = 'walkthroughFirstAppDone';
