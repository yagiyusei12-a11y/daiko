/** 縦型デイリービュー（Googleカレンダー風）の重なりレイアウト */

export type ScheduleAxis = { mn: number; mx: number };

export type TimedEvent = { id: string; startMin: number; endMin: number };

export type EventRect = {
  topPx: number;
  heightPx: number;
  leftPct: number;
  widthPct: number;
  column: number;
  totalColumns: number;
};

export const GCAL_HOUR_HEIGHT_PX = 56;

function overlaps(a: TimedEvent, b: TimedEvent): boolean {
  return a.startMin < b.endMin && b.startMin < a.endMin;
}

/** 時間的に重なる予定をクラスターに分割 */
export function clusterTimedEvents(events: TimedEvent[]): TimedEvent[][] {
  const sorted = [...events].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
  const clusters: TimedEvent[][] = [];

  for (const e of sorted) {
    const idx = clusters.findIndex((c) => c.some((x) => overlaps(x, e)));
    if (idx >= 0) clusters[idx].push(e);
    else clusters.push([e]);
  }

  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        if (clusters[i].some((a) => clusters[j].some((b) => overlaps(a, b)))) {
          clusters[i] = [...clusters[i], ...clusters[j]];
          clusters.splice(j, 1);
          merged = true;
          break outer;
        }
      }
    }
  }
  return clusters;
}

/** クラスター内で列を割り当て、絶対配置用の矩形を返す */
export function layoutTimedEvents(
  events: TimedEvent[],
  axis: ScheduleAxis,
  hourHeightPx: number = GCAL_HOUR_HEIGHT_PX,
): Map<string, EventRect> {
  const result = new Map<string, EventRect>();
  const span = axis.mx - axis.mn;
  if (span <= 0 || events.length === 0) return result;

  const gutterPct = 1.5;

  for (const cluster of clusterTimedEvents(events)) {
    const sorted = [...cluster].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
    const colEnds: number[] = [];
    const colById = new Map<string, number>();

    for (const e of sorted) {
      let col = colEnds.findIndex((end) => end <= e.startMin);
      if (col === -1) {
        col = colEnds.length;
        colEnds.push(e.endMin);
      } else {
        colEnds[col] = e.endMin;
      }
      colById.set(e.id, col);
    }

    const totalCols = Math.max(1, colEnds.length);
    const colWidth = (100 - gutterPct * (totalCols + 1)) / totalCols;

    for (const e of sorted) {
      const col = colById.get(e.id) ?? 0;
      const lo = Math.max(axis.mn, Math.min(e.startMin, e.endMin));
      const hi = Math.min(axis.mx, Math.max(e.startMin, e.endMin));
      if (hi <= lo) continue;

      const topPx = ((lo - axis.mn) / 60) * hourHeightPx;
      const heightPx = Math.max(((hi - lo) / 60) * hourHeightPx, 24);
      const leftPct = gutterPct + col * (colWidth + gutterPct);

      result.set(e.id, {
        topPx,
        heightPx,
        leftPct,
        widthPct: colWidth,
        column: col,
        totalColumns: totalCols,
      });
    }
  }

  return result;
}

export function axisGridHeightPx(axis: ScheduleAxis, hourHeightPx: number = GCAL_HOUR_HEIGHT_PX): number {
  return Math.max(((axis.mx - axis.mn) / 60) * hourHeightPx, hourHeightPx);
}

/** 軸ラベル用（28時間表記: 27:00 など） */
export function formatAxisTimeLabel(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

/** 1時間刻みの目盛り（mn〜mx） */
export function hourTicks(axis: ScheduleAxis): number[] {
  const startH = Math.floor(axis.mn / 60);
  const endH = Math.ceil(axis.mx / 60);
  const ticks: number[] = [];
  for (let h = startH; h <= endH; h++) {
    const min = h * 60;
    if (min >= axis.mn && min <= axis.mx) ticks.push(min);
  }
  if (ticks.length === 0) ticks.push(axis.mn);
  return ticks;
}

export function minutesToTopPx(minutes: number, axis: ScheduleAxis, hourHeightPx: number): number {
  return ((minutes - axis.mn) / 60) * hourHeightPx;
}
