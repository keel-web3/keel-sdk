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


class _Reader:
    def __init__(self, raw): self.raw, self.pos = raw, 0
    def take(self, n):
        if n < 0 or self.pos+n > len(self.raw): raise ValueError('truncated')
        out = self.raw[self.pos:self.pos+n]; self.pos += n; return out
    def integer(self, n): return int.from_bytes(self.take(n), 'little')
    def compact(self):
        n = self.integer(1)
        if n < 253: return n
        size = {253:2,254:4,255:8}[n]; value = self.integer(size)
        if value < {2:253,4:65536,8:4294967296}[size]: raise ValueError('noncanonical compact size')
        return value
    def blob(self): return self.take(self.compact())


def _varint(n):
    if n < 253: return bytes([n])
    if n < 65536: return b'\xfd'+n.to_bytes(2,'little')
    if n < 2**32: return b'\xfe'+n.to_bytes(4,'little')
    return b'\xff'+n.to_bytes(8,'little')


def parse_tx(raw):
    r = _Reader(bytes.fromhex(raw) if isinstance(raw,str) else raw)
    version = r.take(4); witness = r.raw[r.pos:r.pos+2] == b'\x00\x01'
    if witness: r.take(2)
    count = r.compact()
    if count == 0: raise ValueError('no inputs')
    inputs = []; stripped = version + _varint(count)
    for _ in range(count):
        prev = r.take(32); index = r.integer(4); script = r.blob(); sequence = r.take(4)
        stripped += prev+index.to_bytes(4,'little')+_varint(len(script))+script+sequence
        inputs.append({'prev':prev,'index':index,'script':script,'witness':[]})
    count = r.compact(); stripped += _varint(count); outputs = []
    for _ in range(count):
        value = r.integer(8); script = r.blob()
        stripped += value.to_bytes(8,'little')+_varint(len(script))+script
        outputs.append({'value':value,'script':script})
    if witness:
        for vin in inputs:
            vin['witness'] = [r.blob() for _ in range(r.compact())]
    stripped += r.take(4)
    if r.pos != len(r.raw): raise ValueError('trailing tx bytes')
    return {'inputs':inputs,'outputs':outputs,'txid':digest(digest(stripped))}


def authenticate_commit(reveal_raw, commit_raw):
    try:
        reveal, commit = parse_tx(reveal_raw), parse_tx(commit_raw)
        vin = reveal['inputs'][0]; stack = vin['witness'][:]
        if len(stack) >= 2 and stack[-1][:1] == b'\x50': stack.pop()
        if len(stack) < 2 or vin['prev'] != commit['txid'] or vin['index'] >= len(commit['outputs']): return False
        script, control = stack[-2:]
        if len(control) < 33 or (len(control)-33) % 32 or len(control) > 33+128*32 or control[0] & 0xfe != 0xc0: return False
        internal = control[1:33]; point = _lift(int.from_bytes(internal,'big'))
        root = _tag('TapLeaf',b'\xc0'+_compact(len(script))+script)
        for i in range(33,len(control),32): root = _branch(root,control[i:i+32])
        tweak = int.from_bytes(_tag('TapTweak',internal+root),'big')
        if tweak >= _N: return False
        point = _add(point,_mul(tweak,_G))
        return point is not None and point[1] % 2 == control[0] % 2 and commit['outputs'][vin['index']]['script'] == b'\x51\x20'+point[0].to_bytes(32,'big')
    except (ValueError,KeyError,IndexError,TypeError,OverflowError): return False


def _cbor(raw):
    reader = _Reader(raw)
    def item():
        head = reader.integer(1); major = head >> 5; n = head & 31
        if n >= 24:
            if n not in (24,25,26,27): raise ValueError('indefinite CBOR')
            n = int.from_bytes(reader.take({24:1,25:2,26:4,27:8}[n]),'big')
        if major == 0: return n
        if major == 1: return -1-n
        if major == 2: return reader.take(n)
        if major == 3: return reader.take(n).decode('utf8')
        if major == 4: return [item() for _ in range(n)]
        if major == 5:
            result = {}
            for _ in range(n):
                key = item()
                if key in result: raise ValueError('duplicate CBOR key')
                result[key] = item()
            return result
        if major == 7 and n in (20,21,22): return {20:False,21:True,22:None}[n]
        raise ValueError('unsupported CBOR')
    result = item()
    if reader.pos != len(raw): raise ValueError('trailing CBOR')
    return result


def _tokens(script):
    r = _Reader(script); result = []
    while r.pos < len(script):
        op = r.integer(1)
        if 1 <= op <= 75: data = r.take(op); minimal = True
        elif op == 76:
            size = r.integer(1); data = r.take(size); minimal = size >= 76
        elif op == 77:
            size = r.integer(2); data = r.take(size); minimal = size > 255
        elif op == 78:
            size = r.integer(4); data = r.take(size); minimal = size > 65535
        elif op == 0: data = b''; minimal = True
        else: data = None; minimal = True
        result.append((op,data,minimal))
    return result


def _envelopes(tx):
    found = []
    for vin, inp in enumerate(tx['inputs']):
        stack = inp['witness'][:]
        if len(stack) >= 2 and stack[-1][:1] == b'\x50': stack.pop()
        if len(stack) < 2: continue
        toks = _tokens(stack[-2]); i = 0
        while i+2 < len(toks):
            if toks[i][0] == 0 and toks[i+1][0] == 0x63 and toks[i+2][1] == b'ord':
                start = i+3; end = start
                while end < len(toks) and toks[end][0] != 0x68: end += 1
                if end < len(toks): found.append((vin,toks[start:end])); i = end
            i += 1
    return found


def _mint_fields(tokens):
    fields = {}; i = 0; body = False
    while i < len(tokens):
        op, tag, canonical = tokens[i]
        if op == 0:
            body = True; i += 1; break
        if tag is None or not canonical or not tag or tag[-1] == 0 or i+1 >= len(tokens): raise ValueError('tag')
        number = int.from_bytes(tag,'little'); val = tokens[i+1]
        if val[1] is None or not val[2] or len(val[1]) > 520 or number % 2 == 0 or (number in fields and number != 5): raise ValueError('field')
        fields.setdefault(number,[]).append(val[1]); i += 2
    if not body or i != len(tokens): raise ValueError('body')
    return fields


def check_mint(data):
    def ignored(reason): return {'status':'ignored','reason':reason}
    try:
        recipe = data['recipe']; tx = parse_tx(data['rawTx']); env = _envelopes(tx)
        if len(env) != 1: return ignored('envelope-count')
        if env[0][0] != 0: return ignored('envelope-input')
        try: fields = _mint_fields(env[0][1]); meta = _cbor(b''.join(fields[5]))
        except (ValueError,KeyError,TypeError,UnicodeDecodeError): return ignored('canonical-envelope')
        viewer = bytes.fromhex(recipe['art']['viewer']['id']); index = int.from_bytes(viewer[32:],'big')
        delegate = viewer[:32] + (index.to_bytes(4,'little').rstrip(b'\x00') if index else b'')
        if not isinstance(meta, dict): return ignored('tags')
        m = meta.get('m')
        if (fields.get(7) != [b'koc1'] or fields.get(11) != [delegate] or meta.get('p') != 'koc1' or meta.get('op') != 'mint'
            or meta.get('r') != bytes.fromhex(recipe['id']) or not isinstance(m,bytes) or len(m) != 32 or set(meta)-{'p','op','r','m','ch','seen'}): return ignored('tags')
        if recipe_errors(recipe,data['refs']): return ignored('recipe')
        if set(data.get('charms',[])) & {'cursed','unbound','reinscription'}: return ignored('charms')
        if not authenticate_commit(data['rawTx'],data.get('commitTx')): return ignored('commit-authentication')
        outputs = tx['outputs']; marker = bytes.fromhex('6a284b4f4331'+recipe['id'])
        if len(outputs) < 3 or outputs[2]['script'] != marker or outputs[2]['value'] != 0 or sum(o['script'].startswith(bytes.fromhex('6a284b4f4331')) for o in outputs) != 1: return ignored('marker')
        if outputs[0]['value'] < 330: return ignored('recipient')
        payment = recipe['payment']; target = bytes.fromhex(escrow(payment,m.hex())['scriptPubKey']) if payment['mode'] == 'escrow' else bytes.fromhex(payment['treasuryScript'])
        if outputs[1]['value'] < recipe['price'] or outputs[1]['script'] != target: return ignored('payment')
        height = data.get('height')
        if height is None: return {'status':'pending','position':None}
        end = recipe['end']
        if height < end['open'] or (end.get('close') is not None and height > end['close']): return {'status':'refund','reason':'window'}
        position = 1+data.get('earlierValid',0); cap = end.get('max')
        return {'status':'over-cap' if cap is not None and position > cap else 'member','position':position,'txid':tx['txid'].hex()}
    except (ValueError,KeyError,TypeError,IndexError,OverflowError): return ignored('malformed')


def controls_at(recipe, controls, tip):
    """Return authenticated controls in child order, before applying their heights."""
    accepted, ignored = [], []
    policy = recipe.get('controls'); sealed = False
    maximum = recipe['end'].get('max')
    for c in controls:
        if c.get('height', tip+1) > tip: continue
        action = c.get('action'); at = c.get('at'); allowed = {'id','p','op','r','parent','height','action','at'}
        if action == 'lowerCap': allowed.add('cap')
        good = (isinstance(policy,dict) and not sealed and c.get('p') == 'koc1' and c.get('op') == 'control'
                and c.get('r') == recipe['id'] and c.get('parent') == recipe['id'] and not set(c)-allowed
                and type(at) is int and type(c.get('height')) is int and at >= c['height']+policy.get('notice',0))
        if action in ('pause','resume'): good = good and policy.get('pausable') is True
        elif action == 'close': good = good and (recipe['end'].get('close') is None or at <= recipe['end']['close'])
        elif action == 'lowerCap': good = good and maximum is not None and type(c.get('cap')) is int and 0 < c['cap'] < maximum
        else: good = False
        if good:
            accepted.append(c)
            if action == 'close': sealed = True
        else: ignored.append(c)
    return accepted, ignored


def compute_index(recipe, refs, candidates, controls, height, blockhash):
    """Compute a complete index snapshot from independently checked reveals."""
    accepted, ignored = controls_at(recipe, controls, height)
    cap = recipe['end'].get('max'); close = recipe['end'].get('close'); sold = None
    for control in accepted:
        if control['action'] == 'close': close = min(close,control['at']) if close is not None else control['at']
    members, refunds, rejected = [], [], []
    pending = [c['id'] for c in candidates if c.get('height') is None]
    confirmed = sorted((c for c in candidates if c.get('height') is not None and c['height'] <= height), key=lambda c:(c['height'],c['txIndex']))
    byheight = {}
    for candidate in confirmed: byheight.setdefault(candidate['height'],[]).append(candidate)
    for h in sorted(set(byheight) | {c['at'] for c in accepted if c['at'] <= height}):
        active = [c for c in accepted if c['at'] <= h]
        paused = False
        for c in active:
            if c['action'] == 'pause': paused = True
            elif c['action'] == 'resume': paused = False
            elif c['action'] == 'close': close = min(close,c['at']) if close is not None else c['at']
        eligible = []
        for c in byheight.get(h,[]):
            data = dict(c,recipe=recipe,refs=refs); verdict = check_mint(data)
            if verdict['status'] == 'ignored': rejected.append({'id':c['id'],'reason':verdict['reason']}); continue
            if h < recipe['end']['open']:
                rejected.append({'id':c['id'],'reason':'before-open'}); continue
            tx = parse_tx(c['rawTx']); fields = _mint_fields(_envelopes(tx)[0][1]); meta = _cbor(b''.join(fields[5]))
            entry = dict(c, txid=tx['txid'].hex(), m=meta['m'].hex(), paymentOutpoint=(tx['txid']+u32(1)).hex())
            if (close is not None and h > close) or (sold is not None and h > sold): refunds.append((entry,'late'))
            elif paused: refunds.append((entry,'paused'))
            else: eligible.append(entry)
        for control in accepted:
            if control['action'] == 'lowerCap' and control['at'] == h and cap is not None and control['cap'] < cap:
                cap = min(cap,max(control['cap'],len(members)+len(eligible)))
        for entry in eligible:
            if cap is None or len(members) < cap: members.append(entry)
            else: refunds.append((entry,'over-cap'))
        if sold is None and cap is not None and len(members) >= cap: sold = h
    end = min(close,sold) if close is not None and sold is not None else close if sold is None else sold
    def root(es):
        return merkle_root([member_leaf(n,bytes.fromhex(e['txid']),e['height'],e['txIndex'],bytes.fromhex(e['m']),bytes.fromhex(e['paymentOutpoint'])) for n,e in enumerate(es,1)])
    mr,orr = root(members),root([e for e,_ in refunds])
    return {'count':len(members),'over':len(refunds),'cap':cap,'endHeight':end,'sold':sold,
            'members':[{'id':e['id'],'n':n} for n,e in enumerate(members,1)],
            'refund':[{'id':e['id'],'reason':reason} for e,reason in refunds], 'rejected':rejected,'pending':pending,
            'acceptedControls':[c['id'] for c in accepted], 'ignoredControls':[c['id'] for c in ignored],
            'membersRoot':mr.hex(),'overRoot':orr.hex(),
            'indexRoot':index_root(bytes.fromhex(recipe['id']),height,bytes.fromhex(blockhash),len(members),mr,orr).hex()}


def writer_merge(data):
    """Merge writer caches after entry and correction evidence has been verified by caller."""
    chains, states = [], []
    for wi, writer in enumerate(data['writers']):
        accepted, ignored, equivocations, history, applied = [], [], [], [], []
        working = []; prev = None; roots = {}; siblings = {}
        for update in writer['updates']:
            try:
                uid = update['id']; parent = update['prev']
                basic = (update['p']=='koc1' and update['op']=='index' and update['parent']==writer['authority']
                         and update['r']==data['recipe'] and data['hostHashes'].get(str(update['h']))==update['hash'])
                if not basic: raise ValueError()
                if parent in siblings:
                    equivocations.append([siblings[parent],uid]); raise ValueError()
                if parent != (prev['id'] if prev else None) or update['prevRoot'] != (prev['root'] if prev else None) or (prev and update['h'] < prev['h']): raise ValueError()
                new = update['new']; ids = [x['txid'] for x in history+new]
                if len(ids) != len(set(ids)) or any(x['height'] > update['h'] for x in new): raise ValueError()
                next_history = history+new; projection = list(next_history)
                next_applied = update['applied']
                if any(x not in next_applied for x in applied): raise ValueError()
                for cid in dict.fromkeys(next_applied):
                    correction = data['corrections'].get(cid)
                    if not correction or correction.get('valid') is not True: raise ValueError()
                    c = correction['challenge']; mint = c['mint']
                    if c['kind'] == 'omitted' and all(e['txid'] != mint for e in projection): projection.append(correction['entries'][mint])
                    elif c['kind'] == 'invalid': projection = [e for e in projection if e['txid'] != mint]
                    elif c['kind'] != 'order' and c['kind'] != 'omitted': raise ValueError()
                projection.sort(key=lambda e:(e['height'],e['txIndex']))
                cap = data['cap']; members = projection[:cap] if cap is not None else projection; over = projection[len(members):]
                if (update['count'] != len(members) or update['over'] != len(over) or commitment_for_entries(data['recipe'],update['h'],update['hash'],members,over).hex() != update['root']): raise ValueError()
                siblings[parent] = uid; accepted.append(uid); roots[uid] = update['root']; history = next_history; working = projection; applied = list(dict.fromkeys(next_applied)); prev = update
            except (ValueError,KeyError,TypeError,IndexError): ignored.append(update.get('id'))
        usable = all(pin['updateId'] in roots and roots[pin['updateId']] == pin['root'] for pin in data['pins'] if pin['writerIndex'] == wi)
        chains.append({'accepted':accepted,'ignored':ignored,'equivocations':equivocations,'usable':usable,'h':prev['h'] if usable and prev else None,'announced':[x['txid'] for x in history],'applied':applied})
        states.append(working if usable else [])
    heights = sorted((c['h'] for c in chains if c['h'] is not None),reverse=True)
    covered = heights[data['q']-1] if len(heights) >= data['q'] else None
    candidates = [e for state in states for e in state]
    for registry in data['registry']:
        if registry.get('usable'): candidates.extend(registry['entries'])
    for key in ('self','challenges','ch'): candidates.extend(data[key])
    unique = {}
    for e in candidates:
        if e.get('valid') is True: unique.setdefault(e['txid'],e)
    entries = sorted(unique.values(),key=lambda e:(e['height'],e['txIndex']))
    merged = [{'id':e['id'],'txid':e['txid'],'n':n,'settled':covered is not None and e['height'] <= covered,
               'final':covered is not None and e['height']+data['W'] <= covered and not data['unresolved']} for n,e in enumerate(entries,1)]
    return {'chains':chains,'merged':{'C':covered,'entries':merged}}
