const list = (value: string | undefined): string[] =>
  (value ?? '').split(',').map((s) => s.trim()).filter(Boolean);

const int = (value: string | undefined, fallback: number): number => {
  const n = Number(value);
  return Number.isFinite(n) && value !== '' && value !== undefined ? n : fallback;
};

export const config = {
  port: int(process.env.PORT, 8080),
  dataDir: process.env.DATA_DIR ?? './data',
  ttc: {
    siteUrl: 'https://transit.ttc.com.ge/',
    apiBase: 'https://transit.ttc.com.ge/pis-gateway/api',
    minIntervalMs: int(process.env.TTC_MIN_INTERVAL_MS, 700),
    userAgent: 'tbilisi-transit-hackathon/0.1 (Hacktoberfest Georgia 2026)',
  },
  logger: {
    hotIntervalMs: int(process.env.HOT_INTERVAL_MS, 30_000),
    hotStops: list(process.env.HOT_STOPS),
    hotRoutes: list(process.env.HOT_ROUTES),
    sweepIntervalMs: int(process.env.SWEEP_INTERVAL_MS, 1_500),
    routeRefreshMs: 6 * 60 * 60 * 1000,
  },
};
