import { ProjectResourceType } from '../models/Project.model';

export const isValidProjectResourceUrl = (resourceType: ProjectResourceType, value: string): boolean => {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
    if (resourceType === 'drive') {
      return ['drive.google.com', 'docs.google.com'].includes(url.hostname.toLowerCase());
    }
    if (resourceType === 'github') {
      return url.hostname.toLowerCase() === 'github.com'
        && /^\/[^/]+\/[^/]+\/?$/.test(url.pathname);
    }
    return false;
  } catch {
    return false;
  }
};
