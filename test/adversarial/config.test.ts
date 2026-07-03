import toml from '@iarna/toml';
import { describe, expect, it } from 'vitest';
import { ConfigError, validateConfig } from '../../src/config/load.js';

describe('validateConfig', () => {
  it('parses a valid config with clock and http-json sources', () => {
    const parsed = toml.parse(`
      [app]
      refresh = 15

      [[sources]]
      id = "clock"
      type = "clock"

      [[sources]]
      id = "hn"
      type = "http-json"
      url = "https://example.com/x.json"
      refresh = 90
    `);

    const config = validateConfig(parsed);
    expect(config.app.refresh).toBe(15);
    expect(config.sources).toHaveLength(2);
    expect(config.sources[1]).toMatchObject({
      type: 'http-json',
      url: 'https://example.com/x.json',
    });
  });

  it('defaults app.refresh when omitted', () => {
    expect(validateConfig({}).app.refresh).toBe(30);
  });

  it('rejects an unknown source type', () => {
    expect(() => validateConfig({ sources: [{ id: 'x', type: 'weather' }] })).toThrow(ConfigError);
  });

  it('rejects http-json without a url', () => {
    expect(() => validateConfig({ sources: [{ id: 'x', type: 'http-json' }] })).toThrow(/url/);
  });

  it('rejects http-json with a malformed url', () => {
    expect(() =>
      validateConfig({ sources: [{ id: 'x', type: 'http-json', url: 'not-a-url' }] }),
    ).toThrow(/url/);
  });

  it('rejects duplicate ids', () => {
    const sources = [
      { id: 'dup', type: 'clock' },
      { id: 'dup', type: 'clock' },
    ];
    expect(() => validateConfig({ sources })).toThrow(/duplicate/);
  });

  it('rejects a source missing an id', () => {
    expect(() => validateConfig({ sources: [{ type: 'clock' }] })).toThrow(/id/);
  });
});
