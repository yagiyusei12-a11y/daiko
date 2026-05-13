/**
 * 乗務記録簿: Excel テンプレを埋めて LibreOffice で PDF に変換する。
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import ExcelJS from "exceljs";
import { PDFDocument } from "pdf-lib";
import { fillJommuWorksheet } from "./jommu-excel-fill.js";
import type { JommuKirokuboModel } from "./jommu-types.js";

const execFileAsync = promisify(execFile);

const TEMPLATE_REL = path.join("templates", "jommu-zyoumukiroku.xlsx");

function templatePath(): string {
  return path.join(process.cwd(), TEMPLATE_REL);
}

/** LibreOffice の soffice 実行ファイル。未設定・未検出なら null。 */
export function getLibreOfficeExecutable(): string | null {
  const fromEnv = process.env.LIBREOFFICE_SOFFICE?.trim();
  if (fromEnv && existsSync(fromEnv)) return fromEnv;

  const candidates = [
    "/usr/bin/soffice",
    "/usr/lib/libreoffice/program/soffice",
    "/snap/bin/libreoffice",
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

export function isLibreOfficeConfigured(): boolean {
  return getLibreOfficeExecutable() !== null;
}

async function xlsxBufferToPdf(xlsxBuffer: Buffer): Promise<Buffer> {
  const soffice = getLibreOfficeExecutable();
  if (!soffice) {
    throw new Error("LIBREOFFICE_SOFFICE is not set or soffice was not found on PATH");
  }

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "daiko-jommu-"));
  const base = `jommu-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const xlsxPath = path.join(dir, `${base}.xlsx`);
  const pdfPath = path.join(dir, `${base}.pdf`);

  await fs.writeFile(xlsxPath, xlsxBuffer);

  try {
    await execFileAsync(
      soffice,
      [
        "--headless",
        "--invisible",
        "--nologo",
        "--nodefault",
        "--nolockcheck",
        "--convert-to",
        "pdf",
        "--outdir",
        dir,
        xlsxPath,
      ],
      {
        timeout: 120_000,
        maxBuffer: 20 * 1024 * 1024,
      },
    );
    return await fs.readFile(pdfPath);
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function renderJommuKirokuboPdf(model: JommuKirokuboModel): Promise<Buffer> {
  const tpl = await fs.readFile(templatePath());
  const wb = new ExcelJS.Workbook();
  // @ts-expect-error exceljs の xlsx.load の Buffer 型と Node の Buffer が一致しない（実行時は問題なし）
  await wb.xlsx.load(tpl);
  const ws = wb.getWorksheet(1);
  if (!ws) throw new Error("Jommu template: sheet 1 not found");
  fillJommuWorksheet(ws, model);
  const xlsxBuf = Buffer.from(await wb.xlsx.writeBuffer());
  return xlsxBufferToPdf(xlsxBuf);
}

/** 複数枚を 1 本の PDF に結合する。 */
export async function renderJommuKirokuboPdfBundle(models: JommuKirokuboModel[]): Promise<Buffer> {
  if (models.length === 0) {
    const doc = await PDFDocument.create();
    return Buffer.from(await doc.save());
  }

  const chunks: Buffer[] = [];
  for (const m of models) {
    chunks.push(await renderJommuKirokuboPdf(m));
  }

  if (chunks.length === 1) return chunks[0]!;

  const out = await PDFDocument.create();
  for (const buf of chunks) {
    const src = await PDFDocument.load(buf);
    const copied = await out.copyPages(src, src.getPageIndices());
    for (const p of copied) out.addPage(p);
  }
  return Buffer.from(await out.save());
}
