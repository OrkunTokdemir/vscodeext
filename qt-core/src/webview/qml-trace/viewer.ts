

import * as childProcess from 'child_process';

import { createLogger, IsWindows } from 'qt-lib';
import { QmlTraceDoc } from './doc';

const logger = createLogger('runner');
const VIEWER_EXEC = '/Users/bencho/Downloads/QtCreator.app/Contents/Resources/libexec/qmltraceviewer';


export class QmlTraceViewerRunner {
  private _onStdout: ((line: string) => void) | undefined;
  private _onStderr: ((line: string) => void) | undefined;
  private _proc: ReturnType<typeof childProcess.spawn> | undefined;

  constructor(private readonly _doc: QmlTraceDoc) {
  }

  public onStdout(f: ((line: string) => void) | undefined) {
    this._onStdout = f;
  }

  public onStderr(f: ((line: string) => void) | undefined) {
    this._onStderr = f;
  }

  public async run() {
    if (this._proc) {
      logger.error('Already running...', this._doc.uri.fsPath);
      return;
    }

    const uri = this._doc.uri;
    const shell = resolveShellPath();
    const commandLine = [VIEWER_EXEC, '-e', '-l', uri.fsPath].join(' ');

    logger.info('Running command');
    logger.info(`- shell: ${shell}`);
    logger.info(`- command: ${commandLine}`);

    this._proc = childProcess.spawn(commandLine, { shell });
    const outPromise = streamToLines(this._proc.stdout, this._onStdout);
    const errPromise = streamToLines(this._proc.stderr, this._onStderr);

    await new Promise<void>((resolve, reject) => {
      // const timeout = setTimeout(() => {
      //   if (this._proc) {
      //     this._proc.kill();
      //     this._proc = undefined;
      //     reject(new Error('Process timed out after 5 seconds'));
      //   }
      // }, 5_000);

      if (this._proc) {
        this._proc.on('error', (err) => {
          // clearTimeout(timeout);
          this._proc = undefined;
          reject(err);
        });

        this._proc.on('close', (code) => {
          // clearTimeout(timeout);
          if (code === 0) {
            resolve();
            this._proc = undefined;
            return;
          }

          this._proc = undefined;
          reject(new Error(`Process exited with code ${code?.toString() ?? ''}`));
        });
      }
    });

    const out = await outPromise;
    const err = await errPromise;
    void err;

    return out;
  }
}

// helpers
// function parseSourceLocation(l: string): SourceLocation | undefined {
//   // format of the source location:
//   // qrc:/qt/qml/QtCreator/Tracing/FlameGraphView.qml
//   // qrc:/qt/qml/QtCreator/Tracing/FlameGraphView.qml:115
//   // qrc:/qt/qml/QtCreator/Tracing/FlameGraphView.qml:115:13

//   const loc = l.trim()
//   const match = loc.match(/^(qrc:\/[a-zA-Z0-9/._-]+)(?::(\d+))?(?::(\d+))?$/);
//   if (!match) {
//     return undefined;
//   }

//   return {
//     filepath: match[1] ?? '',
//     ...(match[2] !== undefined && { line: parseInt(match[2], 10) }),
//     ...(match[3] !== undefined && { column: parseInt(match[3], 10) }),
//   };
// }

function resolveShellPath(): string {
  if (IsWindows) {
    return process.env.ComSpec ?? 'C:\\Windows\\System32\\cmd.exe';
  }

  const result = childProcess.spawnSync('command -v bash', { shell: true });
  const found = result.stdout.toString().trim();
  return result.status === 0 && found ? found : '/bin/bash';
}

type Stream = NodeJS.ReadableStream;
type Callback = ((line: string) => void) | undefined;

async function streamToLines(stream: Stream | null, callback: Callback) {
  if (stream === null) {
    return;
  }

  let leftover = '';
  const lines: string[] = [];

  for await (const chunk of stream) {
    const text = leftover + chunk.toString();
    const parts = text.split('\n');
    leftover = parts.pop() ?? '';

    for (const line of parts) {
      const trimmed = line.trim();
      lines.push(trimmed);
      callback?.(trimmed);
    }
  }

  if (leftover.trim()) {
    const trimmed = leftover.trim();
    lines.push(trimmed);
    callback?.(trimmed);
  }

  return lines;
}
