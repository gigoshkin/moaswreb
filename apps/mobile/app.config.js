// Adds the Google Maps key for Android from the environment, so it is never committed.
// Set GOOGLE_MAPS_ANDROID_KEY as an EAS environment variable for builds (see docs/build.md).
const { execSync } = require('node:child_process');

// Branch and commit of the checkout the bundle is built from, shown in Settings so a tester can tell which version is running.
const git = (args) => {
  try {
    return execSync(`git ${args}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
};

module.exports = ({ config }) => ({
  ...config,
  extra: { ...config.extra, build: { branch: git('rev-parse --abbrev-ref HEAD'), commit: git('rev-parse --short HEAD'), dirty: git('status --porcelain --untracked-files=no') !== '' } },
  android: {
    ...config.android,
    ...(process.env.GOOGLE_MAPS_ANDROID_KEY ? { config: { googleMaps: { apiKey: process.env.GOOGLE_MAPS_ANDROID_KEY } } } : {}),
  },
});
