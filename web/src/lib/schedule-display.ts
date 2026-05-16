export type RouteDetail = {
  customerName?: string;
  pickup?: string;
  viaStops?: string[];
  dropoff?: string;
};

/** 迎え先 → 経由… → お送り先 */
export function formatReservationRoute(detail: RouteDetail): string {
  const parts = [
    detail.pickup?.trim(),
    ...(detail.viaStops ?? []).map((s) => s.trim()).filter(Boolean),
    detail.dropoff?.trim(),
  ].filter(Boolean);
  return parts.join(" → ");
}

export function formatReservationCustomer(detail: RouteDetail, fallbackTitle?: string): string {
  return (detail.customerName?.trim() || fallbackTitle?.trim() || "予定").trim();
}
