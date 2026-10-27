# Natural speech diagnosis — 2026-10-25

The user reports about half of normal-paced attempts failing. One screenshot shows an uncertain phrase candidate, “let us go home now”, with a score gap of 7.7 against the shipped limit of 5. The screenshot does not show the original challenge phrase.

The speaker check passed for that attempt. Its threshold remains 0.5. No phrase threshold changed in this diagnostic patch.

The live UI now distinguishes an empty result, a confidently selected different phrase, and an uncertain phrase candidate. Browser-local diagnostics record the expected phrase, candidate, gap, and speaker similarity. Raw microphone audio is still discarded.

Re-evaluation of saved screening scores at cutoff 8 accepts two of 48 near misses. Both omit the article “a”. Cutoff 5 rejects all 48. No out-of-vocabulary sample in the saved CTC screen passes either cutoff. These synthetic development samples do not establish human error rates.

An exploratory tokenizer-lattice scorer accepted 62 of 64 in-list saved samples, equal to the canonical scorer. It was not integrated because it did not improve those cases.

The live-page browser E2E passed with real models and synthetic microphone speech. It verifies wrong-phrase rejection, enrollment, unlock, and signing against deterministic NEAR RPC. SDK build, SDK/test type checks, and bloat checks passed.
