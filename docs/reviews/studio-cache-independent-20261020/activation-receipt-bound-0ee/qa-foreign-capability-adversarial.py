from pathlib import Path
import importlib.util,json,copy
root=Path('/tmp/keel-qa-receipt-activation-20261020/keel-site/docs/reviews/studio-publication-20261020/release/activation-receipt-bound')
spec=importlib.util.spec_from_file_location('qa_contract',root/'dependency-contract.test.py');t=importlib.util.module_from_spec(spec);spec.loader.exec_module(t)
c=t.Contract(methodName='test_actual_helper_mounts_capabilities_and_blank_values_guarded');c.setUp()
try:
 d=c.make();ident=d.create(c.plan['dependencies']['pgOnlyName'],t.h.pg_only_configuration(c.old,c.plan,c.image));original=d.container(ident)
 t.h.assert_pg_only(original,c.old,c.plan,c.image)
 out=[]
 for key,value in [('CapAdd',['SYS_ADMIN']),('Devices',[{'PathOnHost':'/dev/mem','PathInContainer':'/dev/mem','CgroupPermissions':'rwm'}]),('VolumesFrom',['unrelated:rw'])]:
  changed=copy.deepcopy(original);changed['HostConfig'][key]=value
  rejected=False
  try:t.h.assert_pg_only(changed,c.old,c.plan,c.image)
  except RuntimeError:rejected=True
  out.append({'field':key,'value':value,'rejected':rejected,'expected':'reject foreign extra privileged host configuration'})
 print(json.dumps({'sourceCommit':'0ee9947af4b2fc73606150db0189471853cafcf3','scope':'actual helper source and explicit synthetic Docker inspection, no Docker or host execution','results':out},indent=2))
 assert all(x['rejected']for x in out),'PG-only ownership guard accepted foreign extra host permissions'
finally:c.doCleanups()
