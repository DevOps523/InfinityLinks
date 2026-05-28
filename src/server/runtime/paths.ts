import fs from 'node:fs';
import path from 'node:path';

export function isPackagedRuntime(): boolean {
  return Boolean((process as { pkg?: unknown }).pkg);
}

export function getRuntimeBaseDir(): string {
  if (isPackagedRuntime()) {
    return path.dirname(process.execPath);
  }

  return process.cwd();
}

export function resolveRuntimePath(relativePath: string): string {
  return path.resolve(getRuntimeBaseDir(), relativePath);
}

export function resolveClientDistPath(): string {
  const releaseClientPath = resolveRuntimePath('client');

  if (fs.existsSync(path.join(releaseClientPath, 'index.html'))) {
    return releaseClientPath;
  }

  if (isPackagedRuntime()) {
    throw new Error(`Missing packaged client assets. Expected ${path.join(releaseClientPath, 'index.html')}`);
  }

  return resolveRuntimePath('dist/client');
}

export function resolveSchemaAssetPath(): string {
  return resolveRuntimePath('schema.sql');
}
