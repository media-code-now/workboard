# Workboard

A projects and tasks dashboard for the whole company. Everyone sees the same board, and changes show up live in every open browser.

- **Summary widgets**: progress rings, this week's numbers (open, overdue, due soon, completed) and workload per person
- **Projects**: owner, start and target dates, health (on track / at risk / off track / completed), color, progress
- **Tasks**: Board (drag between To Do, In Progress, Review, Done), List (tap to complete) and Timeline views, with search and filters by person and priority

Built with React + TypeScript (Vite) on the front end and Node + Express on the back end. Data is stored in SQLite using Node's built-in driver, so there are no native modules to compile. Live updates use Server-Sent Events.

## Requirements

Node.js 22.13 or newer.

## Run it locally

```bash
npm install
npm run seed      # optional: adds example projects and tasks
npm run dev
```

Open http://localhost:5173. The API runs on port 3001 and Vite proxies `/api` to it.

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

The database lives in the `workboard-data` volume, so it survives container restarts and upgrades.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3001` | Port the server listens on |
| `DATABASE_FILE` | `./data/workboard.db` | Path of the SQLite database |
| `APP_USER`, `APP_PASSWORD` | unset | When both are set, the browser asks for this shared login before showing anything |

Put the app behind HTTPS (a reverse proxy or your hosting platform) when you use the shared login, so the password isn't sent in the clear.

## Backups

The whole board is one file. Copy `DATABASE_FILE` (plus its `-wal` file, if present) while the server is stopped, or run `sqlite3 workboard.db ".backup backup.db"` while it runs.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | API and frontend with hot reload |
| `npm run build` | Builds the frontend into `dist/` |
| `npm start` | Production server |
| `npm run seed` | Adds example data (`-- --reset` clears the board first) |
| `npm test` | API tests |
| `npm run typecheck` | TypeScript checks |

## API

All endpoints are JSON under `/api`.

| Method | Path | |
| --- | --- | --- |
| GET | `/board` | All projects and tasks |
| GET / POST | `/projects` | List / create |
| PATCH / DELETE | `/projects/:id` | Update (partial) / delete; the project's tasks are kept |
| GET / POST | `/tasks` | List / create |
| PATCH / DELETE | `/tasks/:id` | Update (partial) / delete |
| GET | `/events` | Live change stream (Server-Sent Events) |
| GET | `/health` | Health check |

## Project layout

```
server/        Express app, SQLite storage and validation
client/src/    React app (components/, data hook, API client, styles)
scripts/       Seed script
test/          API tests
```
