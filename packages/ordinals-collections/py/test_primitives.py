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
