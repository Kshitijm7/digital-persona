const isProduction = process.env.NODE_ENV === "production";
const disableLogsInProduction =
  process.env.DISABLE_LOGS_IN_PROD === "1" ||
  process.env.DISABLE_LOGS_IN_PROD === "true";

const defaultProdLevel = disableLogsInProduction ? "silent" : "warn";
const defaultDevLevel = "debug";

const resolvedServerLevel = isProduction
  ? process.env.LOG_LEVEL_PROD || process.env.LOG_LEVEL || defaultProdLevel
  : process.env.LOG_LEVEL_DEV || process.env.LOG_LEVEL || defaultDevLevel;

const resolvedClientLevel = isProduction
  ? process.env.NEXT_PUBLIC_LOG_LEVEL_PROD || process.env.NEXT_PUBLIC_LOG_LEVEL || defaultProdLevel
  : process.env.NEXT_PUBLIC_LOG_LEVEL_DEV || process.env.NEXT_PUBLIC_LOG_LEVEL || defaultDevLevel;

export const loggingConfig = {
  isProduction,
  disableLogsInProduction,
  server: {
    level: resolvedServerLevel,
  },
  client: {
    level: resolvedClientLevel,
  },
};
