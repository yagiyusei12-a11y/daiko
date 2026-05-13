export type JommuTripRow = {
  clientName: string;
  charterVehicleNo: string;
  origin: string;
  departedHm: string;
  viaText: string;
  destination: string;
  arrivedHm: string;
  distanceKm: string;
  fareYen: string;
};

export type JommuKirokuboModel = {
  businessDateYmd: string;
  yParts: { y: string; m: string; d: string };
  /** 受託者（運転者）氏名 */
  crewName: string;
  clockInHm: string | null;
  clockOutHm: string | null;
  /** 事業所名 */
  officeName: string;
  /** 自社車（随伴車）登録番号 */
  companyCarRegNo: string;
  /** 安全運転管理者（設定の法定情報） */
  safetyManagerName: string;
  /** 日報の同伴乗務員（客車担当以外のペア） */
  accompanyingCrewName: string;
  trips: JommuTripRow[];
  odoStartKm: string | null;
  odoEndKm: string | null;
  totalOdoKm: string | null;
  actualDistanceKmSum: string;
  salesTotalYen: string;
};
