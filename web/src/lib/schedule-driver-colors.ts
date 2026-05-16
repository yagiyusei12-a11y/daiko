import { SCHEDULE_UNASSIGNED_DRIVER_ID } from "./schedule-constants";

export type DriverColor = { bg: string; border: string; text: string };

export const DRIVER_COLOR_PALETTE: readonly DriverColor[] = [
  { bg: "#FDE68A", border: "#F59E0B", text: "#78350F" },
  { bg: "#BFDBFE", border: "#3B82F6", text: "#1E3A8A" },
  { bg: "#BBF7D0", border: "#22C55E", text: "#14532D" },
  { bg: "#FBCFE8", border: "#EC4899", text: "#831843" },
  { bg: "#DDD6FE", border: "#8B5CF6", text: "#4C1D95" },
  { bg: "#FECACA", border: "#EF4444", text: "#7F1D1D" },
  { bg: "#A5F3FC", border: "#06B6D4", text: "#164E63" },
  { bg: "#FED7AA", border: "#EA580C", text: "#7C2D12" },
] as const;

export const UNASSIGNED_DRIVER_COLOR: DriverColor = {
  bg: "#E2E8F0",
  border: "#94A3B8",
  text: "#334155",
};

/** 客車担当者（シフト行）ごとに安定した色を割り当て */
export function buildDriverColorMap(driverIds: string[]): Map<string, DriverColor> {
  const map = new Map<string, DriverColor>();
  let idx = 0;
  for (const id of driverIds) {
    if (id === SCHEDULE_UNASSIGNED_DRIVER_ID) {
      map.set(id, UNASSIGNED_DRIVER_COLOR);
      continue;
    }
    map.set(id, DRIVER_COLOR_PALETTE[idx % DRIVER_COLOR_PALETTE.length]);
    idx += 1;
  }
  return map;
}

export function colorForDriver(
  driverEmployeeId: string | null,
  colorMap: Map<string, DriverColor>,
): DriverColor {
  const key = driverEmployeeId ?? SCHEDULE_UNASSIGNED_DRIVER_ID;
  return colorMap.get(key) ?? UNASSIGNED_DRIVER_COLOR;
}
