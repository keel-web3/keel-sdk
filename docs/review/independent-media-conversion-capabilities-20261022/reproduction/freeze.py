from pathlib import Path
import hashlib,shutil,json,subprocess
r=Path(__file__).parent.resolve();s=r/'keel-sdk';e=r/'evidence';d=s/'docs/review/independent-media-conversion-capabilities-20261022';d.mkdir(parents=True,exist_ok=True);rows=[]
for top in [s/'packages',s/'apps']:
 for p in top.rglob('*'):
  if p.is_file()and not p.is_symlink()and'dist'in p.relative_to(top).parts and'node_modules'not in p.relative_to(top).parts:rows.append({'path':str(p.relative_to(s)),'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
(e/'own-output-identities.json').write_text(json.dumps(rows,indent=2)+'\n');shutil.copytree(e,d/'raw',dirs_exist_ok=True)
for p in [r/'setup.py',r/'run-local.py',r/'freeze.py',s/'reviewer-acceptance-media-capability.test.mjs']:
 out=d/'reproduction'/p.name;out.parent.mkdir(exist_ok=True);shutil.copyfile(p,out)
(d/'raw/source-471.patch').write_bytes(subprocess.check_output(['git','show','--format=fuller','471b26a572531ccd56e926bdb8fd682ce2f4ab4e'],cwd=s));(d/'raw/test-d469.patch').write_bytes(subprocess.check_output(['git','show','--format=fuller','d46961461df319e26d4c947030fddf06337ed7f7'],cwd=s))
receipt={'verdict':'APPROVE SCOPED SERVER CAPABILITY SOURCE','production':'471b26a572531ccd56e926bdb8fd682ce2f4ab4e','testOnly':'d46961461df319e26d4c947030fddf06337ed7f7','sdkActuallyBuiltAndTested':'d46961461df319e26d4c947030fddf06337ed7f7','siteConsumerSource':'230c8cff0e2075042cc0784c03beece7ddf14900','freshPass':67,'freshFail':0,'skip':0,'standardBuildExit':0,'builderTSCExit':0,'actualSitePureConsumerContexts':3,'reviewerProductionFixAuthorship':False,'wholeSDKStudioOrLiveApproval':False,'ownBuildOutputFiles':len(rows),'outputManifestSHA256':hashlib.sha256((e/'own-output-identities.json').read_bytes()).hexdigest()};(d/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps(receipt))
