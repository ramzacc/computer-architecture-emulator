# Computer Architecture Tool

[Open the tool](https://comparch.ramza.cc)

## ISA and assembly

Create a ROM on Canvas, then select it in **ISA**. Add an instruction card, enter its keyword, and add ordered **Register** or **Value** operands. Select `0`, `1`, or an operand and click ROM bit cells to assign them. Bit 0 is the least significant bit. The first assigned operand cell receives its highest bit; use the arrows in the operand strip to change the order. Save the ISA for the selected ROM.

In **Program**, each physical source line maps to one ROM address, starting at 0. Blank lines and `;` comments reserve a zero word. Write instructions such as `ADD R2 5`; register indexes use `R` (for example `R7` or `R0xA`), while unprefixed decimal, `0x` hex, and `0b` binary numbers are Values. Use `.word 0xAB` for a raw ROM word. Assemble a draft before using Play or Step. Disassembling a sparse ROM fills gaps with blank lines and uses `.word` for unmatched values.

The Program gutter shows each line’s ROM address and highlights the line selected by the PC. The linked run clock locks source and ROM writing while enabled. Saved ISAs from older text rules are converted when documents load.
