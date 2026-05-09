import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";

export type EndpointKind = "query" | "mutation";

export type ParseSuccess<T> = {
  success: true;
  data: T;
};

export type ParseFailure = {
  success: false;
  error: unknown;
};

export type ParseResult<T> = ParseSuccess<T> | ParseFailure;

export type Parser<T> =
  | ((value: unknown) => T | ParseResult<T>)
  | {
      parse(value: unknown): T;
    }
  | {
      safeParse(value: unknown): ParseResult<T>;
    };

export type Endpoint<
  Kind extends EndpointKind = EndpointKind,
  Input = unknown,
  Output = unknown,
> = {
  readonly kind: Kind;
  readonly call: (input: Input) => Promise<Output>;
  readonly parseInput?: Parser<Input>;
};

export type QueryEndpoint<Input, Output> = Endpoint<"query", Input, Output>;
export type MutationEndpoint<Input, Output> = Endpoint<"mutation", Input, Output>;

export type EndpointInput<TEndpoint> =
  TEndpoint extends Endpoint<EndpointKind, infer Input, any>
    ? Input
    : never;

export type EndpointOutput<TEndpoint> =
  TEndpoint extends Endpoint<EndpointKind, any, infer Output>
    ? Output
    : never;

export type QueryResult<Output> = {
  data: Output | undefined;
  error: unknown;
  loading: boolean;
  refetch: () => Promise<Output>;
};

export type MutationResult<Input, Output> = {
  data: Output | undefined;
  error: unknown;
  loading: boolean;
  mutate: (input: Input) => Promise<Output>;
  reset: () => void;
};

type AnyQueryEndpoint = QueryEndpoint<any, any>;
type AnyMutationEndpoint = MutationEndpoint<any, any>;
type FieldName<TInput> = Extract<keyof TInput, string>;
type FieldErrors<TInput> = Partial<Record<FieldName<TInput>, string>>;

export type FormSource<TInput> =
  | Endpoint<EndpointKind, TInput, unknown>
  | Parser<TInput>;

export type UseFormOptions<TInput> = {
  defaultValues: Partial<TInput>;
};

export type FieldProps<Name extends string> = {
  name: Name;
  value: string | number | readonly string[];
  checked?: boolean;
  onChange: (
    event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
  ) => void;
};

export type UseFormResult<TInput> = {
  value: Partial<TInput>;
  valid: boolean;
  errors: FieldErrors<TInput>;
  field: <Name extends FieldName<TInput>>(name: Name) => FieldProps<Name>;
  error: <Name extends FieldName<TInput>>(name: Name) => string | undefined;
  parse: () => ParseResult<TInput>;
  submit: (
    callback: (input: TInput) => void | Promise<void>,
  ) => (event: FormEvent<HTMLFormElement>) => Promise<void>;
};

function isParseResult<T>(value: T | ParseResult<T>): value is ParseResult<T> {
  return (
    typeof value === "object" &&
    value !== null &&
    "success" in value &&
    typeof value.success === "boolean"
  );
}

function parseWith<T>(parser: Parser<T> | undefined, value: unknown): ParseResult<T> {
  if (!parser) {
    return { success: true, data: value as T };
  }

  try {
    if (typeof parser === "function") {
      const parsed = parser(value);
      return isParseResult(parsed) ? parsed : { success: true, data: parsed };
    }

    if ("safeParse" in parser) {
      return parser.safeParse(value);
    }

    return { success: true, data: parser.parse(value) };
  } catch (error) {
    return { success: false, error };
  }
}

function sourceParser<TInput>(source: FormSource<TInput>): Parser<TInput> | undefined {
  if (typeof source === "object" && source !== null && "parseInput" in source) {
    return source.parseInput;
  }

  return source as Parser<TInput>;
}

function stableKey(value: unknown): string {
  return JSON.stringify(value, (_key, child) => {
    if (!child || typeof child !== "object" || Array.isArray(child)) {
      return child;
    }

    return Object.fromEntries(
      Object.entries(child).sort(([left], [right]) => left.localeCompare(right)),
    );
  });
}

function fieldErrors<TInput>(error: unknown): FieldErrors<TInput> {
  const errors: Record<string, string> = {};

  if (!error || typeof error !== "object") {
    return errors as FieldErrors<TInput>;
  }

  if ("flatten" in error && typeof error.flatten === "function") {
    const flattened = error.flatten() as {
      fieldErrors?: Record<string, string[] | string>;
    };

    for (const [field, message] of Object.entries(flattened.fieldErrors ?? {})) {
      errors[field] = Array.isArray(message) ? message[0] ?? "" : message;
    }
  }

  const issueList =
    "issues" in error && Array.isArray(error.issues)
      ? error.issues
      : "errors" in error && Array.isArray(error.errors)
        ? error.errors
        : [];

  for (const issue of issueList) {
    if (!issue || typeof issue !== "object") {
      continue;
    }

    const path = "path" in issue && Array.isArray(issue.path) ? issue.path : [];
    const field = String(path[0] ?? "");
    const message =
      "message" in issue && typeof issue.message === "string"
        ? issue.message
        : "Invalid value";

    if (field) {
      errors[field] = message;
    }
  }

  return errors as FieldErrors<TInput>;
}

export function useApi<TEndpoint extends AnyQueryEndpoint>(
  endpoint: TEndpoint,
  input: EndpointInput<TEndpoint>,
): QueryResult<EndpointOutput<TEndpoint>>;

export function useApi<TEndpoint extends AnyMutationEndpoint>(
  endpoint: TEndpoint,
): MutationResult<EndpointInput<TEndpoint>, EndpointOutput<TEndpoint>>;

export function useApi(
  endpoint: Endpoint<EndpointKind, unknown, unknown>,
  input?: unknown,
): QueryResult<unknown> | MutationResult<unknown, unknown> {
  const [data, setData] = useState<unknown>();
  const [error, setError] = useState<unknown>();
  const [loading, setLoading] = useState(false);
  const inputKey = useMemo(() => stableKey(input), [input]);

  const run = useCallback(
    async (nextInput: unknown) => {
      setLoading(true);
      setError(undefined);

      try {
        const nextData = await endpoint.call(nextInput);
        setData(nextData);
        return nextData;
      } catch (nextError) {
        setError(nextError);
        throw nextError;
      } finally {
        setLoading(false);
      }
    },
    [endpoint],
  );

  useEffect(() => {
    if (endpoint.kind !== "query") {
      return;
    }

    void run(input);
  }, [endpoint.kind, inputKey, run]);

  if (endpoint.kind === "query") {
    return {
      data,
      error,
      loading,
      refetch: () => run(input),
    };
  }

  return {
    data,
    error,
    loading,
    mutate: run,
    reset: () => {
      setData(undefined);
      setError(undefined);
      setLoading(false);
    },
  };
}

export function useForm<TInput>(
  source: FormSource<TInput>,
  options: UseFormOptions<TInput>,
): UseFormResult<TInput> {
  const [value, setValue] = useState<Partial<TInput>>(options.defaultValues);
  const parser = sourceParser(source);

  const parse = useCallback(() => parseWith(parser, value), [parser, value]);
  const parsed = useMemo(() => parse(), [parse]);
  const errors = useMemo<FieldErrors<TInput>>(
    () => (parsed.success ? {} : fieldErrors<TInput>(parsed.error)),
    [parsed],
  );

  const field = useCallback(
    <Name extends FieldName<TInput>>(name: Name): FieldProps<Name> => {
      const currentValue = value[name];

      return {
        name,
        value:
          typeof currentValue === "string" ||
          typeof currentValue === "number" ||
          Array.isArray(currentValue)
            ? currentValue
            : "",
        checked:
          typeof currentValue === "boolean" ? currentValue : undefined,
        onChange: event => {
          const target = event.currentTarget;
          const nextValue =
            "checked" in target && target.type === "checkbox"
              ? target.checked
              : target.value;

          setValue(current => ({
            ...current,
            [name]: nextValue,
          }));
        },
      };
    },
    [value],
  );

  const error = useCallback(
    <Name extends FieldName<TInput>>(name: Name) => errors[name],
    [errors],
  );

  const submit = useCallback(
    (callback: (input: TInput) => void | Promise<void>) =>
      async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();

        const result = parse();

        if (!result.success) {
          return;
        }

        await callback(result.data);
      },
    [parse],
  );

  return {
    value,
    valid: parsed.success,
    errors,
    field,
    error,
    parse,
    submit,
  };
}
