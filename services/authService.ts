
import { UserAccount, UserProfile } from "../types";
import { STORAGE_KEYS } from "../constants";

// Mock Database of users
const MOCK_USERS: UserAccount[] = [
  {
    username: '2868037696',
    password: 'aa520520', 
    name: '超级管理员',
    role: 'admin'
  },
  {
    username: 'operator',
    password: '123456', // Demo password
    name: '运营专员01',
    role: 'user'
  }
];

export const login = (username: string, password: string): UserProfile | null => {
  const user = MOCK_USERS.find(u => u.username === username && u.password === password);
  
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
