# Computer Architecture Tool

[Open the tool](https://comparch.ramza.cc)

## ISA and assembly

Create a ROM on Canvas. In **ISA**, select the ROM to link it with Program, then write rules such as:

```text
ADD | op 7-6=01 | address 5-4-3 | address 2-1-0
LDI | op 7-6-5=110 | address 4-3 | immediate 2-1-0
JMP | op 7-6=10 | address *
```

Bit 0 is the least significant bit. The first position in a list receives the highest bit of that opcode or operand. `*` assigns every unused bit to that operand, from high to low. Bits left unassigned are zero. Each `address` or `immediate` clause creates one numeric operand in the listed order. Save rules for each ROM separately.

For scattered fields, a rule can use `MIX | op 0-3-5=101 | immediate 1-4-6 | address *`.

In **Program**, link the ROM and write instructions such as `ADD 2 1`, `LDI 3 0x5`, or `JMP 0b101`. Numbers can be decimal, hex (`0x`), or binary (`0b`). Use `.org 0x10` to set the next address and `;` for comments. Click **Assemble to ROM** to validate and save the complete ROM image. **Disassemble ROM** reloads the ROM into the editor; unmatched words use `.word`. Raw memory editing is in **ROM**.
