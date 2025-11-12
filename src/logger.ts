export type LogLevel = "ERROR" | "WARN" | "INFO" | "DEBUG";

export type LogEntry = Readonly<{
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
}>;

const LOG_LEVELS: Record<LogLevel, number> = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3,
};

function getLogLevel(): LogLevel {
  const level = Deno.env.get("TRINKETS_LOG_LEVEL")?.toUpperCase();
  if (level && level in LOG_LEVELS) {
    return level as LogLevel;
  }
  return "INFO";
}

const currentLevel = getLogLevel();

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] <= LOG_LEVELS[currentLevel];
}

function log(
  level: LogLevel,
  message: string,
  context?: Record<string, unknown>,
): void {
  if (!shouldLog(level)) return;

  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(context && { context }),
  };

  const output = level === "ERROR" ? console.error : console.log;
  output(JSON.stringify(entry));
}

export function error(
  message: string,
  context?: Record<string, unknown>,
): void {
  log("ERROR", message, context);
}

export function warn(message: string, context?: Record<string, unknown>): void {
  log("WARN", message, context);
}

export function info(message: string, context?: Record<string, unknown>): void {
  log("INFO", message, context);
}

export function debug(
  message: string,
  context?: Record<string, unknown>,
): void {
  log("DEBUG", message, context);
}
