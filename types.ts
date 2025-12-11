

export enum MediaType {
  IMAGE = 'IMAGE',
  VIDEO = 'VIDEO'
}

export type Platform = 'Facebook' | 'Instagram' | 'Audience Network' | 'Messenger';

export enum AdStatus {
  ALL = 'ALL',
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE'
}

export interface SearchFilters {
  dateRange: string; // 'LAST_30_DAYS', 'LAST_7_DAYS', etc.
  adType: string;    // 'all', 'political_and_issue_ads', etc.
  region: string;    // 'ALL', 'US', 'CN', etc.
  language?: string;
  // Added optional properties to support GeminiService and potential future UI
  platforms?: string[];
  status?: AdStatus | string;
  mediaType?: MediaType | string;
  startDate?: string;
  endDate?: string;
}

export interface Ad {
  id: string;
  advertiserName: string;
  advertiserAvatar: string;
  adCopy: string;
  adMedia?: string; // Made optional as we are hiding it
  mediaType: MediaType;
  ctaText: string;
  startDate: string;
  endDate?: string;
  isActive: boolean;
  platform: string[];
  adLibraryUrl?: string;
  count?: number;
  displayLink?: string; // e.g. WWW.ZXNCIETUR.SHOP
  headline?: string;    // e.g. Zxncietur-qw
  translatedCopy?: string;
  originalKeyword?: string; // Track which keyword found this ad
}

export interface Message {
  id: string;
  role: 'user' | 'model';
  content: string;
  timestamp: Date;
  isThinking?: boolean;
}

export enum ModelType {
  FLASH = 'gemini-2.5-flash',
  PRO = 'gemini-3-pro-preview'
}

export interface ChatConfig {
  useThinking: boolean;
}

export enum DataSource {
  GEMINI = 'GEMINI',
  APIFY = 'APIFY'
}

export interface AppSettings {
  dataSource: DataSource;
  apifyApiToken: string;
  apifyDatasetId: string; // Kept for backward compat, though less used now
  autoAnalyze: boolean;
  customGeminiApiKey?: string; // New field for custom API Key
  customBaseUrl?: string; // New field for custom Base URL (Proxy)
}

export interface UserProfile {
  name: string;
  role: 'user' | 'admin';
}

export interface UserAccount {
  username: string;
  password: string;
  name: string;
  role: 'user' | 'admin';
}

export interface SearchLog {
  id: string;
  userId: string;
  userName: string;
  keyword: string;
  timestamp: number;
  resultCount: number;
  dataSource: DataSource;
  filtersUsed: boolean;
}

export interface SearchHistoryItem {
  keyword: string;
  filters: SearchFilters;
  timestamp: number;
}