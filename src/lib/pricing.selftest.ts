import assert from "node:assert/strict";
import {
  fareYenForDistance,
  fareYenForTrip,
  fareYenTieredAdd,
  segmentFareYen,
} from "./pricing.js";
import { waitingFareYen } from "./tariff-waiting.js";

// linear waiting
assert.equal(waitingFareYen({ type: "linear", graceMin: 10, perMinYen: 100 }, 12), 200);
assert.equal(waitingFareYen({ type: "linear", graceMin: 10, perMinYen: 100 }, 10), 0);

// block waiting (5 min / 500 yen after 10 min grace) — 11 billable minutes -> ceil(11/5)*500
assert.equal(waitingFareYen({ type: "block", graceMin: 10, blockEveryMin: 5, blockYen: 500 }, 21), 1500);

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

console.log("pricing.selftest ok");
