import dotenv from 'dotenv';
import { createApp } from './app.js';
import { getDatabase, closeDatabase } from './db/connection.js';
import { runMigrations } from './db/migrate.js';
import { getConfig } from './config/env.js';
import { WorkerManager } from './workers/worker-manager.js';
import { rootLogger } from './utils/logger.js';

dotenv.config();

// Fail fast if configuration is invalid
const config = getConfig();

const PORT = config.port;
const HOST = config.host;

// Ensure DB is migrated
const db = getDatabase();
runMigrations(db);

const app = createApp();

// Start Operational Workers
const workerManager = new WorkerManager(db);
if (config.nodeEnv !== 'test') {
  workerManager.startAll();
}

const server = app.listen(PORT, HOST, () => {
  rootLogger.info(`Digital Impersonation Response Desk listening on http://${HOST}:${PORT}`, {
    environment: config.nodeEnv,
    database: config.databasePath,
    pilotMode: config.modes.pilotMode,
    dryRunBilling: config.modes.billingMode,
    notificationMode: config.modes.notificationMode
  });
});

// Graceful shutdown handling
const shutdown = (signal: string) => {
  rootLogger.info(`Received ${signal}. Starting graceful shutdown...`);
  workerManager.stopAll();
  server.close(() => {
    closeDatabase();
    rootLogger.info('HTTP server and database connections closed cleanly.');
    process.exit(0);
  });
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

