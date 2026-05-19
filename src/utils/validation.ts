export const passwordHelpText = 'Password must be at least 8 characters and include uppercase, lowercase, and a number.';

export const normalizeName = (value: unknown): string => String(value || '').trim();

export const normalizeUsername = (value: unknown): string => String(value || '').trim().toLowerCase();

export const normalizeEmail = (value: unknown): string => String(value || '').trim().toLowerCase();

export const normalizePhone = (value: unknown): string => String(value || '').trim();

export const validateUsername = (username: string): string | null => {
  if (!username) return 'Username is required';
  if (username.length < 3 || username.length > 30) return 'Username must be 3 to 30 characters long';
  if (!/^[a-z0-9._-]+$/.test(username)) {
    return 'Username can only contain lowercase letters, numbers, dots, underscores, and hyphens';
  }
  return null;
};

export const validatePassword = (password: string): string | null => {
  if (!password) return 'Password is required';
  if (password.length < 8) return passwordHelpText;
  if (!/[A-Z]/.test(password)) return passwordHelpText;
  if (!/[a-z]/.test(password)) return passwordHelpText;
  if (!/[0-9]/.test(password)) return passwordHelpText;
  return null;
};

export const validateEmail = (email: string): string | null => {
  if (!email) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Enter a valid email address';
  return null;
};

export const validatePhone = (phone: string): string | null => {
  if (!phone) return null;
  if (!/^[0-9+\-\s()]{7,20}$/.test(phone)) return 'Enter a valid phone number';
  return null;
};

export const getDuplicateKeyMessage = (err: unknown): string | null => {
  const error = err as { code?: number; keyPattern?: Record<string, number>; keyValue?: Record<string, unknown> };
  if (error?.code !== 11000) return null;

  if (error.keyPattern?.username) return 'Username already taken';
  if (error.keyPattern?.email) return 'Email already taken';

  const duplicateField = Object.keys(error.keyValue || {})[0];
  return duplicateField ? `${duplicateField} already exists` : 'This record already exists';
};

export const getErrorMessage = (_err: unknown): string => 'Server error. Please try again.';
