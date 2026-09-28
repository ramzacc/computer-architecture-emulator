import test from "node:test";
import assert from "node:assert/strict";
import { MAX_PLEXER_CHANNELS, addressWidth, bitWidth, channelCount, dimsFor, documentFields,
  isSizable, normalizeRotation, selectWidth, spec, validBitWidth, validChannelCount,
  validClockFrequency, validConstant, validRam, validRom, validRomAddressWidth, validRomWidth,
  validSplitterOrder } from "../public/components.js";

test("rotation normalizes negatives and fractions into zero through three", () => {
  assert.deepEqual([-5, -1, 0, 1, 2, 3, 4, 5, 2.9, "3", null, undefined, NaN].map(normalizeRotation),
    [3, 3, 0, 1, 2, 3, 0, 1, 2, 3, 0, 0, 0]);
});

test("known component types expose a spec while unknown names do not", () => {
  assert.equal(spec("led").label, "LED");
  assert.equal(spec("mux").block, "mux");
  for (const type of ["power", "alu", "__proto__", "constructor", ""]) assert.equal(spec(type), null);
});

test("clock frequencies are finite values between 0.1 and 20 inclusive", () => {
  for (const frequency of [0.1, 1, 2.5, 20]) assert.equal(validClockFrequency(frequency), true);
  for (const frequency of [0, 0.09, 20.1, -1, Infinity, NaN, "1", undefined]) assert.equal(validClockFrequency(frequency), false);
});

test("plexer channel counts and selector widths follow the 1-16 rule", () => {
  assert.equal(MAX_PLEXER_CHANNELS, 16);
  assert.equal(channelCount({}), 2);
  assert.equal(channelCount({ channels: 5 }), 5);
  for (const channels of [1, 2, 8, 16]) assert.equal(validChannelCount(channels), true);
  for (const channels of [0, 17, 2.5, "4", null]) assert.equal(validChannelCount(channels), false);
  assert.deepEqual([1, 2, 3, 4, 5, 8, 9, 16].map((channels) => selectWidth({ channels })), [1, 1, 2, 2, 3, 3, 4, 4]);
});

test("sizable and document fields agree per component type", () => {
  const sizable = ["and", "or", "not", "register", "rom", "ram", "counter", "splitter", "constant", "input", "output", "portal", "tag", "mux", "demux"];
  const fixed = ["led", "sevenseg", "debugdisplay", "module", "button", "clock", "switch"];
  for (const type of sizable) assert.equal(isSizable({ t: type }), true, type);
  for (const type of fixed) assert.equal(isSizable({ t: type }), false, type);
  assert.deepEqual(documentFields("constant"), ["size", "value", "format", "label"]);
  assert.deepEqual(documentFields("input"), ["size", "value", "format", "label"]);
  assert.deepEqual(documentFields("output"), ["size", "format", "label"]);
  assert.deepEqual(documentFields("rom"), ["size", "addressSize", "data", "label"]);
  assert.deepEqual(documentFields("clock"), ["frequency", "enable", "label"]);
  assert.deepEqual(documentFields("splitter"), ["size", "order", "label"]);
  assert.deepEqual(documentFields("mux"), ["size", "channels", "label"]);
  assert.deepEqual(documentFields("led"), ["label"]);
});

test("bit and address widths fall back to sane defaults", () => {
  assert.equal(bitWidth({ t: "debugdisplay", size: 8 }), 4);
  assert.equal(bitWidth({ t: "constant", size: 7 }), 7);
  assert.equal(bitWidth({ t: "constant" }), 1);
  assert.equal(bitWidth({ t: "led" }), 1);
  assert.equal(addressWidth({ addressSize: 12 }), 12);
  assert.equal(addressWidth({}), 8);
});

test("bus, ROM, address, and splitter validators reject out-of-range widths", () => {
  for (const size of [1, 8, 32]) assert.equal(validBitWidth(size), true);
  for (const size of [0, 33, 2.5, "8", null]) assert.equal(validBitWidth(size), false);
  for (const size of [1, 2, 4, 8, 16, 32]) assert.equal(validRomWidth(size), true);
  for (const size of [3, 6, 24, 0]) assert.equal(validRomWidth(size), false);
  for (const size of [1, 2, 8, 16]) assert.equal(validRomAddressWidth(size), true);
  for (const size of [32, 3, 0]) assert.equal(validRomAddressWidth(size), false);
  assert.equal(validSplitterOrder("ascendant"), true);
  assert.equal(validSplitterOrder("descendant"), true);
  for (const order of ["ascending", "", undefined]) assert.equal(validSplitterOrder(order), false);
});

test("constant values must be integers that fit their width", () => {
  assert.equal(validConstant({ t: "constant", size: 1, value: 1 }), true);
  assert.equal(validConstant({ t: "constant", size: 1, value: 2 }), false);
  assert.equal(validConstant({ t: "constant", size: 4, value: 15 }), true);
  assert.equal(validConstant({ t: "constant", size: 8, value: 255 }), true);
  assert.equal(validConstant({ t: "constant", size: 8, value: 256 }), false);
  assert.equal(validConstant({ t: "constant", size: 9, value: 0 }), false);
  assert.equal(validConstant({ t: "constant", size: 4, value: 1.5 }), false);
  assert.equal(validConstant({ t: "constant" }), true);
});

test("ROM data needs unique in-range addresses and nonzero words that fit", () => {
  assert.equal(validRom({ t: "rom", size: 8, addressSize: 8, data: [[0, 5], [255, 255]] }), true);
  assert.equal(validRom({ t: "rom", size: 8, addressSize: 8, data: [] }), true);
  assert.equal(validRom({ t: "rom", size: 8, addressSize: 8, data: [[0, 0]] }), false);
  assert.equal(validRom({ t: "rom", size: 8, addressSize: 8, data: [[0, 256]] }), false);
  assert.equal(validRom({ t: "rom", size: 8, addressSize: 8, data: [[256, 5]] }), false);
  assert.equal(validRom({ t: "rom", size: 8, addressSize: 8, data: [[0, 5], [0, 6]] }), false);
  assert.equal(validRom({ t: "rom", size: 3, addressSize: 8, data: [] }), false);
  assert.equal(validRom({ t: "rom", size: 8, addressSize: 32, data: [] }), false);
  assert.equal(validRam({ t: "ram", size: 8, addressSize: 8 }), true);
  assert.equal(validRam({ t: "ram", size: 8, addressSize: 32 }), false);
  assert.equal(validRam({ t: "ram", size: 3, addressSize: 8 }), false);
});

test("dimsFor swaps width and height on quarter turns but pins tags upright", () => {
  assert.deepEqual([0, 1, 2, 3].map((r) => dimsFor("and", r)),
    [{ w: 4, h: 2 }, { w: 2, h: 4 }, { w: 4, h: 2 }, { w: 2, h: 4 }]);
  assert.deepEqual([0, 1, 2, 3].map((r) => dimsFor("sevenseg", r)),
    [{ w: 6, h: 5 }, { w: 5, h: 6 }, { w: 6, h: 5 }, { w: 5, h: 6 }]);
  for (const r of [0, 1, 2, 3]) assert.deepEqual(dimsFor("tag", r), { w: 4, h: 2 });
  assert.deepEqual(dimsFor("not", 1), { w: 2, h: 2 });
  assert.equal(dimsFor("missing"), null);
});
