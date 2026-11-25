type LivekitConfig = {
  readonly livekitUrl: string | null;
  readonly livekitApiKey: string | null;
  readonly livekitApiSecret: string | null;
};

type Config = LivekitConfig & {
  readonly port: number;
  readonly corsOrigins: readonly string[];
  readonly logLevel: string;
  readonly dbPath: string;
  readonly pingInterval: number;
  readonly pingTimeout: number;
  readonly tlsCertFile: string | null;
  readonly tlsKeyFile: string | null;
};

const DEFAULTS = {
  port: 3000,
  corsOrigins: ['*'] as const,
  logLevel: 'info',
  dbPath: './chat.db',
  pingInterval: 25_000,
  pingTimeout: 20_000,
} as const;

function parsePort(value: string | undefined): number {
  if (value === undefined || value === '') {
    return DEFAULTS.port;
  }
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 1) {
    throw new Error(`Invalid PORT: ${value}`);
  }
  return parsed;
}

function parseCorsOrigins(value: string | undefined): readonly string[] {
  if (value === undefined || value.trim() === '') {
    return DEFAULTS.corsOrigins;
  }
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

function parsePositiveInt(value: string | undefined, defaultVal: number, name: string): number {
  if (value === undefined || value === '') {
    return defaultVal;
  }
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 1000) {
    throw new Error(`Invalid ${name}: ${value}`);
  }
  return parsed;
}

function parseTlsFiles(
  certRaw: string | undefined,
  keyRaw: string | undefined,
): { readonly tlsCertFile: string | null; readonly tlsKeyFile: string | null } {
  const cert = certRaw?.trim() ?? '';
  const key = keyRaw?.trim() ?? '';
  if (cert === '' && key === '') {
    return { tlsCertFile: null, tlsKeyFile: null };
  }
  if (cert === '' || key === '') {
    throw new Error('TLS_CERT_FILE and TLS_KEY_FILE must be set together');
  }
  return { tlsCertFile: cert, tlsKeyFile: key };
}

// Blank values are treated as unset so an empty env var disables SFU calls
// instead of producing an unusable token endpoint.
function parseOptionalString(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}

function createConfig(env: typeof process.env = process.env): Config {
  // biome-ignore lint/complexity/useLiteralKeys: index sig (noPropertyAccessFromIndexSignature)
  const portRaw = env['PORT'];
  // biome-ignore lint/complexity/useLiteralKeys: index sig (noPropertyAccessFromIndexSignature)
  const corsOriginsRaw = env['CORS_ORIGINS'];
  // biome-ignore lint/complexity/useLiteralKeys: index sig (noPropertyAccessFromIndexSignature)
  const logLevelRaw = env['LOG_LEVEL'];
  // biome-ignore lint/complexity/useLiteralKeys: index sig (noPropertyAccessFromIndexSignature)
  const pingIntervalRaw = env['PING_INTERVAL'];
  // biome-ignore lint/complexity/useLiteralKeys: index sig (noPropertyAccessFromIndexSignature)
  const pingTimeoutRaw = env['PING_TIMEOUT'];
  // biome-ignore lint/complexity/useLiteralKeys: index sig (noPropertyAccessFromIndexSignature)
  const dbPathRaw = env['DB_PATH'];
  // biome-ignore lint/complexity/useLiteralKeys: index sig (noPropertyAccessFromIndexSignature)
  const tlsCertRaw = env['TLS_CERT_FILE'];
  // biome-ignore lint/complexity/useLiteralKeys: index sig (noPropertyAccessFromIndexSignature)
  const tlsKeyRaw = env['TLS_KEY_FILE'];
  // biome-ignore lint/complexity/useLiteralKeys: index sig (noPropertyAccessFromIndexSignature)
  const livekitUrlRaw = env['LIVEKIT_URL'];
  // biome-ignore lint/complexity/useLiteralKeys: index sig (noPropertyAccessFromIndexSignature)
  const livekitApiKeyRaw = env['LIVEKIT_API_KEY'];
  // biome-ignore lint/complexity/useLiteralKeys: index sig (noPropertyAccessFromIndexSignature)
  const livekitApiSecretRaw = env['LIVEKIT_API_SECRET'];

  const port = parsePort(portRaw);
  const corsOrigins = parseCorsOrigins(corsOriginsRaw);
  const logLevel = logLevelRaw ?? DEFAULTS.logLevel;
  const dbPath = dbPathRaw ?? DEFAULTS.dbPath;
  const pingInterval = parsePositiveInt(pingIntervalRaw, DEFAULTS.pingInterval, 'PING_INTERVAL');
  const pingTimeout = parsePositiveInt(pingTimeoutRaw, DEFAULTS.pingTimeout, 'PING_TIMEOUT');
  const tls = parseTlsFiles(tlsCertRaw, tlsKeyRaw);

  return Object.freeze({
    port,
    corsOrigins,
    logLevel,
    pingInterval,
    pingTimeout,
    dbPath,
    tlsCertFile: tls.tlsCertFile,
    tlsKeyFile: tls.tlsKeyFile,
    livekitUrl: parseOptionalString(livekitUrlRaw),
    livekitApiKey: parseOptionalString(livekitApiKeyRaw),
    livekitApiSecret: parseOptionalString(livekitApiSecretRaw),
  });
}

const config = createConfig();

export type { Config, LivekitConfig };
export { config, createConfig };
