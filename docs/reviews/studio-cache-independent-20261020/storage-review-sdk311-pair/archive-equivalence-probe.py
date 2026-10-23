from pathlib import Path
import json,hashlib,tarfile,subprocess
sdk=Path('/Users/ravonus/dev/wt/studio-storage-review-compat-20261020/keel-sdk');site=Path('/private/tmp/keel-studio-live-flow-integration-20261020');out=Path('/private/tmp/keel-independent-storage311-20261020');sha=lambda x:hashlib.sha256(x).hexdigest()
base=json.loads((sdk/'docs/reviews/studio-publication-20261020/storage-review-compatibility/inherited-dist-sha256.json').read_text())
now={str(p.relative_to(sdk)):sha(p.read_bytes()) for p in sdk.glob('packages/*/dist/**/*') if p.is_file()}
assert set(base)==set(now)
changed={p:{'before':base[p],'after':now[p]} for p in now if base[p]!=now[p]}
expected={'packages/mcp/dist/tools.js','packages/mcp/dist/tools.js.map','packages/sdk/dist/studio-agent-drafts.d.ts','packages/sdk/dist/studio-agent-drafts.d.ts.map','packages/sdk/dist/studio-agent-drafts.js','packages/sdk/dist/studio-agent-drafts.js.map'}
assert set(changed)==expected
packages=json.loads(Path('/private/tmp/keel-storage-review-compat-20261020/package-manifest.json').read_text())
checks=[]
for x in packages['packages']:
 p=Path(x['file']);assert p.stat().st_size==x['bytes'] and sha(p.read_bytes())==x['sha256']
 packageFolder=sdk/'packages'/x['name'].removeprefix('@keel/')
 count=0
 with tarfile.open(p,'r:gz') as t:
  seen=set()
  for m in t.getmembers():
   assert m.name not in seen and (m.isdir() or m.isfile()),(x['name'],m.name,'duplicate_or_nonregular')
   seen.add(m.name)
   assert m.name.startswith('package/') and '..' not in Path(m.name).parts
   if m.isfile():
    data=t.extractfile(m).read();actual=packageFolder/Path(m.name).relative_to('package')
    if m.name=='package/LICENSE' and not actual.exists():
     assert not actual.is_symlink()
     assert data==subprocess.check_output(['git','-C',str(sdk),'show',packages['sdkSource']+':LICENSE'])
    elif m.name=='package/package.json':
     assert actual.is_file(),(x['name'],m.name)
     frozen=subprocess.check_output(['git','-C',str(sdk),'show',packages['sdkSource']+':'+str(actual.relative_to(sdk))])
     assert actual.read_bytes()==frozen
     expectedMetadata=json.loads(frozen)
     for dependency,spec in expectedMetadata.get('dependencies',{}).items():
      if spec=='workspace:*':
       assert dependency.startswith('@keel/') and '/' not in dependency.removeprefix('@keel/')
       dependencyPath='packages/'+dependency.removeprefix('@keel/')+'/package.json'
       target=json.loads(subprocess.check_output(['git','-C',str(sdk),'show',packages['sdkSource']+':'+dependencyPath]))
       assert target['name']==dependency and isinstance(target['version'],str)
       expectedMetadata['dependencies'][dependency]=target['version']
     assert json.loads(data)==expectedMetadata,(x['name'],m.name)
    else:
     assert actual.is_file() and actual.read_bytes()==data,(x['name'],m.name)
    if m.name.startswith('package/dist/'):count+=1
 assert count==x['distFileCount']
 checks.append({'package':x['name'],'sha256':x['sha256'],'bytes':x['bytes'],'distMembers':count,'nonMetadataMembersByteExactIncludingOnlyFrozenRootLICENSEFallback':True,'archiveNamesUniqueAndTypesRegularOrDirectory':True,'packageMetadataExactExceptFrozenWorkspaceVersions':True})
new=(sdk/'packages/sdk/src/studio-agent-drafts.ts').read_text();old=subprocess.check_output(['git','-C',str(sdk),'show','fb90011f1ce0ef4dc0883378ffbed39522b1cbfe:packages/sdk/src/studio-agent-drafts.ts'],text=True)
start='  const checkedReview = ';end='  const reviewIdentity = '
assert new[new.index(start):new.index(end)]==old[old.index(start):old.index(end)]
start='  const resumeReview: ';end='  const storageReview = '
assert new[new.index(start):new.index(end)]==old[old.index(start):old.index(end)]
raw=json.loads((site/'apps/studio/public/.well-known/keel.json').read_text());baseline=json.loads(subprocess.check_output(['git','-C',str(site),'show','e61e40162b5b439727d31f3c6b6f56be81603404:apps/studio/public/.well-known/keel.json']))
assert raw['networks']==baseline['networks'];assert raw['sdk']['creatorReleaseRevision']==packages['sdkSource'];assert raw['sdk']['accessRelease']==baseline['sdk']['accessRelease']
paths=[]
for p in json.loads((site/'docs/reviews/studio-publication-20261020/lead/discovery-sdk311/validation.json').read_text())['sourcePathsExist']:
 subprocess.run(['git','-C',str(sdk),'cat-file','-e',packages['sdkSource']+':'+p],check=True);paths.append(p)
result={'sdkSource':packages['sdkSource'],'emittedFiles':len(now),'unchanged':len(now)-len(changed),'changed':changed,'tarPackages':checks,'oldCollectionValidatorByteExact':True,'oldResumeReadCaptureBlockByteExact':True,'discovery':{'currentSourcePin':raw['sdk']['creatorReleaseRevision'],'immutableDocPathsExist':paths,'networksEntireObjectUnchanged':True,'historicalAccessReleaseUnchanged':raw['sdk']['accessRelease'],'sourceApprovalDoesNotClaimRemotePublication':True}}
(out/'artifact-and-source-equivalence.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'files':len(now),'unchanged':len(now)-len(changed),'changed':len(changed),'allSixTarsVerified':True,'discoverySourceTargets':len(paths),'resultSHA256':sha((out/'artifact-and-source-equivalence.json').read_bytes())}))
