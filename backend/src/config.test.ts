import { describe, expect, test } from 'bun:test';
import { createConfig } from './config';

describe('createConfig TLS', () => {
  test('both TLS vars set → trimmed non-null paths', () => {
    const config = createConfig({
      TLS_CERT_FILE: ' /etc/scattered-keyhole/fullchain.pem ',
      TLS_KEY_FILE: '/etc/scattered-keyhole/privkey.pem',
    });
    expect(config.tlsCertFile).toBe('/etc/scattered-keyhole/fullchain.pem');
    expect(config.tlsKeyFile).toBe('/etc/scattered-keyhole/privkey.pem');
  });

  test('neither TLS var set → both null', () => {
    const config = createConfig({});
    expect(config.tlsCertFile).toBeNull();
    expect(config.tlsKeyFile).toBeNull();
  });

  test('only the cert var set → throws', () => {
    expect(() => createConfig({ TLS_CERT_FILE: '/etc/cert.pem' })).toThrow(
      'TLS_CERT_FILE and TLS_KEY_FILE must be set together',
    );
  });

  test('only the key var set → throws', () => {
    expect(() => createConfig({ TLS_KEY_FILE: '/etc/key.pem' })).toThrow(
      'TLS_CERT_FILE and TLS_KEY_FILE must be set together',
    );
  });

  test('blank TLS values count as unset', () => {
    const config = createConfig({ TLS_CERT_FILE: '  ', TLS_KEY_FILE: '' });
    expect(config.tlsCertFile).toBeNull();
    expect(config.tlsKeyFile).toBeNull();
  });

  test('existing defaults are unchanged', () => {
    const config = createConfig({});
    expect(config.port).toBe(3000);
    expect(config.corsOrigins).toEqual(['*']);
    expect(config.logLevel).toBe('info');
    expect(config.dbPath).toBe('./chat.db');
    expect(config.pingInterval).toBe(25_000);
    expect(config.pingTimeout).toBe(20_000);
  });
});

describe('createConfig LiveKit', () => {
  test('all three vars are read and trimmed', () => {
    const config = createConfig({
      LIVEKIT_URL: ' wss://livekit.example ',
      LIVEKIT_API_KEY: ' key ',
      LIVEKIT_API_SECRET: ' secret ',
    });
    expect(config.livekitUrl).toBe('wss://livekit.example');
    expect(config.livekitApiKey).toBe('key');
    expect(config.livekitApiSecret).toBe('secret');
  });

  test('unset or blank values become null', () => {
    const config = createConfig({
      LIVEKIT_URL: '',
      LIVEKIT_API_KEY: '   ',
    });
    expect(config.livekitUrl).toBeNull();
    expect(config.livekitApiKey).toBeNull();
    expect(config.livekitApiSecret).toBeNull();
  });
});
