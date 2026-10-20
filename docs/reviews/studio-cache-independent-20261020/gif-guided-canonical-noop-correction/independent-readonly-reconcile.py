import pathlib,subprocess,json,hashlib,os
base=pathlib.Path('/tmp/keel-private-gif-guided-review-20261020-01');expected=json.loads((base/'before-snapshot.private.json').read_bytes());tables=expected['tables'];assert len(tables)==100
ident=lambda v:'"'+v+'"'if v and v[0]in'abcdefghijklmnopqrstuvwxyz_'and all(c in'abcdefghijklmnopqrstuvwxyz_0123456789'for c in v)else(_ for _ in()).throw(ValueError('identifier'))
queries=['BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;']
queries.append("SELECT json_build_object('names',(SELECT json_agg(tablename ORDER BY tablename) FROM pg_tables WHERE schemaname='public')); ")
for t in tables:queries.append("SELECT json_build_object('table','"+t['table']+"','rows',COALESCE(json_agg(row_to_json(t)::text),'[]'::json)) FROM (SELECT "+','.join(ident(c)for c in t['columns'])+' FROM public.'+ident(t['table'])+')t;')
queries+= ["SELECT json_build_object('readOnly',current_setting('transaction_read_only'),'inactive0050',to_regclass('public.creator_prepared_publication_journals') IS NULL,'invalidConstraints',(SELECT count(*)::integer FROM pg_constraint WHERE NOT convalidated));",'COMMIT;']
argv=['/opt/homebrew/opt/postgresql@17/bin/psql','-X','-qAt','-h','/tmp/keel-diag-capacity-gif-deployed1','-p','55459','-U','ravonus','-d','keel_studio','-v','ON_ERROR_STOP=1']
r=subprocess.run(argv,input='\n'.join(queries),text=True,capture_output=True,timeout=30,env={'PATH':'/usr/bin:/bin','PGOPTIONS':'-c timezone=UTC -c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=1000'})
if r.returncode:raise RuntimeError('Readonly psql failed: '+r.stderr[:200])
rows=[json.loads(x)for x in r.stdout.splitlines()if x.startswith('{')];assert len(rows)==102
assert rows[0]['names']==[t['table']for t in tables]
assert rows[-1]==expected['checks']and rows[-1]['readOnly']=='on'
for t in tables:assert sorted(next(x['rows']for x in rows[1:-1]if x['table']==t['table']))==t['rows'],'table projection differs'
release=next(json.loads(x)for t in tables if t['table']=='launch_releases'for x in t['rows']if json.loads(x)['id']=='0c6c734d-20c0-4d3a-959a-fb7ac8143af2');assert release['revision']==13
names=['review.before.private.json','review.consumed.json','review.after.private.json','review.uncertain-after.private.json','review.receipt.json'];assert not any((base/n).exists()for n in names)
out={'schema':'keel.independent-guided-noop-readonly-reconciliation@1','result':'PASS_NO_NORMAL_ACTION_OCCURRED','all100TableProjectionsExactBaseline':True,'readOnly':True,'releaseRevision':13,'baselineRawSHA256':hashlib.sha256((base/'before-snapshot.private.json').read_bytes()).hexdigest(),'allFiveActionOutputsAbsent':True,'databaseWrites':0,'applicationExportsCalled':0,'RPC':0}
path=pathlib.Path('/private/tmp/keel-independent-gif-guided-review-20261020/independent-noop-reconciliation.json');path.write_text(json.dumps(out,indent=2)+'\n');print(json.dumps(out))
