"""New, separately admitted entrypoint after a proved no-op. Never retries."""
import pathlib,json,hashlib,os,sys,importlib.util
HERE=pathlib.Path(__file__).resolve().parent
PRIVATE=pathlib.Path('/tmp/keel-private-gif-guided-review-20261020-01')
TOOL=pathlib.Path('/private/tmp/keel-qa-receipt-activation-20261020/keel-site/docs/tools/gif-guided-review-only')
LOGS=pathlib.Path('/private/tmp/keel-gif-guided-canonical-20261020-01')
NODE='/Users/ravonus/.nvm/versions/node/v22.22.1/bin/node'
RID='0c6c734d-20c0-4d3a-959a-fb7ac8143af2';PID='fcf16528-aa7e-43c0-a7f0-8a4542ed96e6';CID='f2ae4c6f-3d93-4ac6-9b47-8a6f75162014'
sha=lambda b:hashlib.sha256(b).hexdigest()
def need(ok,reason):
 if not ok:raise RuntimeError(reason)
def read(p,cap=8*1024*1024):
 p=pathlib.Path(p);need(p.is_file()and not p.is_symlink()and p.stat().st_size<=cap,'output_file_contract');return json.loads(p.read_bytes())
def record(p):
 b=pathlib.Path(p).read_bytes();return {'path':str(p),'bytes':len(b),'sha256':sha(b)}
def verify_result(root=PRIVATE):
 r=read(root/'review.receipt.json');before=read(root/'review.before.private.json');after=read(root/'review.after.private.json');consumed=read(root/'review.consumed.json');command=read(root/'command.json');baseline=read(root/'before-snapshot.private.json')
 exact={'schema':'keel-normal-guided-review-only-receipt@1','status':'PASS_NORMAL_GUIDED_REVIEW_ONLY','normalWriterCalls':1,'beforeReleaseRevision':13,'afterReleaseRevision':14,'projectRevision':1,'otherProjectionCount':99,'answersUnchanged':True,'nativeAnswersUnchanged':True,'allOtherReleaseRowsUnchanged':True,'allAssetsUnchanged':True,'candidateRows':0,'compilerExecuted':False,'rpcRequests':0,'signing':False,'submission':False,'siteCommit':'3e50d15bb74f939951de0cc0333a7baa9d8018c1','sdkCommit':'b524bf5fc19939c7523aada2e53f79e3360970ea','packetSHA256':'d1b12a5b22c51e9d18c536f0cda46f614aa85c11f53d966aacf3c285b66496a5','reviewSHA256':'980cad9d2e563378f8bae55e3d17bfeb83e17568118e816a5196744d330df9e4','bundleSHA256':'6eb56fbbcf84c4bfef941a6b1c630b4ff076e2f6ec5be6f47e412cf2ca750bbc','configurationKeySHA256':'9acd4fa2082fd650be9113f0c7bce34e0d9991eed66570b3ffe92e6bc2b98122'}
 for key,value in exact.items():need(type(r.get(key))is type(value)and r[key]==value,'receipt_'+key)
 need(r['network']['denied']==[]and type(r['network']['unixDatabaseConnections'])is int and r['network']['unixDatabaseConnections']>0,'network_proof')
 assets={'files':156,'bytes':79402974,'allFileBytesMatch':True,'credentialFilesRead':False}
 need(r['assetPreservation']=={'before':assets,'after':assets},'asset_preservation')
 need(r['onlyChangedFields']==['launch_releases.revision','launch_releases.updated_at','launch_releases.page_state.studio.guidedPlan.reviewedConfiguration','launch_releases.page_state.studio.guidedPlan.lastCommand'],'changed_fields')
 need(before['snapshot']==baseline and len(baseline['tables'])==100,'baseline_snapshot')
 b={x['table']:x for x in baseline['tables']};a={x['table']:x for x in after['snapshot']['tables']};need(set(a)==set(b)and len(a)==100 and before['snapshot']['checks']==after['snapshot']['checks'],'table_set_or_schema')
 for name in b:
  if name!='launch_releases':need(a[name]==b[name],'other_table_mutated')
  else:need(a[name]['columns']==b[name]['columns'],'release_columns')
 def target(t):
  rows=[json.loads(s)for s in t['rows']if json.loads(s)['id']==RID];need(len(rows)==1,'one_target_release');return rows[0]
 other=lambda t:[s for s in t['rows']if json.loads(s)['id']!=RID]
 need(other(a['launch_releases'])==other(b['launch_releases']),'other_release_mutated')
 old,new=target(b['launch_releases']),target(a['launch_releases']);need(old['revision']==13 and new['revision']==14 and new['updated_at']!=old['updated_at'],'revision_transition')
 digest=sha(json.dumps(command,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode());need(r['commandDigest']==digest,'command_digest')
 need(new['page_state']['studio']['guidedPlan']['reviewedConfiguration']==command['configurationKey']and new['page_state']['studio']['guidedPlan']['lastCommand']=={'id':CID,'digest':digest,'revision':14},'normal_confirmation')
 for row in [old,new]:
  for key in ['revision','updated_at']:del row[key]
  for key in ['reviewedConfiguration','lastCommand']:row['page_state']['studio']['guidedPlan'].pop(key,None)
 need(old==new,'unapproved_target_field_mutated')
 need(a['updated_review_candidates']['rows']==[],'candidate_mutation')
 for view,revision,reviewed in [(before['view'],13,False),(after['view'],14,True)]:
  need(view['releaseId']==RID and view['projectId']==PID and view['revision']==revision and view['status']=='draft'and view['resolved']['status']=='ready-for-review'and view['resolved']['reviewed']is reviewed and view['resolved']['configurationKey']==command['configurationKey'],'actual_normal_view')
 need(consumed=={'schema':'keel-one-normal-guided-review-consumed@1','packetSHA256':r['packetSHA256'],'reviewSHA256':r['reviewSHA256'],'commandSHA256':'1556910ea67cf3c4c5e49742a6de8657e8f88acfd4137bc5a4a9ae10a43ae192','commandId':CID,'expectedRevision':13,'allowedNextRevision':14},'consumed_record')
 projections=r['unchangedOtherTableProjections'];need(len(projections)==99 and len({x['table']for x in projections})==99,'preservation_projection_count')
 for x in projections:
  table=b[x['table']];need(x['table']!='launch_releases'and x['rows']==len(table['rows'])and x['sha256']==sha(('\n'.join(table['rows'])+'\n').encode()),'preservation_projection_digest')
 return {'status':'PASS_NORMAL_GUIDED_REVIEW_ONLY','normalWriterCalls':1,'releaseBefore':13,'releaseAfter':14,'projectRevision':1,'all100BeforeTablesMatch':True,'all99OtherTablesPreserved':True,'onlyFourTargetFieldsChanged':True,'assetsFiles':156,'assetBytes':79402974,'candidateRows':0,'compiler':False,'RPC':False,'signing':False,'submission':False,'receipt':record(root/'review.receipt.json')}
def persist(p,value):
 with os.fdopen(os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600),'w')as f:json.dump(value,f,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
 fd=os.open(p.parent,os.O_RDONLY|os.O_DIRECTORY)
 try:os.fsync(fd)
 finally:os.close(fd)
def main():
 pins=read(HERE/'runtime-pins.json')
 for item in pins['files']:
  p=pathlib.Path(item['path']);need(not p.is_symlink()and p.is_file(),'pinned_file_type');b=p.read_bytes();need(len(b)==item['bytes']and sha(b)==item['sha256'],'pinned_file_changed')
 for name in ['review.before.private.json','review.consumed.json','review.after.private.json','review.uncertain-after.private.json','review.receipt.json']:need(not(PRIVATE/name).exists(),'action_already_observed_no_repeat')
 need(str((TOOL/'run-review.mjs').resolve())==str(TOOL/'run-review.mjs'),'canonical_main_path')
 LOGS.mkdir(mode=0o700)
 spec=importlib.util.spec_from_file_location('exact_reviewed_launcher',TOOL/'launch-review.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
 argv=[NODE,'--conditions=react-server',str(TOOL/'run-review.mjs'),str(PRIVATE/'run-config.json')]
 result=module.run_bounded(argv,LOGS)
 final={'schema':'keel.guided-canonical-entrypoint-action-result@1','launcher':result,'automaticRetry':False,'databaseRestore':False,'originalNoopOutputsPreserved':True,'status':'NO_ACCEPTED_NORMAL_REVIEW_PROOF','mayHaveCommittedReview':True}
 try:
  need(result['category']=='completed'and result['exitCode']==0,'launcher_not_successful');final['normalReview']=verify_result();final['status']='PASS_NORMAL_GUIDED_REVIEW_ONLY';final['mayHaveCommittedReview']=True
 except BaseException as error:final['verificationErrorCategory']=type(error).__name__;final['verificationReasonSHA256']=sha(str(error).encode())
 persist(LOGS/'verified-action-result.json',final);print(json.dumps({'status':final['status'],'automaticRetry':False,'databaseRestore':False,'result':record(LOGS/'verified-action-result.json')}));return 0 if final['status']=='PASS_NORMAL_GUIDED_REVIEW_ONLY'else 1
if __name__=='__main__':raise SystemExit(main())
