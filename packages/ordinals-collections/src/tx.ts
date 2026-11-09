export { parseTx, parseBlock, authenticateCommit } from "./core.ts";
export { unsignedPsbt, taprootSighash, signTransaction, xOnly, keyOutput, buildKeySpend, buildCancel, bumpRbf, buildCpfp } from './builders.ts';

import { serializeTx as serialize } from "./core.ts";
export const serializeTx = (...args) => Buffer.from(serialize(...args));
