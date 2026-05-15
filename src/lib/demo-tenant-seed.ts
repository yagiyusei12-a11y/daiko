/**
 * デモ専用テナント（本番 nagahama 等と完全分離）のサンプルデータ投入。
 * scripts/seed-demo-tenant.ts から実行。
 */
import bcrypt from "bcryptjs";
import {
  CompensationType,
  Prisma,
  PrismaClient,
  TimeCardPunchKind,
} from "@prisma/client";

export const DEMO_TENANT_SLUG = "daiko-demo";
export const DEMO_TENANT_NAME = "デモ運転代行（サンプル）";
export const DEMO_USER_EMAIL = "daiko-demo@demo.local";
const DEMO_ROLE_NAME = "demo";
const DEMO_PERMISSIONS = ["nav.full", "staff.shift"] as const;

export type DemoSeedPayload = {
  tenantId: string;
  slug: string;
  employeeIds: string[];
  vehicleIds: string[];
  dailyReportIds: string[];
  tripLegIds: string[];
  timeCardPunchIds: string[];
  complaintIds: string[];
  confirmedShiftIds: string[];
  dispatchReservationIds: string[];
  userId: string;
};

function tokyoYmd(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function addDaysYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00+09:00`);
  d.setDate(d.getDate() + days);
  return tokyoYmd(d);
}

/** 事業日 ymd の flex 時刻（28h表記 hour>=24 は翌暦日 rollHour 未満）を Date に */
function flexAt(businessDate: string, flexHour: number, minute: number, rollHour = 4): Date {
  let calDate = businessDate;
  let hour = flexHour;
  if (flexHour >= 24) {
    const next = addDaysYmd(businessDate, 1);
    calDate = next;
    hour = flexHour - 24;
  } else if (flexHour < rollHour) {
    // 通常は事業日当日
    calDate = businessDate;
    hour = flexHour;
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  return new Date(`${calDate}T${pad(hour)}:${pad(minute)}:00+09:00`);
}

export async function seedDemoTenant(prisma: PrismaClient): Promise<DemoSeedPayload> {
  const existing = await prisma.tenant.findUnique({ where: { slug: DEMO_TENANT_SLUG } });
  if (existing) {
    await prisma.tenant.delete({ where: { id: existing.id } });
  }

  const today = tokyoYmd();
  const biz1 = addDaysYmd(today, -1);
  const biz2 = today;
  const yearMonth = biz2.slice(0, 7);

  const passwordHash = await bcrypt.hash(`demo-seed-unused-${Date.now()}`, 10);
  const validFrom = new Date(`${addDaysYmd(today, -365)}T00:00:00+09:00`);

  const payload: DemoSeedPayload = {
    tenantId: "",
    slug: DEMO_TENANT_SLUG,
    employeeIds: [],
    vehicleIds: [],
    dailyReportIds: [],
    tripLegIds: [],
    timeCardPunchIds: [],
    complaintIds: [],
    confirmedShiftIds: [],
    dispatchReservationIds: [],
    userId: "",
  };

  await prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.create({
      data: { name: DEMO_TENANT_NAME, slug: DEMO_TENANT_SLUG, timezone: "Asia/Tokyo" },
    });
    payload.tenantId = tenant.id;

    await tx.tenantSettings.create({
      data: {
        tenantId: tenant.id,
        businessDayRollHour: 4,
        featureFlags: {},
        customJson: {
          businessBasics: {
            version: 2,
            tradeName: DEMO_TENANT_NAME,
            dayChangeHour: 28,
          },
        } as Prisma.InputJsonValue,
        legalTradeName: DEMO_TENANT_NAME,
        legalPrefecture: "滋賀県",
        legalStreetAddress: "長浜市（サンプル）",
        legalPhone: "000-0000-0000",
      },
    });

    await tx.subscription.create({
      data: { tenantId: tenant.id, planTier: "FREE", validFrom: new Date() },
    });

    const demoRole = await tx.role.create({
      data: { tenantId: tenant.id, name: DEMO_ROLE_NAME, permissions: [...DEMO_PERMISSIONS] },
    });
    await tx.role.create({
      data: { tenantId: tenant.id, name: "staff", permissions: ["staff.shift"] },
    });

    const empYamada = await tx.employee.create({
      data: {
        tenantId: tenant.id,
        familyName: "山田",
        givenName: "太郎",
        status: "ACTIVE",
        adminMaster: false,
        safetyDrivingManager: true,
      },
    });
    const empSato = await tx.employee.create({
      data: {
        tenantId: tenant.id,
        familyName: "佐藤",
        givenName: "花子",
        status: "ACTIVE",
      },
    });
    const empNakagawa = await tx.employee.create({
      data: {
        tenantId: tenant.id,
        familyName: "中川",
        givenName: "直樹",
        status: "ACTIVE",
      },
    });
    const empTomimura = await tx.employee.create({
      data: {
        tenantId: tenant.id,
        familyName: "冨村",
        givenName: "昴也",
        status: "ACTIVE",
      },
    });
    payload.employeeIds = [empYamada.id, empSato.id, empNakagawa.id, empTomimura.id];

    for (const emp of [empYamada, empSato, empNakagawa, empTomimura]) {
      await tx.employeeCompensationPeriod.create({
        data: {
          employeeId: emp.id,
          validFrom,
          compensationType: CompensationType.HOURLY_AND_COMMISSION,
          baseHourlyYen: 1200,
          mainHourlyYen: 1200,
          partnerHourlyYen: 1100,
          phoneHourlyYen: 1000,
          commissionMainRateBps: 550,
          commissionPartnerRateBps: 300,
        },
      });
    }

    const vehicle = await tx.vehicle.create({
      data: {
        tenantId: tenant.id,
        label: "デモ1号",
        plate: "滋賀 300 あ 12-34",
        active: true,
        currentOdometer: 125400,
      },
    });
    payload.vehicleIds = [vehicle.id];

    const demoUser = await tx.user.create({
      data: {
        tenantId: tenant.id,
        email: DEMO_USER_EMAIL,
        passwordHash,
        displayName: "デモ閲覧",
        employeeId: empYamada.id,
      },
    });
    payload.userId = demoUser.id;
    await tx.userRole.create({ data: { userId: demoUser.id, roleId: demoRole.id } });

    // 確定シフト（今月・昨日）
    for (const [bd, emp, duties, start, end] of [
      [biz1, empYamada, ["客車"], "18:00", "28:00"],
      [biz1, empSato, ["電話"], "17:30", "26:00"],
      [biz2, empNakagawa, ["客車"], "19:00", "27:00"],
      [biz2, empTomimura, ["随伴車"], "19:00", "27:00"],
    ] as const) {
      const row = await tx.confirmedShiftDay.create({
        data: {
          tenantId: tenant.id,
          employeeId: emp.id,
          businessDate: bd,
          startTime: start,
          endTime: end,
          dutiesJson: duties,
        },
      });
      payload.confirmedShiftIds.push(row.id);
    }

    // タイムカード（山田・佐藤）
    const tcYamada: Array<[TimeCardPunchKind, Date]> = [
      [TimeCardPunchKind.CLOCK_IN, flexAt(biz1, 18, 5)],
      [TimeCardPunchKind.BREAK_START, flexAt(biz1, 22, 10)],
      [TimeCardPunchKind.BREAK_END, flexAt(biz1, 22, 40)],
      [TimeCardPunchKind.CLOCK_OUT, flexAt(biz1, 27, 15)],
    ];
    for (const [kind, punchedAt] of tcYamada) {
      const p = await tx.timeCardPunch.create({
        data: {
          tenantId: tenant.id,
          employeeId: empYamada.id,
          businessDate: biz1,
          kind,
          punchedAt,
          alcoholCheckJson:
            kind === TimeCardPunchKind.CLOCK_IN || kind === TimeCardPunchKind.CLOCK_OUT
              ? ({
                  alcoholDetected: false,
                  verificationMethod: "目視",
                } as Prisma.InputJsonValue)
              : undefined,
        },
      });
      payload.timeCardPunchIds.push(p.id);
    }

    const tcSato: Array<[TimeCardPunchKind, Date]> = [
      [TimeCardPunchKind.CLOCK_IN, flexAt(biz1, 17, 50)],
      [TimeCardPunchKind.CLOCK_OUT, flexAt(biz1, 26, 0)],
    ];
    for (const [kind, punchedAt] of tcSato) {
      const p = await tx.timeCardPunch.create({
        data: {
          tenantId: tenant.id,
          employeeId: empSato.id,
          businessDate: biz1,
          kind,
          punchedAt,
        },
      });
      payload.timeCardPunchIds.push(p.id);
    }

    // 日報 + 運行
    const report1 = await tx.dailyReport.create({
      data: {
        tenantId: tenant.id,
        businessDate: biz1,
        vehicleId: vehicle.id,
        mainEmployeeId: empYamada.id,
        meterStart: 125000,
        meterEnd: 125180,
        dutyStartAt: flexAt(biz1, 18, 0),
        dutyEndAt: flexAt(biz1, 27, 30),
        paymentCashYen: 4800,
        paymentCardYen: 0,
      },
    });
    payload.dailyReportIds.push(report1.id);

    const trip1 = await tx.tripLeg.create({
      data: {
        dailyReportId: report1.id,
        clientName: "鈴木一郎",
        origin: "JR長浜駅",
        destination: "木之本町",
        departedAt: flexAt(biz1, 23, 10),
        arrivedAt: flexAt(biz1, 23, 55),
        distanceM: 8500,
        fareYen: 4800,
        tripPaymentMethod: "CASH",
      },
    });
    payload.tripLegIds.push(trip1.id);

    const report2 = await tx.dailyReport.create({
      data: {
        tenantId: tenant.id,
        businessDate: biz2,
        vehicleId: vehicle.id,
        mainEmployeeId: empNakagawa.id,
        partnerEmployeeId: empTomimura.id,
        meterStart: 125180,
        meterEnd: 125320,
        paymentCashYen: 0,
        paymentCardYen: 6200,
      },
    });
    payload.dailyReportIds.push(report2.id);

    const trip2 = await tx.tripLeg.create({
      data: {
        dailyReportId: report2.id,
        clientName: "株式会社サンプル",
        origin: "本社",
        destination: "ホテル○○",
        departedAt: flexAt(biz2, 0, 20),
        arrivedAt: flexAt(biz2, 1, 5),
        distanceM: 5200,
        fareYen: 6200,
        tripPaymentMethod: "CARD",
      },
    });
    payload.tripLegIds.push(trip2.id);

    // 配車予定（スケジュール用）
    const res1 = await tx.dispatchReservation.create({
      data: {
        tenantId: tenant.id,
        virtualLane: 1,
        title: "○○様 長浜駅北口→自宅",
        startsAt: flexAt(biz2, 21, 45),
        endsAt: flexAt(biz2, 22, 30),
        status: "CONFIRMED",
        detailJson: { clientName: "○○様", route: "長浜駅北口→自宅" },
      },
    });
    const res2 = await tx.dispatchReservation.create({
      data: {
        tenantId: tenant.id,
        driverEmployeeId: empYamada.id,
        title: "△△様 居酒屋街→○○町",
        startsAt: flexAt(biz2, 22, 15),
        endsAt: flexAt(biz2, 23, 0),
        status: "CONFIRMED",
      },
    });
    const res3 = await tx.dispatchReservation.create({
      data: {
        tenantId: tenant.id,
        driverEmployeeId: empSato.id,
        title: "□□様 病院送迎",
        startsAt: flexAt(biz2, 25, 30),
        endsAt: flexAt(biz2, 26, 30),
        status: "CONFIRMED",
      },
    });
    payload.dispatchReservationIds.push(res1.id, res2.id, res3.id);

    // 苦情
    const c1 = await tx.complaintLedger.create({
      data: {
        tenantId: tenant.id,
        receivedAt: new Date(`${addDaysYmd(today, -3)}T10:30:00+09:00`),
        receivedByEmployeeId: empSato.id,
        occurredOn: new Date(`${addDaysYmd(today, -3)}T00:00:00+09:00`),
        category: "電話",
        detail: "迎えが5分遅れたとの申し出（事実確認中）",
        driverEmployeeId: empYamada.id,
        handlerEmployeeId: empNakagawa.id,
      },
    });
    const c2 = await tx.complaintLedger.create({
      data: {
        tenantId: tenant.id,
        receivedAt: new Date(`${addDaysYmd(today, -5)}T14:00:00+09:00`),
        receivedByEmployeeId: empSato.id,
        category: "メール",
        detail: "料金表示と請求の相違",
        completedOn: new Date(`${addDaysYmd(today, -4)}T00:00:00+09:00`),
        handlerEmployeeId: empYamada.id,
        representativeChecked: true,
      },
    });
    payload.complaintIds.push(c1.id, c2.id);

    // シフト申請（今月・空でなくてもよいが1件）
    await tx.shiftApplication.create({
      data: {
        tenantId: tenant.id,
        employeeId: empNakagawa.id,
        yearMonth,
        daysJson: { [biz2]: { start: "19:00", end: "27:00" } },
      },
    });

    await tx.demoSeedBatch.create({
      data: {
        tenantId: tenant.id,
        payload: payload as unknown as Prisma.InputJsonValue,
      },
    });
  });

  return payload;
}

/** nagahama 等に誤って作ったデモユーザーを削除 */
export async function removeDemoUserFromOtherTenants(prisma: PrismaClient, demoTenantId: string): Promise<number> {
  const r = await prisma.user.deleteMany({
    where: {
      email: DEMO_USER_EMAIL,
      tenantId: { not: demoTenantId },
    },
  });
  return r.count;
}
