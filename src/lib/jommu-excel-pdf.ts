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
import { PDFDocument } from "pdf-lib";
import { buildJommuFilledXlsxBuffer } from "./jommu-populate-fill.js";
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

async function readPdfAfterSoffice(dir: string, base: string, stderr: string): Promise<Buffer> {
  const expected = path.join(dir, `${base}.pdf`);
  if (existsSync(expected)) return fs.readFile(expected);
  const names = await fs.readdir(dir);
  const pdfs = names.filter((n) => n.toLowerCase().endsWith(".pdf"));
  if (pdfs.length === 1) return fs.readFile(path.join(dir, pdfs[0]!));
  const exact = pdfs.find((n) => n === `${base}.pdf`);
  if (exact) return fs.readFile(path.join(dir, exact));
  const listing = names.join(", ");
  const warn = stderr.trim();
  throw new Error(
    `LibreOffice が PDF を出力しませんでした（期待: ${expected}）。` +
      ` 作業ディレクトリ内: [${listing}]` +
      (warn ? ` soffice stderr: ${warn}` : ""),
  );
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

  await fs.writeFile(xlsxPath, xlsxBuffer);

  const childEnv: NodeJS.ProcessEnv = { ...process.env };
  delete childEnv.DISPLAY;
  Object.assign(childEnv, {
    HOME: dir,
    TMPDIR: dir,
    TMP: dir,
    TEMP: dir,
    SAL_USE_VCLPLUGIN: process.env.SAL_USE_VCLPLUGIN ?? "gen",
  });

  const loPrefix = [
    `-env:UserInstallation=${userInst}`,
    "--headless",
    "--invisible",
    "--nologo",
    "--nolockcheck",
    "--norestore",
  ];

  const convertFilters = ["pdf:calc_pdf_Export", "pdf"] as const;

  try {
    let lastReadErr: unknown;
    for (const filter of convertFilters) {
      for (const n of await fs.readdir(dir).catch(() => [] as string[])) {
        if (n.toLowerCase().endsWith(".pdf")) {
          await fs.rm(path.join(dir, n), { force: true }).catch(() => undefined);
        }
      }
      let stderr = "";
      try {
        const r = await execFileAsync(
          soffice,
          [...loPrefix, "--convert-to", filter, "--outdir", dir, xlsxPath],
          {
            timeout: 120_000,
            maxBuffer: 20 * 1024 * 1024,
            env: childEnv,
          },
        );
        stderr = strFromExecOut(r.stderr);
      } catch (e) {
        lastReadErr = e;
        continue;
      }
      try {
        return await readPdfAfterSoffice(dir, base, stderr);
      } catch (e) {
        lastReadErr = e;
      }
    }
    if (lastReadErr instanceof Error) throw lastReadErr;
    throw new Error(String(lastReadErr ?? "LibreOffice PDF 変換に失敗しました"));
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
  const xlsxBuf = await buildJommuFilledXlsxBuffer(tpl, model);
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
    const src = await PDFDocument.load(buf, { ignoreEncryption: true });
    const copied = await out.copyPages(src, src.getPageIndices());
    for (const p of copied) out.addPage(p);
  }
  return Buffer.from(await out.save());
}
