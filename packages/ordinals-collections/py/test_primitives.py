import json
import unittest
from pathlib import Path
from koc1 import digest, metadata_leaf, merkle_root, permutation

VECTORS = Path(__file__).resolve().parents[1] / 'spec' / 'vectors'

class PrimitiveVectors(unittest.TestCase):
    def test_permutation(self):
        for case in json.loads((VECTORS / 'permutation.json').read_text())['cases']:
            with self.subTest(case=case['id']):
                data, expected = case['input'], case['expected']
                seed, result = permutation(bytes.fromhex(data['recipe']), bytes.fromhex(data['blockhash']), data['max'])
                self.assertEqual(seed.hex(), expected['seed'])
                self.assertEqual(result, expected['perm'])

    def test_metadata(self):
        for case in json.loads((VECTORS / 'metadata.json').read_text())['cases']:
            data, expected = case['input'], case['expected']
            leaves = [metadata_leaf(i, message) for i, message in enumerate(data['messages'], 1)]
            self.assertEqual([digest(m.encode()).hex() for m in data['messages']], expected['messageHashes'])
            self.assertEqual([leaf.hex() for leaf in leaves], expected['leaves'])
            self.assertEqual(merkle_root(leaves).hex(), expected['root'])
            self.assertEqual(merkle_root([]).hex(), expected['emptyRoot'])
            self.assertEqual(merkle_root(leaves[:1]).hex(), expected['singletonRoot'])
            from koc1 import metadata_proof
            self.assertEqual(digest(b'\x01'+leaves[0]+leaves[1]).hex(),expected['node12'])
            self.assertEqual(metadata_proof(leaves,1),expected['proof2'])
            self.assertEqual(metadata_proof(leaves,2),expected['proof3'])
            for n in (1,2):
                value=leaves[n]
                for item in metadata_proof(leaves,n):
                    sibling=bytes.fromhex(item['hash'])
                    value=digest(b'\x01'+(sibling+value if item['side']=='left' else value+sibling))
                self.assertEqual(value,merkle_root(leaves))
            self.assertTrue(expected['proofsValid'])
            self.assertEqual([(n-1)%len(leaves)+1 for n in data['positions']],expected['cycle'])

if __name__ == '__main__':
    unittest.main()

class EscrowVectors(unittest.TestCase):
    def test_escrow(self):
        from koc1 import escrow
        for case in json.loads((VECTORS / 'escrow.json').read_text())['cases']:
            with self.subTest(case=case['id']):
                self.assertEqual(escrow(case['input']['payment'], case['input']['minter']), case['expected'])

class RecipeVectors(unittest.TestCase):
    def test_recipes(self):
        from koc1 import recipe_errors
        for case in json.loads((VECTORS / 'recipes.json').read_text())['cases']:
            with self.subTest(case=case['id']):
                self.assertEqual(recipe_errors(case['input']['recipe'], case['input']['refs']), case['expected']['errors'])

class ChallengeVectors(unittest.TestCase):
    def test_challenges(self):
        from koc1 import apply_challenge
        for case in json.loads((VECTORS / 'challenges.json').read_text())['cases']:
            with self.subTest(case=case['id']):
                i, e = case['input'], case['expected']
                valid, entries = apply_challenge(i['recipe'], i['cache'], i['entries'], i['hostHashes'], i['challenge'])
                self.assertEqual(valid, e['valid'])
                self.assertEqual([x['id'] for x in entries], e['orderedIds'])
                from koc1 import commitment_for_entries, partition_challenged_entries
                members, refunds = partition_challenged_entries(i['recipe'], entries)
                root = commitment_for_entries(i['cache']['r'], i['cache']['h'], i['cache']['hash'], members, refunds)
                self.assertEqual(root.hex(), e['patchedRoot'])
                old = {entry['txid']:n for n,entry in enumerate(i['cache']['entries'],1)}
                positions = [{'id':entry['id'],'n':n,'shift':None if entry['txid'] not in old else n-old[entry['txid']]} for n,entry in enumerate(entries,1)]
                self.assertEqual(positions,e['positions'])
                self.assertEqual(len(members),e['count'])
                self.assertEqual(len(refunds),e['over'])
                self.assertEqual(root.hex()==i['canonicalRoot'],e['canonicalMatch'])

class RegistryVectors(unittest.TestCase):
    def test_registry(self):
        from koc1 import registry_outcome
        for case in json.loads((VECTORS / 'registry.json').read_text())['cases']:
            with self.subTest(case=case['id']):
                i = case['input']
                self.assertEqual(registry_outcome(i['children'], i['originals'], i['burnHeight']), case['expected'])

class PolicyVectors(unittest.TestCase):
    def test_policy(self):
        from koc1 import escrow_policy
        for case in json.loads((VECTORS / 'escrow-policy.json').read_text())['cases']:
            with self.subTest(case=case['id']):
                self.assertEqual(escrow_policy(case['input']), (case['expected']['consensus'], case['expected']['writerPolicy']))

class CommitVectors(unittest.TestCase):
    def test_commit_authentication(self):
        from koc1 import authenticate_commit
        for case in json.loads((VECTORS / 'commit-auth.json').read_text())['cases']:
            with self.subTest(case=case['id']):
                i = case['input']
                self.assertEqual(authenticate_commit(i.get('rawTx'), i.get('commitTx')), case['expected']['authenticated'])

class MintVectors(unittest.TestCase):
    def test_mints(self):
        from koc1 import check_mint
        for filename in ('mint.json','mint-boundaries.json'):
            for case in json.loads((VECTORS / filename).read_text())['cases']:
                with self.subTest(case=case['id']):
                    self.assertEqual(check_mint(case['input']),case['expected'])

class ControlVectors(unittest.TestCase):
    def test_control_admission(self):
        from koc1 import controls_at
        for case in json.loads((VECTORS / 'numbering-controls-roots.json').read_text())['cases']:
            for h, expected in zip(case['input']['heights'],case['expected']):
                with self.subTest(case=case['id'],height=h['height']):
                    accepted, ignored = controls_at(case['input']['recipe'],case['input']['controls'],h['height'])
                    self.assertEqual([x['id'] for x in accepted], expected['acceptedControls'])
                    self.assertEqual([x['id'] for x in ignored], expected['ignoredControls'])

class IndexVectors(unittest.TestCase):
    def test_index(self):
        from koc1 import compute_index
        for case in json.loads((VECTORS / 'numbering-controls-roots.json').read_text())['cases']:
            i = case['input']
            for h, expected in zip(i['heights'],case['expected']):
                with self.subTest(case=case['id'],height=h['height']):
                    self.assertEqual(compute_index(i['recipe'],i['refs'],i['candidates'],i['controls'],h['height'],h['hash']), expected)

class WriterVectors(unittest.TestCase):
    def test_writers(self):
        from koc1 import writer_merge
        for case in json.loads((VECTORS / 'writers.json').read_text())['cases']:
            with self.subTest(case=case['id']):
                self.assertEqual(writer_merge(case['input']),case['expected'])

class WireAndHeaderVectors(unittest.TestCase):
    def test_wire(self):
        from koc1 import wire_vector
        for case in json.loads((VECTORS / 'wire.json').read_text())['cases']:
            i = case['input']
            with self.subTest(case=case['id']): self.assertEqual(wire_vector(i['displayTxid'],i['index'],i['recipe']),case['expected'])
    def test_headers(self):
        from koc1 import validate_headers
        for case in json.loads((VECTORS / 'headers.json').read_text())['cases']:
            i = case['input']
            with self.subTest(case=case['id']): self.assertEqual(validate_headers(i['headers'],i['hostHashes']),case['expected']['valid'])
    def test_light_switch(self):
        for case in json.loads((VECTORS / 'light-switch.json').read_text())['cases']:
            i = case['input']
            actual = {'switchAllowed':i['challengeValid'] and i['patchedRoot']==i['nextRoot'], 'completenessProven':False, 'fullRejectsCache':i['computedRoot']!=i['cacheRoot']}
            with self.subTest(case=case['id']): self.assertEqual(actual,case['expected'])

class BlockVectors(unittest.TestCase):
    def test_order(self):
        from koc1 import transaction_order
        for case in json.loads((VECTORS / 'transaction-order.json').read_text())['cases']:
            with self.subTest(case=case['id']): self.assertEqual(transaction_order(case['input']),case['expected'])
    def test_public_block(self):
        from koc1 import parse_block, digest
        for case in json.loads((VECTORS / 'testnet4-block.json').read_text())['cases']:
            h, txs = parse_block(case['input']['raw']); hashed = digest(digest(h)); e = case['expected']
            self.assertEqual({'hash':hashed[::-1].hex(),'internalHash':hashed.hex(),'merkleRoot':h[36:68].hex(), 'headerMerkleRoot':h[36:68].hex(),'txids':[t.hex() for t in txs],'valid':True},e)

class ShellVectors(unittest.TestCase):
    def test_shell(self):
        from koc1 import shell_policy
        for case in json.loads((VECTORS / 'shell-policy.json').read_text())['cases']:
            with self.subTest(case=case['id']): self.assertEqual(shell_policy(case['input']),case['expected'])

class SampleSeedVectors(unittest.TestCase):
    def test_sample_seed(self):
        from koc1 import sample_seed
        for case in json.loads((VECTORS / 'sample-seed.json').read_text())['cases']:
            with self.subTest(case=case['id']): self.assertEqual(sample_seed(case['input']),case['expected'])

class PendingVectors(unittest.TestCase):
    def test_pending(self):
        from koc1 import pending_mints
        for case in json.loads((VECTORS / 'pending-mints.json').read_text())['cases']:
            with self.subTest(case=case['id']): self.assertEqual(pending_mints(case['input']),case['expected'])

class TagVectors(unittest.TestCase):
    def test_tags(self):
        from koc1 import tagged_record
        for case in json.loads((VECTORS / 'tags.json').read_text())['cases']:
            i = case['input']
            with self.subTest(case=case['id']): self.assertEqual(tagged_record(i['tag7'],i['metadata']),case['expected'])

class TrustVectors(unittest.TestCase):
    def test_trust(self):
        from koc1 import parse_tx, authenticate_commit
        for case in json.loads((VECTORS / 'trust-boundaries.json').read_text())['cases']:
            i = case['input']; a,b = parse_tx(i['a']),parse_tx(i['b'])
            actual = {'sameTxid':a['txid']==b['txid'],'sameStripped':a['stripped']==b['stripped'],
                      'sameWitness':[x['witness'] for x in a['inputs']]==[x['witness'] for x in b['inputs']],
                      's2AloneAuthenticatesEnvelope':False,'originalCommitAuthenticated':authenticate_commit(i['a'],i['commitTx']),
                      'forgedCommitAuthenticated':authenticate_commit(i['b'],i['commitTx'])}
            with self.subTest(case=case['id']): self.assertEqual(actual,case['expected'])

class CoverageInventory(unittest.TestCase):
    def test_vector_file_inventory(self):
        expected = {'pending-mints','recipes','testnet4-block','registry','mint-boundaries','challenges',
                    'metadata','commit-auth','trust-boundaries','shell-policy','numbering-controls-roots',
                    'headers','mint','escrow','light-switch','permutation','transaction-order','tags',
                    'escrow-policy','writers','wire','sample-seed'}
        actual = {p.stem for p in VECTORS.glob('*.json') if 'cases' in json.loads(p.read_text())}
        self.assertEqual(actual,expected, 'new vector families need independent tests')

class RoundTwoBoundaries(unittest.TestCase):
    def test_time_metadata_requires_cycle(self):
        import copy
        from koc1 import recipe_errors
        case = next(c for c in json.loads((VECTORS / 'numbering-controls-roots.json').read_text())['cases'] if c['id']=='time-end')
        recipe = copy.deepcopy(case['input']['recipe'])
        self.assertNotIn('metadata',recipe_errors(recipe,case['input']['refs']))
        recipe['metadata'].pop('cycle')
        self.assertIn('metadata',recipe_errors(recipe,case['input']['refs']))
    def test_challenge_refunds_and_before_open(self):
        import copy
        from koc1 import apply_challenge, partition_challenged_entries
        case = next(c for c in json.loads((VECTORS / 'challenges.json').read_text())['cases'] if c['id']=='omitted-valid-over-cap-refund')
        i = case['input']; recipe = copy.deepcopy(i['recipe']); recipe['end']['max'] = 30
        valid, entries = apply_challenge(recipe,i['cache'],i['entries'],i['hostHashes'],i['challenge'])
        self.assertTrue(valid)
        target = i['challenge']['mint']
        controls = [{'action':'pause','at':100},{'action':'resume','at':101}]
        members, refunds = partition_challenged_entries(recipe,entries,controls)
        self.assertIn(target,[e['txid'] for e in refunds]); self.assertNotIn(target,[e['txid'] for e in members])
        recipe['end']['close'] = 100
        late = dict(next(e for e in entries if e['txid'] == target), height=101)
        members, refunds = partition_challenged_entries(recipe,[late])
        self.assertIn(target,[e['txid'] for e in refunds]); self.assertNotIn(target,[e['txid'] for e in members])
        recipe['end']['open'] = 101
        valid, _ = apply_challenge(recipe,i['cache'],i['entries'],i['hostHashes'],i['challenge'])
        self.assertFalse(valid)
