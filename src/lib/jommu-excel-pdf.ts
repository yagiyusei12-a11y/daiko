/**
 * 乗務記録簿: HTML テンプレ（templates/jommu-print）を Chromium で PDF 化する。
 * 複数枚は pdf-lib または qpdf で結合する。
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { PDFDocument } from "pdf-lib";
import { renderHtmlToPdf } from "./html-to-pdf.js";
import { buildJommuKirokuboSheetHtml } from "./jommu-print-html.js";
import type { JommuKirokuboModel } from "./jommu-types.js";

const execFileAsync = promisify(execFile);

function getQpdfExecutable(): string | null {
  const fromEnv = process.env.QPDF_EXECUTABLE?.trim();
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  if (existsSync("/usr/bin/qpdf")) return "/usr/bin/qpdf";
  return null;
}

/** pdf-lib が読めない出力でも結合できるよう qpdf を使う */
async function mergePdfBuffersWithQpdf(pdfs: Buffer[]): Promise<Buffer> {
  const qpdf = getQpdfExecutable();
  if (!qpdf) throw new Error("qpdf が見つかりません（apt install qpdf）");

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "daiko-jommu-qpdf-"));
  try {
    const inputs: string[] = [];
    for (let i = 0; i < pdfs.length; i++) {
      const p = path.join(dir, `in${i}.pdf`);
      await fs.writeFile(p, pdfs[i]!);
      inputs.push(p);
    }
    const outPath = path.join(dir, "merged.pdf");
    const args = ["--empty", "--pages"];
    for (const p of inputs) {
      args.push(p, "1-z");
    }
    args.push("--", outPath);
    await execFileAsync(qpdf, args, {
      timeout: 120_000,
      maxBuffer: 50 * 1024 * 1024,
    });
    return await fs.readFile(outPath);
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function mergePdfBuffers(pdfs: Buffer[]): Promise<Buffer> {
  if (pdfs.length === 0) {
    const doc = await PDFDocument.create();
    return Buffer.from(await doc.save());
  }
  if (pdfs.length === 1) return pdfs[0]!;

  try {
    const out = await PDFDocument.create();
    for (const buf of pdfs) {
      const src = await PDFDocument.load(buf, { ignoreEncryption: true });
      const copied = await out.copyPages(src, src.getPageIndices());
      for (const p of copied) out.addPage(p);
    }
    return Buffer.from(await out.save());
  } catch (libErr) {
    try {
      return await mergePdfBuffersWithQpdf(pdfs);
    } catch (qErr) {
      const a = libErr instanceof Error ? libErr.message : String(libErr);
      const b = qErr instanceof Error ? qErr.message : String(qErr);
      throw new Error(`pdf 結合: pdf-lib が失敗（${a}）; qpdf も失敗（${b}）`);
    }
  }
}

export async function renderJommuKirokuboPdf(model: JommuKirokuboModel): Promise<Buffer> {
  const html = await buildJommuKirokuboSheetHtml(model);
  return renderHtmlToPdf(html);
}

export async function renderJommuKirokuboPdfBundle(models: JommuKirokuboModel[]): Promise<Buffer> {
  if (models.length === 0) {
    const doc = await PDFDocument.create();
    return Buffer.from(await doc.save());
  }

  const chunks: Buffer[] = [];
  for (const m of models) {
    chunks.push(await renderJommuKirokuboPdf(m));
  }

  return mergePdfBuffers(chunks);
}
