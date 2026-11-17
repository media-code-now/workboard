// Fills the database with example projects and tasks for a demo.
// Usage: npm run seed            (adds examples; uses DATABASE_URL from .env.local when set)
//        npm run seed -- --reset (clears everything first)
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { init } from "../server/init.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { sql, store } = await init({ dataDir: resolve(process.env.DATA_DIR || join(root, "data", "pg")) });

if (process.argv.includes("--reset")) {
  await sql.query("DELETE FROM tasks");
  await sql.query("DELETE FROM projects");
}

const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

const projects = {
  web: await store.createProject({ name: "Website relaunch", owner: "Dana Levi", start: day(-20), due: day(24), health: "on-track", color: "blue", description: "New marketing site and CMS migration." }),
  hire: await store.createProject({ name: "Q1 hiring plan", owner: "Amir Cohen", start: day(-12), due: day(10), health: "at-risk", color: "orange", description: "Headcount, roles and interview loops." }),
  onb: await store.createProject({ name: "Customer onboarding v2", owner: "Maya Ross", start: day(-5), due: day(45), health: "on-track", color: "teal", description: "Shorter time-to-value for new accounts." }),
  soc: await store.createProject({ name: "SOC 2 readiness", owner: "Yoni Bar", start: day(-40), due: day(-3), health: "off-track", color: "purple", description: "Policies, evidence, auditor kickoff." }),
};

const tasks = [
  ["Finalize sitemap", "web", "Dana Levi", "done", "medium", -6],
  ["Homepage copy", "web", "Noa Katz", "review", "high", 2],
  ["Migrate blog posts", "web", "Eli Mor", "doing", "medium", 8],
  ["Set up redirects", "web", "Eli Mor", "todo", "low", 18],
  ["Approve headcount with finance", "hire", "Amir Cohen", "doing", "high", -1],
  ["Write job descriptions", "hire", "Noa Katz", "todo", "medium", 5],
  ["Define interview loop", "hire", "Amir Cohen", "todo", "medium", 7],
  ["Map onboarding steps", "onb", "Maya Ross", "done", "medium", -10],
  ["Design welcome checklist", "onb", "Dana Levi", "doing", "medium", 12],
  ["In-app tour prototype", "onb", "Eli Mor", "todo", "low", 30],
  ["Access review policy", "soc", "Yoni Bar", "review", "high", -2],
  ["Collect vendor contracts", "soc", "Maya Ross", "doing", "high", -4],
  ["Book auditor kickoff", "soc", "Yoni Bar", "done", "medium", -8],
  ["Team offsite agenda", null, "Dana Levi", "todo", "low", 14],
];
for (const [title, p, assignee, status, priority, d] of tasks) {
  await store.createTask({ title, projectId: p ? projects[p].id : "", assignee, status, priority, due: day(d) });
}

console.log(`Added ${Object.keys(projects).length} projects and ${tasks.length} tasks.`);
await sql.close();
