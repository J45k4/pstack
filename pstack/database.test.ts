import { expect, test } from "bun:test";
import { Database } from "./database";

type TodoRow = {
  id: number;
  title: string;
  completed: number;
};

function createTestDb() {
  const db = Database.sqlite(":memory:");

  return db;
}

test("Database helpers read and write rows", async () => {
  const db = createTestDb();

  try {
    await db.execute(`
      create table todos (
        id integer primary key autoincrement,
        title text not null,
        completed integer not null default 0
      )
    `);

    const first = await db.insert<TodoRow>(
      "todos",
      {
        title: "Build database helpers",
        completed: 0,
      },
      { returning: "*" },
    );
    const second = await db.insert<TodoRow>(
      "todos",
      {
        title: "Use Bun SQL",
        completed: 1,
      },
      { returning: "*" },
    );

    expect(first?.title).toBe("Build database helpers");
    expect(second?.completed).toBe(1);

    const openTodo = await db.findOne<TodoRow>("todos", {
      completed: 0,
    });

    expect(openTodo?.title).toBe("Build database helpers");

    const todos = await db.findMany<TodoRow>(
      "todos",
      {
        id: [first!.id, second!.id],
      },
      {
        orderBy: {
          column: "id",
          direction: "desc",
        },
      },
    );

    expect(todos.map(todo => todo.title)).toEqual([
      "Use Bun SQL",
      "Build database helpers",
    ]);

    const updated = await db.update<TodoRow>(
      "todos",
      { completed: 1 },
      { id: first!.id },
      { returning: "*" },
    );

    expect(updated[0]?.completed).toBe(1);

    const deleted = await db.delete<TodoRow>(
      "todos",
      { id: second!.id },
      { returning: "*" },
    );

    expect(deleted[0]?.title).toBe("Use Bun SQL");
    expect(await db.findMany<TodoRow>("todos")).toHaveLength(1);
  } finally {
    await db.close({ timeout: 0 });
  }
});

test("Database validates identifiers", () => {
  const db = createTestDb();

  try {
    expect(() => db.identifier("todos")).not.toThrow();
    expect(() => db.identifier("todos; drop table todos")).toThrow(
      "Invalid SQL identifier",
    );
  } finally {
    void db.close({ timeout: 0 });
  }
});

test("Database transactions rollback on failure", async () => {
  const db = createTestDb();

  try {
    await db.execute("create table todos (id integer primary key, title text)");

    await expect(
      db.transaction(async tx => {
        await tx.insert("todos", { id: 1, title: "Rolled back" });
        throw new Error("stop");
      }),
    ).rejects.toThrow("stop");

    expect(await db.findMany("todos")).toEqual([]);
  } finally {
    await db.close({ timeout: 0 });
  }
});

test("Database creates schema from object definitions", async () => {
  const db = new Database(
    {
      todos: {
        id: {
          type: "text",
          primaryKey: true,
        },
        title: {
          type: "text",
          notNull: true,
        },
        completed: {
          type: "boolean",
          notNull: true,
          default: false,
        },
      },
    },
    ":memory:",
  );

  try {
    await db.syncSchema();

    const todo = await db.insert<TodoRow>(
      "todos",
      {
        id: "todo_1",
        title: "Defined with schema",
        completed: 0,
      },
      {
        returning: "*",
      },
    );

    expect(todo?.title).toBe("Defined with schema");
  } finally {
    await db.close({ timeout: 0 });
  }
});
