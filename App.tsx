
import React, { useState, useEffect, useCallback } from 'react';
import Sidebar from './components/Sidebar';
import AdSearchPage from './pages/AdSearchPage';
import ChatWindow from './components/ChatWindow';
import AnalyticsPage from './pages/AnalyticsPage';
import SettingsPage from './pages/SettingsPage';
import AdminPage from './pages/AdminPage';
import LoginPage from './pages/LoginPage';
import { getCurrentUser, logout } from './services/authService';
import { getLastSession, saveLastSession, saveSearchLog, saveLocalSearchHistory } from './services/storageService';
import { searchAdsWithGemini } from './services/geminiService';
import { searchAdsWithApify } from './services/apifyService';
import { Ad, UserProfile, SearchFilters, DataSource, SearchPageState } from './types';
import { Loader2, Zap } from 'lucide-react';

const INITIAL_SEARCH_STATE: SearchPageState = {
    isBatchMode: false,
    inputKeyword: '',
    filters: {
        dateRange: 'LAST_30_DAYS',
        adType: 'all',
        region: 'ALL',
        language: 'auto',
        mediaType: 'ALL',
        status: 'ACTIVE'
    },
    batchKeywords: '',
    batchResults: [],
    batchProgress: 0,
    batchTotal: 0,
    isBatchLoading: false,
    groupSize: 10,
    groupCount: 1,
    startGroup: 1,
    concurrency: 5
};

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState('search');
  const [globalAds, setGlobalAds] = useState<Ad[]>([]);
  const [globalKeyword, setGlobalKeyword] = useState('');
  
  // Hoisted UI State for Search Page
  const [searchPageState, setSearchPageState] = useState<SearchPageState>(INITIAL_SEARCH_STATE);

  // Global Search State (Background Process)
  const [isSearching, setIsSearching] = useState(false);
  const [searchingKeyword, setSearchingKeyword] = useState('');

  // Auth State
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);

  // Load user from storage on boot
  useEffect(() => {
    const user = getCurrentUser();
    setCurrentUser(user);
    setIsLoadingAuth(false);
  }, []);

  // When user changes (logs in), try to restore their session
  useEffect(() => {
    if (currentUser && currentUser.name) {
        const sessionData = getLastSession(currentUser.name);
        if (sessionData && sessionData.ads.length > 0) {
            setGlobalAds(sessionData.ads);
            setGlobalKeyword(sessionData.keyword);
            setSearchPageState(prev => ({
                ...prev,
                inputKeyword: sessionData.keyword
            }));
        } else {
            setGlobalAds([]);
            setGlobalKeyword('');
            setSearchPageState(INITIAL_SEARCH_STATE);
        }
    }
  }, [currentUser]);

  const handleLoginSuccess = (user: UserProfile) => {
    setCurrentUser(user);
    setActiveTab('search');
  };

  const handleLogout = () => {
    logout();
    setCurrentUser(null);
    setGlobalAds([]);
    setGlobalKeyword('');
    setSearchPageState(INITIAL_SEARCH_STATE);
    setIsSearching(false);
  };

  // Centralized Search Handler
  const performSearch = async (keyword: string, filters: SearchFilters, dataSource: DataSource, apifyToken: string) => {
      setIsSearching(true);
      setSearchingKeyword(keyword);
      
      saveLocalSearchHistory(keyword, filters);

      try {
          let results: Ad[] = [];
          if (dataSource === DataSource.APIFY) {
            results = await searchAdsWithApify(apifyToken, keyword, filters);
          } else {
            results = await searchAdsWithGemini(keyword, filters);
          }
          
          setGlobalAds(results);
          setGlobalKeyword(keyword);
          
          if (currentUser && currentUser.name) {
             saveLastSession(currentUser.name, results, keyword);
             saveSearchLog({
                userId: currentUser.name, 
                userName: currentUser.name,
                keyword: keyword,
                resultCount: results.length,
                dataSource: dataSource,
                filtersUsed: true
              });
          }
      } catch (error: any) {
          console.error("Search failed", error);
          alert(`搜索失败: ${error.message}`);
      } finally {
          setIsSearching(false);
          setSearchingKeyword('');
      }
  };

  const handleUpdateAds = (updatedAds: Ad[]) => {
      setGlobalAds(updatedAds);
      if (currentUser && currentUser.name) {
          saveLastSession(currentUser.name, updatedAds, globalKeyword);
      }
  };

  const handleUpdateSearchPageState = useCallback((updates: Partial<SearchPageState>) => {
      setSearchPageState(prev => ({ ...prev, ...updates }));
  }, []);

  if (isLoadingAuth) {
    return <div className="min-h-screen bg-gray-50 flex items-center justify-center">Loading...</div>;
  }

  if (!currentUser) {
    return <LoginPage onLoginSuccess={handleLoginSuccess} />;
  }

  const renderContent = () => {
    switch (activeTab) {
      case 'search': 
        return (
          <AdSearchPage 
            ads={globalAds}
            keyword={globalKeyword}
            onUpdateAds={handleUpdateAds}
            isSearching={isSearching}
            onSearch={performSearch}
            currentUser={currentUser}
            state={searchPageState}
            onUpdateState={handleUpdateSearchPageState}
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
            ads={globalAds}
            keyword={globalKeyword}
            onUpdateAds={handleUpdateAds}
            isSearching={isSearching}
            onSearch={performSearch}
            currentUser={currentUser}
            state={searchPageState}
            onUpdateState={handleUpdateSearchPageState}
          />
        );
    }
  };

  return (
    <div className="flex bg-gray-50 min-h-screen relative">
      <Sidebar 
        activeTab={activeTab} 
        onTabChange={setActiveTab} 
        currentUser={currentUser}
        onLogout={handleLogout}
      />
      <main className="flex-1 md:ml-64 transition-all duration-300 w-full relative">
        {isSearching && (
            <div className="w-full bg-blue-50 h-1 overflow-hidden absolute top-0 left-0 right-0 z-50">
                <div className="h-full bg-blue-600 animate-[pulse_1s_cubic-bezier(0.4,0,0.6,1)_infinite] w-1/2 translate-x-[-100%] ml-[50%]"></div>
            </div>
        )}
        
        {renderContent()}

        {isSearching && (
            <div className="fixed bottom-6 right-6 bg-white rounded-xl shadow-2xl border border-blue-100 p-4 z-[100] animate-in slide-in-from-bottom-8 duration-300 flex items-center space-x-4 max-w-sm ring-1 ring-black/5">
                <div className="relative flex-shrink-0">
                    <div className="w-10 h-10 bg-blue-50 rounded-full flex items-center justify-center">
                    <Zap className="w-5 h-5 text-blue-600 fill-blue-600 animate-pulse" />
                    </div>
                    <div className="absolute -bottom-1 -right-1 bg-white rounded-full p-0.5">
                    <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
                    </div>
                </div>
                <div className="flex-1 min-w-[150px]">
                    <p className="text-sm font-bold text-gray-800">正在后台搜索...</p>
                    <p className="text-xs text-gray-500 truncate max-w-[180px] mt-0.5">关键词: <span className="font-medium text-blue-600">{searchingKeyword}</span></p>
                </div>
                <div className="flex flex-col items-end justify-center">
                    <div className="flex space-x-1">
                        <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce"></span>
                        <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce delay-100"></span>
                        <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce delay-200"></span>
                    </div>
                </div>
            </div>
        )}
      </main>
    </div>
  );
};

export default App;
