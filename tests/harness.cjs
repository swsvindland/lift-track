const { readFileSync, readdirSync } = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const ts = require("typescript");
const { drizzle } = require(
  path.join(path.dirname(require.resolve("drizzle-orm/expo-sqlite")), "driver.cjs")
);

// Execute production TypeScript under Node while substituting only native boundaries.
function load(file, dependencies = {}) {
  const output = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  const sourceRequire = require("node:module").createRequire(path.resolve(file));
  new Function("require", "module", "exports", output)(
    (name) => (name in dependencies ? dependencies[name] : sourceRequire(name)),
    module,
    module.exports
  );
  return module.exports;
}

const schema = load("src/db/schema.ts");

function database() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  for (const migration of readdirSync("drizzle")
    .filter((f) => f.endsWith(".sql"))
    .sort())
    sqlite.exec(readFileSync(`drizzle/${migration}`, "utf8"));
  // Same Drizzle Expo driver as production, backed by real SQLite instead of a phone.
  const client = {
    prepareSync(sql) {
      return {
        executeSync(params) {
          const stmt = sqlite.prepare(sql);
          if (!stmt.columns().length) {
            const result = stmt.run(...params);
            return { changes: result.changes, lastInsertRowId: result.lastInsertRowid };
          }
          const rows = stmt.all(...params);
          return { getAllSync: () => rows, getFirstSync: () => rows[0] };
        },
        executeForRawResultSync(params) {
          const stmt = sqlite.prepare(sql);
          stmt.setReturnArrays(true);
          const rows = stmt.all(...params);
          return { getAllSync: () => rows };
        },
      };
    },
    execSync(sql) {
      sqlite.exec(sql);
    },
  };
  return { sqlite, db: drizzle(client, { schema }) };
}

/** The app's lifting modules wired to one in-memory database. */
function lift() {
  const { db, sqlite } = database();
  const metrics = load("src/lib/metrics.ts");
  const strength = load("src/lib/strength.ts");
  const loads = load("src/lib/loads.ts", { "./metrics": metrics });
  const { library } = load("src/lib/exercises/library.ts");
  const exercises = load("src/lib/exercises/index.ts", { "./library": { library } });
  const progression = load("src/lib/progression.ts", { "./loads": loads, "./strength": strength });
  const workouts = load("src/lib/workouts.ts", {
    "@/db": { db, ...schema },
    "./exercises": exercises,
    "./loads": loads,
    "./metrics": metrics,
    "./progression": progression,
    "./strength": strength,
  });
  const volume = load("src/lib/volume.ts", { "./strength": strength });
  const builder = load("src/lib/program-builder.ts", {
    "./exercises": exercises,
    "./progression": progression,
  });
  const programs = load("src/lib/programs.ts", {
    "@/db": { db, ...schema },
    "./exercises": exercises,
    "./progression": progression,
    "./strength": strength,
    "./workouts": workouts,
  });
  const analytics = load("src/lib/analytics.ts", {
    "@/db": { db, ...schema },
    "./metrics": metrics,
    "./strength": strength,
    "./volume": volume,
    "./workouts": workouts,
  });
  return {
    analytics,
    db,
    sqlite,
    schema,
    metrics,
    strength,
    loads,
    workouts,
    library,
    exercises,
    volume,
    progression,
    builder,
    programs,
  };
}

module.exports = { load, database, schema, lift };
