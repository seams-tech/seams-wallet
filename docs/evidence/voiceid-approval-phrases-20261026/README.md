# Approval prompts and selected Easter eggs

The current bank has 16 phrases of 4–6 words. Standard prompts use direct trading
and approval wording. The five user-selected Easter eggs are included; the rejected
moon, bags, ponzi, and fresh-quotes phrases are absent from the active bank.

The production Aurora matcher passed 16 matching challenges, 240 cross-phrase
rejections, and 12 rough/invalid speech cases. The added cases reject omitted,
changed, and added negation. A challenge containing “no” requires that negation;
the same matcher continues to reject negation added to a positive challenge.

The composed browser flow passed enrollment, VoiceID unlock, Arc signing,
cancellation, and NEAR signing. Speaker verification remains at 0.5. The tests use
synthetic speech, real inference and MPC, and deterministic chain RPC responses.
They do not establish human recognition accuracy or live-chain settlement.

The reports are unchanged Playwright outputs; the phrase matrix is compressed.
Regenerate the vocabulary/audio and run the two commands documented in
[the preceding trading-prompt evidence](../voiceid-trading-prompts-20261026/README.md).
The phrase generator README records the source of the DegenSpartan adaptations.
