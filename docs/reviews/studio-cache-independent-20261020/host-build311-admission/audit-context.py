from pathlib import Path,PurePosixPath
import hashlib,json,tarfile,gzip,collections,importlib.util
root=Path('/private/tmp/keel-image-only-release-20261020/docs/reviews/studio-publication-20261020/release/image-only311');out=Path('/private/tmp/keel-independent-host-build311-20261020');sha=lambda b:hashlib.sha256(b).hexdigest();canonical=lambda x:json.dumps(x,ensure_ascii=False,separators=(',',':'),allow_nan=False).encode()
plan=json.loads((root/'host-build-plan.proposed.json').read_bytes());assert sha((root/'host-build-plan.proposed.json').read_bytes())=='5174c328fe646976dbf123400c86ba8de66fabc64e1d36375d7e5e9ba4382afc'
context=Path('/private/tmp/keel-ui-mcp-image-build-20261020/delta-build-context.tar.gz');assert context.stat().st_size==plan['contextBytes'] and sha(context.read_bytes())==plan['contextSHA256']
raw=gzip.decompress(context.read_bytes());assert len(raw)==55767040 and sha(raw)=='08bea3a4a6b8011de215e996d50ef25379d44d292999c29ba96b4dd52cade826'
baseDoc=json.loads((root.parent/'image-only95/evidence/base95-app-tree-02.json').read_bytes());expectedDoc=json.loads((root/'evidence/expected-app-tree.json').read_bytes());provenance=json.loads((root/'evidence/delta-provenance.json').read_bytes());sdk=json.loads((root/'evidence/expected-installed-sdk.json').read_bytes())
for d in [baseDoc,expectedDoc]:assert sha(canonical(d['entries']))==d['sha256']
base={r[0]:r for r in baseDoc['entries']};expected={r[0]:r for r in expectedDoc['entries']};assert len(base)==len(baseDoc['entries']) and len(expected)==len(expectedDoc['entries'])==36064
assert expectedDoc['sha256']==provenance['resultTreeSHA256']=='345ea159bdf35662cfb79769546f570a41c9ed8426185fc846ea26c44720cf14'
spec=importlib.util.spec_from_file_location('review_delta',root/'prepare-delta.py');mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
scanner=(root/'scan-app.cjs').read_text().split('if(require.main===module')[0]
def assertion(digest):return scanner+"if(crypto.createHash('sha256').update(JSON.stringify(scan())).digest('hex')!=="+json.dumps(digest)+")throw Error('whole_app_tree_mismatch');"
deleted=provenance['deletedPaths'];changed=provenance['changedFiles'];assert len(deleted)==288 and len(changed)==1753 and len(set(deleted))==288 and len(set(changed))==1753
sdkChanges=set(sdk['changedExternalFiles']);assert len(sdkChanges)==4 and sdk['fileCount']==len(sdk['files'])==1360
for rel in changed:assert mod.managed(rel,provenance['distDirectory']) or rel in sdkChanges
for rel in deleted:assert mod.managed(rel,provenance['distDirectory']) and rel in base
for rel,row in sdk['files'].items():assert expected[rel]==row
for rel in sdkChanges:assert '/sdk/dist/studio-agent-drafts.' in rel and base[rel][6]!=expected[rel][6]
deletes=['/app/'+p for p in deleted]+['/app/'+p for p in changed if p in base and expected[p][1]!=base[p][1]];deletes=list(dict.fromkeys(deletes))
requiredDockerfile='FROM '+plan['expectedCurrent']['image']+'\nRUN '+json.dumps(['node','-e',assertion(baseDoc['sha256'])+'for(const p of '+json.dumps(deletes)+')fs.rmSync(p,{recursive:true,force:false});'])+'\nCOPY --chown=999:999 delta/ /\nRUN '+json.dumps(['node','-e',assertion(expectedDoc['sha256'])])+'\n'
result=dict(base)
for rel in deleted:
 for key in list(result):
  if key==rel or key.startswith(rel+'/'):del result[key]
files={};dirs={};names=set()
with tarfile.open(context,'r:gz') as t:
 for m in t.getmembers():
  assert m.name not in names and (m.isfile() or m.isdir()),(m.name,m.type)
  names.add(m.name);path=PurePosixPath(m.name);assert not path.is_absolute() and '..' not in path.parts and str(path)==m.name
  if m.name=='Dockerfile':assert m.isfile() and t.extractfile(m).read()==requiredDockerfile.encode();continue
  assert m.name in ('delta','delta/app') or m.name.startswith('delta/app/')
  if m.name=='delta':assert m.isdir();continue
  rel=m.name[len('delta/app/'): ] if m.name!='delta/app' else ''
  assert rel in expected,(m.name,'not_in_expected_full_tree')
  if m.isdir():row=[rel,'dir',m.mode,999,999,0,''];dirs[rel]=row
  else:
   data=t.extractfile(m).read();row=[rel,'file',m.mode,999,999,len(data),sha(data)];files[rel]=row
   assert rel in changed
  assert row==expected[rel],(m.name,'tar_COPY_metadata_or_content_mismatch')
  result[rel]=row
assert set(files)=={p for p in changed if expected[p][1]=='file'}
assert sorted(result.values(),key=lambda r:r[0])==expectedDoc['entries']
worker='web/apps/studio/keel-publisher.mjs';assert result[worker]==base[worker] and result[worker][6]=='b3315da1b279565a4534b5e52c086f018ec75af449c28c4294401213ad8bbae8'
assert sum(r[5] for r in files.values())==51997532
budget=plan['budget'];assert sum(v for k,v in budget.items() if k not in ('requiredInitialFreeBytes','freshObservedFreeBytes'))==plan['requiredInitialFreeBytes']==1644635064
assert budget['rollbackReserveBytes']==1073741824 and budget['snapshotReserveBytes']==268435456 and budget['unpackedContextPlusExpandedLayerPlusContentStoreCopies']==3*56176640
report={'contextSHA256':plan['contextSHA256'],'compressedBytes':context.stat().st_size,'rawTarBytes':len(raw),'tarMembers':len(names),'regularPayloadFiles':len(files),'directoryCOPYEntries':len(dirs),'changedEntries':len(changed),'deletedEntries':len(deleted),'regularPayloadBytes':sum(r[5] for r in files.values()),'completePredictedAppEntries':len(result),'completePredictedAppTreeSHA256':expectedDoc['sha256'],'allTarCOPYMetadataAndBytesMatchExpected':True,'DockerfileExactlyFourReviewedInstructions':True,'deletionsOnlyManagedAppPaths':True,'exact1360InstalledSDKWithOnly4ReviewedClientChanges':True,'pausedWorkerExact':True,'reservesAndThreeCopiesRecomputed':True,'hostOrDockerActions':0}
(out/'context-audit.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
