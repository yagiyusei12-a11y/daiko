import type { FastifyInstance } from "fastify";
import { authenticate, jwtUser } from "../auth/pre.js";
import { loadUserAccess } from "../lib/permissions.js";
import { prisma } from "../db.js";

function ymdTokyo(d = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(d);
}

function shiftCalendarYm(ym: string, delta: number): string {
  const [ys, ms] = ym.split("-").map(Number);
  const x = new Date(Date.UTC(ys, ms - 1 + delta, 1));
  return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, "0")}`;
}

function legFare(fareYen: number, fareOverrideYen: number | null): number {
  return fareOverrideYen ?? fareYen;
}

export async function registerDashboardRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  app.get("/summary", async (req) => {
    const { tenantId, sub: userId } = jwtUser(req);
    const access = await loadUserAccess(userId, tenantId);

    const today = ymdTokyo();
    const thisYm = today.slice(0, 7);
    const prevYm = shiftCalendarYm(thisYm, -1);

    const drBase = {
      tenantId,
      ...(access.isStaffShiftOnly && access.employeeId ? { mainEmployeeId: access.employeeId } : {}),
    } as const;

    const legs = await prisma.tripLeg.findMany({
      where: {
        dailyReport: {
          ...drBase,
          OR: [{ businessDate: today }, { businessDate: { startsWith: `${thisYm}-` } }, { businessDate: { startsWith: `${prevYm}-` } }],
        },
      },
      select: {
        fareYen: true,
        fareOverrideYen: true,
        dailyReport: {
          select: {
            businessDate: true,
            mainEmployeeId: true,
            mainEmployee: { select: { familyName: true, givenName: true } },
          },
        },
      },
    });

    let totalToday = 0;
    let totalThisMonth = 0;
    let totalPrevMonth = 0;

    type Agg = { name: string; today: number; thisMonth: number; prevMonth: number };
    const byEmp = new Map<string, Agg>();

    for (const leg of legs) {
      const f = legFare(leg.fareYen, leg.fareOverrideYen);
      const bd = leg.dailyReport.businessDate;
      const eid = leg.dailyReport.mainEmployeeId;
      const name = `${leg.dailyReport.mainEmployee.familyName} ${leg.dailyReport.mainEmployee.givenName}`;

      if (bd === today) totalToday += f;
      if (bd.startsWith(`${thisYm}-`)) totalThisMonth += f;
      if (bd.startsWith(`${prevYm}-`)) totalPrevMonth += f;

      let row = byEmp.get(eid);
      if (!row) {
        row = { name, today: 0, thisMonth: 0, prevMonth: 0 };
        byEmp.set(eid, row);
      }
      if (bd === today) row.today += f;
      if (bd.startsWith(`${thisYm}-`)) row.thisMonth += f;
      if (bd.startsWith(`${prevYm}-`)) row.prevMonth += f;
    }

    const byDriver = [...byEmp.entries()]
      .map(([employeeId, v]) => ({
        employeeId,
        name: v.name,
        todayYen: v.today,
        thisMonthYen: v.thisMonth,
        prevMonthYen: v.prevMonth,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "ja"));

    return {
      asOfBusinessDateTokyo: today,
      thisMonthYm: thisYm,
      prevMonthYm: prevYm,
      totals: {
        todayYen: totalToday,
        thisMonthYen: totalThisMonth,
        prevMonthYen: totalPrevMonth,
      },
      byMainDriver: byDriver,
    };
  });
}
