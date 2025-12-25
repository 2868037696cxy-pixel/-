
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
  adMedia?: string; 
  mediaType: MediaType;
  ctaText: string;
  startDate: string;
  endDate?: string;
  isActive: boolean;
  platform: string[];
  adLibraryUrl?: string;
  count?: number;
  displayLink?: string; 
  headline?: string;    
  translatedCopy?: string;
  originalKeyword?: string; 
  reach?: number; 
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
  apifyDatasetId: string; 
  autoAnalyze: boolean;
  customGeminiApiKey?: string; 
  customBaseUrl?: string; 
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

// Interface for hoisting the search page state to prevent data loss on tab navigation
export interface BatchResult {
    keyword: string;
    count: number;
    error?: string;
}

export interface SearchPageState {
    isBatchMode: boolean;
    inputKeyword: string;
    filters: SearchFilters;
    batchKeywords: string;
    batchResults: BatchResult[];
    batchProgress: number;
    batchTotal: number;
    isBatchLoading: boolean;
    groupSize: number;
    groupCount: number;
    startGroup: number;
    concurrency: number;
}
