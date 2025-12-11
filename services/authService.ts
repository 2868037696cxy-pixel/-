
import { UserAccount, UserProfile } from "../types";
import { STORAGE_KEYS } from "../constants";

// Helper to get all users from storage
const getStoredUsers = (): UserAccount[] => {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.USERS);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.error("Failed to parse users", e);
  }
  return [];
};

// Ensure the specific Admin account always exists
const ensureAdminAndGetUsers = (): UserAccount[] => {
  let users = getStoredUsers();
  const adminUsername = '2868037696';
  
  const adminExists = users.some(u => u.username === adminUsername);
  
  if (!adminExists) {
    const adminUser: UserAccount = {
      username: adminUsername,
      password: 'aa520520',
      name: '超级管理员',
      role: 'admin'
    };
    users = [adminUser, ...users];
    localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(users));
  }
  
  return users;
};

export const login = (username: string, password: string): UserProfile | null => {
  const users = ensureAdminAndGetUsers();
  const user = users.find(u => u.username === username && u.password === password);
  
  if (user) {
    const profile: UserProfile = {
      name: user.name,
      role: user.role
    };
    // Persist session
    localStorage.setItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(profile));
    return profile;
  }
  
  return null;
};

export const register = (user: UserAccount): boolean => {
  const users = ensureAdminAndGetUsers();
  
  if (users.some(u => u.username === user.username)) {
    return false; // User already exists
  }

  const newUsers = [...users, user];
  localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(newUsers));
  
  // Auto login after register
  const profile: UserProfile = {
      name: user.name,
      role: user.role
  };
  localStorage.setItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(profile));
  
  return true;
};

export const logout = (): void => {
  localStorage.removeItem(STORAGE_KEYS.CURRENT_USER);
};

export const getCurrentUser = (): UserProfile | null => {
  const stored = localStorage.getItem(STORAGE_KEYS.CURRENT_USER);
  if (stored) {
    try {
      return JSON.parse(stored);
    } catch (e) {
      return null;
    }
  }
  return null;
};

// For Admin Page: Get all users to display passwords
export const getAllUsers = (): UserAccount[] => {
  return ensureAdminAndGetUsers();
};
