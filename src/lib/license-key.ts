import { createHash, randomBytes } from "node:crypto";
import type { LicenseKey } from "@prisma/client";
import { prisma } from "../db.js";

/** 紛らわしい文字を除いた英数字 */
const KEY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const KEY_PREFIX = "DAIKO";
const SEGMENT_LEN = 4;
const SEGMENT_COUNT = 3;
/** 照合・一覧表示用（平文の先頭） */
export const LICENSE_KEY_PREFIX_DISPLAY_LEN = 10;

const MAX_GENERATE_QUANTITY = 100;
const MIN_VALID_DAYS = 1;
const MAX_VALID_DAYS = 3650;

export function hashLicenseKeyPlain(plain: string): string {
  const normalized = normalizeLicenseKeyPlain(plain);
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

/** 入力を検索用に正規化（ハイフン・空白は維持しつつ大文字化） */
export function normalizeLicenseKeyPlain(plain: string): string {
  return plain.trim().toUpperCase().replace(/\s+/g, "");
}

export function licenseKeyPrefixFromPlain(plain: string): string {
  const n = normalizeLicenseKeyPlain(plain);
  return n.slice(0, LICENSE_KEY_PREFIX_DISPLAY_LEN);
}

function randomSegment(length: number): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += KEY_ALPHABET[bytes[i]! % KEY_ALPHABET.length]!;
  }
  return out;
}

/** `DAIKO-XXXX-XXXX-XXXX` 形式の平文キーを1件生成 */
export function generateLicenseKeyPlain(): string {
  const parts = [KEY_PREFIX];
  for (let i = 0; i < SEGMENT_COUNT; i++) {
    parts.push(randomSegment(SEGMENT_LEN));
  }
  return parts.join("-");
}

export function parseGenerateQuantity(raw: unknown): number | null {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > MAX_GENERATE_QUANTITY) return null;
  return n;
}

export function parseValidDays(raw: unknown): number | null {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < MIN_VALID_DAYS || n > MAX_VALID_DAYS) return null;
  return n;
}

export function isLicenseKeyRedeemable(key: LicenseKey, now: Date = new Date()): boolean {
  if (key.isRevoked) return false;
  if (key.usedAt) return false;
  if (key.expiresAt && key.expiresAt.getTime() <= now.getTime()) return false;
  return true;
}

export function licenseKeyInvalidReason(key: LicenseKey | null, now: Date = new Date()): string {
  if (!key) return "ライセンスキーが見つかりません。";
  if (key.isRevoked) return "このライセンスキーは無効化されています。";
  if (key.usedAt) return "このライセンスキーはすでに使用されています。";
  if (key.expiresAt && key.expiresAt.getTime() <= now.getTime()) {
    return "このライセンスキーの有効期限が切れています。";
  }
  return "ライセンスキーを使用できません。";
}

export function extendPaidThrough(
  currentPaidThrough: Date | null,
  validDays: number,
  now: Date = new Date(),
): Date {
  const base =
    currentPaidThrough && currentPaidThrough.getTime() > now.getTime()
      ? currentPaidThrough
      : now;
  return new Date(base.getTime() + validDays * 24 * 60 * 60 * 1000);
}

/** ユニークな平文キーを quantity 件生成し DB に保存（平文一覧を返す） */
export async function generateAndStoreLicenseKeys(input: {
  validDays: number;
  quantity: number;
  note?: string | null;
  batchLabel?: string | null;
  expiresAt?: Date | null;
}): Promise<{ keys: string[]; batchLabel: string | null }> {
  const { validDays, quantity, note, batchLabel, expiresAt } = input;
  const plainKeys: string[] = [];
  const seenHashes = new Set<string>();

  while (plainKeys.length < quantity) {
    const plain = generateLicenseKeyPlain();
    const keyHash = hashLicenseKeyPlain(plain);
    if (seenHashes.has(keyHash)) continue;
    const existing = await prisma.licenseKey.findUnique({ where: { keyHash }, select: { id: true } });
    if (existing) continue;
    seenHashes.add(keyHash);
    plainKeys.push(plain);
  }

  await prisma.$transaction(async (tx) => {
    for (const plain of plainKeys) {
      await tx.licenseKey.create({
        data: {
          keyHash: hashLicenseKeyPlain(plain),
          keyPrefix: licenseKeyPrefixFromPlain(plain),
          validDays,
          batchLabel: batchLabel ?? null,
          note: note ?? null,
          expiresAt: expiresAt ?? null,
        },
      });
    }
  });

  return { keys: plainKeys, batchLabel: batchLabel ?? null };
}

export type RedeemLicenseKeyResult = {
  paidThroughAt: Date;
  validDays: number;
  billingStatus: "LICENSE_ONLY";
};

/** 平文キーをテナントに適用（トランザクション） */
export async function redeemLicenseKeyForTenant(
  tenantId: string,
  licenseKeyPlain: string,
): Promise<RedeemLicenseKeyResult> {
  const normalized = normalizeLicenseKeyPlain(licenseKeyPlain);
  if (!normalized) {
    throw new LicenseKeyError("ライセンスキーを入力してください。");
  }

  const keyHash = hashLicenseKeyPlain(normalized);
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    const key = await tx.licenseKey.findUnique({ where: { keyHash } });
    if (!key || !isLicenseKeyRedeemable(key, now)) {
      throw new LicenseKeyError(licenseKeyInvalidReason(key, now));
    }

    const marked = await tx.licenseKey.updateMany({
      where: { id: key.id, usedAt: null, isRevoked: false },
      data: { usedAt: now, usedByTenantId: tenantId },
    });
    if (marked.count !== 1) {
      throw new LicenseKeyError("このライセンスキーはすでに使用されています。");
    }

    const tenant = await tx.tenant.findUnique({
      where: { id: tenantId },
      select: { paidThroughAt: true },
    });
    if (!tenant) {
      throw new LicenseKeyError("テナントが見つかりません。");
    }

    const paidThroughAt = extendPaidThrough(tenant.paidThroughAt, key.validDays, now);

    await tx.tenant.update({
      where: { id: tenantId },
      data: {
        billingStatus: "LICENSE_ONLY",
        paidThroughAt,
        billingUpdatedAt: now,
      },
    });

    await tx.subscription.create({
      data: {
        tenantId,
        planTier: "STANDARD",
        source: "LICENSE_KEY",
        status: "ACTIVE",
        validFrom: now,
        validTo: paidThroughAt,
        licenseKeyId: key.id,
      },
    });

    return { paidThroughAt, validDays: key.validDays, billingStatus: "LICENSE_ONLY" };
  });
}

export class LicenseKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LicenseKeyError";
  }
}
