import { z } from "zod";

export const PickupTierSchema = z.object({
  fromM: z.number().int().min(0),
  toM: z.number().int().min(0).nullable(),
  yen: z.number().int().min(0),
});

/** 迎車距離（基準地点から m）に対する帯別円。JSON はこの配列（または空配列）。 */
export const PickupRuleJsonSchema = z.array(PickupTierSchema);

export type PickupTier = z.infer<typeof PickupTierSchema>;

export function parsePickupTiers(input: unknown): PickupTier[] {
  const p = PickupRuleJsonSchema.safeParse(input);
  return p.success ? p.data : [];
}

/**
 * 迎車距離 m に該当する帯の円。未設定・未ヒットは 0。
 */
export function pickupFareYen(pickupRuleJson: unknown, pickupFromBaseM: number | null | undefined): number {
  if (pickupFromBaseM == null || !Number.isFinite(pickupFromBaseM)) return 0;
  const d = Math.max(0, Math.floor(pickupFromBaseM));
  const tiers = [...parsePickupTiers(pickupRuleJson)].sort((a, b) => a.fromM - b.fromM);
  for (const t of tiers) {
    if (d >= t.fromM && (t.toM == null || d <= t.toM)) return t.yen;
  }
  return 0;
}
