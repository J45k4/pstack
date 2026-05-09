#!/usr/bin/env bun
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { Database, type DatabaseSchema } from "../pstack";

type MigrationState = {
  schema: DatabaseSchema;
};

type MigrateOptions = {
  schemaPath: string;
  migrationsDir: string;
  dialect: "postgres" | "mysql" | "sqlite";
};

const DEFAULT_SCHEMA = "examples/todo/schema.ts";
const DEFAULT_MIGRATIONS_DIR = "migrations";

function usage() {
  console.log(`pstack

Commands:
  pstack migrate [--schema path] [--dir path] [--dialect sqlite|postgres|mysql]

Examples:
  pstack migrate --schema examples/todo/schema.ts
`);
}

function parseArgs(argv: string[]) {
  const [command, ...args] = argv;

  if (!command || command === "help" || command === "--help" || command === "-h") {
    return { command: "help" as const };
  }

  if (command !== "migrate") {
    throw new Error(`Unknown command: ${command}`);
  }

  const options: MigrateOptions = {
    schemaPath: DEFAULT_SCHEMA,
    migrationsDir: DEFAULT_MIGRATIONS_DIR,
    dialect: "sqlite",
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];

    if (arg === "--schema") {
      if (!next) {
        throw new Error("--schema requires a path");
      }

      options.schemaPath = next;
      index += 1;
      continue;
    }

    if (arg === "--dir") {
      if (!next) {
        throw new Error("--dir requires a path");
      }

      options.migrationsDir = next;
      index += 1;
      continue;
    }

    if (arg === "--dialect") {
      if (next !== "sqlite" && next !== "postgres" && next !== "mysql") {
        throw new Error("--dialect must be sqlite, postgres, or mysql");
      }

      options.dialect = next;
      index += 1;
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  return {
    command,
    options,
  } as const;
}

async function loadSchema(schemaPath: string) {
  const absolutePath = schemaPath.startsWith("/")
    ? schemaPath
    : `${process.cwd()}/${schemaPath}`;
  const schemaUrl = Bun.pathToFileURL(absolutePath);
  const module = await import(schemaUrl.href) as {
    schema?: DatabaseSchema;
    default?: DatabaseSchema;
  };
  const schema = module.schema ?? module.default;

  if (!schema) {
    throw new Error(`${schemaPath} must export a schema or default schema`);
  }

  return schema;
}

async function readState(migrationsDir: string): Promise<MigrationState> {
  const stateFile = Bun.file(`${migrationsDir}/schema.snapshot.json`);

  if (!(await stateFile.exists())) {
    return { schema: {} };
  }

  return await stateFile.json();
}

function normalizeName(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function timestamp() {
  return new Date()
    .toISOString()
    .replaceAll("-", "")
    .replaceAll(":", "")
    .replace(/\.\d+Z$/, "");
}

function columnChanged(before: unknown, after: unknown) {
  return JSON.stringify(before) !== JSON.stringify(after);
}

function diffSchema(
  before: DatabaseSchema,
  after: DatabaseSchema,
  dialect: MigrateOptions["dialect"],
) {
  const db = new Database(after, ":memory:", { dialect });
  const statements: string[] = [];

  for (const [table, tableSchema] of Object.entries(after)) {
    const previousTable = before[table];

    if (!previousTable) {
      statements.push(...db.schemaSql({ [table]: tableSchema }));
      continue;
    }

    for (const [column, definition] of Object.entries(tableSchema)) {
      if (!(column in previousTable)) {
        statements.push(
          `alter table ${db.identifier(table)} add column ${db.columnSql(column, definition)}`,
        );
      } else if (columnChanged(previousTable[column], definition)) {
        statements.push(
          `-- TODO: column changed: ${table}.${column}. Write the migration manually.`,
        );
      }
    }

    for (const column of Object.keys(previousTable)) {
      if (!(column in tableSchema)) {
        statements.push(
          `-- TODO: column removed: ${table}.${column}. Write the migration manually.`,
        );
      }
    }
  }

  for (const table of Object.keys(before)) {
    if (!(table in after)) {
      statements.push(`-- TODO: table removed: ${table}. Write the migration manually.`);
    }
  }

  return statements;
}

async function promptMigrationName() {
  const readline = createInterface({ input, output });

  try {
    const name = await readline.question("Migration name: ");
    const normalized = normalizeName(name);

    if (!normalized) {
      throw new Error("Migration name cannot be empty");
    }

    return normalized;
  } finally {
    readline.close();
  }
}

async function writeMigration(
  options: MigrateOptions,
  schema: DatabaseSchema,
  statements: string[],
) {
  await Bun.$`mkdir -p ${options.migrationsDir}`.quiet();

  const name = await promptMigrationName();
  const filename = `${timestamp()}_${name}.sql`;
  const path = `${options.migrationsDir}/${filename}`;
  const content = `${statements.map(statement => `${statement};`).join("\n\n")}\n`;

  await Bun.write(path, content);
  await Bun.write(
    `${options.migrationsDir}/schema.snapshot.json`,
    `${JSON.stringify({ schema }, null, 2)}\n`,
  );

  console.log(`Created ${path}`);
}

async function migrate(options: MigrateOptions) {
  const schema = await loadSchema(options.schemaPath);
  const state = await readState(options.migrationsDir);
  const statements = diffSchema(state.schema, schema, options.dialect);

  if (statements.length === 0) {
    console.log("No schema changes detected.");
    return;
  }

  console.log("Detected schema changes:");
  for (const statement of statements) {
    console.log(`- ${statement}`);
  }

  await writeMigration(options, schema, statements);
}

try {
  const parsed = parseArgs(Bun.argv.slice(2));

  if (parsed.command === "help") {
    usage();
  } else {
    await migrate(parsed.options);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
