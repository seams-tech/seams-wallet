# Visible failure diagnostics — 2026-10-26

The user reported 7 successful attempts and 4 failed attempts out of 11. This is
about 64% reported success and does not establish stable recognition. The supplied
screenshots showed ready, listening, and retry screens with diagnostics collapsed.
They do not expose the failed scores or reliably identify the attempted sentence:
the retry headline already contains the next sentence.

Speaker and phrase failure details now open automatically. They identify the
actual attempted sentence separately from the next phrase. Normal ready/listening
states still hide details. Models, thresholds, capture, and enrollment are unchanged.

The live-page browser contract passed (1 test, 1.5 minutes). It verifies that the
rejection keeps the wallet locked, automatically exposes details, preserves the
attempted sentence, and permits a new explicit retry before reviewed signing.
Artifacts use synthetic microphone input and deterministic NEAR RPC. They do not
explain the user's live failures or establish a new live success rate.

SDK build, SDK/intended-test type checks, and the bloat check passed. The remaining
required evidence is one live failure with the expanded diagnostic text visible.
No further batch, threshold change, or re-enrollment is requested.
