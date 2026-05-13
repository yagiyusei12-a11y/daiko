/**
 * templates/jommu-zyoumukiroku.xlsx のレイアウトに合わせてセルへ値を書き込む。
 * 結合セルは先頭セルだけに値を入れる（Excel と同じ）。
 */

import type { Worksheet } from "exceljs";
import type { JommuKirokuboModel } from "./jommu-types.js";

function splitHm(hm: string | null | undefined): { hh: string; mm: string } {
  if (!hm || !String(hm).trim()) return { hh: "", mm: "" };
  const p = String(hm).trim().split(":");
  const hh = (p[0] ?? "").trim();
  const mm = (p[1] ?? "").trim().slice(0, 2);
  return { hh, mm };
}

function set(ws: Worksheet, addr: string, v: string | number | null | undefined): void {
  if (v === null || v === undefined) return;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return;
    ws.getCell(addr).value = v;
    return;
  }
  const s = String(v).trim();
  if (!s) return;
  ws.getCell(addr).value = s;
}

function clearCell(ws: Worksheet, addr: string): void {
  ws.getCell(addr).value = null;
}

/** 1 シート分を埋める（テンプレの Sheet1 を想定） */
export function fillJommuWorksheet(ws: Worksheet, model: JommuKirokuboModel): void {
  set(ws, "G3", model.crewName);
  set(ws, "AC3", model.yParts.y);
  set(ws, "AK3", model.yParts.m.padStart(2, "0"));
  set(ws, "AP3", model.yParts.d.padStart(2, "0"));

  const inT = splitHm(model.clockInHm);
  const outT = splitHm(model.clockOutHm);
  set(ws, "G4", inT.hh);
  set(ws, "J4", inT.mm);
  set(ws, "R4", outT.hh);
  set(ws, "U4", outT.mm);

  set(ws, "AC4", model.companyCarRegNo);
  set(ws, "BH3", model.officeName);
  set(ws, "BH4", model.safetyManagerName);

  const maxRows = 10;
  for (let i = 0; i < maxRows; i++) {
    const row = 7 + i;
    const trip = model.trips[i];
    const a = `A${row}`;
    const c = `C${row}`;
    const k = `K${row}`;
    const u = `U${row}`;
    const ad = `AD${row}`;
    const ai = `AI${row}`;
    const aq = `AQ${row}`;
    const ba = `BA${row}`;
    const bf = `BF${row}`;
    const bl = `BL${row}`;
    const bx = `BX${row}`;
    if (!trip) {
      clearCell(ws, a);
      clearCell(ws, c);
      clearCell(ws, k);
      clearCell(ws, u);
      clearCell(ws, ad);
      clearCell(ws, ai);
      clearCell(ws, aq);
      clearCell(ws, ba);
      clearCell(ws, bf);
      clearCell(ws, bl);
      clearCell(ws, bx);
      continue;
    }
    set(ws, a, i + 1);
    set(ws, c, trip.clientName);
    set(ws, k, trip.charterVehicleNo);
    set(ws, u, trip.origin);
    set(ws, ad, trip.departedHm);
    set(ws, ai, trip.viaText);
    set(ws, aq, trip.destination);
    set(ws, ba, trip.arrivedHm);
    set(ws, bf, trip.distanceKm);
    set(ws, bl, trip.fareYen);
    set(ws, bx, model.accompanyingCrewName);
  }

  set(ws, "H18", model.odoStartKm ?? "");
  set(ws, "W18", model.odoEndKm ?? "");
  set(ws, "AL18", model.totalOdoKm ?? "");
  set(ws, "BA18", model.actualDistanceKmSum);
  set(ws, "BQ18", model.salesTotalYen);
}
