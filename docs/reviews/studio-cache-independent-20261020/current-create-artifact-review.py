#!/usr/bin/env python3
"""Read-only verification of the exact qualification-only native archive/profile."""
import ast, gzip, hashlib, importlib.util, io, json, subprocess, tarfile
from pathlib import Path

BASE = Path('/Users/ravonus/dev/wt/studio-publication-20261019')
SITE = BASE / 'keel-site'
PROFILE = SITE / 'docs/reviews/studio-publication-20261019/release/production-proof-factory/current-create'
ART = BASE / 'native-artifacts/native-create-candidate-20261020'
OUT = Path(__file__).parent
sha = lambda b: hashlib.sha256(b).hexdigest()
plan = json.loads((PROFILE / 'host-plan.json').read_bytes())
imp = json.loads((PROFILE / 'native-import-plan.json').read_bytes())
assert sha((PROFILE/'host-plan.json').read_bytes()) == '9c6a2edbdfd5f25cbcd371a154760506cc0e11bec5c976546e9ac5cc39ee819c'
assert sha((PROFILE/'native-import-plan.json').read_bytes()) == '827f05ae182484013886a668c7e4154974fdbfd332ffdf2e3c6dea99680d96cf'
sources = json.loads((PROFILE / 'local-staging-sources.json').read_bytes())
verified = {}
for key, name in sources.items():
    b = Path(name).read_bytes(); row = plan['files'][key]
    assert len(b) == row['bytes'] and sha(b) == row['sha256'], key
    verified[key] = {'bytes':len(b), 'sha256':sha(b)}
archive = (ART / 'keel-proof-runner.tar').read_bytes()
assert len(archive)==imp['native']['archiveBytes'] and sha(archive)==imp['native']['archiveSHA256']
blobs = {}; descriptors = []
with tarfile.open(fileobj=io.BytesIO(archive)) as t:
    for member in t.getmembers():
        if member.isfile() and member.name.startswith('blobs/sha256/'):
            b=t.extractfile(member).read(); assert sha(b)==member.name.split('/')[-1]
            blobs['sha256:'+sha(b)] = b
    index=json.loads(t.extractfile('index.json').read())
def walk(desc):
    b=blobs[desc['digest']]; assert len(b)==desc['size']
    descriptors.append(desc['digest'])
    if 'json' in desc['mediaType']:
        v=json.loads(b)
        for key in ('manifests','layers'):
            for d in v.get(key,[]): walk(d)
        if isinstance(v.get('config'),dict) and 'digest' in v['config']: walk(v['config'])
for d in index['manifests']: walk(d)
assert index['manifests'][0]['digest'] == imp['native']['index']
manifest=json.loads(blobs[imp['native']['manifest']])
assert manifest['config']['digest']==imp['native']['config']
config=json.loads(blobs[imp['native']['config']])
assert config['rootfs']['diff_ids']==imp['native']['rootFSLayers']
assert config['config']=={k:v for k,v in imp['native']['imageConfig'].items() if v is not None}
assert plan['images']['runner']['imageConfig']==imp['native']['imageConfig']
assert plan['images']['runner']['rootFSLayers']==config['rootfs']['diff_ids']
layer_results=[]; expanded=0; files={}
for desc, expected in zip(manifest['layers'],config['rootfs']['diff_ids'],strict=True):
    b=blobs[desc['digest']]
    raw=gzip.decompress(b) if b[:2]==b'\x1f\x8b' else b
    assert 'sha256:'+sha(raw)==expected
    with tarfile.open(fileobj=io.BytesIO(raw)) as t:
        members=t.getmembers()
        for m in members:
            expanded += ((m.size+4095)//4096)*4096 if m.isfile() else 4096
            if m.isfile(): files[m.name.lstrip('./')]=t.extractfile(m).read()
    layer_results.append({'digest':desc['digest'],'diffID':expected,'uncompressedTarBytes':len(raw),'entries':len(members)})
for name, expected in [('executor',plan['files']['executor']['sha256']),('runner','9936f4b8661b4a8b396b581f5e6152b37a442dfc04d56e1960c7f59687a1da26')]:
    assert sha(files[name])==expected, name
assert expanded<=imp['native']['expandedBytes']
inspect=json.loads((ART/'image-inspect.json').read_bytes())
if isinstance(inspect,list): inspect=inspect[0]
assert inspect['Id']==imp['native']['index'] and inspect['RootFS']['Layers']==config['rootfs']['diff_ids']
assert inspect['Config']==imp['native']['imageConfig']
spec=importlib.util.spec_from_file_location('review_host',PROFILE/'host-qualify.py'); host=importlib.util.module_from_spec(spec);spec.loader.exec_module(host)
class Docker:
    def request(self,*a,**kw): return inspect
assert host.image(Docker(),plan['images']['runner'])['Id']==inspect['Id']
old=json.loads(subprocess.check_output(['git','show','cb34e47485710ecc386ea1ed5f07257855a5b306:docs/reviews/studio-publication-20261019/release/production-proof-factory/current-create/host-plan.json'],cwd=SITE))
try: host.image(Docker(),old['images']['runner'])
except RuntimeError as e: assert str(e)=='image_layers_or_configuration'
else: raise AssertionError('original descriptor must reject actual null fields')
oldhost=PROFILE.parent/'current-cache/host-qualify.py'
defs=lambda p:{n.name:ast.dump(n,include_attributes=False) for n in ast.parse(p.read_text()).body if isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef))}
assert defs(PROFILE/'host-qualify.py')==defs(oldhost)
assert (PROFILE/'identity.mjs').read_bytes()==(PROFILE.parent/'current-cache/identity.mjs').read_bytes()
old_driver=(PROFILE.parent/'current64e/run-prerequisites.mjs').read_text()
old_driver=old_driver.replace('698495c9c645f412a059dd4467e2346d7f4dd96acaa2a7453c30ec9459250477',verified['sdkManifest']['sha256']).replace('8a2970e2cebc1f4b51bd228ab7fa53208e2d247030f46037991351115f12a3b5',verified['executor']['sha256'])
assert old_driver==(PROFILE/'run-prerequisites.mjs').read_text()
result={'schema':'independent-native-create-artifact-profile-review@1','result':'PASS','sourceFreeze':'a2a3fc18f8a0230732fa36fcca6943c392987586','hostPlanSHA256':sha((PROFILE/'host-plan.json').read_bytes()),'importPlanSHA256':sha((PROFILE/'native-import-plan.json').read_bytes()),'archive':{'bytes':len(archive),'sha256':sha(archive)},'blobCount':len(blobs),'descriptorVisits':len(descriptors),'layers':layer_results,'conservativeExpandedBytes':expanded,'expandedBudget':imp['native']['expandedBytes'],'requiredFreeBytes':imp['rollbackReserveBytes']+imp['metadataReserveBytes']+len(archive)+imp['native']['expandedBytes'],'sources':verified,'unchangedHostFunctionCount':len(defs(oldhost)),'identityUnchanged':True,'driverOnlyManifestAndExecutorPinsChanged':True,'originalDescriptorNegative':'image_layers_or_configuration','correctedDescriptorActualFixture':'PASS','runtimeExecutionPerformed':False,'hostActionPerformed':False}
(OUT/'current-create-artifact-profile-proof.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2))
