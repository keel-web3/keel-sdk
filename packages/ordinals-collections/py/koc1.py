"""Independent KOC1 v1 byte primitives; this is not a complete verifier."""
from hashlib import sha256


def digest(data):
    return sha256(data).digest()


def u32(n):
    return n.to_bytes(4, 'big')


def metadata_leaf(number, message):
    return digest(b'\x00KOC1' + u32(number) + digest(message.encode('utf-8')))


def merkle_root(leaves):
    level = list(leaves)
    if not level:
        return bytes(32)
    while len(level) > 1:
        level = [digest(b'\x01' + level[i] + level[i + 1])
                 if i + 1 < len(level) else level[i]
                 for i in range(0, len(level), 2)]
    return level[0]


def permutation(recipe, blockhash, maximum):
    seed = digest(b'KOC1/perm' + recipe + blockhash)
    result = list(range(1, maximum + 1))
    for i in range(maximum - 1, 0, -1):
        j = int.from_bytes(digest(seed + u32(i)), 'big') % (i + 1)
        result[i], result[j] = result[j], result[i]
    return seed, result


def member_leaf(number, txid, height, tx_index, minter, payment):
    return digest(b'KOC1/m' + u32(number) + txid + u32(height)
                  + u32(tx_index) + minter + payment)


def index_root(recipe, height, blockhash, count, members_root, over_root):
    return digest(b'KOC1/i' + recipe + u32(height) + blockhash + u32(count)
                  + members_root + over_root)
