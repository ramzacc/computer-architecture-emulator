# Computer Architecture Tool

[Open the tool](https://comparch.ramza.cc)

## ISA and assembly

Create a ROM on Canvas, then select it in **ISA**. Add an instruction card, enter its keyword, and add ordered **Register** or **Value** operands. Select `0`, `1`, or an operand and click ROM bit cells to assign them. Bit 0 is the least significant bit. The first assigned operand cell receives its highest bit; use the arrows in the operand strip to change the order. Save the ISA for the selected ROM.

In **Program**, each physical source line maps to one ROM address, starting at 0. Blank lines and `;` comments reserve a zero word. Write instructions such as `ADD R2 5`; register indexes use `R` (for example `R7` or `R0xA`), while unprefixed decimal, `0x` hex, and `0b` binary numbers are Values. Use `.word 0xAB` for a raw ROM word. Assemble a draft before using Play or Step. Disassembling a sparse ROM fills gaps with blank lines and uses `.word` for unmatched values.

The Program gutter shows each line’s ROM address and highlights the line selected by the PC. The linked run clock locks source and ROM writing while enabled. Saved ISAs from older text rules are converted when documents load.

### Demo computer ISA

The bundled 8-bit computer has four ISA cards preloaded. Bits 7–6 select the operation, bits 5–3 select RA, and bits 2–0 select RB. Both operands are **Register** fields, with bit order descending within each field. The result is written to RB.

| Keyword | Bits 7–6 | Result in RB |
| --- | --- | --- |
| `NOT` | `00` | `~RA` |
| `SUM` | `01` | `RA + RB` |
| `AND` | `10` | `RA & RB` |
| `INC` | `11` | `RA + 1` |

For example, `AND R2 R7` encodes as `0x97` (`10 010 111`). The 8-bit arithmetic results wrap at 256. In ISA, select **Program ROM** to inspect or edit these cards; in Program, address `0x01` disassembles to `AND R2 R7`.
