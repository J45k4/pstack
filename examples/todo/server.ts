import { Database, pStack } from "../../pstack";
import index from "./index.html";
import { schema } from "./schema";

type Todo = {
  id: string;
  title: string;
  completed: number;
};

const db = new Database(schema, ":memory:");

await db.syncSchema();

await db.insertMany("todos", [
  {
    id: "todo_1",
    title: "Wire the example through useApi",
    completed: 1,
  },
  {
    id: "todo_2",
    title: "Store todos in SQLite",
    completed: 0,
  },
]);

function jsonError(message: string, status = 400) {
  return Response.json(
    {
      issues: [
        {
          path: ["title"],
          message,
        },
      ],
    },
    { status },
  );
}

function serializeTodo(todo: Todo) {
  return {
    ...todo,
    completed: Boolean(todo.completed),
  };
}

const server = pStack({
  enableLogging: {
    level: "info",
  },
  routes: {
    // Serve the example app shell for all unmatched routes.
    "/*": index,

    "/api/todos": {
      async GET() {
        const todos = await db.findMany<Todo>(
          "todos",
          {},
          {
            orderBy: {
              column: "id",
              direction: "asc",
            },
          },
        );

        return Response.json(todos.map(serializeTodo));
      },

      async POST(req) {
        const body = await req.json().catch(() => undefined);
        const title =
          body && typeof body.title === "string" ? body.title.trim() : "";

        if (!title) {
          return jsonError("Title is required");
        }

        const todo = await db.insert<Todo>(
          "todos",
          {
            id: `todo_${Date.now()}`,
            title,
            completed: 0,
          },
          {
            returning: "*",
          },
        );

        if (!todo) {
          return Response.json(
            { message: "Failed to create todo" },
            { status: 500 },
          );
        }

        return Response.json(serializeTodo(todo), { status: 201 });
      },
    },

    "/api/todos/:id": {
      async PATCH(req) {
        const id = req.params.id;
        const body = await req.json().catch(() => undefined);
        const existing = await db.findOne<Todo>("todos", { id });

        if (!existing) {
          return Response.json({ message: "Todo not found" }, { status: 404 });
        }

        if (!body || typeof body.completed !== "boolean") {
          return Response.json(
            { message: "completed must be a boolean" },
            { status: 400 },
          );
        }

        const [todo] = await db.update<Todo>(
          "todos",
          {
            completed: body.completed ? 1 : 0,
          },
          {
            id,
          },
          {
            returning: "*",
          },
        );

        return Response.json(serializeTodo(todo!));
      },
    },

    "/api/hello": {
      async GET() {
        return Response.json({
          message: "Hello, world!",
          method: "GET",
        });
      },
      async PUT() {
        return Response.json({
          message: "Hello, world!",
          method: "PUT",
        });
      },
    },

    "/api/hello/:name": async req => {
      const name = req.params.name;

      return Response.json({
        message: `Hello, ${name}!`,
      });
    },
  },
});

export default server;
