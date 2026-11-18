# Workboard

A projects and tasks dashboard for the whole company. Everyone sees the same board, and changes from other people appear within a few seconds. Each person signs in with their own account.

- **Summary widgets**: progress rings, this week's numbers (open, overdue, due soon, completed) and workload per person
- **Projects**: owner, start and target dates, health (on track / at risk / off track / completed), color, progress
- **Tasks**: Board (drag between To Do, In Progress, Review, Done), List (tap to complete) and Timeline views, with search and filters by person and priority
- **Phones**: floating tab bar (Overview, Projects, Tasks, Menu) and a + button
- **Team**: admins add people, reset passwords and remove accounts from inside the app
- **Notifications**: a bell with unread count for tasks assigned to you, changes to your tasks, and due-date reminders (tomorrow, today, overdue), plus optional desktop alerts
- **Settings**: your name, which notifications you get, desktop alerts, appearance (System / Light / Dark), password

Built with React + TypeScript (Vite) and an Express API on Postgres. The database is **Neon** (project `young-sun-92051793`, branch `production`, configured in `neon.ts`). The app runs on **Netlify** (static site + one Netlify Function) or anywhere Node runs.

## Database (Neon)

The Neon project is linked with `neon init` and described in `neon.ts`. To get its connection strings locally:

```bash
npm i -g neon@latest
neon login
neon deploy          # applies neon.ts and writes DATABASE_URL + DATABASE_URL_UNPOOLED to .env.local
npm run migrate      # creates/updates tables over the direct (unpooled) connection
```

`.env.local` holds the database password and is git-ignored. The app uses Neon's serverless driver (`@neondatabase/serverless`) over HTTP with the **pooled** `DATABASE_URL`, which suits short-lived serverless functions. Schema changes use the **direct** `DATABASE_URL_UNPOOLED`.

## Deploy to Netlify

1. In Netlify, choose **Add new project → Import an existing project → GitHub** and pick this repository. The settings come from `netlify.toml`.
2. Under **Project configuration → Environment variables**, add (mark them as secret):
   - `DATABASE_URL`: the **pooled** Neon connection string (Neon Console → project → **Connect**, connection pooling on; or copy it from your `.env.local`)
   - `INITIAL_ADMIN_EMAIL` and `INITIAL_ADMIN_PASSWORD` (10+ characters), plus optionally `INITIAL_ADMIN_NAME`: creates the first admin when there are no users yet
3. **Deploys → Trigger deploy**, then open `/api/health`. It should show `"ok":true` and `"databaseConfigured":true`.
4. Sign in, change your password (avatar → Change Password), then delete `INITIAL_ADMIN_PASSWORD`.
5. Add your team from **Team** in the same menu.

Every push to `main` redeploys automatically. `/api/health` reports the build, Node version and database status if anything goes wrong.

## Run it locally

Node.js 22 or newer.

```bash
npm install
npm run user -- add --email you@company.com --name "Your Name" --admin
npm run seed      # optional: adds example projects and tasks
npm run dev
```

The `user add` command prints a temporary password. Open http://localhost:5173 and sign in.

With a `.env.local` from `neon deploy` / `neon env pull`, the dev server, `seed` and `user` commands use your Neon database. Without one, data lives in an embedded Postgres ([PGlite](https://pglite.dev)) under `data/pg`, so there's nothing to install. For day-to-day development, consider a Neon branch (`neon checkout dev --create`) so you don't write to production.

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

The commands use `DATABASE_URL` from `.env.local` (your Neon database) when present, otherwise the local embedded one.

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
| `DATABASE_URL` | Netlify, `.env.local` | Pooled Neon connection string used by the app |
| `DATABASE_URL_UNPOOLED` | `.env.local` | Direct Neon connection string used by `npm run migrate` |
| `NETLIFY_DATABASE_URL` | Netlify DB (legacy) | Still accepted if `DATABASE_URL` isn't set |
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
| `npm run migrate` | Creates/updates the schema over the direct Neon connection |
| `npm run seed` | Adds example data (`-- --reset` clears the board first) |
| `npm run user -- ...` | Manages accounts (see above) |
| `npm test` | API tests (in-memory Postgres) |
| `npm run typecheck` | TypeScript checks |

## How notifications work

People are matched to tasks by **name**: a task notifies the account whose name matches its assignee (ignoring case), and the assignee field suggests team members' names. Renaming yourself in Settings also renames you on existing tasks and projects.

- **Assigned to me**: someone else sets you as a task's assignee.
- **Changes to my tasks**: someone else moves a task you're assigned to another column.
- **Due-date reminders**: created for your open tasks due tomorrow, today, or overdue, once each.

You never get notified about your own changes. Each person turns types on or off in Settings, and read notifications are kept for 60 days. Desktop alerts are per device and need the browser's permission.

## How syncing works

Each browser asks `/api/revision` every 4 seconds while the tab is visible (every 30 seconds in the background). That returns one number that goes up on every change, plus your unread notification count; the browser reloads the board only when the number moved. This works on serverless hosting, where long-lived connections aren't available.

## API

All endpoints are JSON under `/api`. Everything except `/auth/login` and `/health` needs a signed-in session.

| Method | Path | |
| --- | --- | --- |
| POST | `/auth/login` | Sign in with `{ email, password }`; sets the session cookie |
| POST | `/auth/logout` | Ends the session |
| GET | `/auth/me` | The signed-in user |
| POST | `/auth/password` | Change your password: `{ currentPassword, newPassword }` |
| GET | `/revision?today=YYYY-MM-DD` | Change counter for syncing, plus your unread count |
| GET | `/notifications?today=YYYY-MM-DD` | Your latest notifications (creates due reminders) |
| POST | `/notifications/read` | Mark `{ ids: [...] }` or `{ all: true }` as read |
| GET / PATCH | `/settings` | Your name and notification preferences |
| GET | `/team` | Everyone's name (for assignee suggestions) |
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
