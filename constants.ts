
import { ModelType, AppSettings, DataSource } from './types';

export const APP_NAME = "FB Ads Insight Pro";

// Placeholder images source
export const PLACEHOLDER_AVATAR = (seed: string) => `https://picsum.photos/seed/${seed}/50/50`;
export const PLACEHOLDER_AD_IMAGE = (seed: string) => `https://picsum.photos/seed/${seed}/600/400`;

export const GEMINI_API_KEY = process.env.API_KEY || '';

export const DEFAULT_CHAT_MODEL = ModelType.PRO;
export const SEARCH_MODEL = ModelType.FLASH;

export const MAX_THINKING_BUDGET = 32768;

export const ACTOR_ID = 'curious_coder~facebook-ads-library-scraper';

export const STORAGE_KEYS = {
  SETTINGS: 'fb_ads_app_settings',
  SEARCH_LOGS: 'fb_ads_search_logs',
  CURRENT_USER: 'fb_ads_current_user',
  SEARCH_HISTORY: 'fb_ads_local_search_history',
  USERS: 'fb_ads_registered_users',
  LAST_SESSION: 'fb_ads_last_session_data'
};

export const DEFAULT_SETTINGS: AppSettings = {
  dataSource: DataSource.GEMINI, 
  apifyApiToken: 'apify_api_FLrMKmrqYRkoh7gOn19Pea8XUG4Wpz0xBu5v',
  apifyDatasetId: '', 
  autoAnalyze: false,
  customGeminiApiKey: 'sk-kyK8SyiKq91HuI1muxzIXe3jHjyMXmhNfSlglZAYw36NPpfY',
  customBaseUrl: 'https://api.vectorengine.ai'
};
