import { z } from "zod";

export const WaitingRuleSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("linear"),
    graceMin: z.number().int().min(0),
    perMinYen: z.number().int().min(0),
  }),
  z.object({
    type: z.literal("block"),
    graceMin: z.number().int().min(0),
    blockEveryMin: z.number().int().min(1),
    blockYen: z.number().int().min(0),
  }),
  z.object({
    type: z.literal("grace_flat_then_linear"),
    graceMin: z.number().int().min(0),
    firstChargeYen: z.number().int().min(0),
    perMinAfterFirstYen: z.number().int().min(0),
  }),
  /** 無料分のあと、先頭 prefix 分は定額、その超過を blockEveryMin ごとに blockYen（だるま型・ひよこ型） */
  z.object({
    type: z.literal("prefix_block_then_block"),
    graceMin: z.number().int().min(0),
    prefixMin: z.number().int().min(0),
    prefixYen: z.number().int().min(0),
    blockEveryMin: z.number().int().min(1),
    blockYen: z.number().int().min(0),
  }),
]);

export type WaitingRule = z.infer<typeof WaitingRuleSchema>;

export function parseWaitingRule(input: unknown, legacyPerMinYen: number): WaitingRule {
  const parsed = WaitingRuleSchema.safeParse(input);
  if (parsed.success) return parsed.data;
  return { type: "linear", graceMin: 0, perMinYen: Math.max(0, Math.floor(legacyPerMinYen)) };
}

export function waitingFareYen(rule: WaitingRule, waitingMinutes: number): number {
  const m = Math.max(0, Math.floor(waitingMinutes));
  if (rule.type === "linear") {
    const billable = Math.max(0, m - rule.graceMin);
    return billable * rule.perMinYen;
  }
  if (rule.type === "block") {
    const billable = Math.max(0, m - rule.graceMin);
    if (billable <= 0) return 0;
    return Math.ceil(billable / rule.blockEveryMin) * rule.blockYen;
  }
  if (rule.type === "prefix_block_then_block") {
    if (m <= rule.graceMin) return 0;
    if (m <= rule.graceMin + rule.prefixMin) return rule.prefixYen;
    const over = m - rule.graceMin - rule.prefixMin;
    return rule.prefixYen + Math.ceil(over / rule.blockEveryMin) * rule.blockYen;
  }
  const billable = Math.max(0, m - rule.graceMin);
  if (billable <= 0) return 0;
  if (billable === 1) return rule.firstChargeYen;
  return rule.firstChargeYen + (billable - 1) * rule.perMinAfterFirstYen;
}
