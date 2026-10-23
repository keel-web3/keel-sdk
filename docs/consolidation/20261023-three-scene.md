# Older Three Scene reconciliation

The archive/three-scene-owner history is merged. Current multi-resource scene storage, manifest publication, token/presentation separation, native gas profiles, complete ABI catalogs and classified test entry point supersede its older implementations. The older Chainlink-dependent anchor helpers were previously removed from the active proof protocol; consolidation keeps that implementation in history and does not reinstate an oracle dependency.

The archive branch contributes the missing exact plan/job recovery binding to the current scene implementation, its negative test, and Cool S ABI conformance controls. Recovery now requires the exact planDigest; progress belonging to a different job is rejected. No signing or publication is performed. Generated ABIs must be synchronized with the final consolidated contracts.
