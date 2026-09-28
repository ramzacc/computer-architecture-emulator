# Computer Architecture Tool

[Open the tool](https://comparch.ramza.cc)

Projects can be saved and imported from the **File** menu in the top bar. The [project file format](docs/project-format-v1.md) is versioned.

The **File** menu also opens two examples. The [branching computer](docs/branching-computer.md) is a 4-bit accumulator CPU with arithmetic, bitwise operations, `JMP`, `JZ`, `JNZ`, and `HALT`. Its sample program counts down to zero in a loop, then takes a zero branch. Use **Program → Step** to watch `PC` and `ACC` change. The example can be regenerated with `node scripts/generate-branching-computer.mjs`.
