# Preserved cloud import facades

The SDK retains packages/game-engine as a bridge to the extracted engine. After fixing its absent-exports handling, the normal link-engine feature generator reproduced all 17 cloud forwarding files byte-for-byte against the current explicit local engine checkout. They are now integrated in the bridge source as well as preserved here. No engine lock or production release pin was changed. Optional feature imports still require an engine that exports those features.
