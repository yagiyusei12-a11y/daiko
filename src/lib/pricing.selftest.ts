import assert from "node:assert/strict";
import {
  fareYenForDistance,
  fareYenForTrip,
  fareYenTieredAdd,
  segmentFareYen,
} from "./pricing.js";
import { pickupFareYen } from "./pickup-pricing.js";
import { waitingFareYen } from "./tariff-waiting.js";

// linear waiting
assert.equal(waitingFareYen({ type: "linear", graceMin: 10, perMinYen: 100 }, 12), 200);
assert.equal(waitingFareYen({ type: "linear", graceMin: 10, perMinYen: 100 }, 10), 0);

// block waiting (5 min / 500 yen after 10 min grace) — 11 billable minutes -> ceil(11/5)*500
assert.equal(waitingFareYen({ type: "block", graceMin: 10, blockEveryMin: 5, blockYen: 500 }, 21), 1500);

// prefix_block_then_block (だるま型: 15分まで500円、その後5分ごと500円)
const darumaWait = {
  type: "prefix_block_then_block" as const,
  graceMin: 0,
  prefixMin: 15,
  prefixYen: 500,
  blockEveryMin: 5,
  blockYen: 500,
};
assert.equal(waitingFareYen(darumaWait, 0), 0);
assert.equal(waitingFareYen(darumaWait, 15), 500);
assert.equal(waitingFareYen(darumaWait, 16), 1000);

// 迎車帯
const pickupJson = [
  { fromM: 0, toM: 5000, yen: 0 },
  { fromM: 5001, toM: 10000, yen: 500 },
  { fromM: 10001, toM: null, yen: 1000 },
];
assert.equal(pickupFareYen(pickupJson, 3000), 0);
assert.equal(pickupFareYen(pickupJson, 8000), 500);
assert.equal(pickupFareYen(pickupJson, 12000), 1000);

// segment member
const segs = [
  { fromM: 0, toM: 2000, fareYen: 800, fareMemberYen: 600 },
  { fromM: 2001, toM: 5000, fareYen: 1200, fareMemberYen: null },
];
assert.equal(segmentFareYen(segs, 1000, false), 800);
assert.equal(segmentFareYen(segs, 1000, true), 600);

// TIERED_ADD simple: initial 2km/800, then [2000,10000) 200m/100
const tiers = [{ sortOrder: 0, fromM: 2000, untilM: 10000, stepM: 200, addYenPerStep: 100 }];
assert.equal(fareYenTieredAdd(2000, 800, tiers, 2000), 800);
const t1 = fareYenTieredAdd(2000, 800, tiers, 3000);
assert.ok(t1 !== null && t1 > 800);

const ver = {
  distanceMode: "INITIAL_ADD",
  initialDistanceM: 2000,
  initialFareYen: 800,
  addUnitDistanceM: 200,
  addFareYen: 100,
  waitingFareYenPerMin: 50,
  waitingRuleJson: { type: "linear", graceMin: 0, perMinYen: 50 },
  perViaStopYen: 300,
  nightSurchargeBps: 0,
  leftHandSurchargeBps: 0,
};
const trip = fareYenForTrip(ver, 2500, 2, [], [], { viaStopCount: 1 });
assert.equal(trip, fareYenForDistance(ver, 2500, [], [], false)! + 2 * 50 + 300);

// 距離割引 + 迎車 + 定額深夜
const ver2 = {
  ...ver,
  distanceDiscountFromM: 2000,
  distanceDiscountBps: -1000,
  nightSurchargeFlatYen: 500,
  pickupRuleJson: pickupJson,
};
const trip2 = fareYenForTrip(ver2, 3000, 0, [], [], {
  pickupFromBaseM: 6000,
  applyNightSurchargeFlat: true,
});
const baseDist = fareYenForDistance(ver2, 3000, [], [], false)!;
const discounted = Math.round((baseDist * 9000) / 10000);
assert.equal(trip2, discounted + 500 + pickupFareYen(pickupJson, 6000));

console.log("pricing.selftest ok");
