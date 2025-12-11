
import { SearchLog, UserProfile, SearchHistoryItem, SearchFilters } from "../types";
import { STORAGE_KEYS } from "../constants";

// Get all logs
export const getSearchLogs = (): SearchLog[] => {
  try {
    const logs = localStorage.getItem(STORAGE_KEYS.SEARCH_LOGS);
    return logs ? JSON.parse(logs) : [];
  } catch (error) {
    console.error("Error reading logs", error);
    return [];
  }
};

// Save a new log
export const saveSearchLog = (log: Omit<SearchLog, 'id' | 'timestamp'>): void => {
  try {
    const logs = getSearchLogs();
    const newLog: SearchLog = {
      ...log,
      id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
      timestamp: Date.now()
    };
    // Prepend new log (newest first)
    const updatedLogs = [newLog, ...logs];
    // Optional: Limit log size to prevent localStorage overflow (e.g., keep last 1000)
    if (updatedLogs.length > 1000) {
        updatedLogs.length = 1000;
    }
    localStorage.setItem(STORAGE_KEYS.SEARCH_LOGS, JSON.stringify(updatedLogs));
  } catch (error) {
    console.error("Error saving log", error);
  }
};

// Clear all logs (Admin only)
export const clearLogs = (): void => {
  localStorage.removeItem(STORAGE_KEYS.SEARCH_LOGS);
};

// Helper to format timestamp
export const formatLogTime = (timestamp: number): string => {
    return new Date(timestamp).toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
};

// --- Client Side Search History (Recent 5) ---

export const getLocalSearchHistory = (): SearchHistoryItem[] => {
  try {
    const history = localStorage.getItem(STORAGE_KEYS.SEARCH_HISTORY);
    return history ? JSON.parse(history) : [];
  } catch (error) {
    console.error("Error reading search history", error);
    return [];
  }
};

export const saveLocalSearchHistory = (keyword: string, filters: SearchFilters): void => {
  if (!keyword || !keyword.trim()) return;
  const trimmedKeyword = keyword.trim();

  try {
    let history = getLocalSearchHistory();
    
    // Remove existing entry for same keyword to avoid duplicates and bump to top
    history = history.filter(item => item.keyword.toLowerCase() !== trimmedKeyword.toLowerCase());
    
    const newItem: SearchHistoryItem = {
      keyword: trimmedKeyword,
      filters,
      timestamp: Date.now()
    };

    // Add to beginning
    history.unshift(newItem);

    // Keep only top 5
    if (history.length > 5) {
      history = history.slice(0, 5);
    }

    localStorage.setItem(STORAGE_KEYS.SEARCH_HISTORY, JSON.stringify(history));
  } catch (error) {
    console.error("Error saving search history", error);
  }
};
