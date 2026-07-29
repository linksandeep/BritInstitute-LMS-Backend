import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: process.env.PORT || 5001,
  nodeEnv: process.env.NODE_ENV || 'development',
  mongoUri: process.env.MONGO_URI || 'mongodb://localhost:27017/britInstiuteLMS',
  jwtSecret: process.env.JWT_SECRET || 'brit_secret_key',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
  inactivityTimeoutMinutes: Number(process.env.INACTIVITY_TIMEOUT_MINUTES || 30),
  license: {
    key: process.env.LICENSE_KEY || '',
    superCode: process.env.LICENSE_SUPER_CODE || '',
    encodedLicense: process.env.LICENSE_ENCODED_VALUE || '',
    encodedSuperLicense: process.env.LICENSE_SUPER_ENCODED_VALUE || '',
    mongoUri: process.env.LICENSE_MONGO_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/britInstituteLicense',
    mongoDbName: process.env.LICENSE_MONGO_DB_NAME || 'britInstituteLicense',
    validationIntervalMs: Number(process.env.LICENSE_VALIDATION_INTERVAL_MS || 60_000),
    maxActivationAttempts: Number(process.env.LICENSE_MAX_ACTIVATION_ATTEMPTS || 3),
    activationLockoutMs: Number(process.env.LICENSE_ACTIVATION_LOCKOUT_MS || 15 * 60_000),
    initialMinutes: process.env.LICENSE_INITIAL_MINUTES ? Number(process.env.LICENSE_INITIAL_MINUTES) : undefined,
    initialDays: Number(process.env.LICENSE_INITIAL_DAYS || 7),
  },
  zoom: {
    accountId: process.env.ZOOM_ACCOUNT_ID || '',
    clientId: process.env.ZOOM_CLIENT_ID || '',
    clientSecret: process.env.ZOOM_CLIENT_SECRET || '',
    webhookSecretToken: process.env.ZOOM_WEBHOOK_SECRET_TOKEN || '',
  },
};
