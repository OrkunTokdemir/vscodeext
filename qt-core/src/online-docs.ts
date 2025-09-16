// Copyright (C) 2024 The Qt Company Ltd.
// SPDX-License-Identifier: LicenseRef-Qt-Commercial OR LGPL-3.0-only

import * as vscode from 'vscode';

import { EXTENSION_ID } from '@/constants';
import { telemetry, createLogger, isError, fetchWithAbort } from 'qt-lib';

const logger = createLogger('online-docs');
interface SearchItem {
  link: string;
  snippet: string;
  title: string;
}

interface SearchResponse {
  items?: SearchItem[];
  searchInformation: {
    formattedTotalResults: string;
    totalResults: string;
  };
  queries: {
    nextPage: {
      startIndex: number;
    };
  };
}

function getCurrentWord(): string {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return '';
  }
  const range = editor.selection.isEmpty
    ? editor.document.getWordRangeAtPosition(editor.selection.active)
    : editor.selection;
  if (range) {
    const word = editor.document.getText(range);
    return word;
  }
  return '';
}

async function tryToOpenDocumentationFor(
  word: string,
  token?: vscode.CancellationToken
) {
  if (!word) {
    return false;
  }
  const link = `https://doc.qt.io/qt-6/${word.toLowerCase()}.html`;

  if (token?.isCancellationRequested) {
    return false;
  }
  const controller = new AbortController();
  token?.onCancellationRequested(() => {
    controller.abort();
  });
  const response = await fetchWithAbort(link, {
    controller: controller,
    timeout: 5000
  });

  if (response?.ok) {
    openInBrowser(link);
    return true;
  }
  return false;
}

function openInBrowser(url: string) {
  const openInExternalBrowserCommand = vscode.workspace
    .getConfiguration(EXTENSION_ID)
    .get<boolean>('openOnlineDocumentationInExternalBrowser');
  if (openInExternalBrowserCommand) {
    void vscode.env.openExternal(vscode.Uri.parse(url));
    return;
  }
  const simpleBrowserCommand = 'simpleBrowser.api.open';
  void vscode.commands.executeCommand(simpleBrowserCommand, url, {
    viewColumn: vscode.ViewColumn.Beside
  });
}

async function search() {
  telemetry.sendAction('documentationSearchManually');
  const hintWord = getCurrentWord();
  const value = await vscode.window.showInputBox({
    value: hintWord,
    placeHolder: 'Search for...',
    prompt: 'Enter a term to search for in the Qt Documentation'
  });
  if (value === undefined || value === '') {
    return;
  }

  searchAndAskforResult(value);
}

async function searchWithEngine(
  value: string,
  token?: vscode.CancellationToken
) {
  const link = 'https://d24zn9cw9ofw9u.cloudfront.net?q=';
  const controller = new AbortController();
  token?.onCancellationRequested(() => {
    controller.abort();
  });
  const response = await fetchWithAbort(link + value, {
    controller: controller,
    timeout: 5000
  });

  if (token?.isCancellationRequested) {
    return;
  }
  if (!response?.ok) {
    throw new Error('Network response: ' + String(response?.status));
  }

  return (await response.json()) as SearchResponse;
}

function searchAndAskforResult(value: string) {
  let quickPickItems: {
    label: string;
    link: string;
    detail: string;
  }[] = [];
  const task = async (
    _: vscode.Progress<{ message?: string; increment?: number }>,
    token: vscode.CancellationToken
  ) => {
    try {
      if (await tryToOpenDocumentationFor(value, token)) {
        return;
      }
      const searchResponseJson = await searchWithEngine(value, token);
      if (token.isCancellationRequested) {
        return;
      }
      if (!searchResponseJson?.items) {
        void vscode.window.showInformationMessage('No search results found.');
        return;
      }
      quickPickItems = searchResponseJson.items.map((item) => ({
        label: item.title,
        link: item.link,
        detail: item.snippet
      }));
    } catch (error) {
      const err = isError(error) ? error.message : String(error);
      logger.error(err);
      void vscode.window.showErrorMessage(`Error: "${err}"`);
    }
  };
  const options = {
    location: vscode.ProgressLocation.Notification,
    title: 'Searching...',
    cancellable: true
  };
  void vscode.window.withProgress(options, task).then(async () => {
    if (quickPickItems.length === 0) {
      return;
    }
    const selected = await vscode.window.showQuickPick(quickPickItems, {
      placeHolder: 'Select a search result'
    });
    if (selected) {
      openInBrowser(selected.link);
    }
  });
}

function openHomepage() {
  telemetry.sendAction('documentationHomepage');
  openInBrowser('https://doc.qt.io');
}

function searchForCurrentWord() {
  telemetry.sendAction('documentationSearchForCurrentWord');
  const word = getCurrentWord();
  if (word === '') {
    void vscode.window.showInformationMessage('No word found at the cursor.');
    return;
  }

  searchAndAskforResult(word);
}

export function registerDocumentationCommands() {
  const homepageCommand = vscode.commands.registerCommand(
    `${EXTENSION_ID}.documentationHomepage`,
    openHomepage
  );
  const searchManuallyCommand = vscode.commands.registerCommand(
    `${EXTENSION_ID}.documentationSearchManually`,
    search
  );
  const searchForCurrentWordCommand = vscode.commands.registerCommand(
    `${EXTENSION_ID}.documentationSearchForCurrentWord`,
    searchForCurrentWord
  );
  return [homepageCommand, searchManuallyCommand, searchForCurrentWordCommand];
}
