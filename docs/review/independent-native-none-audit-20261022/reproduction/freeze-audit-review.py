from pathlib import Path
import shutil,json,hashlib,subprocess
r=Path(__file__).parent.resolve();e=r/'evidence';sdk=r/'keel-sdk';d=sdk/'docs/review/independent-native-none-audit-20261022';d.mkdir(parents=True,exist_ok=True)
shutil.copytree(e,d/'raw',dirs_exist_ok=True)
for name in ['setup.py','run-local.py','run-pg.py','run-pg-diagnostic.py','run-pg-diagnostic-esm.py','observe-unissued-throw.cjs','observe-unissued-throw.mjs','freeze-audit-review.py']:
 out=d/'reproduction'/name;out.parent.mkdir(exist_ok=True);shutil.copyfile(r/name,out)
for name in ['reviewer-native-none-role-shape.test.mjs','reviewer-native-none-carriage.test.mjs']:
 shutil.copyfile(sdk/name,d/'reproduction'/name)
for name in ['read-only-rpc-guard.mjs','rpc-observer.mjs','exact-case-sequence.mjs','qualified-inputs.json']:
 out=d/'reproduction/pg-required-docs'/name;out.parent.mkdir(exist_ok=True);shutil.copyfile(r/'keel-site/docs/reviews/studio-publication-20261022/temporal-normal-postgres'/name,out)
(d/'raw/source-3de2c27.patch').write_bytes(subprocess.check_output(['git','show','--format=fuller','3de2c2710fcb5812f96a1b1ddcc047325a70e08b'],cwd=sdk))
receipt={'verdict':'APPROVE SCOPED CODEC/AUDIT SOURCE; NORMAL STUDIO CONTEXT BLOCKED','approvedSource':'3de2c2710fcb5812f96a1b1ddcc047325a70e08b','sdkTested':'0dc7e6f342b228515b1eecf783c9fd3629802eef','siteTested':'230c8cff0e2075042cc0784c03beece7ddf14900','independentProductionFixAuthorship':False,'fresh179':{'pass':179,'fail':0,'skip':0},'actualRegisteredChromium':{'pass':1,'fail':0,'skip':0},'standardSDKBuildExit':0,'siteTSCExit':0,'normalOriginalTest':'90a28021b7e838e8a44ba06ee43ae79a240a599a9e74b4ca7cec929cb292fced','normalAdmittedDescriptionTest':'8c7e76a133bb78541f04ba339e2fbb2f4f857162f72a9eddbe7e681c7955bca9','normalContextResult':'FAIL product unissued artifact.chainId null exclusion','normalCounts':{'jobs':1,'artifacts':1,'physicalPlans':3,'walletOperations':0},'liveOrSigningApproval':False}
(d/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n');print(d)
