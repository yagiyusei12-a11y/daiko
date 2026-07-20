/** 画像ファイルを縮小して JPEG data URL にする（免許証写真のアップロード用）。 */
export async function fileToCompressedDataUrl(
  file: File,
  opts?: { maxEdge?: number; quality?: number },
): Promise<string> {
  const maxEdge = opts?.maxEdge ?? 1280;
  const quality = opts?.quality ?? 0.72;

  if (!file.type.startsWith("image/")) {
    throw new Error("画像ファイルを選択してください");
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("画像の読み込みに失敗しました"));
      el.src = objectUrl;
    });

    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (!w || !h) throw new Error("画像サイズを取得できませんでした");

    const scale = Math.min(1, maxEdge / Math.max(w, h));
    const tw = Math.max(1, Math.round(w * scale));
    const th = Math.max(1, Math.round(h * scale));

    const canvas = document.createElement("canvas");
    canvas.width = tw;
    canvas.height = th;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("画像の変換に失敗しました");
    ctx.drawImage(img, 0, 0, tw, th);

    const dataUrl = canvas.toDataURL("image/jpeg", quality);
    // まだ大きすぎる場合は品質を下げて再エンコード
    if (dataUrl.length > 900_000) {
      return canvas.toDataURL("image/jpeg", 0.55);
    }
    return dataUrl;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
