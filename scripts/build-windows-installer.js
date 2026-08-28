const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const electronPackager = require('@electron/packager');
const { createWindowsInstaller } = require('electron-winstaller');

const rootDir = path.resolve(__dirname, '..');
const pkg = require(path.join(rootDir, 'package.json'));

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: rootDir,
      stdio: 'inherit',
      shell: false,
      ...options,
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
    });
  });
}

function runWindowsCommandLine(commandLine, options = {}) {
  const cmd = process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe';
  return run(cmd, ['/d', '/s', '/c', commandLine], options);
}

function ensureFreshDirectory(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
  fs.mkdirSync(dirPath, { recursive: true });
}

function findLatestInstalledAppDir() {
  const localAppData = process.env.LOCALAPPDATA || '';
  const installRoots = ['dalvi-indiamart-product-bot', 'indiamart_seller_automation']
    .map(name => path.join(localAppData, name))
    .filter(root => root && fs.existsSync(root));
  const candidates = installRoots.flatMap(installRoot => fs.readdirSync(installRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^app-\d+\.\d+\.\d+$/.test(entry.name))
    .map((entry) => {
      const fullPath = path.join(installRoot, entry.name);
      return { fullPath, mtimeMs: fs.statSync(fullPath).mtimeMs };
    }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  return candidates[0]?.fullPath || null;
}

async function buildWebpackBundles() {
  if (process.env.SKIP_WEBPACK_BUILD === '1') {
    const requiredBundles = [
      path.join(rootDir, '.webpack', 'x64', 'main', 'index.js'),
      path.join(rootDir, '.webpack', 'x64', 'renderer', 'main_window', 'index.html'),
      path.join(rootDir, '.webpack', 'x64', 'renderer', 'main_window', 'index.js'),
      path.join(rootDir, '.webpack', 'x64', 'renderer', 'main_window', 'preload.js'),
    ];
    const missingBundle = requiredBundles.find((bundlePath) => !fs.existsSync(bundlePath));
    if (missingBundle) {
      throw new Error(`Cannot skip webpack build because a required bundle is missing: ${missingBundle}`);
    }

    console.log('Using existing verified webpack bundles.');
    return;
  }

  if (process.platform === 'win32') {
    await runWindowsCommandLine('npx.cmd electron-forge package --platform win32 --arch x64');
    return;
  }

  const npmCmd = 'npx';
  await run(npmCmd, ['electron-forge', 'package', '--platform', 'win32', '--arch', 'x64']);
}

async function packageApp(packageOutputDir) {
  const iconPath = path.join(rootDir, 'src', 'icon.ico');
  const outputPaths = await electronPackager({
    dir: rootDir,
    name: pkg.productName,
    platform: 'win32',
    arch: 'x64',
    out: packageOutputDir,
    overwrite: true,
    prune: true,
    appVersion: pkg.version,
    executableName: pkg.productName,
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    ignore: [
      /^[/\\]out($|[/\\])/,
      /^[/\\]scratch($|[/\\])/,
      /^[/\\]tmp($|[/\\])/,
      /^[/\\]internshala-applier($|[/\\])/,
      /^[/\\]\.git($|[/\\])/,
    ],
  });

  const packagedAppDir = outputPaths[0] || path.join(packageOutputDir, `${pkg.productName}-win32-x64`);
  if (!fs.existsSync(packagedAppDir)) {
    throw new Error(`Packaged app directory was not created: ${packagedAppDir}`);
  }

  return packagedAppDir;
}

function syncRuntimeFiles(packagedAppDir) {
  const appResourcesDir = path.join(packagedAppDir, 'resources', 'app');
  fs.mkdirSync(appResourcesDir, { recursive: true });

  // Older builds wrote diagnostics inside resources/app, producing paths that
  // Squirrel could not remove during upgrades on Windows.
  fs.rmSync(path.join(appResourcesDir, 'scratch'), { recursive: true, force: true });

  const runtimeItems = [
    '.env',
    'brochures',
    'indiamart-product-discovery.js',
    'package.json',
    'product-engine',
    'src',
  ];

  for (const item of runtimeItems) {
    const sourcePath = path.join(rootDir, item);
    const destinationPath = path.join(appResourcesDir, item);
    if (!fs.existsSync(sourcePath)) {
      continue;
    }

    fs.cpSync(sourcePath, destinationPath, { recursive: true, force: true });
  }

  const freshWebpackDir = path.join(rootDir, '.webpack', 'x64');
  const destinationWebpackDir = path.join(appResourcesDir, '.webpack');
  if (fs.existsSync(freshWebpackDir)) {
    fs.rmSync(destinationWebpackDir, { recursive: true, force: true });
    fs.cpSync(freshWebpackDir, destinationWebpackDir, { recursive: true, force: true });
  }
}

async function prunePackagedDependencies(packagedAppDir) {
  const appResourcesDir = path.join(packagedAppDir, 'resources', 'app');
  const npmArgs = ['prune', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'];

  if (process.platform === 'win32') {
    await runWindowsCommandLine(`npm.cmd ${npmArgs.join(' ')}`, { cwd: appResourcesDir });
    return;
  }

  await run('npm', npmArgs, { cwd: appResourcesDir });
}

function stageInstalledApp(packageOutputDir) {
  const installedAppDir = findLatestInstalledAppDir();
  if (!installedAppDir) {
    throw new Error('No installed IndiaMART app bundle was found under LocalAppData for fallback packaging.');
  }

  const packagedAppDir = path.join(packageOutputDir, `${pkg.productName}-win32-x64`);
  fs.cpSync(installedAppDir, packagedAppDir, { recursive: true, force: true });
  return packagedAppDir;
}

async function buildInstaller(packagedAppDir, installerOutputDir) {
  const iconPath = path.join(rootDir, 'src', 'icon.ico');

  await createWindowsInstaller({
    appDirectory: packagedAppDir,
    outputDirectory: installerOutputDir,
    authors: pkg.author || 'devev',
    description: pkg.description,
    exe: `${pkg.productName}.exe`,
    name: pkg.name,
    noMsi: true,
    setupExe: `${pkg.productName}-${pkg.version} Setup.exe`,
    setupIcon: fs.existsSync(iconPath) ? iconPath : undefined,
    title: pkg.productName,
    version: pkg.version,
  });
}

function writeBuildMetadata(packagedAppDir, installerOutputDir) {
  const metadata = {
    productName: pkg.productName,
    version: pkg.version,
    builtAt: new Date().toISOString(),
    packagedAppDir,
    installerOutputDir,
  };

  fs.writeFileSync(
    path.join(installerOutputDir, 'build-info.json'),
    JSON.stringify(metadata, null, 2),
    'utf8'
  );
}

async function main() {
  const packageOutputDir = path.join(rootDir, 'out', 'package-manual');
  const installerOutputDir = path.join(rootDir, 'out', 'make', 'squirrel.windows', 'x64');
  let buildSource = 'source-package';
  let fallbackReason = null;

  ensureFreshDirectory(packageOutputDir);
  ensureFreshDirectory(installerOutputDir);

  await buildWebpackBundles();
  let packagedAppDir;
  if (findLatestInstalledAppDir()) {
    buildSource = 'verified-installed-electron-shell';
    fallbackReason = 'Fresh runtime files and webpack bundles synchronized onto the latest verified Electron shell.';
    packagedAppDir = stageInstalledApp(packageOutputDir);
  } else {
    packagedAppDir = await packageApp(packageOutputDir);
  }

  syncRuntimeFiles(packagedAppDir);
  await prunePackagedDependencies(packagedAppDir);
  await buildInstaller(packagedAppDir, installerOutputDir);
  writeBuildMetadata(packagedAppDir, installerOutputDir);

  if (fallbackReason) {
    console.log(`Build source: ${buildSource} (${fallbackReason})`);
  } else {
    console.log(`Build source: ${buildSource}`);
  }
  console.log(`Packaged app: ${packagedAppDir}`);
  console.log(`Installer output: ${installerOutputDir}`);
}

const buildKeepAlive = setInterval(() => {}, 1000);
main()
  .then(() => {
    clearInterval(buildKeepAlive);
  })
  .catch((error) => {
    clearInterval(buildKeepAlive);
    console.error(error);
    process.exitCode = 1;
  });
