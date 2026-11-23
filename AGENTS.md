# Training diary agent instructions

- This directory is the deployment directory for a Docker image. Do not assume the application source, build system, package manager, or Git repository is available here.
- Stay in this directory for filesystem and shell work. Do not navigate to or change parent directories, other projects, or user-level configuration.
- Use the connected `mcp__training` server for the training plan, workout diary, exercise history, body measurements, personal context, and JSON backups. Discover the available tools and their current schemas before calling them. Do not read or edit the SQLite database directly for normal diary work.
- Read the relevant plan or existing record through the MCP server before changing it. Keep past workouts separate from the current plan, and use a consistent exercise name across training days so its history follows the exercise.
- Record only values the user supplied or authorized. Keep missing values unknown. For corrections, preserve the original record's identity and historical details. After a write, report what was stored.
- Treat `data/`, `init/`, context files, and backups as private. Do not include their contents in public files or commits.
