import test from "node:test";
import assert from "node:assert/strict";
import { VALUE_FORMATS, formatValue, parseValue, validValueFormat } from "./public/value-format.js";

test("the three supported value formats are decimal, binary, and hex", () => {
  assert.deepEqual(VALUE_FORMATS, ["decimal", "binary", "hex"]);
  for (const format of VALUE_FORMATS) assert.equal(validValueFormat(format), true);
  for (const format of ["octal", "BINARY", "", null, undefined, 1]) assert.equal(validValueFormat(format), false);
});

test("formatting pads binary and hex to the component's bit width", () => {
  assert.equal(formatValue(0, 1), "0");
  assert.equal(formatValue(173, 8), "173");
  assert.equal(formatValue(0, 1, "binary"), "0b0");
  assert.equal(formatValue(9, 4, "binary"), "0b1001");
  assert.equal(formatValue(0xffffffff, 32, "binary"), `0b${"1".repeat(32)}`);
  assert.equal(formatValue(5, 8, "hex"), "0x05");
  assert.equal(formatValue(255, 8, "hex"), "0xFF");
  assert.equal(formatValue(0, 32, "hex"), "0x00000000");
  assert.equal(formatValue(0xabcd, 16, "hex"), "0xABCD");
});

test("parsing accepts a matching radix with or without a prefix and ignores surrounding space", () => {
  assert.equal(parseValue("173", "decimal"), 173);
  assert.equal(parseValue(" 173 ", "decimal"), 173);
  assert.equal(parseValue("0b10101101", "binary"), 173);
  assert.equal(parseValue("10101101", "binary"), 173);
  assert.equal(parseValue("0B101", "binary"), 5);
  assert.equal(parseValue("0xAD", "hex"), 173);
  assert.equal(parseValue("AD", "hex"), 173);
  assert.equal(parseValue("0Xad", "hex"), 173);
  assert.equal(parseValue("000", "binary"), 0);
  assert.equal(parseValue("0", "hex"), 0);
});

test("parsing rejects malformed, empty, prefixed-digit, and out-of-range input", () => {
  assert.equal(parseValue("", "decimal"), null);
  assert.equal(parseValue("", "binary"), null);
  assert.equal(parseValue("0b", "binary"), null);
  assert.equal(parseValue("0b102", "binary"), null);
  assert.equal(parseValue("-1", "binary"), null);
  assert.equal(parseValue("1.5", "decimal"), null);
  assert.equal(parseValue("0x", "hex"), null);
  assert.equal(parseValue("0xGG", "hex"), null);
  assert.equal(parseValue("0xAD", "decimal"), null);
  assert.equal(parseValue("10102", "binary"), null);
  assert.equal(parseValue("173", "octal"), null);
  assert.equal(parseValue("9".repeat(30), "decimal"), null);
});
