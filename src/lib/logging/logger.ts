import pino from "pino";
import { loggingConfig } from "./config";

const isDev = process.env.NODE_ENV === "development";
const isBrowser = typeof window !== "undefined";

// Custom serializers to redact sensitive information and format objects
const serializers = {
  // Serialize standard Next.js / Express Request objects
  req: (req: unknown) => {
    const r = req as Record<string, unknown>;
    const headers = (r.headers as Record<string, unknown>) || {};
    return {
      method: r.method,
      url: r.url,
      headers: {
        ...headers,
        authorization: headers.authorization ? "[REDACTED]" : undefined,
      },
      remoteAddress: r.remoteAddress,
    };
  },
  // Serialize standard Response objects
  res: (res: unknown) => ({
    statusCode: (res as Record<string, unknown>).statusCode,
  }),
  // Serialize errors cleanly with stack traces
  err: pino.stdSerializers.err,
  
  // Specific redactor for tool calls involving potential PII or secrets
  toolCall: (call: unknown) => {
    if (!call) return call;
    const c = call as Record<string, unknown>;
    return {
      ...c,
      args: c.name === "search_web" || c.name === "get_user_info" ? "[REDACTED ARGUMENTS]" : c.args,
    };
  }
};

function formatBrowserLog(level: string, entry: unknown) {
  const payload = (entry ?? {}) as Record<string, unknown>;
  const moduleName = typeof payload.module === "string" ? payload.module : "app";
  const msg = typeof payload.msg === "string" ? payload.msg : "";
  const time = typeof payload.time === "number" ? new Date(payload.time).toISOString() : "";

  const context = { ...payload };
  delete context.level;
  delete context.msg;
  delete context.time;
  delete context.module;
  delete context.pid;
  delete context.hostname;

  const prefix = `[${time || "no-time"}] [${level.toUpperCase()}] [${moduleName}]`;
  if (Object.keys(context).length > 0) {
    // Keep context structured while making the primary line human-readable.
    return { prefix, msg, context };
  }
  return { prefix, msg };
}

const transport =
  !isBrowser && isDev
    ? pino.transport({
      target: "pino-pretty",
      options: {
        colorize: true,
      },
    })
  : undefined;

/**
 * The base logger instance.
 * Use this directly in client components or purely non-request-scoped utility functions.
 */
export const logger = pino(
  {
    level: isBrowser ? loggingConfig.client.level : loggingConfig.server.level,
    serializers: serializers,
    browser: isBrowser
      ? {
          asObject: true,
          write: {
            trace: (entry: unknown) => {
              const { prefix, msg, context } = formatBrowserLog("trace", entry) as {
                prefix: string;
                msg: string;
                context?: Record<string, unknown>;
              };
              if (context) {
                console.debug(`${prefix} ${msg}`, context);
                return;
              }
              console.debug(`${prefix} ${msg}`);
            },
            debug: (entry: unknown) => {
              const { prefix, msg, context } = formatBrowserLog("debug", entry) as {
                prefix: string;
                msg: string;
                context?: Record<string, unknown>;
              };
              if (context) {
                console.debug(`${prefix} ${msg}`, context);
                return;
              }
              console.debug(`${prefix} ${msg}`);
            },
            info: (entry: unknown) => {
              const { prefix, msg, context } = formatBrowserLog("info", entry) as {
                prefix: string;
                msg: string;
                context?: Record<string, unknown>;
              };
              if (context) {
                console.info(`${prefix} ${msg}`, context);
                return;
              }
              console.info(`${prefix} ${msg}`);
            },
            warn: (entry: unknown) => {
              const { prefix, msg, context } = formatBrowserLog("warn", entry) as {
                prefix: string;
                msg: string;
                context?: Record<string, unknown>;
              };
              if (context) {
                console.warn(`${prefix} ${msg}`, context);
                return;
              }
              console.warn(`${prefix} ${msg}`);
            },
            error: (entry: unknown) => {
              const { prefix, msg, context } = formatBrowserLog("error", entry) as {
                prefix: string;
                msg: string;
                context?: Record<string, unknown>;
              };
              if (context) {
                console.error(`${prefix} ${msg}`, context);
                return;
              }
              console.error(`${prefix} ${msg}`);
            },
            fatal: (entry: unknown) => {
              const { prefix, msg, context } = formatBrowserLog("fatal", entry) as {
                prefix: string;
                msg: string;
                context?: Record<string, unknown>;
              };
              if (context) {
                console.error(`${prefix} ${msg}`, context);
                return;
              }
              console.error(`${prefix} ${msg}`);
            },
          },
        }
      : undefined,
  },
  transport
);

/**
 * Creates a child logger pre-configured with a specific module context.
 * Best practice for codebase-wide logging (e.g. `const log = createLogger('lipsync-engine')`).
 */
export function createLogger(moduleName: string) {
  return logger.child({ module: moduleName });
}

// Removed getLogger, moved to logger.server.ts
