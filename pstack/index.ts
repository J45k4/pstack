import { serve } from "bun";
export { Database } from "./database";
export type {
  DatabaseDialect,
  DatabaseOptions,
  DatabaseRow,
  DatabaseSchema,
  DatabaseValue,
  ColumnDefault,
  ColumnDefinition,
  ColumnReference,
  ColumnType,
  FindOptions,
  OrderBy,
  Returning,
  TableSchema,
  Where,
  WriteOptions,
} from "./database";

export type PStackLogger<WebSocketData = undefined> = (
  server: Bun.Server<WebSocketData>,
) => void;

export type PStackLogLevel = "debug" | "info" | "warn" | "error" | "silent";

export type PStackLogEvent =
  | {
      level: "debug";
      type: "request:start";
      method: string;
      path: string;
    }
  | {
      level: "info";
      type: "request";
      method: string;
      path: string;
      status?: number;
      durationMs: number;
    }
  | {
      level: "error";
      type: "request:error";
      method: string;
      path: string;
      durationMs: number;
      error: unknown;
    };

export type PStackRequestLogger = (event: PStackLogEvent) => void;

export type PStackLoggingOptions = {
  level?: PStackLogLevel;
  logger?: PStackRequestLogger;
};

export type PStackOptions<
  WebSocketData = undefined,
  R extends string = string,
> = Bun.Serve.Options<WebSocketData, R> & {
  enableLogging?: boolean | PStackLoggingOptions;
  log?: boolean | PStackLogger<WebSocketData>;
};

const logLevels = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: Number.POSITIVE_INFINITY,
} satisfies Record<PStackLogLevel, number>;

function defaultDevelopment(): Bun.Serve.Development {
  return (
    process.env.NODE_ENV !== "production" && {
      hmr: true,
      console: true,
    }
  );
}

function defaultLogger<WebSocketData>(server: Bun.Server<WebSocketData>) {
  console.log(`[pstack] Server running at ${server.url}`);
}

function requestPath(req: Request) {
  return new URL(req.url).pathname;
}

function durationMs(startedAt: number) {
  return Math.round((performance.now() - startedAt) * 100) / 100;
}

function defaultRequestLogger(event: PStackLogEvent) {
  if (event.type === "request:start") {
    console.debug(`[pstack] -> ${event.method} ${event.path}`);
    return;
  }

  if (event.type === "request:error") {
    console.error(
      `[pstack] ${event.method} ${event.path} error ${event.durationMs}ms`,
      event.error,
    );
    return;
  }

  console.info(
    `[pstack] ${event.method} ${event.path} ${event.status ?? "-"} ${event.durationMs}ms`,
  );
}

function createRequestLogger(
  enableLogging: PStackOptions["enableLogging"],
): PStackRequestLogger | undefined {
  if (!enableLogging) {
    return undefined;
  }

  const options = enableLogging === true ? {} : enableLogging;
  const level = options.level ?? "info";
  const logger = options.logger ?? defaultRequestLogger;
  const minimum = logLevels[level];

  return event => {
    if (logLevels[event.level] < minimum) {
      return;
    }

    logger(event);
  };
}

function logStart(req: Request, logger: PStackRequestLogger | undefined) {
  logger?.({
    level: "debug",
    type: "request:start",
    method: req.method,
    path: requestPath(req),
  });
}

function logResponse(
  req: Request,
  response: Response | undefined | void,
  startedAt: number,
  logger: PStackRequestLogger | undefined,
) {
  logger?.({
    level: "info",
    type: "request",
    method: req.method,
    path: requestPath(req),
    status: response instanceof Response ? response.status : undefined,
    durationMs: durationMs(startedAt),
  });
}

function logError(
  req: Request,
  error: unknown,
  startedAt: number,
  logger: PStackRequestLogger | undefined,
) {
  logger?.({
    level: "error",
    type: "request:error",
    method: req.method,
    path: requestPath(req),
    durationMs: durationMs(startedAt),
    error,
  });
}

function wrapHandler(
  handler: (req: Request, server: Bun.Server<unknown>) => unknown,
  logger: PStackRequestLogger | undefined,
) {
  return async (req: Request, server: Bun.Server<unknown>) => {
    const startedAt = performance.now();

    logStart(req, logger);

    try {
      const response = await handler(req, server);
      logResponse(
        req,
        response instanceof Response ? response : undefined,
        startedAt,
        logger,
      );
      return response;
    } catch (error) {
      logError(req, error, startedAt, logger);
      throw error;
    }
  };
}

function isMethodMap(value: unknown) {
  const methods = new Set([
    "GET",
    "POST",
    "PUT",
    "DELETE",
    "PATCH",
    "HEAD",
    "OPTIONS",
  ]);

  return (
    value !== null &&
    typeof value === "object" &&
    Object.keys(value).some(key => methods.has(key))
  );
}

function wrapRoutes(
  routes: Record<string, unknown> | undefined,
  logger: PStackRequestLogger | undefined,
) {
  if (!routes || !logger) {
    return routes;
  }

  return Object.fromEntries(
    Object.entries(routes).map(([path, value]) => {
      if (typeof value === "function") {
        return [path, wrapHandler(value as never, logger)];
      }

      if (!isMethodMap(value)) {
        return [path, value];
      }

      return [
        path,
        Object.fromEntries(
          Object.entries(value as Record<string, unknown>).map(([method, handler]) => {
            if (typeof handler === "function") {
              return [method, wrapHandler(handler as never, logger)];
            }

            if (handler instanceof Response) {
              return [
                method,
                (req: Request) => {
                  const startedAt = performance.now();
                  logStart(req, logger);
                  logResponse(req, handler, startedAt, logger);
                  return handler;
                },
              ];
            }

            return [method, handler];
          }),
        ),
      ];
    }),
  );
}

export function pStack<
  const R extends string = string,
  WebSocketData = undefined,
>(options: PStackOptions<WebSocketData, R>): Bun.Server<WebSocketData> {
  const { enableLogging, log = true, ...serveOptions } = options;
  const requestLogger = createRequestLogger(enableLogging);
  const fetch = serveOptions.fetch
    ? wrapHandler(serveOptions.fetch as never, requestLogger)
    : serveOptions.fetch;
  const routes = wrapRoutes(
    serveOptions.routes as Record<string, unknown> | undefined,
    requestLogger,
  );

  const server = serve({
    development: defaultDevelopment(),
    ...serveOptions,
    fetch,
    routes,
  } as Bun.Serve.Options<WebSocketData, R>);

  if (log) {
    if (typeof log === "function") {
      log(server);
    } else {
      defaultLogger(server);
    }
  }

  return server;
}
