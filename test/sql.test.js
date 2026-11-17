import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanDatabaseUrl, redactSecrets } from "../server/sql.js";

const URL_ = "postgresql://neondb_owner:npg_abc123@ep-x-pooler.c-8.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require";

test("accepts connection strings pasted with psql, quotes or spaces", () => {
  assert.equal(cleanDatabaseUrl(URL_), URL_);
  assert.equal(cleanDatabaseUrl(`  ${URL_}  `), URL_);
  assert.equal(cleanDatabaseUrl(`psql '${URL_}'`), URL_);
  assert.equal(cleanDatabaseUrl(`"${URL_}"`), URL_);
  assert.equal(cleanDatabaseUrl(""), "");
});

test("rejects values that aren't Postgres URLs, without echoing them", () => {
  assert.throws(() => cleanDatabaseUrl("hello npg_secret"), (e) => /start with postgresql:\/\//.test(e.message) && !/npg_secret/.test(e.message));
});

test("redacts connection strings and Neon passwords", () => {
  const out = redactSecrets(`failed for ${URL_} and token npg_zzz999`);
  assert.doesNotMatch(out, /npg_|neondb_owner:/);
  assert.match(out, /postgresql:\/\/\*\*\*/);
});
