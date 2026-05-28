import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getRuntimeBaseDir,
  resolveClientDistPath,
  resolveRuntimePath
} from '../../src/server/runtime/paths.js';

const originalCwd = process.cwd();
const originalExecPathDescriptor = Object.getOwnPropertyDescriptor(process, 'execPath');
const originalPkgDescriptor = Object.getOwnPropertyDescriptor(process, 'pkg');
let tempDir: string;

function setPackagedRuntime(execPath: string) {
  Object.defineProperty(process, 'pkg', {
    configurable: true,
    value: {}
  });
  Object.defineProperty(process, 'execPath', {
    configurable: true,
    value: execPath
  });
}

function restoreProcessProperty(name: 'execPath' | 'pkg', descriptor: PropertyDescriptor | undefined) {
  if (descriptor) {
    Object.defineProperty(process, name, descriptor);
    return;
  }

  delete (process as NodeJS.Process & { pkg?: unknown })[name];
}

describe('runtime paths', () => {
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'infinitylinks-runtime-'));
    process.chdir(tempDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    restoreProcessProperty('execPath', originalExecPathDescriptor);
    restoreProcessProperty('pkg', originalPkgDescriptor);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('uses process.cwd() outside pkg runtime', () => {
    expect(getRuntimeBaseDir()).toBe(tempDir);
  });

  it('resolves runtime paths under cwd', () => {
    expect(resolveRuntimePath('data/infinitylinks.sqlite')).toBe(
      path.resolve(tempDir, 'data/infinitylinks.sqlite')
    );
  });

  it('returns cwd/client when cwd/client/index.html exists', () => {
    fs.mkdirSync(path.join(tempDir, 'client'), { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'client', 'index.html'), '');

    expect(resolveClientDistPath()).toBe(path.resolve(tempDir, 'client'));
  });

  it('falls back to cwd/dist/client otherwise', () => {
    expect(resolveClientDistPath()).toBe(path.resolve(tempDir, 'dist/client'));
  });

  it('uses the executable directory in pkg runtime', () => {
    const exePath = path.join(tempDir, 'release', 'infinitylinks.exe');
    setPackagedRuntime(exePath);

    expect(getRuntimeBaseDir()).toBe(path.dirname(exePath));
  });

  it('throws a clear error when packaged client assets are missing', () => {
    const exePath = path.join(tempDir, 'release', 'infinitylinks.exe');
    setPackagedRuntime(exePath);

    expect(() => resolveClientDistPath()).toThrow(
      `Missing packaged client assets. Expected ${path.join(path.dirname(exePath), 'client', 'index.html')}`
    );
  });

  it('returns exeDir/client when packaged client assets exist', () => {
    const exePath = path.join(tempDir, 'release', 'infinitylinks.exe');
    const clientPath = path.join(path.dirname(exePath), 'client');
    fs.mkdirSync(clientPath, { recursive: true });
    fs.writeFileSync(path.join(clientPath, 'index.html'), '');
    setPackagedRuntime(exePath);

    expect(resolveClientDistPath()).toBe(clientPath);
  });
});
