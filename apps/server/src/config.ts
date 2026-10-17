const list = (value: string | undefined): string[] =>
  (value ?? '').split(',').map((s) => s.trim()).filter(Boolean);

const int = (value: string | undefined, fallback: number): number => {
  const n = Number(value);
  return Number.isFinite(n) && value !== '' && value !== undefined ? n : fallback;
};

export const config = {
  port: int(process.env.PORT, 8080),
  /** Bearer key for /chat and /mcp. Unset = open (local dev only). */
  apiKey: process.env.API_KEY ?? '',
  /** 32-byte base64 key that encrypts stored trips. Without it, /me and alerts are off. */
  tripsKey: process.env.TRIPS_KEY ?? '',
  anthropic: {
    /** The SDK reads ANTHROPIC_API_KEY itself; this only says whether chat is configured. */
    enabled: Boolean(process.env.ANTHROPIC_API_KEY),
    model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
  },
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
    // Tbilisi local hours with (almost) no buses: sweep off, hot set slowed down.
    quietFromHour: int(process.env.QUIET_FROM_HOUR, 1),
    quietToHour: int(process.env.QUIET_TO_HOUR, 6),
    quietHotIntervalMs: 5 * 60_000,
  },
};

/** Current hour in Tbilisi (UTC+4, no DST). */
export const tbilisiHour = (now = new Date()): number => (now.getUTCHours() + 4) % 24;

export const isQuietHours = (now = new Date()): boolean => {
  const h = tbilisiHour(now);
  const { quietFromHour: from, quietToHour: to } = config.logger;
  return from <= to ? h >= from && h < to : h >= from || h < to;
};
