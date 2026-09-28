# Computer Architecture Tool

[Open the tool](https://comparch.ramza.cc)

## ISA and assembly

Create a ROM on Canvas, then select it in **ISA**. Add an instruction card, enter its keyword, and add ordered **Register** or **Value** operands. Click a ROM bit cell to cycle `0` → `1` → empty. Select a Register or Value operand, then click empty cells to assign its bits. Click an assigned operand cell to remove it and click again to assign it last in bit order. Click the selected operand button again to return to fixed-bit cycling. Bit 0 is the least significant bit; the first assigned operand cell receives its highest bit. Save the ISA for the selected ROM.

In **Program**, each instruction or `.word` line maps to one ROM address, starting at 0. Blank lines and `;` comments do not consume an address. Write instructions such as `ADD R2 5`; register indexes use `R` (for example `R7` or `R0xA`), while unprefixed decimal, `0x` hex, and `0b` binary numbers are Values. Use `.word 0xAB` for a raw ROM word. Assemble a draft before using Play or Step. Disassembling a sparse ROM fills gaps with `.word 0` lines and uses `.word` for unmatched values. Address 0 is shown explicitly when it contains a zero word, so the first program line is readable.

The Program gutter shows each line’s ROM address and highlights the line selected by the PC. The linked run clock locks source and ROM writing while enabled. Saved ISAs from older text rules are converted when documents load.

Saving Program source keeps the ROM words authoritative. The document stores only source lines that differ from disassembly, blank and comment-only lines, and the program length needed to display trailing zero words. If ROM contents or ISA rules change, a saved line is shown only while it still assembles to the ROM word at that address.

### Demo computer ISA

The bundled 8-bit computer has four ISA cards preloaded. Bits 7–6 select the operation, bits 5–3 select RA, and bits 2–0 select RB. Both operands are **Register** fields, with bit order descending within each field. The result is written to RB.

| Keyword | Bits 7–6 | Result in RB |
| --- | --- | --- |
| `NOT` | `00` | `~RA` |
| `SUM` | `01` | `RA + RB` |
| `AND` | `10` | `RA & RB` |
| `INC` | `11` | `RA + 1` |

For example, `AND R2 R7` encodes as `0x97` (`10 010 111`). The 8-bit arithmetic results wrap at 256. In ISA, select **Program ROM** to inspect or edit these cards; in Program, address `0x01` disassembles to `AND R2 R7`.
