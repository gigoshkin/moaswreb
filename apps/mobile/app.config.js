// Adds the Google Maps key for Android from the environment, so it is never committed.
// Set GOOGLE_MAPS_ANDROID_KEY as an EAS environment variable for builds (see docs/build.md).
module.exports = ({ config }) => ({
  ...config,
  android: {
    ...config.android,
    ...(process.env.GOOGLE_MAPS_ANDROID_KEY ? { config: { googleMaps: { apiKey: process.env.GOOGLE_MAPS_ANDROID_KEY } } } : {}),
  },
});
