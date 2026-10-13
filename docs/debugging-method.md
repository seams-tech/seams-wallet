# Debugging method

Use this method for a fault of unknown cause: a bug, a regression, a stall, a
leak, a hang or a flaky test. It applies also when the fault is in code or on
a platform that we cannot read. A failure with a clear error and an obvious
fix does not need it.

The rule: facts come from tools and are constraints. Causes are hypotheses.
A cause stays only while no fact contradicts it.

## Steps

1. **State the fault.** Name the broken case in one sentence: what is wrong,
   where, since when, and which measurement shows it.
2. **Gather facts before causes.** Start from data, not from code. Code says
   what can happen. Data says what did happen. Read code last, to explain a
   fact or to find a place to measure.
3. **Check each instrument.** Before a conclusion rests on a reading:
   - Make the instrument show a known non-zero case.
   - Confirm the host, the time window and the version of the reading.
   - Find what the instrument cannot see.
   - Reproduce each count from the raw data with a script.
4. **Use a control.** A control differs from the broken case in the one thing
   that you suspect. A data point in the broken case and not in the control
   is a signal. A data point in both is noise. If the measurement adds load,
   run a light measurement alone first and add the load at a known time.
5. **Build the cause table.** Causes are rows and signals are columns. Mark
   each cell: fits, contradicts, or says nothing. Include "our own code" and
   "the measurement itself" as rows.
   - A signal that only one cause fits is strong. Percentiles and error
     rates are weak: every cause fits them.
   - One contradiction removes a cause. Do not explain it away.
6. **When no cause is left,** do these in order:
   1. Check again how the contradicting facts were gathered.
   2. Split a cause that is too coarse.
   3. Merge causes that each explain one symptom of the same thing.
   4. Combine two causes only if each is necessary.
   5. Gather facts one layer down. Do not add guesses.
7. **Validate the cause that is left.** Check it against every fact. Derive a
   prediction that the other causes do not make, and measure it.
8. **Treat a reproduction as a hypothesis.** A probe or a benchmark is a claim
   that it behaves like the product. Show that it produces the strongest
   signal of the real fault. Until then, write "parity is not established",
   and label each number as the probe's number.
9. **Ask a reviewer to contradict.** Give an independent reviewer the record
   and the raw data, not the conclusion. Ask for objections with citations.
   Verify each objection from the data before the record changes. Ask also
   which facts the record needs and does not have.
10. **Report.** Start with the result. Then give:
    - What is measured, what is inferred and what stays unknown.
    - The cause table, with the fact that removed each cause.
    - Whether parity with the product is established.
    - For each unknown, the measurement that would settle it.
    - Each earlier statement that was withdrawn.

When the cause is inside a system that we cannot read, stop at the cause that
is left, even if it is coarse. Name who can refine it, and write the evidence
for them.

## Records

A diagnosis leaves two tables in its evidence record.

The fact list:

| # | Fact | Instrument | Where and when | Checked |
| --- | --- | --- | --- | --- |

The cause table:

| Cause | Fact 1 | Fact 2 | Fact 3 | Left |
| --- | --- | --- | --- | --- |

## Worked example

The [record of the Cloudflare write pauses](evidence/refactor-155h-write-stalls.md)
used this method. Three of its sections show the steps:

- [How the facts were checked](evidence/refactor-155h-write-stalls.md#how-the-facts-were-checked):
  step 3. One reading was 0 by construction, because the clock inside a
  timer callback is the scheduled time. The record withdrew the claim that
  rested on it.
- [Candidate causes against the facts](evidence/refactor-155h-write-stalls.md#candidate-causes-against-the-facts):
  steps 5 and 6. Seven causes against ten facts; one coarse cause is left.
- [What the review changed](evidence/refactor-155h-write-stalls.md#what-the-review-changed):
  step 9. A reviewer broke four statements and weakened four more. Each
  objection was verified from the data before the record changed.

## Source

The method follows Cindy Sridharan,
[How to effectively debug when you no longer understand the code](https://copyconstruct.medium.com/how-to-effectively-debug-when-you-no-longer-understand-the-code-bd3dcb2c5f7b)
(October 2026). This page is a short procedure in our own words. Steps 3 and
10 come from our first use of the method.
