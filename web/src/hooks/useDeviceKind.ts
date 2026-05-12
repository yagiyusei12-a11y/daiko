import { useEffect, useState } from "react";

/** レイアウト用の端末区分（UA と幅から推定） */
export type DeviceKind = "phone" | "tablet" | "desktop";

function computeKind(width: number): DeviceKind {
  if (width < 600) return "phone";
  if (width < 1100) return "tablet";
  return "desktop";
}

/** 画面幅のブレークポイント＋タブレット扱いの UA で区分。リサイズに追従。 */
export function useDeviceKind(): DeviceKind {
  const [kind, setKind] = useState<DeviceKind>(() =>
    typeof window !== "undefined" ? computeKind(window.innerWidth) : "desktop",
  );

  useEffect(() => {
    const ua = navigator.userAgent;
    const isIPad = /\biPad\b/i.test(ua) || (/\bMacintosh\b/i.test(ua) && navigator.maxTouchPoints > 1);

    const update = () => {
      const w = window.innerWidth;
      let k = computeKind(w);
      if (isIPad && k === "desktop" && w < 1300) k = "tablet";
      setKind(k);
    };

    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return kind;
}
