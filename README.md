# Workboard

A projects and tasks dashboard for the whole company. Everyone sees the same board, and changes show up live in every open browser. Each person signs in with their own account.

- **Summary widgets**: progress rings, this week's numbers (open, overdue, due soon, completed) and workload per person
- **Projects**: owner, start and target dates, health (on track / at risk / off track / completed), color, progress
- **Tasks**: Board (drag between To Do, In Progress, Review, Done), List (tap to complete) and Timeline views, with search and filters by person and priority

Built with React + TypeScript (Vite) on the front end and Node + Express on the back end. Data is stored in SQLite using Node's built-in driver, so there are no native modules to compile. Live updates use Server-Sent Events.

## Requirements

Node.js 22.13 or newer.

## Run it locally

```bash
npm install
npm run user -- add --email you@company.com --name "Your Name" --admin
npm run seed      # optional: adds example projects and tasks
npm run dev
```

The `user add` command prints a temporary password. Open http://localhost:5173 and sign in. The API runs on port 3001 and Vite proxies `/api` to it.

## Run in production

```bash
npm install
npm run build
npm start
```

The server serves both the API and the built app on http://localhost:3001.

### With Docker

```bash
docker build -t workboard .
docker run -d -p 3001:3001 -v workboard-data:/data --name workboard workboard
```

The database lives in the `workboard-data` volume, so it survives container restarts and upgrades. Create the first account inside the container:

```bash
docker exec -it workboard node --disable-warning=ExperimentalWarning scripts/user.js add --email you@company.com --name "Your Name" --admin
```

## Accounts and security

Nothing in the app or its API is visible until someone signs in. There is no public sign-up: an admin creates each account from the command line.

| Command | What it does |
| --- | --- |
| `npm run user -- add --email ... --name "..." [--admin]` | Creates an account and prints a temporary password (or pass `--password`) |
| `npm run user -- list` | Lists accounts |
| `npm run user -- reset-password --email ...` | Sets a new password and signs that person out everywhere |
| `npm run user -- remove --email ...` | Deletes the account and its sessions |

How it's protected:

- Passwords are at least 10 characters and stored as salted scrypt hashes, never in plain text.
- Sessions are random tokens in an `HttpOnly`, `SameSite=Lax` cookie, valid for 30 days. Only a hash of each token is stored.
- After 5 wrong passwords for the same email from the same address, sign-in is blocked for 15 minutes.
- Changes must be sent as JSON (and deletes carry a custom header), which stops other websites from making changes on a signed-in person's behalf.
- Basic hardening headers (`nosniff`, no framing, same-origin referrer).

**In production, serve it over HTTPS** (your host or a reverse proxy like nginx or Caddy) and set `SECURE_COOKIES=true` so the session cookie is never sent over plain HTTP. Behind a proxy, also set `TRUST_PROXY=true` (or a hop count such as `1`) so sign-in limits see the real client address.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3001` | Port the server listens on |
| `DATABASE_FILE` | `./data/workboard.db` | Path of the SQLite database |
| `SECURE_COOKIES` | `false` | Set to `true` when served over HTTPS |
| `TRUST_PROXY` | unset | `true` or a hop count when running behind a reverse proxy |

## Backups

The whole board is one file. Copy `DATABASE_FILE` (plus its `-wal` file, if present) while the server is stopped, or run `sqlite3 workboard.db ".backup backup.db"` while it runs.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | API and frontend with hot reload |
| `npm run build` | Builds the frontend into `dist/` |
| `npm start` | Production server |
| `npm run seed` | Adds example data (`-- --reset` clears the board first) |
| `npm run user -- ...` | Manages accounts (see above) |
| `npm test` | API tests |
| `npm run typecheck` | TypeScript checks |

## API

All endpoints are JSON under `/api`. Everything except `/auth/login` and `/health` needs a signed-in session.

| Method | Path | |
| --- | --- | --- |
| POST | `/auth/login` | Sign in with `{ email, password }`; sets the session cookie |
| POST | `/auth/logout` | Ends the session |
| GET | `/auth/me` | The signed-in user |
| GET | `/board` | All projects and tasks |
| GET / POST | `/projects` | List / create |
| PATCH / DELETE | `/projects/:id` | Update (partial) / delete; the project's tasks are kept |
| GET / POST | `/tasks` | List / create |
| PATCH / DELETE | `/tasks/:id` | Update (partial) / delete |
| GET | `/events` | Live change stream (Server-Sent Events) |
| GET | `/health` | Health check |

## Project layout

```
server/        Express app, accounts and sessions, SQLite storage and validation
client/src/    React app (components/, data hook, API client, styles)
scripts/       Seed and account-management scripts
test/          API tests
```
