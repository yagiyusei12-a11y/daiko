declare module "xlsx-populate" {
  interface XlsxCell {
    value(v?: unknown): unknown;
    clear(): unknown;
  }

  interface XlsxSheet {
    cell(addr: string): XlsxCell;
  }

  interface XlsxWorkbook {
    sheet(indexOrName: number | string): XlsxSheet | undefined;
    outputAsync(opts?: { type?: string; password?: string }): Promise<Buffer | Uint8Array | string>;
  }

  const XlsxPopulate: {
    fromDataAsync(
      data: string | number[] | ArrayBuffer | Uint8Array | Buffer,
      opts?: Record<string, unknown>,
    ): Promise<XlsxWorkbook>;
  };

  export default XlsxPopulate;
}
