export const VALUE_FORMATS = ["decimal", "binary", "hex"];

export function validValueFormat(format) {
  return VALUE_FORMATS.includes(format);
}

export function formatValue(value, size, format = "decimal") {
  if (format === "binary") return `0b${value.toString(2).padStart(size, "0")}`;
  if (format === "hex") return `0x${value.toString(16).toUpperCase().padStart(Math.ceil(size / 4), "0")}`;
  return String(value);
}

export function parseValue(text, format = "decimal") {
  const input = text.trim();
  const patterns = {
    decimal: /^(?:[0-9]+)$/,
    binary: /^(?:0[bB])?[01]+$/,
    hex: /^(?:0[xX])?[0-9a-fA-F]+$/,
  };
  if (!patterns[format]?.test(input)) return null;
  const digits = format === "binary" ? input.replace(/^0[bB]/, "")
    : format === "hex" ? input.replace(/^0[xX]/, "") : input;
  const value = parseInt(digits, format === "binary" ? 2 : format === "hex" ? 16 : 10);
  return Number.isSafeInteger(value) ? value : null;
}
