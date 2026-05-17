type JsonObj = Record<string, unknown>;

function asObj(v: unknown): JsonObj {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as JsonObj) : {};
}

export function buildRegisterExtension(
  base: unknown,
  body: {
    birthDate?: string;
    phone?: string;
    mobile?: string;
    hiredOn?: string;
    retiredOn?: string;
    usualWorkDays?: string;
    emergencyName?: string;
    emergencyTel?: string;
    licenseKind?: string;
    licenseNumber?: string;
    licenseExpiresOn?: string;
    licenseConditions?: string[] | string;
    licensePhotoFrontDataUrl?: string;
    licensePhotoBackDataUrl?: string;
  },
): JsonObj {
  const cur = asObj(base);
  const ext: JsonObj = { ...cur };
  const keys = [
    "birthDate",
    "phone",
    "mobile",
    "hiredOn",
    "retiredOn",
    "usualWorkDays",
    "emergencyName",
    "emergencyTel",
    "licenseKind",
    "licenseNumber",
    "licenseExpiresOn",
    "licensePhotoFrontDataUrl",
    "licensePhotoBackDataUrl",
  ] as const;
  for (const k of keys) {
    if (body[k] !== undefined) ext[k] = body[k] as string;
  }
  if (body.licenseConditions !== undefined) {
    if (Array.isArray(body.licenseConditions)) {
      ext.licenseConditions = body.licenseConditions.filter((x): x is string => typeof x === "string");
    } else if (typeof body.licenseConditions === "string") {
      const t = body.licenseConditions.trim();
      ext.licenseConditions = t ? [t] : [];
    }
  }
  if (body.licensePhotoFrontDataUrl !== undefined || body.licensePhotoBackDataUrl !== undefined) {
    delete ext.licensePhotoDataUrl;
  }
  return ext;
}

export function patchMyLicenseExtension(
  base: unknown,
  body: {
    licenseExpiresOn?: string;
    licensePhotoFrontDataUrl?: string;
    licensePhotoBackDataUrl?: string;
  },
): JsonObj {
  return buildRegisterExtension(base, body);
}
