import type {
  MutationEndpoint,
  ParseResult,
  QueryEndpoint,
} from "pstack/react";

export type TodoId = string & { readonly __brand: "TodoId" };

export type Todo = {
  id: TodoId;
  title: string;
  completed: boolean;
};

export type CreateTodoInput = {
  title: string;
};

export type ToggleTodoInput = {
  id: TodoId;
  completed: boolean;
};

type FieldIssue = {
  path: string[];
  message: string;
};

function validationError(issues: FieldIssue[]) {
  return { issues };
}

function parseCreateTodo(value: unknown): ParseResult<CreateTodoInput> {
  const input = value as Partial<CreateTodoInput>;
  const title = typeof input.title === "string" ? input.title.trim() : "";

  if (!title) {
    return {
      success: false,
      error: validationError([
        {
          path: ["title"],
          message: "Title is required",
        },
      ]),
    };
  }

  return {
    success: true,
    data: { title },
  };
}

async function request<Output>(
  path: string,
  init?: RequestInit,
): Promise<Output> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init?.headers,
    },
  });

  const data = await response.json();

  if (!response.ok) {
    throw data;
  }

  return data as Output;
}

export const api = {
  todos: {
    list: {
      kind: "query",
      call: () => request<Todo[]>("/api/todos"),
    } satisfies QueryEndpoint<void, Todo[]>,

    create: {
      kind: "mutation",
      parseInput: parseCreateTodo,
      call: (input: CreateTodoInput) =>
        request<Todo>("/api/todos", {
          method: "POST",
          body: JSON.stringify(input),
        }),
    } satisfies MutationEndpoint<CreateTodoInput, Todo>,

    toggle: {
      kind: "mutation",
      call: (input: ToggleTodoInput) =>
        request<Todo>(`/api/todos/${input.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            completed: input.completed,
          }),
        }),
    } satisfies MutationEndpoint<ToggleTodoInput, Todo>,
  },
} as const;
