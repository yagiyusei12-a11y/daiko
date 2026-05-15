/**
 * デモ専用テナント（本番 nagahama 等と完全分離）のサンプルデータ投入。
 * 氏名・店名・住所はすべて架空（実在しない想定）。
 * scripts/seed-demo-tenant.ts から実行。
 */
import bcrypt from "bcryptjs";
import {
  CompensationType,
  PayrollRunStatus,
  Prisma,
  PrismaClient,
  TimeCardPunchKind,
  TripPassengerKind,
  TripRole,
} from "@prisma/client";

export const DEMO_TENANT_SLUG = "daiko-demo";
export const DEMO_TENANT_NAME = "架空代行サービス（デモ）";
export const DEMO_USER_EMAIL = "daiko-demo@demo.local";
const DEMO_ROLE_NAME = "demo";
const DEMO_PERMISSIONS = ["nav.full", "staff.shift"] as const;

/** 架空の所在地（実在しない地名） */
const FICTION_PREF = "架空県";
const FICTION_CITY = "フクソウ市見本町";
const FICTION_STREET = "1-2-3";

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

type DemoEmployeeSeed = {
  familyName: string;
  givenName: string;
  furigana?: string;
  address?: string;
  adminMaster?: boolean;
  safetyDrivingManager?: boolean;
};

const DEMO_EMPLOYEES: DemoEmployeeSeed[] = [
  { familyName: "青空", givenName: "蓮", furigana: "あおぞら れん", address: `${FICTION_PREF}${FICTION_CITY}青空荘201`, safetyDrivingManager: true },
  { familyName: "星河", givenName: "美咲", furigana: "ほしがわ みさき", address: `${FICTION_PREF}${FICTION_CITY}星河ハイツ5F` },
  { familyName: "橘野", givenName: "健太", furigana: "たちばの けんた", address: `${FICTION_PREF}${FICTION_CITY}橘野通8-1` },
  { familyName: "雲井", givenName: "優子", furigana: "くもい ゆうこ", address: `${FICTION_PREF}フクソウ市雲井町3-4-5` },
  { familyName: "紙野", givenName: "浩二", furigana: "かみの こうじ", adminMaster: true },
  { familyName: "水無", givenName: "彩", furigana: "みな あや" },
  { familyName: "虹川", givenName: "翔", furigana: "にじかわ しょう" },
  { familyName: "琥珀", givenName: "真由", furigana: "こはく まゆ" },
];

const DEMO_CUSTOMERS: Array<{
  displayName: string;
  phone: string;
  defaultOrigin: string;
  defaultDestination: string;
  notes?: string;
}> = [
  {
    displayName: "見本 一郎（個人）",
    phone: "090-0000-1001",
    defaultOrigin: "フクソウ駅北口",
    defaultDestination: "見本湖畔マンション",
  },
  {
    displayName: "架空商事（株）",
    phone: "077-000-2002",
    defaultOrigin: "架空ビル本社",
    defaultDestination: "フクソウ空港ターミナル",
    notes: "請求書払い・売掛",
  },
  {
    displayName: "虹の丘 さくら",
    phone: "090-0000-1003",
    defaultOrigin: "居酒屋「ねこじる」",
    defaultDestination: "虹の丘団地A棟",
  },
  {
    displayName: "デモタウン 宿泊施設",
    phone: "077-000-3003",
    defaultOrigin: "フクソウ中央病院",
    defaultDestination: "ホテル・デモタウン",
  },
];

const DEMO_REFERRALS = [
  { name: "飲食店「ねこじる」", memo: "架空通り・紹介手数料10%" },
  { name: "カフェ・見本館", memo: "フクソウ駅前" },
  { name: "宴会場「星の間」", memo: "法人宴会多め" },
];

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
    calDate = addDaysYmd(businessDate, 1);
    hour = flexHour - 24;
  } else if (flexHour < rollHour) {
    calDate = businessDate;
    hour = flexHour;
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  return new Date(`${calDate}T${pad(hour)}:${pad(minute)}:00+09:00`);
}

function atYmdTime(ymd: string, hour: number, minute: number): Date {
  const pad = (n: number) => String(n).padStart(2, "0");
  return new Date(`${ymd}T${pad(hour)}:${pad(minute)}:00+09:00`);
}

export async function seedDemoTenant(prisma: PrismaClient): Promise<DemoSeedPayload> {
  const existing = await prisma.tenant.findUnique({ where: { slug: DEMO_TENANT_SLUG } });
  if (existing) {
    await prisma.tenant.delete({ where: { id: existing.id } });
  }

  const today = tokyoYmd();
  const bizDays = [-3, -2, -1, 0, 1].map((d) => addDaysYmd(today, d));
  const [bizM3, bizM2, bizM1, bizToday, bizP1] = bizDays;
  const yearMonth = bizToday.slice(0, 7);

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
        legalPrefecture: FICTION_PREF,
        legalStreetAddress: `${FICTION_CITY}${FICTION_STREET}`,
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

    const employees = [];
    for (const e of DEMO_EMPLOYEES) {
      const row = await tx.employee.create({
        data: {
          tenantId: tenant.id,
          familyName: e.familyName,
          givenName: e.givenName,
          furigana: e.furigana,
          address: e.address,
          status: "ACTIVE",
          adminMaster: e.adminMaster ?? false,
          safetyDrivingManager: e.safetyDrivingManager ?? false,
        },
      });
      employees.push(row);
      payload.employeeIds.push(row.id);
      await tx.employeeCompensationPeriod.create({
        data: {
          employeeId: row.id,
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

    const [emp0, emp1, emp2, emp3, emp4, emp5, emp6, emp7] = employees;

    const vehicles = [];
    for (const [label, plate, odo] of [
      ["客車デモ1号", "架空 500 ろ 12-34", 125400],
      ["客車デモ2号", "架空 300 は 90-12", 98200],
      ["随伴デモA", "架空 500 い 56-78", 44100],
    ] as const) {
      const v = await tx.vehicle.create({
        data: {
          tenantId: tenant.id,
          label,
          plate,
          active: true,
          currentOdometer: odo,
        },
      });
      vehicles.push(v);
      payload.vehicleIds.push(v.id);
    }
    const [vehMain1, vehMain2, vehEscort] = vehicles;

    const demoUser = await tx.user.create({
      data: {
        tenantId: tenant.id,
        email: DEMO_USER_EMAIL,
        passwordHash,
        displayName: "デモ閲覧",
        employeeId: emp0.id,
      },
    });
    payload.userId = demoUser.id;
    await tx.userRole.create({ data: { userId: demoUser.id, roleId: demoRole.id } });

    const tariffPlan = await tx.tariffPlan.create({
      data: { tenantId: tenant.id, name: "標準（デモ）" },
    });
    const tariffVersion = await tx.tariffPlanVersion.create({
      data: {
        planId: tariffPlan.id,
        version: 1,
        initialDistanceM: 2000,
        initialFareYen: 1500,
        addUnitDistanceM: 300,
        addFareYen: 300,
        waitingFareYenPerMin: 50,
      },
    });

    const customers = [];
    for (const c of DEMO_CUSTOMERS) {
      const row = await tx.customer.create({
        data: {
          tenantId: tenant.id,
          displayName: c.displayName,
          phone: c.phone,
          defaultOrigin: c.defaultOrigin,
          defaultDestination: c.defaultDestination,
          notes: c.notes,
          defaultTariffVersionId: tariffVersion.id,
        },
      });
      customers.push(row);
    }

    const referrals = [];
    for (const r of DEMO_REFERRALS) {
      referrals.push(
        await tx.referralSource.create({
          data: { tenantId: tenant.id, name: r.name, memo: r.memo },
        }),
      );
    }

    // 確定シフト（直近5事業日 × 複数従業員）
    const shiftRows: Array<[string, (typeof employees)[0], string[], string, string]> = [
      [bizM3, emp0, ["客車"], "18:00", "27:30"],
      [bizM3, emp1, ["電話"], "17:00", "26:00"],
      [bizM2, emp0, ["客車"], "18:30", "28:00"],
      [bizM2, emp2, ["客車"], "19:00", "27:00"],
      [bizM2, emp3, ["電話"], "17:30", "25:30"],
      [bizM1, emp0, ["客車"], "18:00", "27:15"],
      [bizM1, emp1, ["電話"], "17:30", "26:00"],
      [bizM1, emp4, ["随伴車"], "19:00", "27:00"],
      [bizToday, emp2, ["客車"], "19:00", "27:00"],
      [bizToday, emp5, ["随伴車"], "19:00", "27:00"],
      [bizToday, emp6, ["電話"], "16:00", "25:00"],
      [bizP1, emp0, ["客車"], "18:00", "27:00"],
      [bizP1, emp7, ["電話"], "17:00", "26:30"],
    ];
    for (const [bd, emp, duties, start, end] of shiftRows) {
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

    // シフト申請（今月・3名）
    for (const emp of [emp2, emp3, emp6]) {
      await tx.shiftApplication.create({
        data: {
          tenantId: tenant.id,
          employeeId: emp.id,
          yearMonth,
          daysJson: {
            [bizToday]: { start: "19:00", end: "27:00" },
            [bizP1]: { start: "18:00", end: "27:00" },
          },
        },
      });
    }

    // タイムカード（複数日・複数人）
    const timeCardDefs: Array<[typeof emp0, string, Array<[TimeCardPunchKind, number, number]>]> = [
      [emp0, bizM2, [[TimeCardPunchKind.CLOCK_IN, 18, 5], [TimeCardPunchKind.BREAK_START, 22, 0], [TimeCardPunchKind.BREAK_END, 22, 35], [TimeCardPunchKind.CLOCK_OUT, 27, 20]]],
      [emp1, bizM2, [[TimeCardPunchKind.CLOCK_IN, 17, 45], [TimeCardPunchKind.CLOCK_OUT, 26, 10]]],
      [emp0, bizM1, [[TimeCardPunchKind.CLOCK_IN, 18, 5], [TimeCardPunchKind.BREAK_START, 22, 10], [TimeCardPunchKind.BREAK_END, 22, 40], [TimeCardPunchKind.CLOCK_OUT, 27, 15]]],
      [emp1, bizM1, [[TimeCardPunchKind.CLOCK_IN, 17, 50], [TimeCardPunchKind.CLOCK_OUT, 26, 0]]],
      [emp2, bizM1, [[TimeCardPunchKind.CLOCK_IN, 19, 0], [TimeCardPunchKind.CLOCK_OUT, 27, 5]]],
      [emp3, bizToday, [[TimeCardPunchKind.CLOCK_IN, 17, 30], [TimeCardPunchKind.CLOCK_OUT, 25, 45]]],
    ];
    for (const [emp, bd, punches] of timeCardDefs) {
      for (const [kind, fh, fm] of punches) {
        const punchedAt = flexAt(bd, fh, fm);
        const p = await tx.timeCardPunch.create({
          data: {
            tenantId: tenant.id,
            employeeId: emp.id,
            businessDate: bd,
            kind,
            punchedAt,
            alcoholCheckJson:
              kind === TimeCardPunchKind.CLOCK_IN || kind === TimeCardPunchKind.CLOCK_OUT
                ? ({
                    alcoholDetected: false,
                    verificationMethod: "目視（デモ）",
                  } as Prisma.InputJsonValue)
                : undefined,
          },
        });
        payload.timeCardPunchIds.push(p.id);
      }
    }

    // アルコールチェック帳票用
    for (const [emp, bd, phase, h, m] of [
      [emp0, bizM1, "出勤", 18, 0],
      [emp0, bizM1, "退勤", 27, 10],
      [emp2, bizM1, "出勤", 19, 0],
      [emp2, bizM1, "退勤", 27, 0],
      [emp4, bizToday, "中間", 22, 0],
    ] as const) {
      await tx.alcoholCheck.create({
        data: {
          tenantId: tenant.id,
          employeeId: emp.id,
          businessDate: bd,
          phase,
          checkedAt: flexAt(bd, h, m),
          checkerName: `${emp4.familyName} ${emp4.givenName}`,
          checkMethod: "目視",
          detectorUsed: false,
          resultPositive: false,
        },
      });
    }

    // 日報 + 運行（複数日・複数便）
    type TripSeed = {
      clientName: string;
      origin: string;
      destination: string;
      depH: number;
      depM: number;
      arrH: number;
      arrM: number;
      distanceM: number;
      fareYen: number;
      payment?: string;
      customerIdx?: number;
      referralIdx?: number;
      role?: TripRole;
    };

    const reportSeeds: Array<{
      bd: string;
      vehicle: (typeof vehicles)[0];
      main: (typeof employees)[0];
      partner?: (typeof employees)[0];
      meterStart: number;
      meterEnd: number;
      cash: number;
      card: number;
      paypay?: number;
      trips: TripSeed[];
    }> = [
      {
        bd: bizM3,
        vehicle: vehMain1,
        main: emp0,
        meterStart: 124800,
        meterEnd: 125000,
        cash: 5200,
        card: 0,
        trips: [
          {
            clientName: "見本 一郎",
            origin: "フクソウ駅北口",
            destination: "見本湖畔マンション",
            depH: 23,
            depM: 10,
            arrH: 23,
            arrM: 55,
            distanceM: 8500,
            fareYen: 5200,
            payment: "CASH",
            customerIdx: 0,
          },
        ],
      },
      {
        bd: bizM2,
        vehicle: vehMain1,
        main: emp0,
        partner: emp4,
        meterStart: 125000,
        meterEnd: 125180,
        cash: 3600,
        card: 2800,
        trips: [
          {
            clientName: "虹の丘 さくら",
            origin: "居酒屋「ねこじる」",
            destination: "虹の丘団地A棟",
            depH: 22,
            depM: 30,
            arrH: 23,
            arrM: 5,
            distanceM: 4200,
            fareYen: 3600,
            payment: "CASH",
            customerIdx: 2,
            referralIdx: 0,
          },
          {
            clientName: "架空商事（株）",
            origin: "架空ビル本社",
            destination: "フクソウ空港ターミナル",
            depH: 25,
            depM: 0,
            arrH: 26,
            arrM: 15,
            distanceM: 12000,
            fareYen: 2800,
            payment: "CARD",
            customerIdx: 1,
            role: TripRole.MAIN_DRIVER,
          },
        ],
      },
      {
        bd: bizM1,
        vehicle: vehMain1,
        main: emp0,
        meterStart: 125180,
        meterEnd: 125340,
        cash: 4800,
        card: 0,
        trips: [
          {
            clientName: "見本 一郎",
            origin: "フクソウ駅北口",
            destination: "デモタウン3丁目",
            depH: 23,
            depM: 10,
            arrH: 23,
            arrM: 50,
            distanceM: 7200,
            fareYen: 4800,
            payment: "CASH",
            customerIdx: 0,
          },
        ],
      },
      {
        bd: bizToday,
        vehicle: vehMain2,
        main: emp2,
        partner: emp5,
        meterStart: 98100,
        meterEnd: 98280,
        cash: 0,
        card: 6200,
        paypay: 1500,
        trips: [
          {
            clientName: "デモタウン 宿泊施設",
            origin: "フクソウ中央病院",
            destination: "ホテル・デモタウン",
            depH: 0,
            depM: 20,
            arrH: 1,
            arrM: 5,
            distanceM: 5200,
            fareYen: 6200,
            payment: "CARD",
            customerIdx: 3,
          },
          {
            clientName: "水無 彩",
            origin: "カフェ・見本館",
            destination: "フクソウ駅南口",
            depH: 2,
            depM: 10,
            arrH: 2,
            arrM: 40,
            distanceM: 3100,
            fareYen: 1500,
            payment: "PAYPAY",
          },
        ],
      },
      {
        bd: bizToday,
        vehicle: vehMain1,
        main: emp6,
        meterStart: 125340,
        meterEnd: 125420,
        cash: 2200,
        card: 0,
        trips: [
          {
            clientName: "橘野 健太",
            origin: "見本町役場前",
            destination: "フクソウ駅東口",
            depH: 21,
            depM: 0,
            arrH: 21,
            arrM: 25,
            distanceM: 2800,
            fareYen: 2200,
            payment: "CASH",
          },
        ],
      },
    ];

    for (const rs of reportSeeds) {
      const report = await tx.dailyReport.create({
        data: {
          tenantId: tenant.id,
          businessDate: rs.bd,
          vehicleId: rs.vehicle.id,
          mainEmployeeId: rs.main.id,
          partnerEmployeeId: rs.partner?.id,
          escortVehicleId: rs.partner ? vehEscort.id : undefined,
          meterStart: rs.meterStart,
          meterEnd: rs.meterEnd,
          dutyStartAt: flexAt(rs.bd, 18, 0),
          dutyEndAt: flexAt(rs.bd, 27, 30),
          paymentCashYen: rs.cash,
          paymentCardYen: rs.card,
          paymentPayPayYen: rs.paypay ?? 0,
        },
      });
      payload.dailyReportIds.push(report.id);

      for (const t of rs.trips) {
        const trip = await tx.tripLeg.create({
          data: {
            dailyReportId: report.id,
            clientName: t.clientName,
            origin: t.origin,
            destination: t.destination,
            departedAt: flexAt(rs.bd, t.depH, t.depM),
            arrivedAt: flexAt(rs.bd, t.arrH, t.arrM),
            distanceM: t.distanceM,
            fareYen: t.fareYen,
            tripPaymentMethod: t.payment,
            customerId: t.customerIdx != null ? customers[t.customerIdx]?.id : undefined,
            referralSourceId: t.referralIdx != null ? referrals[t.referralIdx]?.id : undefined,
            tariffVersionId: tariffVersion.id,
            role: t.role ?? TripRole.MAIN_DRIVER,
            passengerKind: TripPassengerKind.GENERAL,
          },
        });
        payload.tripLegIds.push(trip.id);
      }
    }

    // 配車予定（未予定列 + 担当者付き・前後数日）
    const dispatchSeeds: Array<{
      title: string;
      startBd: string;
      startH: number;
      startM: number;
      endH: number;
      endM: number;
      driver?: (typeof employees)[0];
      virtualLane?: number;
      detail?: Prisma.InputJsonValue;
    }> = [
      {
        title: "見本 様 フクソウ駅北口→見本湖畔",
        startBd: bizToday,
        startH: 21,
        startM: 45,
        endH: 22,
        endM: 30,
        virtualLane: 1,
        detail: { clientName: "見本 一郎", route: "フクソウ駅北口→見本湖畔マンション" },
      },
      {
        title: "虹の丘 さくら 様 ねこじる→虹の丘団地",
        startBd: bizToday,
        startH: 22,
        startM: 15,
        endH: 23,
        endM: 0,
        driver: emp0,
        detail: { clientName: "虹の丘 さくら", route: "居酒屋ねこじる→虹の丘団地A棟" },
      },
      {
        title: "架空商事 送迎 病院→ホテル",
        startBd: bizToday,
        startH: 25,
        startM: 30,
        endH: 26,
        endM: 30,
        driver: emp1,
      },
      {
        title: "琥珀 真由 様 駅南口→デモタウン",
        startBd: bizP1,
        startH: 20,
        startM: 30,
        endH: 21,
        endM: 15,
        driver: emp7,
      },
      {
        title: "未割当 フクソウ東口→見本町",
        startBd: bizP1,
        startH: 23,
        startM: 0,
        endH: 23,
        endM: 45,
        virtualLane: 2,
      },
      {
        title: "水無 彩 様 見本館→青空荘",
        startBd: bizM1,
        startH: 24,
        startM: 0,
        endH: 24,
        endM: 40,
        driver: emp2,
      },
    ];

    for (const ds of dispatchSeeds) {
      const res = await tx.dispatchReservation.create({
        data: {
          tenantId: tenant.id,
          title: ds.title,
          startsAt: flexAt(ds.startBd, ds.startH, ds.startM),
          endsAt: flexAt(ds.startBd, ds.endH, ds.endM),
          status: "CONFIRMED",
          driverEmployeeId: ds.driver?.id,
          virtualLane: ds.virtualLane,
          detailJson: ds.detail ?? {},
          vehicleId: ds.driver ? vehMain1.id : undefined,
        },
      });
      payload.dispatchReservationIds.push(res.id);
    }

    // 苦情（架空の申立人）
    const complaints: Array<Prisma.ComplaintLedgerCreateInput> = [
      {
        tenant: { connect: { id: tenant.id } },
        receivedAt: atYmdTime(addDaysYmd(today, -4), 10, 30),
        receivedByEmployee: { connect: { id: emp1.id } },
        occurredOn: atYmdTime(addDaysYmd(today, -4), 0, 0),
        category: "電話",
        complainantName: "見本 次郎",
        complainantAddress: `${FICTION_PREF}${FICTION_CITY}見本町4-5-6`,
        complainantContact: "090-0000-9001",
        detail: "迎えが約5分遅れたとの申し出（事実確認中）",
        driverEmployee: { connect: { id: emp0.id } },
        handlerEmployee: { connect: { id: emp2.id } },
      },
      {
        tenant: { connect: { id: tenant.id } },
        receivedAt: atYmdTime(addDaysYmd(today, -6), 14, 0),
        receivedByEmployee: { connect: { id: emp1.id } },
        category: "メール",
        complainantName: "架空商事（株） 総務",
        detail: "料金表示と請求金額の相違について",
        completedOn: atYmdTime(addDaysYmd(today, -5), 0, 0),
        handlerEmployee: { connect: { id: emp0.id } },
        representativeChecked: true,
        correctiveAction: "再計算のうえ差額返金を実施（デモ記録）",
      },
      {
        tenant: { connect: { id: tenant.id } },
        receivedAt: atYmdTime(addDaysYmd(today, -2), 9, 15),
        receivedByEmployee: { connect: { id: emp3.id } },
        occurredOn: atYmdTime(addDaysYmd(today, -3), 0, 0),
        category: "その他",
        complainantName: "虹の丘 さくら",
        detail: "ドライバーの案内が分かりにくかった",
        driverEmployee: { connect: { id: emp6.id } },
        handlerEmployee: { connect: { id: emp4.id } },
      },
    ];
    for (const c of complaints) {
      const row = await tx.complaintLedger.create({ data: c });
      payload.complaintIds.push(row.id);
    }

    // 指導記録
    await tx.instructionRecord.create({
      data: {
        tenantId: tenant.id,
        recipientEmployeeIds: [emp2.id, emp5.id, emp6.id],
        date: atYmdTime(addDaysYmd(today, -7), 15, 0),
        instructionVenue: `${FICTION_CITY}研修室（架空）`,
        instructorEmployeeIds: [emp0.id, emp4.id],
        instructionItems: "深夜帯の運転・迎車時の声かけ・メーター操作の再確認",
        specialNotes: "デモ用サンプル記録です",
        remarks: "",
      },
    });

    // 指導・研修（GuidanceSession）
    const guidance = await tx.guidanceSession.create({
      data: {
        tenantId: tenant.id,
        startedAt: atYmdTime(addDaysYmd(today, -14), 14, 0),
        endedAt: atYmdTime(addDaysYmd(today, -14), 16, 0),
        location: "フクソウ市見本町コミュニティ会館（架空）",
        instructorName: `${emp0.familyName} ${emp0.givenName}`,
        topicFeeCollection: true,
        topicTerms: true,
        topicRoadTransportLaw: true,
        representativeChecked: true,
      },
    });
    for (const emp of [emp0, emp1, emp2, emp3, emp5, emp6]) {
      await tx.guidanceAttendee.create({
        data: {
          guidanceSessionId: guidance.id,
          employeeId: emp.id,
          attendeeName: `${emp.familyName} ${emp.givenName}`,
        },
      });
    }

    // 売掛
    await tx.accountsReceivableEntry.createMany({
      data: [
        {
          tenantId: tenant.id,
          partyName: "架空商事（株）",
          amountYen: 12800,
          status: "OPEN",
          referenceNote: "2月分送迎（デモ）",
        },
        {
          tenantId: tenant.id,
          partyName: "宴会場「星の間」",
          amountYen: 4500,
          status: "COLLECTED",
          collectedAt: atYmdTime(addDaysYmd(today, -1), 12, 0),
          referenceNote: "紹介料精算済み",
        },
      ],
    });

    // 給与ドラフト（今月）
    const payroll = await tx.payrollRun.create({
      data: {
        tenantId: tenant.id,
        periodYm: yearMonth,
        status: PayrollRunStatus.DRAFT,
        poolRateBps: 1000,
      },
    });
    const payrollAmounts = [198400, 176200, 205800, 162500, 189000];
    for (let i = 0; i < [emp0, emp1, emp2, emp3, emp4].length; i++) {
      const emp = [emp0, emp1, emp2, emp3, emp4][i]!;
      const net = payrollAmounts[i] ?? 180000;
      await tx.payrollLine.create({
        data: {
          runId: payroll.id,
          employeeId: emp.id,
          grossSalesYen: net + 42000,
          hourlyYen: Math.floor(net * 0.55),
          commissionYen: Math.floor(net * 0.35),
          poolYen: Math.floor(net * 0.05),
          netPayYen: net,
          breakdownJson: { demo: true, note: "架空のデモ集計" },
        },
      });
    }

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
