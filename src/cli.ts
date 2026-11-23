import { Diary } from "./database.ts";
import { exportData, importLegacy, restoreData } from "./import-export.ts";

const [command, path, flag, ...extra] = process.argv.slice(2);
try {
  if (extra.length || (flag && (command !== "restore" || flag !== "--replace")) ||
      (command !== "export" && !path)) {
    throw new Error("Usage: export [path] | restore <path> [--replace] | import-legacy <path>");
  }
  const diary = new Diary();
  try {
    switch (command) {
      case "export":
        if (path === "-") {
          console.log(JSON.stringify(diary.snapshot(), null, 2));
        } else {
          console.log(exportData(diary, path));
        }
        break;
      case "restore": console.log(restoreData(diary, path, flag === "--replace")); break;
      case "import-legacy": console.log(importLegacy(diary, path)); break;
      default: throw new Error("Unknown command");
    }
  } finally {
    diary.db.close();
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
