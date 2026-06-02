const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');
const fs = require('fs');
const path = require('path');

module.exports = {
  packagerConfig: {
    asar: false,
    icon: 'src/icon',
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {},
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin'],
    },
    {
      name: '@electron-forge/maker-deb',
      config: {},
    },
    {
      name: '@electron-forge/maker-rpm',
      config: {},
    },
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-webpack',
      config: {
        mainConfig: './webpack.main.config.js',
        devContentSecurityPolicy: "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: https://fonts.googleapis.com https://fonts.gstatic.com; font-src 'self' data: https://fonts.gstatic.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data:;",
        renderer: {
          config: './webpack.renderer.config.js',
          entryPoints: [
            {
              html: './src/index.html',
              js: './src/renderer.js',
              name: 'main_window',
              preload: {
                js: './src/preload.js',
              },
            },
          ],
        },
      },
    },
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: true,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: false,
      [FuseV1Options.OnlyLoadAppFromAsar]: false,
    }),
  ],
  hooks: {
    postPackage: async (forgeConfig, packageResult) => {
      console.log('   Post-Package hook: Copying pipeline scripts and brochures to packaged app...');
      for (const outputPath of packageResult.outputPaths) {
        const appPath = path.join(outputPath, 'resources', 'app');
        if (!fs.existsSync(appPath)) {
          fs.mkdirSync(appPath, { recursive: true });
        }
        const toCopy = [
          'indiamart-product-discovery.js',
          'product-engine',
          'brochures',
          'src',
          '.env'
        ];
        for (const item of toCopy) {
          const srcPath = path.join(__dirname, item);
          const destPath = path.join(appPath, item);
          if (fs.existsSync(srcPath)) {
            console.log(`      Copying ${item} -> ${destPath}`);
            fs.cpSync(srcPath, destPath, { recursive: true, force: true });
          } else {
            console.log(`      ⚠️ Warning: ${item} not found at ${srcPath}`);
          }
        }
      }
    }
  }
};
