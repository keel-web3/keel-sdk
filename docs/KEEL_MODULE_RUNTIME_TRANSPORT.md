# Module package transport

New executable module catalog packages default to **Brotli then Base90**.
`prepareKeelModuleRuntime` records the chosen representation once, validates its
exact replay and retains uncompressed bytes when Brotli does not save space.
The public catalog is script-safe JSON; HTML and data-URI use requires the
additional escaping for each parser boundary. The prepared verification shell
defaults to the compact Brotli/Base90 decoder with gzip/Base64 shell boot.

Each `runtime` record reports `encoding`, `transportProfile`, `compression`,
`encryption`, stored integrity and decoded integrity. Open reusable modules say
`encryption: "none"`; encoding and compression do not conceal them. The module
output digest continues to identify the exact executable bytes, independently
of the package representation. `decodeKeelModuleRuntime` verifies compressed
bytes before bounded decompression and the exact output afterwards. Unsupported
encryption or codec declarations fail rather than executing guessed bytes.

Explicit older catalog records remain readable. Existing deployed modules and
minted prepared fragments retain their codecs, carriages, object IDs and proof
commitments. New package preparation is not evidence that a matching shell or
reader has been registered on Sepolia.

Protected content uses the existing AES-256-GCM symmetric sealed layer, with a
random 256-bit content key. Its description reports the cipher, compression,
key-wrapping and derivation algorithms without exposing secrets or claiming
password entropy. See [the sealed-content threat model](SEALED_CONTENT.md).
The existing sealed envelope reports its own actual internal codec separately
from the outer Base90 package; it is not relabeled as internally Brotli.

Deploy the updated Studio catalog parser and byte-verified readers before
switching the public catalog to Base90 records. Older deployed Studio parsers
accept only Base64 runtime records. The new module catalog stays on the refresh
branch until that consumer migration is verified. Source/build verification,
consumer deployment and chain publication remain separate gates.
