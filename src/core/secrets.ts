import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const SERVICE = 'reveille';

const execAsync = promisify(exec);

export interface SecretStore {
  get(account: string): Promise<string | undefined>;
  set(account: string, secret: string): Promise<void>;
  delete(account: string): Promise<boolean>;
}

export function envKey(account: string): string {
  return `REVEILLE_SECRET_${account.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;
}

interface KeytarLike {
  getPassword(service: string, account: string): Promise<string | null>;
  setPassword(service: string, account: string, password: string): Promise<void>;
  deletePassword(service: string, account: string): Promise<boolean>;
}

async function loadKeytar(): Promise<KeytarLike | null> {
  try {
    const specifier = 'keytar';
    const mod = (await import(specifier)) as { default?: KeytarLike } & Partial<KeytarLike>;
    const candidate = mod.default ?? (mod as KeytarLike);
    return typeof candidate.getPassword === 'function' ? candidate : null;
  } catch {
    return null;
  }
}

export function createSecretStore(): SecretStore {
  let keytarPromise: Promise<KeytarLike | null> | undefined;
  const keytar = (): Promise<KeytarLike | null> => (keytarPromise ??= loadKeytar());

  return {
    async get(account) {
      const kt = await keytar();
      if (kt) {
        const value = await kt.getPassword(SERVICE, account);
        if (value != null) return value;
      }
      return process.env[envKey(account)];
    },

    async set(account, secret) {
      const kt = await keytar();
      if (!kt) {
        throw new Error(`keytar unavailable; export ${envKey(account)} instead`);
      }
      await kt.setPassword(SERVICE, account, secret);
    },

    async delete(account) {
      const kt = await keytar();
      return kt ? kt.deletePassword(SERVICE, account) : false;
    },
  };
}

async function sh(command: string): Promise<string> {
  const { stdout } = await execAsync(command, { timeout: 10_000 });
  return stdout;
}

function fail(ref: string): never {
  throw new Error(`could not resolve secret reference "${ref}"`);
}

export async function resolveSecret(ref: string, store: SecretStore): Promise<string> {
  if (ref.startsWith('env:')) return process.env[ref.slice(4)] ?? fail(ref);
  if (ref.startsWith('cmd:')) return (await sh(ref.slice(4))).trim();
  if (ref.startsWith('keychain:')) return (await store.get(ref.slice(9))) ?? fail(ref);
  return ref;
}
