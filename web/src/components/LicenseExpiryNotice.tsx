import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../api";
import { useAuth, type MeUser } from "../auth";
import { useSavedToast } from "../saved-toast";
import { Err } from "../ui";

type MyLicense = {
  licenseExpiresOn: string;
  licensePhotoFrontDataUrl: string;
  licensePhotoBackDataUrl: string;
};

export function licenseExpiryBannerText(notice: NonNullable<MeUser["licenseExpiryNotice"]>): string {
  const { daysRemaining, expiresOn } = notice;
  const expLabel = expiresOn.replace(/-/g, "/");
  if (daysRemaining < 0) {
    return `免許書の有効期限（${expLabel}）を過ぎています（${Math.abs(daysRemaining)}日経過）`;
  }
  if (daysRemaining === 0) {
    return `免許書の有効期限は本日（${expLabel}）です`;
  }
  return `免許書の有効期限（${expLabel}）まで残り${daysRemaining}日`;
}

export default function LicenseExpiryNotice(): JSX.Element | null {
  const { me, refreshMe } = useAuth();
  const { flashSaved } = useSavedToast();
  const notice = me?.licenseExpiryNotice;
  const [dialogOpen, setDialogOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadBusy, setLoadBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState<MyLicense>({
    licenseExpiresOn: "",
    licensePhotoFrontDataUrl: "",
    licensePhotoBackDataUrl: "",
  });

  const loadLicense = useCallback(async () => {
    setLoadBusy(true);
    setErr(null);
    const r = await apiFetch<MyLicense>("/my-license");
    setLoadBusy(false);
    if (!r.ok) {
      setErr(r.error);
      return;
    }
    setForm({
      licenseExpiresOn: r.data.licenseExpiresOn,
      licensePhotoFrontDataUrl: r.data.licensePhotoFrontDataUrl,
      licensePhotoBackDataUrl: r.data.licensePhotoBackDataUrl,
    });
  }, []);

  useEffect(() => {
    if (!dialogOpen) return;
    void loadLicense();
  }, [dialogOpen, loadLicense]);

  if (!notice) return null;

  function onLicensePhotoSide(side: "front" | "back", f: File | null): void {
    if (!f) return;
    if (f.size > 900_000) {
      setErr("画像が大きすぎます（900KB 以下にしてください）");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const s = typeof reader.result === "string" ? reader.result : "";
      if (side === "front") setForm((p) => ({ ...p, licensePhotoFrontDataUrl: s }));
      else setForm((p) => ({ ...p, licensePhotoBackDataUrl: s }));
    };
    reader.readAsDataURL(f);
  }

  async function save(): Promise<void> {
    if (!form.licenseExpiresOn.trim()) {
      setErr("有効期限を入力してください");
      return;
    }
    setBusy(true);
    setErr(null);
    const r = await apiFetch<{ ok: boolean }>("/my-license", {
      method: "PATCH",
      json: {
        licenseExpiresOn: form.licenseExpiresOn,
        licensePhotoFrontDataUrl: form.licensePhotoFrontDataUrl,
        licensePhotoBackDataUrl: form.licensePhotoBackDataUrl,
      },
    });
    setBusy(false);
    if (!r.ok) {
      setErr(r.error);
      return;
    }
    flashSaved();
    setDialogOpen(false);
    await refreshMe();
  }

  return (
    <>
      <div className="app-license-expiry-banner" role="status">
        <p className="app-license-expiry-banner__text">{licenseExpiryBannerText(notice)}</p>
        <button
          type="button"
          className="settings-primary app-license-expiry-banner__btn"
          onClick={() => setDialogOpen(true)}
        >
          有効期限を変更する
        </button>
      </div>

      {dialogOpen ? (
        <div
          className="pricing-modal-backdrop"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setDialogOpen(false);
          }}
        >
          <div
            className="pricing-modal license-expiry-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="license-expiry-title"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h2 id="license-expiry-title" className="pricing-modal-title">
              運転免許証の更新
            </h2>
            <p className="settings-hint">有効期限と免許証の表裏の写しを更新できます。</p>
            <Err msg={err} />
            {loadBusy ? (
              <p className="settings-hint">読み込み中…</p>
            ) : (
              <div className="settings-form">
                <label htmlFor="my-license-expires">有効期限</label>
                <input
                  id="my-license-expires"
                  type="date"
                  value={form.licenseExpiresOn}
                  onChange={(e) => setForm((p) => ({ ...p, licenseExpiresOn: e.target.value }))}
                />
                <label>免許証の写真（表面）</label>
                <input type="file" accept="image/*" onChange={(e) => onLicensePhotoSide("front", e.target.files?.[0] ?? null)} />
                {form.licensePhotoFrontDataUrl ? (
                  <img className="settings-photo-preview" src={form.licensePhotoFrontDataUrl} alt="免許証表面" />
                ) : null}
                <label>免許証の写真（裏面）</label>
                <input type="file" accept="image/*" onChange={(e) => onLicensePhotoSide("back", e.target.files?.[0] ?? null)} />
                {form.licensePhotoBackDataUrl ? (
                  <img className="settings-photo-preview" src={form.licensePhotoBackDataUrl} alt="免許証裏面" />
                ) : null}
              </div>
            )}
            <div className="pricing-modal-actions">
              <button type="button" className="settings-primary" disabled={busy || loadBusy} onClick={() => void save()}>
                {busy ? "保存中…" : "保存"}
              </button>
              <button type="button" className="settings-secondary" disabled={busy} onClick={() => setDialogOpen(false)}>
                キャンセル
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
