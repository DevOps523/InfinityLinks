import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import JavaScriptObfuscator from 'javascript-obfuscator';

const rootDir = process.cwd();
const packageDir = path.join(rootDir, 'dist', 'package');
const bundledServerPath = path.join(packageDir, 'server.cjs');
const pkgConfigPath = path.join(packageDir, 'pkg.config.json');
const pkgBinPath = path.join(rootDir, 'node_modules', '@yao-pkg', 'pkg', 'lib-es5', 'bin.js');
const pkgNodeMajor = process.versions.node.split('.')[0];
const pkgNodeVersion = `v${process.versions.node}`;
const pkgTarget = `node${pkgNodeMajor}-win-x64`;
const betterSqlitePackageDir = path.join(rootDir, 'node_modules', 'better-sqlite3');
const betterSqliteNativeAddonPath = path.join(
  betterSqlitePackageDir,
  'build',
  'Release',
  'better_sqlite3.node'
);
const prebuildInstallPath = path.join(rootDir, 'node_modules', 'prebuild-install', 'bin.js');
const releaseDir = path.join(rootDir, 'release', 'windows', 'InfinityLinks');
const releaseClientDir = path.join(releaseDir, 'client');
const releaseAssetsDir = path.join(releaseClientDir, 'assets');

const obfuscatorOptions = {
  compact: true,
  controlFlowFlattening: false,
  deadCodeInjection: false,
  stringArray: false,
  sourceMap: false
} as const;

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function obfuscateFile(filePath: string): Promise<void> {
  const source = await fs.readFile(filePath, 'utf8');
  const result = JavaScriptObfuscator.obfuscate(source, obfuscatorOptions);
  await fs.writeFile(filePath, result.getObfuscatedCode(), 'utf8');
}

async function obfuscateJavaScriptFiles(directory: string): Promise<void> {
  if (!(await pathExists(directory))) {
    return;
  }

  const entries = await fs.readdir(directory, { withFileTypes: true });
  await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      await obfuscateJavaScriptFiles(entryPath);
      return;
    }

    if (entry.isFile() && entry.name.endsWith('.js')) {
      await obfuscateFile(entryPath);
    }
  }));
}

function runPkg(): void {
  const args = [
    pkgBinPath,
    bundledServerPath,
    '--config',
    pkgConfigPath,
    '--targets',
    pkgTarget,
    '--output',
    path.join(releaseDir, 'InfinityLinks.exe')
  ];

  const result = spawnSync(process.execPath, args, {
    cwd: rootDir,
    stdio: 'inherit',
    shell: false
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`pkg failed with exit code ${result.status ?? 'unknown'}`);
  }
}

function runBetterSqlitePrebuildInstall(): void {
  const result = spawnSync(
    process.execPath,
    [
      prebuildInstallPath,
      '--platform',
      'win32',
      '--arch',
      'x64',
      '--target',
      pkgNodeVersion
    ],
    {
      cwd: betterSqlitePackageDir,
      stdio: 'inherit',
      shell: false
    }
  );

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`prebuild-install failed with exit code ${result.status ?? 'unknown'}`);
  }
}

async function writePkgConfig(): Promise<void> {
  if (!(await pathExists(betterSqliteNativeAddonPath))) {
    throw new Error(`Missing better-sqlite3 native addon: ${betterSqliteNativeAddonPath}`);
  }

  const betterSqliteNativeAddonAsset = path
    .relative(packageDir, betterSqliteNativeAddonPath)
    .replaceAll(path.sep, '/');

  await fs.writeFile(
    pkgConfigPath,
    `${JSON.stringify({
      pkg: {
        assets: [betterSqliteNativeAddonAsset]
      }
    }, null, 2)}\n`,
    'utf8'
  );
}

async function ensureBetterSqliteNativeAddon(): Promise<void> {
  await fs.rm(betterSqliteNativeAddonPath, { force: true });
  runBetterSqlitePrebuildInstall();

  if (!(await pathExists(betterSqliteNativeAddonPath))) {
    throw new Error(`Missing better-sqlite3 native addon after prebuild install: ${betterSqliteNativeAddonPath}`);
  }
}

async function main(): Promise<void> {
  await fs.rm(packageDir, { recursive: true, force: true });
  await fs.rm(releaseDir, { recursive: true, force: true });
  await fs.mkdir(packageDir, { recursive: true });
  await fs.mkdir(releaseDir, { recursive: true });

  await build({
    entryPoints: [path.join(rootDir, 'src', 'server', 'index.ts')],
    outfile: bundledServerPath,
    bundle: true,
    platform: 'node',
    target: `node${pkgNodeMajor}`,
    format: 'cjs',
    sourcemap: false,
    define: {
      'import.meta.url': JSON.stringify(pathToFileURL(bundledServerPath).href)
    },
    external: ['better-sqlite3']
  });

  await obfuscateFile(bundledServerPath);
  await ensureBetterSqliteNativeAddon();
  await writePkgConfig();

  await fs.cp(path.join(rootDir, 'dist', 'client'), releaseClientDir, { recursive: true });
  await obfuscateJavaScriptFiles(releaseAssetsDir);

  await Promise.all([
    fs.copyFile(path.join(rootDir, '.env.example'), path.join(releaseDir, '.env.example')),
    fs.copyFile(path.join(rootDir, 'src', 'server', 'db', 'schema.sql'), path.join(releaseDir, 'schema.sql')),
    fs.copyFile(path.join(rootDir, 'scripts', 'templates', 'README.windows.txt'), path.join(releaseDir, 'README.txt')),
    fs.mkdir(path.join(releaseDir, 'data'), { recursive: true })
  ]);

  runPkg();

  console.log(`Windows release created at: ${releaseDir}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
