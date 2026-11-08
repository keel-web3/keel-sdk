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

# BIP341 operations, implemented locally so this verifier has no crypto dependency.
_P = 2**256 - 2**32 - 977
_N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141
_G = (0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798,
      0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8)
_H = bytes.fromhex('50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0')


def _lift(x):
    if x >= _P:
        raise ValueError('invalid x-only key')
    y = pow((x*x*x + 7) % _P, (_P + 1)//4, _P)
    if (y*y - x*x*x - 7) % _P:
        raise ValueError('invalid x-only key')
    return x, y if y % 2 == 0 else _P-y


def _add(a, b):
    if a is None: return b
    if b is None: return a
    x, y = a; z, w = b
    if x == z and (y + w) % _P == 0: return None
    slope = ((3*x*x)*pow(2*y, -1, _P) if a == b else (w-y)*pow((z-x) % _P, -1, _P)) % _P
    nx = (slope*slope-x-z) % _P
    return nx, (slope*(x-nx)-y) % _P


def _mul(n, point):
    result = None
    while n:
        if n & 1: result = _add(result, point)
        point = _add(point, point)
        n >>= 1
    return result


def _tag(tag, data):
    h = digest(tag.encode())
    return digest(h+h+data)


def _compact(n):
    if n < 253: return bytes([n])
    if n <= 65535: return b'\xfd'+n.to_bytes(2, 'little')
    raise ValueError('script too long')


def _number(n):
    if n == 0: return b'\x00'
    if n <= 16: return bytes([0x50+n])
    v = n.to_bytes((n.bit_length()+7)//8, 'little')
    if v[-1] & 128: v += b'\x00'
    return bytes([len(v)]) + v


def _branch(a,b):
    return _tag('TapBranch', min(a,b)+max(a,b))


def _address(key):
    values = [1]; acc = bits = 0
    for byte in key:
        acc = (acc << 8) | byte; bits += 8
        while bits >= 5:
            bits -= 5; values.append((acc >> bits) & 31)
    if bits: values.append((acc << (5-bits)) & 31)
    polymod = 1
    for v in [ord('t') >> 5, ord('b') >> 5, 0, ord('t') & 31, ord('b') & 31] + values + [0]*6:
        top = polymod >> 25; polymod = ((polymod & 0x1ffffff) << 5) ^ v
        for i, gen in enumerate((0x3b6a57b2,0x26508e6d,0x1ea119fa,0x3d4233dd,0x2a1462b3)):
            if (top >> i) & 1: polymod ^= gen
    polymod ^= 0x2bc830a3
    alphabet = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'
    return 'tb1' + ''.join(alphabet[v] for v in values + [(polymod >> (5*(5-i))) & 31 for i in range(6)])


def escrow(payment, minter):
    keys = [bytes.fromhex(x) for x in payment['writerKeys']]
    treasury, m = bytes.fromhex(payment['treasuryKey']), bytes.fromhex(minter)
    for k in keys + [treasury, m]:
        if len(k) != 32: raise ValueError('invalid key length')
        _lift(int.from_bytes(k, 'big'))
    if len(keys) != 3 or len(set(keys)) != 3: raise ValueError('invalid writers')
    suffix = b'\x20'+keys[0]+b'\xac\x20'+keys[1]+b'\xba\x20'+keys[2]+b'\xba\x52\x9c'
    scripts = {'L_t': _number(payment['collectAfter'])+b'\xb2\x75\x20'+treasury+b'\xad'+suffix,
               'L_m': _number(payment['refundAfter'])+b'\xb2\x75\x20'+m+b'\xac'}
    if payment['earlyRefund']: scripts['L_e'] = b'\x20'+m+b'\xad'+suffix
    leaves = {k:_tag('TapLeaf',b'\xc0'+_compact(len(v))+v) for k,v in scripts.items()}
    t, m_leaf = leaves['L_t'], leaves['L_m']
    if 'L_e' in leaves:
        e = leaves['L_e']; inner = _branch(m_leaf,e); root = _branch(t,inner)
        paths = {'L_t':inner, 'L_m':e+t, 'L_e':m_leaf+t}
    else:
        root = _branch(t,m_leaf); paths = {'L_t':m_leaf, 'L_m':t}
    tweak = int.from_bytes(_tag('TapTweak',_H+root),'big')
    if tweak >= _N: raise ValueError('invalid tweak')
    point = _add(_lift(int.from_bytes(_H,'big')), _mul(tweak,_G))
    if point is None: raise ValueError('invalid output key')
    key = point[0].to_bytes(32,'big')
    return {'scripts':{k:v.hex() for k,v in scripts.items()}, 'leaves':{k:v.hex() for k,v in leaves.items()},
            'root':root.hex(), 'outputKey':key.hex(), 'scriptPubKey':(b'\x51\x20'+key).hex(),
            'address':_address(key), 'controlBlocks':{k:(bytes([0xc0 | (point[1]&1)])+_H+v).hex() for k,v in paths.items()}}


def recipe_errors(r, refs):
    """Validate recipe-level constraints and references, returning vector categories."""
    errors = []
    def add(name):
        if name not in errors: errors.append(name)
    if (r.get('p'), r.get('op'), r.get('v'), r.get('network')) != ('koc1','recipe',1,'testnet4'):
        add('identity')
    end = r.get('end', {}); mode = end.get('mode'); maximum = end.get('max'); close = end.get('close'); opening = end.get('open')
    uint = lambda x: type(x) is int and 0 <= x <= 0xffffffff
    if (mode not in ('supply','time','first','open') or not uint(opening)
        or (mode in ('supply','first') and (not uint(maximum) or not maximum))
        or (mode in ('time','first') and not uint(close))
        or (mode == 'open' and maximum is not None)
        or (close is not None and (not uint(close) or close < opening))): add('end')
    if uint(opening) and (not uint(r.get('height')) or r['height'] >= opening): add('recipe-height')
    writers = r.get('writers', []); authorities = [w.get('authority') for w in writers]; q = r.get('quorum')
    if not uint(q) or not 2 <= q <= len(writers) or len(set(authorities)) != len(authorities): add('writers')
    pay = r.get('payment', {})
    if pay.get('mode') == 'escrow':
        try:
            keys = pay['writerKeys']; collect = pay['collectAfter']; refund = pay['refundAfter']
            if len(keys) != 3 or len(set(keys)) != 3 or not (uint(collect) and uint(refund) and 1 <= collect <= 65535 and collect >= r['challengeWindow'] and collect < refund <= 65535): raise ValueError()
            for key in keys + [pay['treasuryKey']]:
                raw = bytes.fromhex(key)
                if len(raw) != 32: raise ValueError()
                _lift(int.from_bytes(raw,'big'))
        except (ValueError, KeyError, TypeError): add('escrow')
    metadata = r.get('metadata', {}); bundles = metadata.get('bundles', [])
    if metadata.get('mode') == 'merkle':
        if (mode == 'open' and not metadata.get('cycle')) or (metadata.get('order') == 'blind' and mode == 'open'): add('metadata')
        count = metadata.get('count', 0)
        if not uint(count) or not count or (maximum is not None and count < maximum and not metadata.get('cycle')): add('metadata')
        cursor = 1
        for b in sorted(bundles, key=lambda b:b.get('from',0)):
            if b.get('from') != cursor or not uint(b.get('to')) or b['to'] < cursor:
                add('bundle-range'); break
            cursor = b['to'] + 1
        if cursor != count + 1: add('bundle-range')
    for ref in bundles + [r.get('art',{}).get('viewer',{}), r.get('indexer',{})]:
        try:
            actual = refs[ref['id']]; height = actual['height']
            if height > r['height'] or (height == r['height'] and actual.get('txIndex',float('inf')) >= r.get('txIndex',-1)) or digest(bytes.fromhex(actual['bytes'])).hex() != ref['sha256']:
                add('reference')
        except (KeyError, ValueError, TypeError): add('reference')
    return errors


def bitcoin_proof(proof, host_hashes):
    try:
        header = bytes.fromhex(proof['header']); tx = bytes.fromhex(proof['mint'])
        n, i = proof['total'], proof['txIndex']
        if len(header) != 80 or len(tx) != 32 or not 0 <= i < n or digest(digest(header)).hex() != host_hashes[str(proof['height'])]: return False
        siblings = iter(proof['branch'])
        while n > 1:
            sibling = bytes.fromhex(next(siblings))
            if len(sibling) != 32 or (i == n-1 and n % 2 and sibling != tx): return False
            tx = digest(digest(sibling+tx if i & 1 else tx+sibling))
            i //= 2; n = (n+1)//2
        return next(siblings, None) is None and tx == header[36:68]
    except (KeyError, ValueError, TypeError, StopIteration): return False


def apply_challenge(recipe, cache, entries, hosts, challenge):
    """Apply one challenge using independently authenticated entry facts.

    `entries` must be supplied by a caller that verified transaction form; missing
    facts never establish invalidity. Returns validity and the patched ordered set.
    """
    result = list(cache['entries']); c = challenge
    if c.get('p') != 'koc1' or c.get('op') != 'challenge' or c.get('r') != cache['r'] or c.get('index') != cache['id']:
        return False, result
    position = next((i for i,e in enumerate(result) if e['txid'] == c.get('mint')), None)
    fact = entries.get(c.get('mint')); proof = bitcoin_proof(c, hosts)
    valid = False
    if c.get('kind') == 'omitted':
        valid = (position is None and fact is not None and fact.get('valid') is True and proof
                 and c['height'] <= cache['h'] and (fact['height'],fact['txIndex']) == (c['height'],c['txIndex']))
        if valid: result.append(fact)
    elif c.get('kind') == 'invalid' and position is not None and fact is not None:
        actual = result[position]
        valid = fact.get('valid') is False or (proof and (actual['height'],actual['txIndex']) != (c['height'],c['txIndex']))
        if valid: result.pop(position)
    elif c.get('kind') == 'order' and position is not None:
        other = c.get('other', {}); other_pos = next((i for i,e in enumerate(result) if e['txid'] == other.get('mint')), None)
        valid = (other_pos is not None and proof and bitcoin_proof(other, hosts)
                 and position < other_pos and (c['height'],c['txIndex']) > (other['height'],other['txIndex']))
    if valid: result.sort(key=lambda e:(e['height'],e['txIndex']))
    return valid, result


def commitment_for_entries(recipe, height, blockhash, members, refunds):
    def tree(entries):
        return merkle_root([member_leaf(n, bytes.fromhex(e['txid']), e['height'], e['txIndex'],
                                       bytes.fromhex(e['m']), bytes.fromhex(e['paymentOutpoint']))
                            for n,e in enumerate(entries,1)])
    return index_root(bytes.fromhex(recipe), height, bytes.fromhex(blockhash), len(members), tree(members), tree(refunds))


def registry_additions(children, originals, burn_height=None):
    seen = set(originals); result = []
    for child in children:
        a = child.get('authority')
        if (child.get('authorized') is not True or child.get('p') != 'koc1' or child.get('op') != 'writer'
            or not isinstance(a,str) or len(a) != 72 or a in seen
            or (burn_height is not None and child.get('height', burn_height+1) > burn_height)):
            continue
        try: bytes.fromhex(a)
        except ValueError: continue
        seen.add(a); result.append(a)
        if len(result) == 16: break
    return result


def escrow_policy(data):
    p = data['payment']; signers = set(data['signers']); path = data['path']
    writers = len(signers & {'w1','w2','w3'}) == 2
    seq = data['sequence']; delta = data['spendHeight'] - data['height']
    def csv(delay):
        return data['version'] >= 2 and not (seq & (1<<31)) and not (seq & (1<<22)) and (seq & 0xffff) >= delay and delta >= (seq & 0xffff)
    if path == 'L_t':
        consensus = csv(p['collectAfter']) and 'treasury' in signers and writers
        policy = data['member'] and data['settled'] and data['depth'] >= data['W'] and not data['unresolved']
    elif path == 'L_m':
        consensus = csv(p['refundAfter']) and 'buyer' in signers
        policy = True
    elif path == 'L_e':
        consensus = p['earlyRefund'] and 'buyer' in signers and writers
        policy = consensus and not data['member'] and data['settled'] and not data['unresolved']
    else: return False, False
    return consensus, policy
