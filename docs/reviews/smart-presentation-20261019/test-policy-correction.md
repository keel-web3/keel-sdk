# Old product-policy assertion correction

Production/source candidate: `af422159e589b424f67313771bc9282e9944fe69`, based on SDK `3d382e90`. This separate test-only change awaits independent review before qualification.

The user explicitly replaced the old image policy. The exact existing decimal small-asset threshold is 500,000 bytes, intermediate native media should recommend direct display, and source sizes above the separate 2,000,000-byte threshold should recommend the verification shell with split reads. Hosted previews must be an explicit choice. SVG may contain scripts and cannot be declared static from its MIME string alone. These changes supersede old assertions for a 1,000,000-byte no-shell boundary, automatic hosted delivery at 500,000 bytes, and MIME-only SVG direct display.

`old-policy-assertions-red.log` preserves the unchanged old suite at source af42215: five passing tests, three failing tests. The correction retains all original fixture bytes, source IDs, delivery overrides, integrity/read-plan mismatch assertions and hard-limit assertions. Boundary coverage expands to 499999/500000/500001 and 1999999-equivalent intermediate cases/2000000/2000001. The removed MIME-only SVG expectation is replaced by stronger positive/negative assertions: unknown SVG keeps verification, while an explicit direct slot remains exactly selected. No failing behavior is hidden behind a tolerance or a replaced reference asset.

The SDK staging test initially exposed another issue: an explicit old mediaSlots choice must override the new recommendation. Source af42215 fixes that and the unchanged original staging test now passes; its fixture and assertions were not modified.

The legacy `assertKeelMediaSlotReadFit` 2 MB default remains unchanged in this correction. A permissive caller max alone must not raise it. The separate explicit qualified nonstandard-read policy is owned by the RPC specialist and must be integrated before a larger return can pass that funding guard. Matrix compatibility warnings themselves never authorize funding or prove a live deployment.
