import 'expo-router/entry';
// Registers the leave card's foreground service runner. The service can start with the app closed (from the
// alarm), and then only this entry file runs: route files such as _layout.tsx are not loaded.
import './src/lib/leaveCard';
