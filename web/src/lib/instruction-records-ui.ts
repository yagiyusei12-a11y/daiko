export type InstructionInstructor = { id: string; familyName: string; givenName: string };

export type InstructionRow = {
  id: string;
  date: string;
  instructionVenue: string;
  recipientEmployeeIds: string[];
  recipients: InstructionInstructor[];
  recipientLabel: string;
  instructorEmployeeIds: string[];
  instructors: InstructionInstructor[];
  instructorLabel: string;
  instructionItems: string;
  specialNotes: string;
  remarks: string;
  createdAt: string;
  updatedAt: string;
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
