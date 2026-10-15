import ts from "typescript";
import { collectMigrationTableNames, hasAuthenticatedProjectDelegate } from "../scripts/studio-structure-policy.mjs";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { siteRoot } from "../scripts/run.mjs";
import { siblingTest } from "./sibling-repository.mjs";

const siteTest = siblingTest(test, "keel-site");

siteTest("Studio structure accepts canonical and idempotent Drizzle CREATE TABLE migrations", async () => {
  const migration = await readFile(path.join(siteRoot, "apps/studio/drizzle/0004_vault_character_index.sql"), "utf8");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "indexed_vault_catalogs"/u);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "indexed_vault_characters"/u);
  const result = spawnSync(process.execPath, ["scripts/studio-structure-check.mjs"], {
    cwd: process.cwd(), encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Studio structure passed/u);
});

test('migration table declarations accept quoted/unquoted PostgreSQL identifiers and reject comment/string decoys', () => {
  const sql = `CREATE TABLE "quoted_name" (id integer); create table if not exists Plain_Name(id integer);
    CREATE TABLE IF NOT EXISTS public.schema_name (id integer);
    -- CREATE TABLE missing_line(id integer);
    /* outer /* nested */ CREATE TABLE missing_block(id integer); */
    SELECT 'CREATE TABLE missing_string(id integer);';
    DO $body$ BEGIN RAISE NOTICE 'CREATE TABLE missing_body(id integer)'; END $body$;
    CREATE TABLE "caseSensitive" (id integer);`;
  assert.deepEqual([...collectMigrationTableNames(sql)].sort(), ['caseSensitive', 'plain_name', 'quoted_name', 'schema_name']);
});

test('project delegation requires canonical authentication before any body read or creation', () => {
  const specifier = '~/server/http/create-project-request';
  const route = `import { requireCreatorSession } from '~/server/security/account-session';
    import { handleProjectRequest } from '${specifier}';
    export function POST(request: Request) { return handleProjectRequest(request, requireCreatorSession); }`;
  const handler = `import { assertSameOriginRequest } from '~/server/security/write-access';
    export async function handleProjectRequest(request: Request, authorize: Function) {
      try { assertSameOriginRequest(request.headers); const session = await authorize(request); const form = await request.formData(); return createArtifact(form, session.userId); }
      catch (error) { throw error; }
    }`;
  assert.equal(hasAuthenticatedProjectDelegate(ts, route, handler, specifier), true);
  for (const [badRoute, badHandler] of [
    [route.replace("'~/server/security/account-session'", "'~/fake-session'"), handler],
    [route.replace('request, requireCreatorSession', 'request, () => ({userId:"claimed"})'), handler],
    [route.replace('return handleProjectRequest', 'createArtifact(); return handleProjectRequest'), handler],
    [route, handler.replace('const session = await authorize(request);', '')],
    [route, handler.replace('const session = await authorize(request);', 'const body = await request.json(); const session = await authorize(request);')],
    [route, handler.replace('await authorize(request)', 'authorize(request)')],
    [route, handler.replace('assertSameOriginRequest(request.headers)', 'assertSameOriginRequest(other.headers)')],
    [route, handler.replace("'~/server/security/write-access'", "'~/fake-write-guard'")],
  ]) assert.equal(hasAuthenticatedProjectDelegate(ts, badRoute, badHandler, specifier), false);
});
