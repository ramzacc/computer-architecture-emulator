# Branching computer example

Open **File → Open branching computer example**, then use **Program → Step**. The **PC** register addresses a 16-word ROM. Each 8-bit instruction has a 4-bit opcode and a 4-bit operand. **ACC** and arithmetic are 4-bit, so results wrap modulo 16.

| Opcode | Instruction | Effect |
| --- | --- | --- |
| 0 | `LDI n` | ACC = n |
| 1 | `ADD n` | ACC = ACC + n |
| 2 | `SUB n` | ACC = ACC − n |
| 3 | `AND n` | ACC = ACC AND n |
| 4 | `OR n` | ACC = ACC OR n |
| 5 | `XOR n` | ACC = ACC XOR n |
| 6 | `NOT` | ACC = NOT ACC |
| 7 | `NAND n` | ACC = NOT (ACC AND n) |
| 8 | `NOR n` | ACC = NOT (ACC OR n) |
| 9 | `INC` | ACC = ACC + 1 |
| A | `DEC` | ACC = ACC − 1 |
| B | `CLR` | ACC = 0 |
| C | `JMP address` | PC = address |
| D | `JZ address` | Jump if ACC is zero |
| E | `JNZ address` | Jump if ACC is nonzero |
| F | `HALT` | Stop advancing PC and writing ACC |

The example program initializes ACC, loads 5, adds 3, and repeatedly subtracts 1 until ACC reaches zero. It then runs several logic instructions, takes a `JZ` branch, and jumps to `HALT`. The ROM, ISA, and annotated assembly are saved in [branching-computer.json](../public/examples/branching-computer.json).
