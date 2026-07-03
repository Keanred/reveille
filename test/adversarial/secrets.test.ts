import { afterEach, describe, expect, it } from 'vitest';
import type { SecretStore } from '../../src/core/secrets.js';
import { resolveSecret } from '../../src/core/secrets.js';

const noSecrets: SecretStore = {
  get: async () => undefined,
  set: async () => {},
  delete: async () => false,
};

function storeWith(value: string | undefined): SecretStore {
  return { ...noSecrets, get: async () => value };
}

describe('resolveSecret', () => {
  const ENV_KEY = 'REVEILLE_TEST_TOKEN';
  afterEach(() => {
    delete process.env[ENV_KEY];
  });

  it('returns a bare string as a literal value', async () => {
    expect(await resolveSecret('tok_literal', noSecrets)).toBe('tok_literal');
  });

  it('reads an env: reference from the environment', async () => {
    process.env[ENV_KEY] = 'tok_env';
    expect(await resolveSecret(`env:${ENV_KEY}`, noSecrets)).toBe('tok_env');
  });

  it('throws when an env: reference is unset', async () => {
    await expect(resolveSecret(`env:${ENV_KEY}`, noSecrets)).rejects.toThrow(/could not resolve/);
  });

  it('runs a cmd: reference and trims its stdout', async () => {
    expect(await resolveSecret('cmd:printf tok_cmd', noSecrets)).toBe('tok_cmd');
  });

  it('reads a keychain: reference through the store', async () => {
    expect(await resolveSecret('keychain:github-token', storeWith('tok_kc'))).toBe('tok_kc');
  });

  it('throws when a keychain: reference is missing', async () => {
    await expect(resolveSecret('keychain:absent', storeWith(undefined))).rejects.toThrow(
      /could not resolve/,
    );
  });
});
