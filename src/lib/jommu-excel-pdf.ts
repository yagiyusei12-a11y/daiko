/**
 * 乗務記録簿: Excel テンプレを埋めて LibreOffice で PDF に変換する。
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
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

function strFromExecOut(x: string | Buffer | undefined): string {
  if (x === undefined) return "";
  return typeof x === "string" ? x : x.toString("utf8");
}

type ExecErr = NodeJS.ErrnoException & { stderr?: Buffer | string; stdout?: Buffer | string; code?: string | number | null };

function execErrDetails(err: unknown): string {
  if (!err || typeof err !== "object") return String(err);
  const e = err as ExecErr;
  const stderr = strFromExecOut(e.stderr).trim();
  const stdout = strFromExecOut(e.stdout).trim();
  const parts = [e.message, stderr && `stderr: ${stderr}`, stdout && `stdout: ${stdout}`].filter(Boolean);
  return parts.join(" | ");
}

async function xlsxBufferToPdf(xlsxBuffer: Buffer): Promise<Buffer> {
  const soffice = getLibreOfficeExecutable();
  if (!soffice) {
    throw new Error("LIBREOFFICE_SOFFICE is not set or soffice was not found on PATH");
  }

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "daiko-jommu-"));
  const loProfile = path.join(dir, "libreoffice-profile");
  await fs.mkdir(loProfile, { recursive: true });
  const userInst = pathToFileURL(loProfile).href;

  const base = `jommu-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const xlsxPath = path.join(dir, `${base}.xlsx`);
  const pdfPath = path.join(dir, `${base}.pdf`);

  await fs.writeFile(xlsxPath, xlsxBuffer);

  const childEnv = {
    ...process.env,
    /** systemd / Node 子プロセスで LO が書き込み可能な場所に固定（プロファイル・キャッシュ用） */
    HOME: dir,
    TMPDIR: dir,
    TMP: dir,
    TEMP: dir,
    /** 実サーバーではディスプレイ無し。Ubuntu の LibreOffice は gen の方が通りやすいことが多い。 */
    SAL_USE_VCLPLUGIN: process.env.SAL_USE_VCLPLUGIN ?? "gen",
  };

  try {
    const { stderr } = await execFileAsync(
      soffice,
      [
        `-env:UserInstallation=${userInst}`,
        "--headless",
        "--invisible",
        "--nologo",
        "--nolockcheck",
        "--norestore",
        "--convert-to",
        "pdf",
        "--outdir",
        dir,
        xlsxPath,
      ],
      {
        timeout: 120_000,
        maxBuffer: 20 * 1024 * 1024,
        env: childEnv,
      },
    );
    try {
      return await fs.readFile(pdfPath);
    } catch (readErr) {
      let listing = "";
      try {
        listing = (await fs.readdir(dir)).join(", ");
      } catch {
        listing = "(readdir failed)";
      }
      const warn = strFromExecOut(stderr).trim();
      const msg =
        `LibreOffice が PDF を出力しませんでした（期待: ${pdfPath}）。` +
        ` 作業ディレクトリ内: [${listing}]` +
        (warn ? ` soffice stderr: ${warn}` : "");
      const wrapped = new Error(msg);
      (wrapped as Error & { cause?: unknown }).cause = readErr;
      throw wrapped;
    }
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("LibreOffice が PDF")) throw e;
    const wrapped = new Error(`soffice の実行に失敗しました: ${execErrDetails(e)}`);
    (wrapped as Error & { cause?: unknown }).cause = e;
    throw wrapped;
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function renderJommuKirokuboPdf(model: JommuKirokuboModel): Promise<Buffer> {
  const tplPath = templatePath();
  if (!existsSync(tplPath)) {
    throw new Error(`乗務記録簿テンプレが見つかりません: ${tplPath}（cwd=${process.cwd()}）`);
  }
  const tpl = await fs.readFile(tplPath);
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
