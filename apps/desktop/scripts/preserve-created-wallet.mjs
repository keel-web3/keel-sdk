// One-time recovery of the wallet the creator made in the compatibility window.
// It copies the CLOSED profile unchanged, preserving its extension identity.
import { cp, mkdir, access } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WalletExtensionPackages } from '../src/wallet-extensions.mjs';

const pid = Number(process.argv[2]);
if (!Number.isSafeInteger(pid) || pid < 1) throw Error('Provide the compatibility wallet process ID.');
let running = true;
try { process.kill(pid, 0); } catch (error) { if (error.code === 'ESRCH') running = false; else throw error; }
if (running) throw Error('Quit the compatibility wallet window before copying its profile. The wallet has not been changed.');
const source = '/tmp/keel-wallet-compat/profile/Partitions/probe';
const packagePath = '/tmp/keel-wallet-compat/metamask';
const root = fileURLToPath(new URL('../artifacts/manual-test-workspace/', import.meta.url));
await access(source); await access(packagePath);
const db = new DatabaseSync(path.join(root, 'workspace.sqlite'));
try {
  db.exec('CREATE TABLE IF NOT EXISTS wallet_extensions (id TEXT PRIMARY KEY, record TEXT NOT NULL)');
  if (db.prepare('SELECT record FROM wallet_extensions').all().some(row => JSON.parse(row.record).preservedPackagePath === packagePath)) throw Error('This wallet is already preserved. Open its existing installation.');
  const packages = new WalletExtensionPackages(path.join(root, 'wallet-extensions'));
  const review = await packages.stage(packagePath);
  const record = await packages.install(review.token, review.digest);
  await mkdir(path.join(packages.root, 'profiles'), { recursive: true, mode: 0o700 });
  await cp(source, path.join(packages.root, 'profiles', record.installationId), { recursive: true, force: false, errorOnExist: true, filter: name => !['SingletonLock','SingletonSocket','SingletonCookie'].includes(path.basename(name)) });
  const preserved = { ...record, extensionId: 'bpinebpeminalcocdlifmefjpchpggnk', importedProfile: true, preservedPackagePath: packagePath };
  db.prepare('INSERT INTO wallet_extensions VALUES (?,?)').run(record.installationId, JSON.stringify(preserved));
  console.log('The created MetaMask wallet is preserved in the permanent practice workspace. Its original profile remains intact.');
} finally { db.close(); }
