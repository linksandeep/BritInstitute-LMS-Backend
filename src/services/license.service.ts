import crypto from 'crypto';
import mongoose, { Model } from 'mongoose';
import { config } from '../config/env';
import { ISoftwareLicense, softwareLicenseSchema } from '../models/SoftwareLicense.model';

type LicenseMode = 'disabled' | 'database' | 'super';

export interface LicenseStatus {
  allowed: boolean;
  mode: LicenseMode;
  expiresAt?: Date;
  message: string;
}

export class SoftwareLicenseError extends Error {
  status: LicenseStatus;

  constructor(status: LicenseStatus) {
    super(status.message);
    this.name = 'SoftwareLicenseError';
    this.status = status;
  }
}

let licenseConnection: mongoose.Connection | null = null;
let licenseModel: Model<ISoftwareLicense> | null = null;
let monitorStarted = false;
let runtimeSuperLicenseActive = false;
let activationFailures = 0;
let activationLockedUntil: Date | null = null;
let cachedStatus: LicenseStatus = {
  allowed: false,
  mode: 'database',
  message: 'Software license has not been validated yet',
};

// Fixed internal encoder: each character is moved five positions forward.
const encodeLicenseValue = (value: string): string => {
  return Array.from(value).map((char) => String.fromCharCode(char.charCodeAt(0) + 5)).join('');
};

const safeEquals = (left: string, right: string): boolean => {
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(Buffer.from(left), Buffer.from(right));
};

const addDays = (date: Date, days: number): Date => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const addMinutes = (date: Date, minutes: number): Date => {
  return new Date(date.getTime() + minutes * 60 * 1000);
};

const addConfiguredDuration = (date: Date, minutes: number | undefined, days: number): Date => {
  return Number.isFinite(minutes) && minutes !== undefined ? addMinutes(date, minutes) : addDays(date, days);
};

const getLicenseModel = (): Model<ISoftwareLicense> => {
  if (!licenseConnection) {
    licenseConnection = mongoose.createConnection(config.license.mongoUri, {
      dbName: config.license.mongoDbName,
    });
  }

  if (!licenseModel) {
    licenseModel = licenseConnection.model<ISoftwareLicense>('SoftwareLicense', softwareLicenseSchema);
  }

  return licenseModel;
};

const getEnteredLicenseEncoded = (): string => encodeLicenseValue(config.license.key.trim());

const normalizeConfiguredEncodedValue = (value: string): string => {
  const trimmed = value.trim();
  return trimmed.includes('@') || /^[A-Za-z]+$/.test(trimmed) ? encodeLicenseValue(trimmed) : trimmed;
};

const matchesConfiguredEncodedValue = (encodedValue: string, configuredValue: string): boolean => {
  const trimmed = configuredValue.trim();
  return safeEquals(encodedValue, trimmed) || safeEquals(encodedValue, normalizeConfiguredEncodedValue(trimmed));
};

const isSuperLicenseValid = (): boolean => {
  const envSuperCode = config.license.superCode ? encodeLicenseValue(config.license.superCode.trim()) : '';
  return runtimeSuperLicenseActive ||
    matchesConfiguredEncodedValue(getEnteredLicenseEncoded(), config.license.encodedSuperLicense) ||
    Boolean(envSuperCode && matchesConfiguredEncodedValue(envSuperCode, config.license.encodedSuperLicense));
};

const hasInvalidEnvSuperCode = (): boolean => {
  if (!config.license.superCode.trim()) return false;
  return !matchesConfiguredEncodedValue(encodeLicenseValue(config.license.superCode.trim()), config.license.encodedSuperLicense);
};

export const getLicenseBoundJwtSecret = (): string => {
  return crypto
    .createHmac('sha256', config.jwtSecret)
    .update(getEnteredLicenseEncoded())
    .update(normalizeConfiguredEncodedValue(config.license.encodedLicense))
    .update(normalizeConfiguredEncodedValue(config.license.encodedSuperLicense))
    .digest('hex');
};

export const checkSoftwareLicense = async (): Promise<LicenseStatus> => {
  if (isSuperLicenseValid()) {
    return { allowed: true, mode: 'super', message: 'Super license active' };
  }

  if (hasInvalidEnvSuperCode()) {
    return { allowed: false, mode: 'database', message: 'License Invalid' };
  }

  try {
    const now = new Date();
    const SoftwareLicense = getLicenseModel();
    const license = await SoftwareLicense.findOne().sort({ updatedAt: -1 });
    if (!license?.license) {
      return { allowed: false, mode: 'database', message: 'License Invalid' };
    }

    const encodedDatabaseLicense = encodeLicenseValue(license.license.trim());
    if (!matchesConfiguredEncodedValue(encodedDatabaseLicense, config.license.encodedLicense)) {
      return { allowed: false, mode: 'database', message: 'License Invalid' };
    }

    const refreshedExpiresAt = addConfiguredDuration(now, config.license.initialMinutes, config.license.initialDays);
    license.expiresAt = refreshedExpiresAt;
    license.note = 'License matched and validation timer was refreshed';
    await license.save();

    return {
      allowed: true,
      mode: 'database',
      expiresAt: refreshedExpiresAt,
      message: `License valid until ${refreshedExpiresAt.toISOString()}`,
    };
  } catch {
    return { allowed: false, mode: 'database', message: 'License Invalid' };
  }
};

const getActivationLockStatus = (): LicenseStatus | null => {
  if (!activationLockedUntil) return null;
  if (activationLockedUntil <= new Date()) {
    activationLockedUntil = null;
    activationFailures = 0;
    return null;
  }

  return {
    allowed: false,
    mode: 'database',
    expiresAt: activationLockedUntil,
    message: `Too many wrong license attempts. Try again after ${activationLockedUntil.toISOString()}`,
  };
};

const markActivationFailure = (): LicenseStatus => {
  activationFailures += 1;
  if (activationFailures >= config.license.maxActivationAttempts) {
    activationLockedUntil = new Date(Date.now() + config.license.activationLockoutMs);
  }

  return getActivationLockStatus() || {
    allowed: false,
    mode: 'database',
    message: `License Invalid. ${Math.max(0, config.license.maxActivationAttempts - activationFailures)} attempt(s) remaining.`,
  };
};

export const activateSoftwareLicense = async (licenseKey: string): Promise<LicenseStatus> => {
  const lockStatus = getActivationLockStatus();
  if (lockStatus) {
    cachedStatus = lockStatus;
    return cachedStatus;
  }

  const enteredLicense = String(licenseKey || '').trim();
  const encodedEnteredLicense = encodeLicenseValue(enteredLicense);

  if (matchesConfiguredEncodedValue(encodedEnteredLicense, config.license.encodedSuperLicense)) {
    runtimeSuperLicenseActive = true;
    activationFailures = 0;
    activationLockedUntil = null;
    cachedStatus = { allowed: true, mode: 'super', message: 'Super license active' };
    return cachedStatus;
  }

  if (!matchesConfiguredEncodedValue(encodedEnteredLicense, config.license.encodedLicense)) {
    cachedStatus = markActivationFailure();
    return cachedStatus;
  }

  try {
    const now = new Date();
    const expiresAt = addConfiguredDuration(now, config.license.initialMinutes, config.license.initialDays);
    const SoftwareLicense = getLicenseModel();
    await SoftwareLicense.updateOne(
      {},
      {
        $set: {
          license: enteredLicense,
          issuedAt: now,
          expiresAt,
          note: 'License entered from activation prompt',
        },
      },
      { upsert: true }
    );

    activationFailures = 0;
    activationLockedUntil = null;
    cachedStatus = await checkSoftwareLicense();
    return cachedStatus;
  } catch {
    cachedStatus = { allowed: false, mode: 'database', message: 'License Invalid' };
    return cachedStatus;
  }
};

export const refreshSoftwareLicenseStatus = async (): Promise<LicenseStatus> => {
  cachedStatus = await checkSoftwareLicense();
  return cachedStatus;
};

export const startSoftwareLicenseMonitor = (): void => {
  if (monitorStarted) return;
  monitorStarted = true;

  const interval = Number.isFinite(config.license.validationIntervalMs) && config.license.validationIntervalMs > 0
    ? config.license.validationIntervalMs
    : 60_000;

  windowlessSetInterval(() => {
    void refreshSoftwareLicenseStatus();
  }, interval);
};

const windowlessSetInterval = (callback: () => void, ms: number): NodeJS.Timeout => {
  return setInterval(callback, ms);
};

export const assertSoftwareLicense = async (): Promise<LicenseStatus> => {
  if (!cachedStatus.allowed) {
    cachedStatus = await checkSoftwareLicense();
  }

  if (!cachedStatus.allowed) {
    throw new SoftwareLicenseError(cachedStatus);
  }

  return cachedStatus;
};
