# Receipt-bound operator 0ee: blocked

No source, plan or release approval is granted. The exact operator and helper are bound by `review.json`.

1. `recover_runtime` restarts the old application after a replacement stop fails while the replacement remains running. The final verification occurs too late. The independent regression preserves the actual no-host RED trace.
2. `assert_pg_only` accepts added host capabilities/devices/inherited volumes. QA discovered this; an independent unchanged rerun confirms all three unsafe fields are accepted.

The existing 20 dependency controls and 13 maintained pure controls pass. These do not cover the two failing cases. The SQL startup fence itself has the appropriate ordering: packaged migrations finish before Studio/router start.

No production operation was performed. The pending plan remains deliberately invalid with all execution approvals false.
