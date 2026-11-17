# Workboard

A projects and tasks dashboard for the whole company. Everyone sees the same board, and changes from other people appear within a few seconds. Each person signs in with their own account.

- **Summary widgets**: progress rings, this week's numbers (open, overdue, due soon, completed) and workload per person
- **Projects**: owner, start and target dates, health (on track / at risk / off track / completed), color, progress
- **Tasks**: Board (drag between To Do, In Progress, Review, Done), List (tap to complete) and Timeline views, with search and filters by person and priority
- **Phones**: floating tab bar (Overview, Projects, Tasks, Menu) and a + button
- **Team**: admins add people, reset passwords and remove accounts from inside the app

Built with React + TypeScript (Vite) and an Express API on Postgres. It runs on **Netlify** (static site + one Netlify Function + Netlify DB) or anywhere Node runs.

## Deploy to Netlify

1. In Netlify, choose **Add new project → Import an existing project → GitHub** and pick this repository. The settings come from `netlify.toml`, so keep the defaults and deploy.
2. Add the database: in the project, open **Extensions** (or **Database**) and enable **Netlify DB**. It creates a Postgres database and sets `NETLIFY_DATABASE_URL` for you.
3. Create the first admin: under **Project configuration → Environment variables**, add
   - `INITIAL_ADMIN_EMAIL`: your email
   - `INITIAL_ADMIN_PASSWORD`: a temporary password of 10+ characters
   - `INITIAL_ADMIN_NAME`: your name (optional)
4. **Deploys → Trigger deploy** so the new settings take effect, then open the site and sign in.
5. Change your password (avatar → Change Password, or Menu → Change Password on a phone). You can then delete `INITIAL_ADMIN_PASSWORD`; it's only used while there are no users.
6. Add your team from **Team** in the same menu. Each person gets a temporary password to send them privately.

Every push to `main` redeploys automatically. Tables are created on first use, so there's no migration step.

> Netlify DB starts as a free claimable database; follow Netlify's prompt to claim it to your Neon account so it isn't removed.

## Run it locally

Node.js 22 or newer.

```bash
npm install
npm run user -- add --email you@company.com --name "Your Name" --admin
npm run seed      # optional: adds example projects and tasks
npm run dev
```

The `user add` command prints a temporary password. Open http://localhost:5173 and sign in.

Locally the data lives in an embedded Postgres ([PGlite](https://pglite.dev)) under `data/pg`, so there's nothing to install. To work against a real Postgres (for example your Netlify DB), set `DATABASE_URL` or `NETLIFY_DATABASE_URL`.

## Other ways to host

### Plain Node server

```bash
npm install
npm run build
npm start
```

Serves the API and the app on http://localhost:3001.

### Docker

```bash
docker build -t workboard .
docker run -d -p 3001:3001 -v workboard-data:/data --name workboard workboard
docker exec -it workboard node scripts/user.js add --email you@company.com --name "Your Name" --admin
```

The database lives in the `workboard-data` volume.

## Accounts and security

Nothing in the app or its API is visible until someone signs in. There's no public sign-up: admins add people from **Team** in the app, or from the command line:

| Command | What it does |
| --- | --- |
| `npm run user -- add --email ... --name "..." [--admin]` | Creates an account and prints a temporary password (or pass `--password`) |
| `npm run user -- list` | Lists accounts |
| `npm run user -- reset-password --email ...` | Sets a new password and signs that person out everywhere |
| `npm run user -- remove --email ...` | Deletes the account and its sessions |

The commands use the local database, or the live one when `NETLIFY_DATABASE_URL` is set (copy it from Netlify's environment variables).

How it's protected:

- Passwords are at least 10 characters and stored as salted scrypt hashes.
- Sessions are random tokens in an `HttpOnly`, `SameSite=Lax` cookie (`Secure` on Netlify), valid for 30 days. Only a hash of each token is stored.
- After 5 wrong passwords for the same email from the same address, sign-in is blocked for 15 minutes.
- Changes must be sent as JSON and deletes carry a custom header, which stops other websites from acting for a signed-in person.
- Changing or resetting a password signs out the account's other sessions.
- Only admins can manage the team, and the last admin can't be removed.

When self-hosting, serve over HTTPS and set `SECURE_COOKIES=true`; behind a reverse proxy also set `TRUST_PROXY=true`.

## Configuration

| Variable | Where | Purpose |
| --- | --- | --- |
| `NETLIFY_DATABASE_URL` | Netlify (set by Netlify DB) | Postgres connection |
| `DATABASE_URL` | anywhere | Any other Postgres connection |
| `INITIAL_ADMIN_EMAIL`, `INITIAL_ADMIN_PASSWORD`, `INITIAL_ADMIN_NAME` | anywhere | Creates the first admin when there are no users yet |
| `DATA_DIR` | local / Docker | Folder for the embedded database (default `./data/pg`) |
| `PORT` | local / Docker | Server port (default `3001`) |
| `SECURE_COOKIES`, `TRUST_PROXY` | self-hosted | HTTPS and reverse-proxy settings |

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | API and frontend with hot reload |
| `npm run build` | Builds the frontend into `dist/` |
| `npm start` | Production Node server |
| `npm run seed` | Adds example data (`-- --reset` clears the board first) |
| `npm run user -- ...` | Manages accounts (see above) |
| `npm test` | API tests (in-memory Postgres) |
| `npm run typecheck` | TypeScript checks |

## How syncing works

Each browser asks `/api/revision` every 4 seconds while the tab is visible. That returns one number that goes up on every change; the browser reloads the board only when it moved. This works on serverless hosting, where long-lived connections aren't available.

## API

All endpoints are JSON under `/api`. Everything except `/auth/login` and `/health` needs a signed-in session.

| Method | Path | |
| --- | --- | --- |
| POST | `/auth/login` | Sign in with `{ email, password }`; sets the session cookie |
| POST | `/auth/logout` | Ends the session |
| GET | `/auth/me` | The signed-in user |
| POST | `/auth/password` | Change your password: `{ currentPassword, newPassword }` |
| GET | `/revision` | Change counter for syncing |
| GET | `/board` | All projects and tasks |
| POST | `/projects`, `/tasks` | Create |
| PATCH / DELETE | `/projects/:id`, `/tasks/:id` | Update (partial) / delete; deleting a project keeps its tasks |
| GET / POST | `/users` | Admins: list / add a person (returns a temporary password) |
| POST | `/users/:id/reset-password` | Admins: new temporary password |
| DELETE | `/users/:id` | Admins: remove a person |

## Project layout

```
client/src/           React app (components/, data hook, API client, styles)
server/               Express app, accounts, Postgres store, connection setup
netlify/functions/    Netlify Function wrapping the Express app
scripts/              Seed and account-management scripts
test/                 API tests
```
