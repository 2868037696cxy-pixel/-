import React, { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import AdSearchPage from './pages/AdSearchPage';
import ChatWindow from './components/ChatWindow';
import AnalyticsPage from './pages/AnalyticsPage';
import SettingsPage from './pages/SettingsPage';
import AdminPage from './pages/AdminPage';
import LoginPage from './pages/LoginPage';
import { getCurrentUser, logout } from './services/authService';
import { Ad, UserProfile } from './types';

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState('search');
  const [globalAds, setGlobalAds] = useState<Ad[]>([]);
  const [globalKeyword, setGlobalKeyword] = useState('');
  
  // Auth State
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);

  // Load user from storage on boot
  useEffect(() => {
    const user = getCurrentUser();
    setCurrentUser(user);
    setIsLoadingAuth(false);
  }, []);

  const handleLoginSuccess = (user: UserProfile) => {
    setCurrentUser(user);
    setActiveTab('search');
  };

  const handleLogout = () => {
    logout();
    setCurrentUser(null);
    setGlobalAds([]);
    setGlobalKeyword('');
  };

  const handleAdsFetched = (ads: Ad[], keyword: string) => {
    setGlobalAds(ads);
    setGlobalKeyword(keyword);
  };

  // Auth Loading Screen
  if (isLoadingAuth) {
    return <div className="min-h-screen bg-gray-50 flex items-center justify-center">Loading...</div>;
  }

  // Login Guard
  if (!currentUser) {
    return <LoginPage onLoginSuccess={handleLoginSuccess} />;
  }

  const renderContent = () => {
    switch (activeTab) {
      case 'search': 
        return (
          <AdSearchPage 
            onAdsFetched={handleAdsFetched} 
            initialKeyword={globalKeyword}
            initialAds={globalAds}
            currentUser={currentUser}
          />
        );
      case 'chat': 
        return (
          <div className="h-[calc(100vh)] p-4 md:p-8 flex flex-col">
             <div className="mb-4">
               <h1 className="text-2xl font-bold text-gray-900">AI 助手</h1>
               <p className="text-gray-500">利用 Gemini 获取洞察、生成文案或分析市场趋势。</p>
             </div>
             <ChatWindow />
          </div>
        );
      case 'analytics': 
        return <AnalyticsPage ads={globalAds} keyword={globalKeyword} />;
      case 'admin':
        return <AdminPage currentUser={currentUser} />;
      case 'settings':
        return <SettingsPage currentUser={currentUser} />;
      default: 
        return (
          <AdSearchPage 
            onAdsFetched={handleAdsFetched} 
            initialKeyword={globalKeyword}
            initialAds={globalAds}
            currentUser={currentUser}
          />
        );
    }
  };

  return (
    <div className="flex bg-gray-50 min-h-screen">
      {/* Fixed: Removed extraneous onUpdateUser prop which caused type error */}
      <Sidebar 
        activeTab={activeTab} 
        onTabChange={setActiveTab} 
        currentUser={currentUser}
        onLogout={handleLogout}
      />
      <main className="flex-1 md:ml-64 transition-all duration-300 w-full">
        {renderContent()}
      </main>
    </div>
  );
};

export default App;