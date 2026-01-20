import type { ProviderCredentials } from '../store/settingsStore';

const PBKDF2_ITERATIONS = 200_000;
const PBKDF2_HASH = 'SHA-256';

type EncryptedCredentialsBlobV1 = {
  v: 1;
  kdf: {
    name: 'PBKDF2';
    hash: 'SHA-256';
    iterations: number;
    saltB64: string;
  };
  cipher: {
    name: 'AES-GCM';
    ivB64: string;
  };
  ctB64: string;
};

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function deriveAesKey(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  return await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations,
      hash: PBKDF2_HASH,
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptCredentialsForBackup(
  credentials: ProviderCredentials,
  password: string
): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveAesKey(password, salt, PBKDF2_ITERATIONS);

  const plaintext = new TextEncoder().encode(JSON.stringify(credentials));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);

  const blob: EncryptedCredentialsBlobV1 = {
    v: 1,
    kdf: {
      name: 'PBKDF2',
      hash: 'SHA-256',
      iterations: PBKDF2_ITERATIONS,
      saltB64: bytesToBase64(salt),
    },
    cipher: {
      name: 'AES-GCM',
      ivB64: bytesToBase64(iv),
    },
    ctB64: bytesToBase64(new Uint8Array(ct)),
  };

  return JSON.stringify(blob);
}

export async function decryptCredentialsFromBackup(
  blobText: string,
  password: string
): Promise<ProviderCredentials> {
  const blob = JSON.parse(blobText) as Partial<EncryptedCredentialsBlobV1>;
  if (blob.v !== 1 || !blob.kdf || !blob.cipher || !blob.ctB64) {
    throw new Error('Unsupported or invalid backup format');
  }
  if (
    blob.kdf.name !== 'PBKDF2' ||
    blob.kdf.hash !== 'SHA-256' ||
    typeof blob.kdf.iterations !== 'number' ||
    typeof blob.kdf.saltB64 !== 'string'
  ) {
    throw new Error('Unsupported or invalid KDF settings');
  }
  if (blob.cipher.name !== 'AES-GCM' || typeof blob.cipher.ivB64 !== 'string') {
    throw new Error('Unsupported or invalid cipher settings');
  }

  const salt = base64ToBytes(blob.kdf.saltB64);
  const iv = base64ToBytes(blob.cipher.ivB64);
  const ct = base64ToBytes(blob.ctB64);

  const key = await deriveAesKey(password, salt, blob.kdf.iterations);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);

  const jsonText = new TextDecoder().decode(pt);
  return JSON.parse(jsonText) as ProviderCredentials;
}
