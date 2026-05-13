import { prisma } from "../db.js";

export function parseEmployeeIdArrayJson(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map((x) => String(x).trim()).filter(Boolean))];
}

export function employeeName(e: { familyName: string; givenName: string }): string {
  return `${e.familyName} ${e.givenName}`.trim();
}

export type InstructionRowDb = {
  id: string;
  date: Date;
  instructionVenue: string;
  recipientEmployeeIds: unknown;
  instructorEmployeeIds: unknown;
  instructionItems: string;
  specialNotes: string;
  remarks: string;
  createdAt: Date;
  updatedAt: Date;
};

export type InstructionRecordFormatted = {
  id: string;
  date: string;
  instructionVenue: string;
  recipientEmployeeIds: string[];
  recipients: { id: string; familyName: string; givenName: string }[];
  recipientLabel: string;
  instructorEmployeeIds: string[];
  instructors: { id: string; familyName: string; givenName: string }[];
  instructorLabel: string;
  instructionItems: string;
  specialNotes: string;
  remarks: string;
  createdAt: string;
  updatedAt: string;
};

export async function formatInstructionRecordsForApi(
  tenantId: string,
  rows: InstructionRowDb[],
): Promise<InstructionRecordFormatted[]> {
  const all = new Set<string>();
  for (const r of rows) {
    for (const id of parseEmployeeIdArrayJson(r.recipientEmployeeIds)) all.add(id);
    for (const id of parseEmployeeIdArrayJson(r.instructorEmployeeIds)) all.add(id);
  }
  const emps =
    all.size > 0
      ? await prisma.employee.findMany({
          where: { tenantId, id: { in: [...all] } },
          select: { id: true, familyName: true, givenName: true },
        })
      : [];
  const map = new Map(emps.map((e) => [e.id, e]));

  return rows.map((r) => {
    const recipientIds = parseEmployeeIdArrayJson(r.recipientEmployeeIds);
    const instructorIds = parseEmployeeIdArrayJson(r.instructorEmployeeIds);
    const recipients = recipientIds
      .map((id) => map.get(id))
      .filter((e): e is (typeof emps)[0] => e != null)
      .map((e) => ({ id: e.id, familyName: e.familyName, givenName: e.givenName }));
    const instructors = instructorIds
      .map((id) => map.get(id))
      .filter((e): e is (typeof emps)[0] => e != null)
      .map((e) => ({ id: e.id, familyName: e.familyName, givenName: e.givenName }));
    return {
      id: r.id,
      date: r.date.toISOString(),
      instructionVenue: r.instructionVenue,
      recipientEmployeeIds: recipientIds,
      recipients,
      recipientLabel: recipients.map((e) => employeeName(e)).join("、"),
      instructorEmployeeIds: instructorIds,
      instructors,
      instructorLabel: instructors.map((e) => employeeName(e)).join("、"),
      instructionItems: r.instructionItems,
      specialNotes: r.specialNotes,
      remarks: r.remarks,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  });
}
