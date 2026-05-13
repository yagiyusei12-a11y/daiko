/** 従事者名簿 registerExtension.licenseKind が「第二種運転免許（貸切等）」相当か */
export function hasSecondClassDriverLicense(registerExtension: unknown): boolean {
  const o =
    registerExtension !== null && typeof registerExtension === "object" && !Array.isArray(registerExtension)
      ? (registerExtension as Record<string, unknown>)
      : {};
  const k = String(o.licenseKind ?? "").trim();
  if (!k) return false;
  if (k.includes("原動機付自転車")) return false;
  const exact = new Set(["大型第二種免許", "中型第二種免許", "普通第二種免許"]);
  if (exact.has(k)) return true;
  return k.includes("第二種") && k.includes("免許");
}
