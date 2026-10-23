set -euo pipefail
umask 077
cd /root/keel-validation-tools-20261020/ffmpeg-static-5.3.0
curl --fail --silent --show-error --location --retry 0 --connect-timeout 10 --max-time 90 https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/linux-x64.README -o linux-x64.README
python3 - <<'PY'
import pathlib,json,hashlib,os,datetime,re,gzip
p=pathlib.Path('.');package=json.load(open('package-provenance.json'));a=json.load(open('asset.json'));b=(p/'ffmpeg').read_bytes();gz=(p/'ffmpeg-linux-x64.gz').read_bytes();version=(p/'version.txt').read_text()
assert re.match(r'^ffmpeg version [0-9]+\.[0-9]+\.[0-9]+-static\b',version)
assert a['browser_download_url']==package['derivedDownloadURL']and len(gz)==a['size']and gzip.decompress(gz)==b and b[:4]==b'\x7fELF'
if a.get('digest'):assert a['digest']=='sha256:'+hashlib.sha256(gz).hexdigest()
dest=pathlib.Path(package['destination']);assert dest.parent.resolve().is_relative_to(pathlib.Path('/root/keel-qa-final-pair-20261020/keel-sdk/node_modules/.pnpm'))
assert json.loads((dest.parent/'package.json').read_text())['version']=='5.3.0'
if dest.exists():assert not dest.is_symlink()and dest.read_bytes()==b
else:
 fd=os.open(dest,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o700)
 with os.fdopen(fd,'wb')as f:f.write(b);f.flush();os.fsync(f.fileno())
assert hashlib.sha256(dest.read_bytes()).hexdigest()==hashlib.sha256(b).hexdigest()
r={'schema':'keel-independent-ffmpeg-static-linux@1','qualifiedAtUTC':datetime.datetime.now(datetime.timezone.utc).isoformat(),**package,'binaryBytes':len(b),'binarySHA256':hashlib.sha256(b).hexdigest(),'gzipSHA256':hashlib.sha256(gz).hexdigest(),'officialAssetDigest':a.get('digest'),'officialAssetSize':a['size'],'binaryVersionBanner':version.splitlines()[0],'genuineExecutionVersionCheck':True,'initialMistakenAssumption':'package release tagb6.1.1 was incorrectly assumed identical to binarybanner6.1.1; stoppedbeforeQAwrite; rawRED preserved','testsOrGoldenFilesChanged':False,'elf':True,'existingDifferentFileOverwritten':False,'sdkDistTouched':False,'globalChanges':False,'credentialChanges':False,'proxyOrRecipientFallback':False,'actualSource':str(p.resolve()/'ffmpeg'),'assetMetadataSHA256':hashlib.sha256((p/'asset.json').read_bytes()).hexdigest(),'readmeSHA256':hashlib.sha256((p/'linux-x64.README').read_bytes()).hexdigest()}
(p/'qualification-receipt.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps(r));print('QUALIFICATION_RECEIPT_SHA256',hashlib.sha256((p/'qualification-receipt.json').read_bytes()).hexdigest())
PY
