# Training

A local TypeScript training diary with SQLite storage and an MCP server over stdio. Use Node.js 24 or newer and pnpm 12 for local project commands. Docker runs the server directly with Node. The server uses Node's built-in SQLite and native TypeScript support, and has no external dependencies.

## Start and connect

Run `pnpm start` from this folder to start the server. It reads MCP messages on stdin. A local MCP client should launch it directly. For clients that accept an `mcpServers` configuration, use:

```json
{
  "mcpServers": {
    "training": {
      "command": "node",
      "args": ["/absolute/path/to/training/src/index.ts"]
    }
  }
}
```

Use an absolute path to the Node executable if the client cannot find it. On Windows use forward slashes or escaped backslashes in JSON paths.

The local stdio connection is exercised by `pnpm test`. ChatGPT connectivity on Windows and mobile has yet to be verified.

## Diary and plan

The database is created in `data/training.db`, relative to this project. Set the optional `TRAINING_DB` environment variable to use another database file.

To seed a fresh installation from the original diary:

```sh
pnpm run import-legacy trainingstagebuch.json
```

The legacy importer preserves already imported records when run again. It imports the workout history and the undated measurement. The current plan starts empty and can be filled using confirmed A/B/C prescriptions.

Use `get_training` to read the plan, workouts, exercise performance, and measurements. Use the same exercise name across days so its history follows it. Create workouts and measurements with a caller-generated unique ID. Reuse that ID with the same payload when retrying a create. To correct an entry, first read it, then supply the full updated record with the original ID. Exercise plan moves use a zero-based position within the destination day.

## Training context

Use `get_context` to read the current context as a plain text string. Use `set_context` with `{ "context": "..." }` to replace it; an empty string clears it. This is background and goal information supplied to the assistant, stored separately from workouts and measurements.

For initial import, put a private `context.md` at `./init/context.md` beside `compose.yaml` before starting the server. Docker Compose mounts that file at `/app/init/context.md`. On startup, the server reads it only if the database has no stored context, including when an existing diary database lacks context. After import, `get_context` reads from SQLite and `set_context` writes to SQLite; changing the file later does not overwrite MCP edits, even if the stored string was cleared. The `init/` directory is ignored by Git and mounted read-only. Context is included in JSON backups; older version 1 backups restore with empty context.

## Back up or move to another computer

```sh
pnpm run export
pnpm run restore path/to/training-export.json
```

Export writes a versioned JSON file to `data/backups/` by default. Use `pnpm run export path/to/new-backup.json` to choose a destination. Move the project and the backup to the other computer and run restore into a fresh database. To intentionally replace an existing diary, add `--replace` after the backup path.

You can also stop every running diary process and copy the entire `data/` directory to the other installation. Keep private source files and backups in the ignored locations defined by `.gitignore`.

## Tests

Run `pnpm test` to verify MCP calls, plan and history separation, retry behavior, and backup integrity.

## Docker Compose on Linux

Copy the project to the Linux host, including `Dockerfile`, `compose.yaml`, and `.dockerignore`. The database and backups live in `data/` beside `compose.yaml`, mounted into the container as `/app/data`. Create that directory and grant UID 1000 write access before starting Compose. For a migration, copy an app-generated JSON backup to `init/seed.json` before the first run. The container runs as UID 1000 and needs read access to the seed file. The seed directory is mounted read-only and excluded from the image and Git.

```sh
docker compose pull training
mkdir -p data
sudo chown 1000:1000 data
```

After placing any seed file, start or inspect the diary with `docker compose run --rm -T --no-deps training src/cli.ts export -`. The first command that opens the database initializes `data/training.db`. If a seed exists, the database imports it once, in a transaction. With no seed, initialization creates an empty diary. If initialization fails, correct the seed and retry. Subsequent runs reuse the database and ignore the seed. `docker compose down -v` does not delete the bind-mounted `data/` directory.

If an earlier deployment used the named `training-data` volume, its existing database stays in that volume when you switch to this Compose file. Export a JSON backup with the old configuration before switching, place it at `init/seed.json`, then start the new configuration with an empty `data/` directory. Do not remove the old volume until the restored diary has been checked.

### Connect Codex CLI or ChatGPT Desktop

The client starts an attached container for each MCP session. Run the build on the Linux server first. On the same host, configure this in `~/.codex/config.toml`:

```toml
[mcp_servers.training]
command = "docker"
args = ["compose", "-f", "/absolute/path/to/training/compose.yaml", "run", "--rm", "-T", "--no-deps", "training"]
```

From another machine, use SSH to launch the same attached container. Use an SSH alias or account that can run Docker on the Linux host without interactive prompts. The Compose path is on the server.

```toml
[mcp_servers.training]
command = "ssh"
args = ["-T", "user@linux-server", "docker compose -f /absolute/path/to/training/compose.yaml run --rm -T --no-deps training"]
```

For ChatGPT Desktop, use the same command and arguments in **Settings → MCP servers → Add server → STDIO**. Restart the client and check `/mcp`. Ask it to show Day B using `training`. Rename existing client entries labeled `training-diary` if you want the displayed name to match; their connection still works without renaming. This setup uses a local client to launch the server over stdio. ChatGPT web requires an MCP endpoint it can reach over the network.

### Back up the diary to a host file

```sh
mkdir -p data/backups
umask 077
docker compose run --rm -T --no-deps training src/cli.ts export - > data/backups/training-export.json
```

Use a new filename for each backup you intend to keep. To restore on another server or a fresh Compose project, put that file in `init/seed.json` before the first run.
