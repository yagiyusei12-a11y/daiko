import { prisma } from "../db.js";

export function formatEmployeeDisplayName(emp: { familyName: string; givenName: string }): string {
  return `${emp.familyName} ${emp.givenName}`.trim();
}

/** 日報の現在のペア従業員から同伴乗務員名を取得（未設定なら空文字） */
export async function accompanyingCrewNameForDailyReport(dailyReportId: string): Promise<string> {
  const dr = await prisma.dailyReport.findUnique({
    where: { id: dailyReportId },
    select: {
      partnerEmployee: { select: { familyName: true, givenName: true } },
    },
  });
  if (!dr?.partnerEmployee) return "";
  return formatEmployeeDisplayName(dr.partnerEmployee);
}
