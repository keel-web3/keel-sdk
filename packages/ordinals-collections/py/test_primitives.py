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
                from koc1 import commitment_for_entries
                cap = i['recipe']['end']['max']
                root = commitment_for_entries(i['cache']['r'], i['cache']['h'], i['cache']['hash'], entries[:cap], entries[cap:])
                self.assertEqual(root.hex(), e['patchedRoot'])

class RegistryVectors(unittest.TestCase):
    def test_registry(self):
        from koc1 import registry_additions
        for case in json.loads((VECTORS / 'registry.json').read_text())['cases']:
            with self.subTest(case=case['id']):
                i = case['input']
                self.assertEqual(registry_additions(i['children'], i['originals'], i['burnHeight']), case['expected']['accepted'])

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
