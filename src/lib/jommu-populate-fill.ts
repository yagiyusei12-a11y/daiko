/**
 * templates/jommu-zyoumukiroku.xlsx を xlsx-populate で埋める。
 * ExcelJS の write よりレイアウト・結合を保ちやすく、LibreOffice の PDF 変換と相性が良い。
 */

import XlsxPopulate from "xlsx-populate";
import type { JommuKirokuboModel } from "./jommu-types.js";

type PopulatedWorkbook = Awaited<ReturnType<typeof XlsxPopulate.fromDataAsync>>;
type PopSheet = NonNullable<ReturnType<PopulatedWorkbook["sheet"]>>;

function splitHm(hm: string | null | undefined): { hh: string; mm: string } {
  if (!hm || !String(hm).trim()) return { hh: "", mm: "" };
  const p = String(hm).trim().split(":");
  const hh = (p[0] ?? "").trim();
  const mm = (p[1] ?? "").trim().slice(0, 2);
  return { hh, mm };
}

function setCell(sheet: PopSheet, addr: string, v: string | number | null | undefined): void {
  if (v === null || v === undefined) return;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return;
    sheet.cell(addr).value(v);
    return;
  }
  const s = String(v).trim();
  if (!s) return;
  sheet.cell(addr).value(s);
}

function clearCell(sheet: PopSheet, addr: string): void {
  sheet.cell(addr).clear();
}

export function fillJommuWorkbookPopulate(wb: PopulatedWorkbook, model: JommuKirokuboModel): void {
  const sheet = wb.sheet(0);
  if (!sheet) throw new Error("Jommu template: sheet 0 not found");

  setCell(sheet, "G3", model.crewName);
  setCell(sheet, "AC3", model.yParts.y);
  setCell(sheet, "AK3", model.yParts.m.padStart(2, "0"));
  setCell(sheet, "AP3", model.yParts.d.padStart(2, "0"));

  const inT = splitHm(model.clockInHm);
  const outT = splitHm(model.clockOutHm);
  setCell(sheet, "G4", inT.hh);
  setCell(sheet, "J4", inT.mm);
  setCell(sheet, "R4", outT.hh);
  setCell(sheet, "U4", outT.mm);

  setCell(sheet, "AC4", model.companyCarRegNo);
  setCell(sheet, "BH3", model.officeName);
  setCell(sheet, "BH4", model.safetyManagerName);

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
      clearCell(sheet, a);
      clearCell(sheet, c);
      clearCell(sheet, k);
      clearCell(sheet, u);
      clearCell(sheet, ad);
      clearCell(sheet, ai);
      clearCell(sheet, aq);
      clearCell(sheet, ba);
      clearCell(sheet, bf);
      clearCell(sheet, bl);
      clearCell(sheet, bx);
      continue;
    }
    setCell(sheet, a, i + 1);
    setCell(sheet, c, trip.clientName);
    setCell(sheet, k, trip.charterVehicleNo);
    setCell(sheet, u, trip.origin);
    setCell(sheet, ad, trip.departedHm);
    setCell(sheet, ai, trip.viaText);
    setCell(sheet, aq, trip.destination);
    setCell(sheet, ba, trip.arrivedHm);
    setCell(sheet, bf, trip.distanceKm);
    setCell(sheet, bl, trip.fareYen);
    setCell(sheet, bx, model.accompanyingCrewName);
  }

  setCell(sheet, "H18", model.odoStartKm ?? "");
  setCell(sheet, "W18", model.odoEndKm ?? "");
  setCell(sheet, "AL18", model.totalOdoKm ?? "");
  setCell(sheet, "BA18", model.actualDistanceKmSum);
  setCell(sheet, "BQ18", model.salesTotalYen);
}

export async function buildJommuFilledXlsxBuffer(tpl: Buffer, model: JommuKirokuboModel): Promise<Buffer> {
  const wb = await XlsxPopulate.fromDataAsync(tpl);
  fillJommuWorkbookPopulate(wb, model);
  const out = await wb.outputAsync({ type: "nodebuffer" });
  if (Buffer.isBuffer(out)) return out;
  if (out instanceof Uint8Array) return Buffer.from(out);
  throw new Error("jommu: unexpected output type from xlsx-populate");
}
