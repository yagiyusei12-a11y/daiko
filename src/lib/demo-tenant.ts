/** デモログイン用テナント（課金ガード・認証で共通） */

export function demoTenantEnv(): { slug: string; email: string } | null {
  const slug = (process.env.DAIKO_DEMO_TENANT_SLUG ?? "").trim().toLowerCase();
  const email = (process.env.DAIKO_DEMO_USER_EMAIL ?? "").trim().toLowerCase();
  if (!slug || !email) return null;
  return { slug, email };
}

export function isDemoTenantSession(tenantSlug: string, userEmail: string): boolean {
  const cfg = demoTenantEnv();
  if (!cfg) return false;
  return tenantSlug.toLowerCase() === cfg.slug && userEmail.trim().toLowerCase() === cfg.email;
}
