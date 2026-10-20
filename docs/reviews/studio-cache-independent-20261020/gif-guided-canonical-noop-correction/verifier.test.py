"""Synthetic verification only. No launcher main, app exports, DB or RPC."""
import pathlib,importlib.util,unittest,tempfile,json,copy,hashlib,shutil
ROOT=pathlib.Path('/tmp/keel-private-gif-guided-review-20261020-01');HERE=pathlib.Path(__file__).parent
s=importlib.util.spec_from_file_location('canonical_wrapper',HERE/'run-canonical.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class Verification(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=pathlib.Path(self.tmp.name)
 def fixture(self):
  baseline=json.loads((ROOT/'before-snapshot.private.json').read_bytes());command=json.loads((ROOT/'command.json').read_bytes());page=json.loads((ROOT/'expected-normal-page.private.json').read_bytes());prior=json.loads(pathlib.Path('/tmp/keel-qa-gif-guidance-readonly-20261020/planning-views.private.json').read_bytes())[1]['view'];beforeView={**prior,'status':'draft','projectId':m.PID};afterView=copy.deepcopy(beforeView);afterView['revision']=14;afterView['resolved']['reviewed']=True
  after=copy.deepcopy(baseline)
  for table in after['tables']:
   if table['table']=='launch_releases':
    rows=[]
    for raw in table['rows']:
     row=json.loads(raw)
     if row['id']==m.RID:row['revision']=14;row['updated_at']='2026-10-20T20:00:00.000Z';row['page_state']=page;raw=json.dumps(row,separators=(',',':'),ensure_ascii=False)
     rows.append(raw)
    table['rows']=sorted(rows)
  digest=m.sha(json.dumps(command,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode());self.assertEqual(page['studio']['guidedPlan']['lastCommand']['digest'],digest)
  assets={'files':156,'bytes':79402974,'allFileBytesMatch':True,'credentialFilesRead':False}
  receipt={'schema':'keel-normal-guided-review-only-receipt@1','status':'PASS_NORMAL_GUIDED_REVIEW_ONLY','normalWriterCalls':1,'beforeReleaseRevision':13,'afterReleaseRevision':14,'projectRevision':1,'otherProjectionCount':99,'answersUnchanged':True,'nativeAnswersUnchanged':True,'allOtherReleaseRowsUnchanged':True,'allAssetsUnchanged':True,'candidateRows':0,'compilerExecuted':False,'rpcRequests':0,'signing':False,'submission':False,'siteCommit':'3e50d15bb74f939951de0cc0333a7baa9d8018c1','sdkCommit':'b524bf5fc19939c7523aada2e53f79e3360970ea','packetSHA256':'d1b12a5b22c51e9d18c536f0cda46f614aa85c11f53d966aacf3c285b66496a5','reviewSHA256':'980cad9d2e563378f8bae55e3d17bfeb83e17568118e816a5196744d330df9e4','bundleSHA256':'6eb56fbbcf84c4bfef941a6b1c630b4ff076e2f6ec5be6f47e412cf2ca750bbc','configurationKeySHA256':'9acd4fa2082fd650be9113f0c7bce34e0d9991eed66570b3ffe92e6bc2b98122','commandDigest':digest,'network':{'denied':[],'unixDatabaseConnections':1},'assetPreservation':{'before':assets,'after':assets},'onlyChangedFields':['launch_releases.revision','launch_releases.updated_at','launch_releases.page_state.studio.guidedPlan.reviewedConfiguration','launch_releases.page_state.studio.guidedPlan.lastCommand'],'unchangedOtherTableProjections':[{'table':t['table'],'rows':len(t['rows']),'sha256':m.sha(('\n'.join(t['rows'])+'\n').encode())}for t in baseline['tables']if t['table']!='launch_releases']}
  values={'review.receipt.json':receipt,'before-snapshot.private.json':baseline,'command.json':command,'review.before.private.json':{'snapshot':baseline,'view':beforeView},'review.after.private.json':{'snapshot':after,'view':afterView},'review.consumed.json':{'schema':'keel-one-normal-guided-review-consumed@1','packetSHA256':receipt['packetSHA256'],'reviewSHA256':receipt['reviewSHA256'],'commandSHA256':'1556910ea67cf3c4c5e49742a6de8657e8f88acfd4137bc5a4a9ae10a43ae192','commandId':m.CID,'expectedRevision':13,'allowedNextRevision':14}}
  for n,v in values.items():(self.root/n).write_text(json.dumps(v,ensure_ascii=False))
  return values
 def change(self,n,edit):
  p=self.root/n;v=json.loads(p.read_bytes());edit(v);p.write_text(json.dumps(v))
 def test_synthetic_complete_transition_is_accepted_without_execution(self):
  self.fixture();self.assertEqual(m.verify_result(self.root)['status'],'PASS_NORMAL_GUIDED_REVIEW_ONLY')
 def test_zero_exit_without_action_receipt_is_not_proof(self):
  with self.assertRaises(RuntimeError):m.verify_result(self.root)
 def test_writer_count_and_authority_flags_are_mandatory(self):
  self.fixture();self.change('review.receipt.json',lambda v:v.update(normalWriterCalls=0))
  with self.assertRaisesRegex(RuntimeError,'normalWriterCalls'):m.verify_result(self.root)
 def test_asset_preservation_is_mandatory(self):
  self.fixture();self.change('review.receipt.json',lambda v:v['assetPreservation']['after'].update(allFileBytesMatch=False))
  with self.assertRaisesRegex(RuntimeError,'asset_preservation'):m.verify_result(self.root)
 def test_any_other_table_change_is_rejected(self):
  self.fixture();self.change('review.after.private.json',lambda v:v['snapshot']['tables'][0]['rows'].append('{}'))
  with self.assertRaises(RuntimeError):m.verify_result(self.root)
 def test_unchanged_original_project_is_required(self):
  self.fixture()
  def mutate(v):
   for t in v['snapshot']['tables']:
    if t['table']=='artifacts':t['rows'].append('{}')
  self.change('review.after.private.json',mutate)
  with self.assertRaises(RuntimeError):m.verify_result(self.root)
 def test_approval_without_durable_consumed_record_is_rejected(self):
  self.fixture();(self.root/'review.consumed.json').unlink()
  with self.assertRaises(RuntimeError):m.verify_result(self.root)
if __name__=='__main__':unittest.main()
