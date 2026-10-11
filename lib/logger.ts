import pino from "pino";

// ponytail: no pino transport workers — Next/Turbopack and Vite both mangle
// the target path (createRequire.resolve still becomes an [externals] string).
// Ceiling: JSON logs in dev; upgrade with `pino | pino-pretty` at the process edge.
export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  base: {
    env: process.env.NODE_ENV,
  },
  formatters: {
    level: (label) => {
      return { level: label };
    },
  },
});
