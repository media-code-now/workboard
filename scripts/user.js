// Manage Workboard sign-in accounts from the command line.
//
//   npm run user -- add --email dana@company.com --name "Dana Levi" [--admin] [--password "..."]
//   npm run user -- list
//   npm run user -- reset-password --email dana@company.com [--password "..."]
//   npm run user -- remove --email dana@company.com
//
// When --password is left out, a strong random password is generated and printed once.
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { init } from "../server/init.js";
import { ValidationError } from "../server/store.js";
import { generatePassword } from "../server/auth.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { email: { type: "string" }, name: { type: "string" }, password: { type: "string" }, admin: { type: "boolean" } },
});
const [command] = positionals;
// Uses DATABASE_URL from .env.local (your Neon database) when set, else the local embedded one.
const { sql, auth } = await init({ dataDir: resolve(process.env.DATA_DIR || join(root, "data", "pg")) });
const generated = generatePassword;

function need(field) {
  if (!values[field]) { console.error(`Missing --${field}`); process.exit(1); }
  return values[field];
}
async function findUser() {
  const user = await auth.getUserByEmail(need("email"));
  if (!user) { console.error(`No user with email ${values.email}`); process.exit(1); }
  return user;
}

try {
  switch (command) {
    case "add": {
      const password = values.password ?? generated();
      const user = await auth.createUser({ email: need("email"), name: need("name"), password, role: values.admin ? "admin" : "member" });
      console.log(`Created ${user.role} ${user.name} <${user.email}>`);
      if (!values.password) console.log(`Temporary password: ${password}\nShare it privately; it won't be shown again.`);
      break;
    }
    case "list": {
      const users = await auth.listUsers();
      if (!users.length) console.log("No users yet.");
      for (const u of users) console.log(`${u.role.padEnd(7)} ${u.email.padEnd(32)} ${u.name}`);
      break;
    }
    case "reset-password": {
      const user = await findUser();
      const password = values.password ?? generated();
      await auth.setPassword(user.id, password);
      console.log(`Password reset for ${user.email}. They've been signed out everywhere.`);
      if (!values.password) console.log(`New password: ${password}`);
      break;
    }
    case "remove": {
      const user = await findUser();
      await auth.removeUser(user.id);
      console.log(`Removed ${user.email}.`);
      break;
    }
    default:
      console.log("Usage: npm run user -- <add|list|reset-password|remove> [--email ...] [--name ...] [--admin] [--password ...]");
      process.exitCode = command ? 1 : 0;
  }
} catch (e) {
  if (e instanceof ValidationError) { console.error(e.message); process.exitCode = 1; } else throw e;
} finally {
  await sql.close();
}
