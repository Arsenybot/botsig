/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

/**
 * Isolated Security Vault for API Tokens & Sensitive Credentials
 * 
 * Features:
 * - Military-grade AES-256-GCM Authenticated Encryption with Associated Data (AEAD)
 * - Cryptographic key derivation with PBKDF2 (100,000 rounds of HMAC-SHA512)
 * - Cryptographically random 96-bit IV per secret
 * - 128-bit authentication tags ensuring tamper-resistance
 * - Additional Authenticated Data (AAD) bound to user chatId and tokenId (prevents substitution attacks)
 * - Isolated physical storage in data/.vault/ directory separate from main database
 * - Zero plaintext token leakage: tokens are never returned to clients or logged
 */

const BASE_DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const VAULT_DIR = path.join(BASE_DATA_DIR, '.vault');
const VAULT_FILE = path.join(VAULT_DIR, 'tokens_vault.enc');
const KEY_FILE = path.join(VAULT_DIR, '.master.key');

interface VaultEntry {
  secretRef: string;
  chatId: number;
  tokenId: string;
  iv: string; // hex
  authTag: string; // hex
  ciphertext: string; // hex
  tokenHash: string; // sha256 hex
  maskedToken: string;
  createdAt: number;
  updatedAt: number;
}

interface VaultData {
  version: number;
  salt: string; // hex
  entries: Record<string, VaultEntry>;
}

export class TokenVault {
  private static instance: TokenVault | null = null;
  private masterKey: Buffer;
  private vaultData: VaultData;
  private saveTimeout: NodeJS.Timeout | null = null;

  private constructor() {
    this.ensureVaultDirectory();
    this.masterKey = this.initMasterKey();
    this.vaultData = this.loadVaultData();
  }

  public static getInstance(): TokenVault {
    if (!TokenVault.instance) {
      TokenVault.instance = new TokenVault();
    }
    return TokenVault.instance;
  }

  private ensureVaultDirectory(): void {
    if (!fs.existsSync(VAULT_DIR)) {
      fs.mkdirSync(VAULT_DIR, { recursive: true, mode: 0o700 });
    }
  }

  /**
   * Initialize or retrieve 256-bit Master Encryption Key
   */
  private initMasterKey(): Buffer {
    const envKey = process.env.ENCRYPTION_MASTER_KEY;
    if (envKey && envKey.trim().length >= 32) {
      return crypto.createHash('sha256').update(envKey.trim()).digest();
    }

    if (fs.existsSync(KEY_FILE)) {
      try {
        const raw = fs.readFileSync(KEY_FILE, 'utf-8').trim();
        if (raw.length >= 32) {
          return Buffer.from(raw, 'hex');
        }
      } catch (err) {
        console.error('[TokenVault] Error reading master key file:', err);
      }
    }

    // Generate high-entropy 256-bit key
    const newKey = crypto.randomBytes(32);
    try {
      fs.writeFileSync(KEY_FILE, newKey.toString('hex'), { mode: 0o600, encoding: 'utf-8' });
      console.log('[TokenVault] Generated new 256-bit master encryption key in isolated vault.');
    } catch (err) {
      console.error('[TokenVault] Failed to write key file with restricted permissions:', err);
    }
    return newKey;
  }

  /**
   * Derive a specific encryption subkey using PBKDF2 with SHA-512
   */
  private deriveSubKey(salt: Buffer, context: string): Buffer {
    return crypto.pbkdf2Sync(
      this.masterKey,
      Buffer.concat([salt, Buffer.from(context, 'utf-8')]),
      100000,
      32,
      'sha512'
    );
  }

  private loadVaultData(): VaultData {
    if (fs.existsSync(VAULT_FILE)) {
      try {
        const raw = fs.readFileSync(VAULT_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed && parsed.entries && parsed.salt) {
          return parsed;
        }
      } catch (err) {
        console.error('[TokenVault] Error reading vault file, fallback to recovery:', err);
      }
    }

    // Default empty vault
    const initial: VaultData = {
      version: 1,
      salt: crypto.randomBytes(16).toString('hex'),
      entries: {},
    };

    try {
      fs.writeFileSync(VAULT_FILE, JSON.stringify(initial, null, 2), { mode: 0o600, encoding: 'utf-8' });
    } catch (err) {
      console.error('[TokenVault] Failed to initialize vault file:', err);
    }

    return initial;
  }

  public flushVault(): void {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }

    try {
      this.ensureVaultDirectory();
      const content = JSON.stringify(this.vaultData, null, 2);
      const tmpFile = `${VAULT_FILE}.tmp.${Date.now()}`;
      fs.writeFileSync(tmpFile, content, { mode: 0o600, encoding: 'utf-8' });

      if (fs.existsSync(VAULT_FILE)) {
        try {
          fs.copyFileSync(VAULT_FILE, `${VAULT_FILE}.bak`);
        } catch {}
      }

      fs.renameSync(tmpFile, VAULT_FILE);
    } catch (err) {
      console.error('[TokenVault] Failed to persist vault to disk:', err);
    }
  }

  private scheduleVaultSave(): void {
    if (this.saveTimeout) return;
    this.saveTimeout = setTimeout(() => {
      this.saveTimeout = null;
      this.flushVault();
    }, 150);
  }

  /**
   * Cryptographic SHA-256 fingerprint
   */
  public hashToken(token: string): string {
    return crypto.createHash('sha256').update(token.trim()).digest('hex');
  }

  /**
   * Generate safe masked token representation
   * e.g. 263e••••••••••••••••••••••••••••••••••••••••••••••••••••••••4ee0
   */
  public maskToken(token: string): string {
    const clean = token.trim();
    if (!clean) return '';
    if (clean.length <= 8) {
      return `${clean.substring(0, 2)}••••${clean.substring(clean.length - 2)}`;
    }
    const prefix = clean.substring(0, 4);
    const suffix = clean.substring(clean.length - 4);
    const maskedMiddle = '•'.repeat(Math.min(clean.length - 8, 32));
    return `${prefix}${maskedMiddle}${suffix}`;
  }

  /**
   * Encrypts and stores a token in the isolated vault.
   * Returns metadata reference to store in the standard database.
   */
  public storeSecret(
    chatId: number,
    tokenId: string,
    plainToken: string,
    existingRef?: string
  ): { secretRef: string; maskedToken: string; tokenHash: string } {
    const cleanToken = plainToken.trim();
    const tokenHash = this.hashToken(cleanToken);
    const maskedToken = this.maskToken(cleanToken);
    const secretRef = existingRef || `sec_${crypto.randomBytes(16).toString('hex')}`;

    // Generate random 96-bit (12 bytes) IV for AES-GCM
    const iv = crypto.randomBytes(12);
    const salt = Buffer.from(this.vaultData.salt, 'hex');

    // Context-bound key derivation
    const subKey = this.deriveSubKey(salt, `vault-token-${chatId}`);

    const cipher = crypto.createCipheriv('aes-256-gcm', subKey, iv);

    // Bind AAD (Additional Authenticated Data) to prevent ciphertext substitution
    const aad = Buffer.from(`auth:${chatId}:${tokenId}:${secretRef}`, 'utf-8');
    cipher.setAAD(aad);

    let encrypted = cipher.update(cleanToken, 'utf-8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    const entry: VaultEntry = {
      secretRef,
      chatId,
      tokenId,
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex'),
      ciphertext: encrypted,
      tokenHash,
      maskedToken,
      createdAt: this.vaultData.entries[secretRef]?.createdAt || Date.now(),
      updatedAt: Date.now(),
    };

    this.vaultData.entries[secretRef] = entry;
    this.scheduleVaultSave();

    return { secretRef, maskedToken, tokenHash };
  }

  /**
   * Decrypts and retrieves a token into volatile memory.
   * Authenticates data integrity via GCM auth tag and AAD.
   */
  public retrieveSecret(chatId: number, tokenId: string, secretRef?: string): string | null {
    if (!secretRef) return null;
    const entry = this.vaultData.entries[secretRef];
    if (!entry) return null;

    try {
      const iv = Buffer.from(entry.iv, 'hex');
      const authTag = Buffer.from(entry.authTag, 'hex');
      const salt = Buffer.from(this.vaultData.salt, 'hex');

      const subKey = this.deriveSubKey(salt, `vault-token-${chatId}`);

      const decipher = crypto.createDecipheriv('aes-256-gcm', subKey, iv);
      decipher.setAuthTag(authTag);

      const aad = Buffer.from(`auth:${chatId}:${tokenId}:${secretRef}`, 'utf-8');
      decipher.setAAD(aad);

      let decrypted = decipher.update(entry.ciphertext, 'hex', 'utf-8');
      decrypted += decipher.final('utf-8');

      return decrypted;
    } catch (err: any) {
      console.error(`[TokenVault] Decryption / authentication failed for secret ${secretRef}:`, err.message);
      return null;
    }
  }

  /**
   * Removes secret permanently from vault
   */
  public deleteSecret(secretRef?: string): boolean {
    if (!secretRef || !this.vaultData.entries[secretRef]) return false;
    delete this.vaultData.entries[secretRef];
    this.scheduleVaultSave();
    return true;
  }

  /**
   * Total number of encrypted secrets in vault
   */
  public getVaultCount(): number {
    return Object.keys(this.vaultData.entries).length;
  }

  /**
   * Returns current cryptography parameters and security health
   */
  public getSecurityStatus(): {
    algorithm: string;
    keyDerivation: string;
    iterations: number;
    vaultIsolated: boolean;
    encryptedEntriesCount: number;
    authTagLength: number;
    vaultPath: string;
  } {
    return {
      algorithm: 'AES-256-GCM (Authenticated Encryption with Associated Data)',
      keyDerivation: 'PBKDF2-HMAC-SHA512',
      iterations: 100000,
      vaultIsolated: true,
      encryptedEntriesCount: Object.keys(this.vaultData.entries).length,
      authTagLength: 128,
      vaultPath: 'data/.vault/vault.secure.enc',
    };
  }
}

export const tokenVault = TokenVault.getInstance();
