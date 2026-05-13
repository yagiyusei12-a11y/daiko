export type InstructionRow = {
  id: string;
  sessionGroupId: string | null;
  employeeId: string;
  employeeFamilyName: string;
  employeeGivenName: string;
  date: string;
  instructionVenue: string;
  instructorNames: string;
  instructionItems: string;
  specialNotes: string;
  remarks: string;
};

/** 印刷用：同一 session の受講者をまとめた1枚分 */
export type GroupedInstructionSheet = {
  key: string;
  dateIso: string;
  instructionVenue: string;
  instructorNames: string;
  instructionItems: string;
  specialNotes: string;
  remarks: string;
  recipientNames: string[];
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function firstDayOfMonth(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-01`;
}

export function lastDayOfMonth(d: Date): string {
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return `${last.getFullYear()}-${pad2(last.getMonth() + 1)}-${pad2(last.getDate())}`;
}

export function formatInstructionDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(d);
}

/** sessionGroupId が同じ行を1件の指導実施としてまとめる（無い場合は id ごとに独立） */
export function groupRecordsBySession(records: InstructionRow[]): GroupedInstructionSheet[] {
  const map = new Map<string, InstructionRow[]>();
  for (const r of records) {
    const k = r.sessionGroupId && r.sessionGroupId.trim() ? r.sessionGroupId : r.id;
    const arr = map.get(k);
    if (arr) arr.push(r);
    else map.set(k, [r]);
  }
  const sheets: GroupedInstructionSheet[] = [];
  for (const [k, rows] of map) {
    const sortedRecipients = [...rows].sort((a, b) => {
      const af = `${a.employeeFamilyName}${a.employeeGivenName}`;
      const bf = `${b.employeeFamilyName}${b.employeeGivenName}`;
      return af.localeCompare(bf, "ja");
    });
    const head = sortedRecipients[0];
    sheets.push({
      key: k,
      dateIso: head.date,
      instructionVenue: head.instructionVenue ?? "",
      instructorNames: head.instructorNames ?? "",
      instructionItems: head.instructionItems,
      specialNotes: head.specialNotes,
      remarks: head.remarks,
      recipientNames: sortedRecipients.map((x) => `${x.employeeFamilyName} ${x.employeeGivenName}`),
    });
  }
  sheets.sort((a, b) => a.dateIso.localeCompare(b.dateIso));
  return sheets;
}
