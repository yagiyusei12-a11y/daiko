import type { Prisma } from "@prisma/client";
import {
  CompensationType,
  EmployeeStatus,
  PayrollRunStatus,
  TripPassengerKind,
  TripRole,
  TariffDistanceMode,
} from "@prisma/client";
import { prisma } from "../db.js";

const P = "【デモ】";

/** payload JSON schema version */
export type DemoSeedPayloadV1 = {
  v: 1;
  employeeIds: string[];
  vehicleIds: string[];
  tariffPlanIds: string[];
  customerIds: string[];
  referralSourceIds: string[];
  dailyReportIds: string[];
  timePunchIds: string[];
  alcoholCheckIds: string[];
  payrollRunIds: string[];
  dispatchReservationIds: string[];
  accountsReceivableEntryIds: string[];
  complaintLedgerIds: string[];
  guidanceSessionIds: string[];
  legalRegisterStubIds: string[];
  legalChangeNoticeIds: string[];
};

function emptyPayload(): DemoSeedPayloadV1 {
  return {
    v: 1,
    employeeIds: [],
    vehicleIds: [],
    tariffPlanIds: [],
    customerIds: [],
    referralSourceIds: [],
    dailyReportIds: [],
    timePunchIds: [],
    alcoholCheckIds: [],
    payrollRunIds: [],
    dispatchReservationIds: [],
    accountsReceivableEntryIds: [],
    complaintLedgerIds: [],
    guidanceSessionIds: [],
    legalRegisterStubIds: [],
    legalChangeNoticeIds: [],
  };
}

function asStringArray(x: unknown): string[] {
  if (!Array.isArray(x)) return [];
  return x.filter((i): i is string => typeof i === "string");
}

function parsePayload(json: unknown): DemoSeedPayloadV1 | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  if (o.v !== 1) return null;
  return {
    v: 1,
    employeeIds: asStringArray(o.employeeIds),
    vehicleIds: asStringArray(o.vehicleIds),
    tariffPlanIds: asStringArray(o.tariffPlanIds),
    customerIds: asStringArray(o.customerIds),
    referralSourceIds: asStringArray(o.referralSourceIds),
    dailyReportIds: asStringArray(o.dailyReportIds),
    timePunchIds: asStringArray(o.timePunchIds),
    alcoholCheckIds: asStringArray(o.alcoholCheckIds),
    payrollRunIds: asStringArray(o.payrollRunIds),
    dispatchReservationIds: asStringArray(o.dispatchReservationIds),
    accountsReceivableEntryIds: asStringArray(o.accountsReceivableEntryIds),
    complaintLedgerIds: asStringArray(o.complaintLedgerIds),
    guidanceSessionIds: asStringArray(o.guidanceSessionIds),
    legalRegisterStubIds: asStringArray(o.legalRegisterStubIds),
    legalChangeNoticeIds: asStringArray(o.legalChangeNoticeIds),
  };
}

function toYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function atNoonLocal(d: Date): Date {
  const x = new Date(d);
  x.setHours(12, 0, 0, 0);
  return x;
}

function daysAgo(n: number): Date {
  const d = atNoonLocal(new Date());
  d.setDate(d.getDate() - n);
  return d;
}

function mix(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export type DemoSeedSummary = {
  employees: number;
  vehicles: number;
  tariffPlans: number;
  customers: number;
  referralSources: number;
  dailyReports: number;
  tripLegsApprox: number;
  timePunches: number;
  alcoholChecks: number;
  payrollRuns: number;
  dispatchReservations: number;
  accountsReceivableEntries: number;
  complaintLedgers: number;
  guidanceSessions: number;
  legalRegisterStubs: number;
  legalChangeNotices: number;
};

function summarize(p: DemoSeedPayloadV1, tripLegApprox: number): DemoSeedSummary {
  return {
    employees: p.employeeIds.length,
    vehicles: p.vehicleIds.length,
    tariffPlans: p.tariffPlanIds.length,
    customers: p.customerIds.length,
    referralSources: p.referralSourceIds.length,
    dailyReports: p.dailyReportIds.length,
    tripLegsApprox: tripLegApprox,
    timePunches: p.timePunchIds.length,
    alcoholChecks: p.alcoholCheckIds.length,
    payrollRuns: p.payrollRunIds.length,
    dispatchReservations: p.dispatchReservationIds.length,
    accountsReceivableEntries: p.accountsReceivableEntryIds.length,
    complaintLedgers: p.complaintLedgerIds.length,
    guidanceSessions: p.guidanceSessionIds.length,
    legalRegisterStubs: p.legalRegisterStubIds.length,
    legalChangeNotices: p.legalChangeNoticeIds.length,
  };
}

/** 衝突しにくい給与の対象年月（実運用と被りにくい） */
const DEMO_PAYROLL_YM = ["2099-01", "2099-02"] as const;

export async function seedDemoDataForTenant(tenantId: string): Promise<DemoSeedSummary> {
  let tripLegApprox = 0;

  const payload = await prisma.$transaction(
    async (tx) => {
      const acc = emptyPayload();

      for (let i = 0; i < 18; i++) {
        const status: EmployeeStatus = i >= 15 ? EmployeeStatus.RETIRED : EmployeeStatus.ACTIVE;
        const emp = await tx.employee.create({
          data: {
            tenantId,
            familyName: `${P}山田`,
            givenName: `${i + 1}郎`,
            furigana: `ヤマダ${String(i + 1).padStart(2, "0")}`,
            address: "東京都千代田区（デモ）",
            status,
            retiredAt: status === EmployeeStatus.RETIRED ? daysAgo(30 + i) : null,
          },
        });
        acc.employeeIds.push(emp.id);
        await tx.employeeCompensationPeriod.create({
          data: {
            employeeId: emp.id,
            validFrom: new Date("2020-01-01"),
            validTo: null,
            compensationType: CompensationType.HOURLY_AND_COMMISSION,
            baseHourlyYen: 1150 + (i % 6) * 50,
            commissionMainRateBps: 1200 + (i % 4) * 100,
            commissionPartnerRateBps: 400,
          },
        });
      }

      for (let i = 0; i < 6; i++) {
        const v = await tx.vehicle.create({
          data: {
            tenantId,
            label: `${P}車両${i + 1}`,
            plate: `品川 ${300 + i} あ ${4000 + i}`,
            active: true,
            legalCoverageStartOn: daysAgo(400),
          },
        });
        acc.vehicleIds.push(v.id);
      }

      const planStd = await tx.tariffPlan.create({
        data: { tenantId, name: `${P}標準` },
      });
      acc.tariffPlanIds.push(planStd.id);
      const verStd = await tx.tariffPlanVersion.create({
        data: {
          planId: planStd.id,
          version: 1,
          validFrom: new Date("2020-01-01"),
          validTo: null,
          initialDistanceM: 1600,
          initialFareYen: 500,
          addUnitDistanceM: 400,
          addFareYen: 100,
          waitingFareYenPerMin: 80,
          distanceMode: TariffDistanceMode.INITIAL_ADD,
          perViaStopYen: 300,
          cancellationFeeYen: 1000,
          nightSurchargeBps: 200,
          leftHandSurchargeBps: 0,
          leftHandSurchargeFlatYen: 0,
          nightSurchargeFlatYen: 0,
          lateNightFlatYen: 0,
          earlyMorningFlatYen: 0,
          earlyRushFlatYen: 0,
          pickupRuleJson: [],
          distanceDiscountFromM: null,
          distanceDiscountBps: 0,
          waitingRuleJson: {},
        },
      });

      const planNight = await tx.tariffPlan.create({
        data: { tenantId, name: `${P}夜間割増` },
      });
      acc.tariffPlanIds.push(planNight.id);
      const verNight = await tx.tariffPlanVersion.create({
        data: {
          planId: planNight.id,
          version: 1,
          validFrom: new Date("2020-01-01"),
          validTo: null,
          initialDistanceM: 2000,
          initialFareYen: 600,
          addUnitDistanceM: 350,
          addFareYen: 120,
          waitingFareYenPerMin: 100,
          distanceMode: TariffDistanceMode.INITIAL_ADD,
          perViaStopYen: 400,
          cancellationFeeYen: 1500,
          nightSurchargeBps: 350,
          leftHandSurchargeBps: 100,
          leftHandSurchargeFlatYen: 200,
          nightSurchargeFlatYen: 300,
          lateNightFlatYen: 500,
          earlyMorningFlatYen: 0,
          earlyRushFlatYen: 0,
          pickupRuleJson: [],
          distanceDiscountFromM: 20_000,
          distanceDiscountBps: -800,
          waitingRuleJson: {},
        },
      });

      const origins = ["東京駅八重洲口", "新宿駅西口", "渋谷駅東口", "品川駅高輪口", "上野駅公園口"];
      const dests = ["羽田空港第2", "成田空港第1", "東京ビッグサイト", "武蔵野の森総合スポーツ", "幕張メッセ"];

      for (let i = 0; i < 24; i++) {
        const tv = i % 2 === 0 ? verStd.id : verNight.id;
        const c = await tx.customer.create({
          data: {
            tenantId,
            displayName: `${P}顧客${i + 1}`,
            phone: `03-0000-${String(1000 + i).slice(-4)}`,
            defaultOrigin: origins[i % origins.length] ?? "",
            defaultDestination: dests[i % dests.length] ?? "",
            defaultTariffVersionId: tv,
            specialFareYen: i % 7 === 0 ? 5000 + i * 100 : null,
            notes: i % 5 === 0 ? "デモ: 車椅子対応可" : null,
          },
        });
        acc.customerIds.push(c.id);
      }

      for (let i = 0; i < 12; i++) {
        const r = await tx.referralSource.create({
          data: {
            tenantId,
            name: `${P}紹介元${i + 1}（飲食店）`,
            memo: i % 3 === 0 ? "デモ: 月末締め請求" : null,
          },
        });
        acc.referralSourceIds.push(r.id);
      }

      const used = new Set<string>();
      const reportPlan: { vi: number; ymd: string }[] = [];
      for (let vi = 0; vi < 6; vi++) {
        for (let k = 0; k < 20; k++) {
          const day = 1 + ((vi * 11 + k * 5) % 88);
          const ymd = toYmd(daysAgo(day));
          const key = `${vi}|${ymd}`;
          if (used.has(key)) continue;
          used.add(key);
          reportPlan.push({ vi, ymd });
          if (reportPlan.length >= 100) break;
        }
        if (reportPlan.length >= 100) break;
      }
      reportPlan.sort((a, b) => (a.vi !== b.vi ? a.vi - b.vi : a.ymd.localeCompare(b.ymd)));

      const meterCursor = acc.vehicleIds.map(() => 480_000 + mix(tenantId) % 10_000);
      const empIds = acc.employeeIds;

      for (let idx = 0; idx < reportPlan.length; idx++) {
        const { vi, ymd } = reportPlan[idx]!;
        const vehicleId = acc.vehicleIds[vi]!;
        const ms = meterCursor[vi]!;
        const delta = 120 + (mix(`${ymd}|${vi}|${idx}`) % 450);
        const me = ms + delta;
        meterCursor[vi] = me;

        const mainIdx = idx % empIds.length;
        const mainEmployeeId = empIds[mainIdx]!;
        const partnerEmployeeId =
          mix(`${ymd}p`) % 10 < 3 ? empIds[(mainIdx + 3) % empIds.length]! : null;

        const baseDay = atNoonLocal(new Date(`${ymd}T12:00:00`));
        const dutyStart = new Date(baseDay);
        dutyStart.setHours(8, 15 + (idx % 5), 0, 0);
        const dutyEnd = new Date(baseDay);
        dutyEnd.setHours(17, 30 + (idx % 10), 0, 0);

        const nTrips = 3 + (mix(`trips|${ymd}|${vi}`) % 6);
        const tripsCreate: Prisma.TripLegCreateWithoutDailyReportInput[] = [];
        for (let t = 0; t < nTrips; t++) {
          const h = 9 + t;
          const dep = new Date(baseDay);
          dep.setHours(h, (t * 17) % 60, 0, 0);
          const arr = new Date(dep);
          arr.setMinutes(arr.getMinutes() + 20 + (mix(`${idx}|${t}`) % 80));
          const dist = 2500 + (mix(`dist|${idx}|${t}`) % 18_000);
          const fare = 1200 + Math.floor(dist / 250) * 90 + (mix(`fare|${idx}|${t}`) % 4000);
          const tv = t % 3 === 0 ? verNight.id : verStd.id;
          const cust = acc.customerIds[(idx + t) % acc.customerIds.length];
          const ref = acc.referralSourceIds[(idx + t * 2) % acc.referralSourceIds.length];
          tripsCreate.push({
            clientName: `${P}利用者${idx}-${t}`,
            origin: origins[(idx + t) % origins.length] ?? "",
            destination: dests[(idx + t * 2) % dests.length] ?? "",
            viaNote: t === 1 ? "デモ: 経由1か所" : null,
            departedAt: dep,
            arrivedAt: arr,
            distanceM: dist,
            waitingMinutes: mix(`w|${idx}|${t}`) % 25,
            tariffVersion: { connect: { id: tv } },
            fareYen: fare,
            role: t % 4 === 0 ? TripRole.PARTNER_DRIVER : TripRole.MAIN_DRIVER,
            passengerKind: t % 5 === 0 ? TripPassengerKind.MEMBER : TripPassengerKind.GENERAL,
            viaStopCount: t % 4 === 1 ? 1 : 0,
            applyNightSurcharge: t % 6 === 0,
            applyLeftHandSurcharge: t % 9 === 0,
            applyLeftHandSurchargeFlat: false,
            pickupFromBaseM: t % 5 === 0 ? 3000 + (mix(`pk|${t}`) % 8000) : null,
            applyNightSurchargeFlat: t % 7 === 0,
            applyLateNightFlatYen: t % 8 === 0,
            applyEarlyMorningFlatYen: false,
            applyEarlyRushFlatYen: false,
            parkingAdvanceYen: t % 4 === 0 ? 500 + (mix(`pa|${t}`) % 2000) : 0,
            tripMeterStartM: ms + t * 30,
            tripMeterEndM: ms + t * 30 + Math.floor(dist / 50),
            customer: { connect: { id: cust } },
            referralSource: { connect: { id: ref } },
            excludeFromOfficialPrint: t % 11 === 0,
          });
        }
        tripLegApprox += nTrips;

        const dr = await tx.dailyReport.create({
          data: {
            tenantId,
            businessDate: ymd,
            vehicleId,
            mainEmployeeId,
            partnerEmployeeId,
            meterStart: ms,
            meterEnd: me,
            dutyStartAt: dutyStart,
            dutyEndAt: dutyEnd,
            breakTaken: mix(`br|${idx}`) % 3 === 0,
            breakStartAt: mix(`br|${idx}`) % 3 === 0 ? new Date(dutyStart.getTime() + 3 * 3600_000) : null,
            breakEndAt: mix(`br|${idx}`) % 3 === 0 ? new Date(dutyStart.getTime() + 3 * 3600_000 + 45 * 60_000) : null,
            breakLocation: mix(`br|${idx}`) % 3 === 0 ? "デモ: サービスエリア" : null,
            paymentCashYen: 8000 + (mix(`pc|${idx}`) % 12_000),
            paymentCashNoReceiptYen: mix(`pcn|${idx}`) % 4 === 0 ? 500 : 0,
            paymentCardYen: 3000 + (mix(`pcc|${idx}`) % 8000),
            paymentPayPayYen: mix(`pp|${idx}`) % 5 === 0 ? 2000 : 0,
            paymentReceivableYen: mix(`pr|${idx}`) % 6 === 0 ? 4500 : 0,
            trips: { create: tripsCreate },
          },
        });
        acc.dailyReportIds.push(dr.id);
      }

      const punchEmps = empIds.slice(0, 8);
      for (let di = 1; di <= 48; di++) {
        const ymd = toYmd(daysAgo(di));
        for (let ei = 0; ei < punchEmps.length; ei++) {
          if (mix(`${ymd}|${ei}`) % 5 === 0) continue;
          const employeeId = punchEmps[ei]!;
          const base = atNoonLocal(new Date(`${ymd}T12:00:00`));
          const inAt = new Date(base);
          inAt.setHours(8, 10 + ei, 0, 0);
          const outAt = new Date(base);
          outAt.setHours(17, 20 + ei, 0, 0);
          const tp = await tx.timePunch.create({
            data: {
              tenantId,
              employeeId,
              businessDate: ymd,
              clockInAt: inAt,
              clockOutAt: outAt,
            },
          });
          acc.timePunchIds.push(tp.id);
        }
      }

      for (let i = 0; i < 55; i++) {
        const employeeId = empIds[i % empIds.length]!;
        const ymd = toYmd(daysAgo(1 + (i % 60)));
        const base = atNoonLocal(new Date(`${ymd}T12:00:00`));
        const checkedAt = new Date(base);
        checkedAt.setHours(7, 30 + (i % 20), 0, 0);
        const ac = await tx.alcoholCheck.create({
          data: {
            tenantId,
            employeeId,
            businessDate: ymd,
            phase: i % 2 === 0 ? "出勤前" : "退勤後",
            checkedAt,
            checkerName: `${P}確認者`,
            checkMethod: "アルコール検知器",
            detectorUsed: true,
            resultPositive: i % 37 === 0,
            instructionNote: i % 11 === 0 ? "デモ: 再検査済" : null,
          },
        });
        acc.alcoholCheckIds.push(ac.id);
      }

      for (const periodYm of DEMO_PAYROLL_YM) {
        const existing = await tx.payrollRun.findUnique({
          where: { tenantId_periodYm: { tenantId, periodYm } },
        });
        if (existing) continue;
        const run = await tx.payrollRun.create({
          data: {
            tenantId,
            periodYm,
            status: PayrollRunStatus.DRAFT,
            poolRateBps: 500,
          },
        });
        acc.payrollRunIds.push(run.id);
        for (const employeeId of empIds) {
          const g = mix(`${periodYm}|${employeeId}`) % 500_000;
          await tx.payrollLine.create({
            data: {
              runId: run.id,
              employeeId,
              grossSalesYen: 400_000 + g,
              hourlyYen: 80_000 + (g % 40_000),
              commissionYen: 50_000 + (g % 30_000),
              poolYen: 5000 + (g % 8000),
              netPayYen: 120_000 + (g % 50_000),
              breakdownJson: { demo: true, periodYm },
            },
          });
        }
      }

      for (let i = 0; i < 22; i++) {
        const start = daysAgo(3 + (i % 40));
        start.setHours(9 + (i % 8), 0, 0, 0);
        const end = new Date(start);
        end.setHours(end.getHours() + 2 + (i % 5), 30, 0, 0);
        const vehicleId = acc.vehicleIds[i % acc.vehicleIds.length]!;
        const d = await tx.dispatchReservation.create({
          data: {
            tenantId,
            vehicleId,
            title: `${P}予約 ${i + 1}`,
            note: i % 4 === 0 ? "デモ: 車いす" : null,
            startsAt: start,
            endsAt: end,
            status: i % 9 === 0 ? "TENTATIVE" : "CONFIRMED",
          },
        });
        acc.dispatchReservationIds.push(d.id);
      }

      for (let i = 0; i < 12; i++) {
        const ar = await tx.accountsReceivableEntry.create({
          data: {
            tenantId,
            partyName: `${P}請求先${i + 1}`,
            amountYen: 30_000 + (i + 1) * 8000,
            status: i % 3 === 0 ? "COLLECTED" : "OPEN",
            collectedAt: i % 3 === 0 ? daysAgo(5 + i) : null,
            referenceNote: `デモINV-${202500 + i}`,
          },
        });
        acc.accountsReceivableEntryIds.push(ar.id);
      }

      for (let i = 0; i < 8; i++) {
        const driverId = empIds[(i * 2) % empIds.length]!;
        const cl = await tx.complaintLedger.create({
          data: {
            tenantId,
            receivedAt: daysAgo(10 + i),
            receivedBy: `${P}受付`,
            occurredOn: daysAgo(12 + i),
            placeOrSection: "デモ: 車内",
            driverEmployeeId: driverId,
            complainantName: `デモ苦情主${i + 1}`,
            category: i % 2 === 0 ? "運賃" : "接遇",
            detail: "デモ用の苦情内容です。実在しません。",
            correctiveAction: i % 2 === 0 ? "再発防止教育を実施" : null,
            handlerName: `${P}担当`,
            representativeChecked: i % 2 === 0,
          },
        });
        acc.complaintLedgerIds.push(cl.id);
      }

      for (let i = 0; i < 6; i++) {
        const started = daysAgo(20 + i * 3);
        started.setHours(14, 0, 0, 0);
        const ended = new Date(started);
        ended.setHours(16, 30, 0, 0);
        const gs = await tx.guidanceSession.create({
          data: {
            tenantId,
            startedAt: started,
            endedAt: ended,
            location: "デモ: 本社会議室",
            instructorName: `${P}講師`,
            topicFeeCollection: true,
            topicTerms: i % 2 === 0,
            topicConditionExplain: true,
            topicMarking: false,
            topicRoadTransportLaw: true,
            topicOther: i % 3 === 0 ? "その他" : null,
            topicOtherDetail: i % 3 === 0 ? "デモメモ" : null,
            remarks: "デモ用の指導記録です。",
            representativeChecked: i % 2 === 0,
            attendees: {
              create: [
                { employeeId: empIds[i % empIds.length]!, attendeeName: null },
                { employeeId: empIds[(i + 1) % empIds.length]!, attendeeName: null },
              ],
            },
          },
        });
        acc.guidanceSessionIds.push(gs.id);
      }

      for (const kind of ["complaint", "guidance", "roster"] as const) {
        for (let j = 0; j < 3; j++) {
          const stub = await tx.legalRegisterStub.create({
            data: {
              tenantId,
              kind,
              payload: { demo: true, index: j, label: `${P}${kind}-${j}` },
            },
          });
          acc.legalRegisterStubIds.push(stub.id);
        }
      }

      for (let i = 0; i < 7; i++) {
        const ln = await tx.legalChangeNotice.create({
          data: {
            tenantId,
            changeType: i % 2 === 0 ? "届出" : "備考",
            submittedOn: daysAgo(40 + i),
            changedOn: daysAgo(35 + i),
            effectiveOn: daysAgo(30 + i),
            oldValue: "デモ: 旧値",
            newValue: "デモ: 新値",
            reason: "デモデータのため実在しません。",
            notes: `${P}変更記録${i + 1}`,
          },
        });
        acc.legalChangeNoticeIds.push(ln.id);
      }

      await tx.demoSeedBatch.create({
        data: {
          tenantId,
          payload: acc as unknown as Prisma.InputJsonValue,
        },
      });

      return acc;
    },
    { maxWait: 60_000, timeout: 120_000 },
  );

  return summarize(payload, tripLegApprox);
}

export type DemoDeleteSummary = {
  removedBatches: number;
};

export async function deleteAllDemoSeedsForTenant(tenantId: string): Promise<DemoDeleteSummary> {
  const batches = await prisma.demoSeedBatch.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
  });

  let removedBatches = 0;
  for (const batch of batches) {
    const p = parsePayload(batch.payload);
    await prisma.$transaction(async (tx) => {
      if (p) {
        if (p.dailyReportIds.length) {
          await tx.dailyReport.deleteMany({ where: { id: { in: p.dailyReportIds }, tenantId } });
        }
        if (p.payrollRunIds.length) {
          await tx.payrollRun.deleteMany({ where: { id: { in: p.payrollRunIds }, tenantId } });
        }
        if (p.guidanceSessionIds.length) {
          await tx.guidanceSession.deleteMany({ where: { id: { in: p.guidanceSessionIds }, tenantId } });
        }
        if (p.timePunchIds.length) {
          await tx.timePunch.deleteMany({ where: { id: { in: p.timePunchIds }, tenantId } });
        }
        if (p.alcoholCheckIds.length) {
          await tx.alcoholCheck.deleteMany({ where: { id: { in: p.alcoholCheckIds }, tenantId } });
        }
        if (p.dispatchReservationIds.length) {
          await tx.dispatchReservation.deleteMany({ where: { id: { in: p.dispatchReservationIds }, tenantId } });
        }
        if (p.accountsReceivableEntryIds.length) {
          await tx.accountsReceivableEntry.deleteMany({ where: { id: { in: p.accountsReceivableEntryIds }, tenantId } });
        }
        if (p.complaintLedgerIds.length) {
          await tx.complaintLedger.deleteMany({ where: { id: { in: p.complaintLedgerIds }, tenantId } });
        }
        if (p.customerIds.length) {
          await tx.customer.deleteMany({ where: { id: { in: p.customerIds }, tenantId } });
        }
        if (p.referralSourceIds.length) {
          await tx.referralSource.deleteMany({ where: { id: { in: p.referralSourceIds }, tenantId } });
        }
        if (p.tariffPlanIds.length) {
          await tx.tariffPlan.deleteMany({ where: { id: { in: p.tariffPlanIds }, tenantId } });
        }
        if (p.vehicleIds.length) {
          await tx.vehicle.deleteMany({ where: { id: { in: p.vehicleIds }, tenantId } });
        }
        if (p.employeeIds.length) {
          await tx.employee.deleteMany({ where: { id: { in: p.employeeIds }, tenantId } });
        }
      }
      await tx.demoSeedBatch.delete({ where: { id: batch.id } });
    });
    removedBatches++;
  }

  return { removedBatches };
}

export async function getDemoSeedStatus(tenantId: string): Promise<{ batchCount: number; lastCreatedAt: string | null }> {
  const [batchCount, last] = await Promise.all([
    prisma.demoSeedBatch.count({ where: { tenantId } }),
    prisma.demoSeedBatch.findFirst({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
  ]);
  return {
    batchCount,
    lastCreatedAt: last?.createdAt.toISOString() ?? null,
  };
}
