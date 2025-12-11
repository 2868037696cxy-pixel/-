

import React, { useState, useEffect } from 'react';
import { Save, Server, Shield, Key, ExternalLink, RefreshCw, CheckCircle2, AlertTriangle, Lock, Cpu, Zap, Eye, EyeOff, Globe } from 'lucide-react';
import { AppSettings, DataSource, UserProfile } from '../types';
import { DEFAULT_SETTINGS, STORAGE_KEYS } from '../constants';
import { verifyApifyToken } from '../services/apifyService';
import { testGeminiConnection } from '../services/geminiService';

interface SettingsPageProps {
    currentUser?: UserProfile;
}

const SettingsPage: React.FC<SettingsPageProps> = ({ currentUser }) => {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [saved, setSaved] = useState(false);
  const [showKey, setShowKey] = useState(false);
  
  // Apify Test State
  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'none' | 'success' | 'failed'>('none');

  // Gemini Test State
  const [testingGemini, setTestingGemini] = useState(false);
  const [geminiStatus, setGeminiStatus] = useState<'none' | 'success' | 'failed'>('none');

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    if (stored) {
      try {
        setSettings(JSON.parse(stored));
      } catch (e) {
        console.error("Failed to parse settings", e);
      }
    }
  }, []);

  const handleSave = () => {
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleTestConnection = async () => {
      setTestingConnection(true);
      setConnectionStatus('none');
      const isValid = await verifyApifyToken(settings.apifyApiToken);
      setTestingConnection(false);
      setConnectionStatus(isValid ? 'success' : 'failed');
  };

  const handleTestGemini = async () => {
      // Force save first so the service picks up the new key from local storage
      localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
      
      setTestingGemini(true);
      setGeminiStatus('none');
      const success = await testGeminiConnection();
      setTestingGemini(false);
      setGeminiStatus(success ? 'success' : 'failed');
  };

  const isAdmin = currentUser?.role === 'admin';

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">设置与配置</h1>
        <p className="text-gray-500 mt-2">管理数据源和 API 连接。</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        {/* Header */}
        <div className="p-6 border-b border-gray-100 bg-gray-50 flex items-center space-x-3">
          <Server className="w-5 h-5 text-blue-600" />
          <h2 className="text-lg font-semibold text-gray-800">数据源配置</h2>
        </div>

        {/* Content */}
        <div className="p-6 space-y-8">
          
          {/* Source Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-3">选择数据提供商</label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div 
                onClick={() => isAdmin && setSettings({...settings, dataSource: DataSource.GEMINI})}
                className={`relative p-4 border-2 rounded-xl transition-all ${isAdmin ? 'cursor-pointer' : 'cursor-not-allowed opacity-80'} ${
                  settings.dataSource === DataSource.GEMINI 
                    ? 'border-blue-500 bg-blue-50' 
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center space-x-3">
                    <div className={`p-2 rounded-lg ${settings.dataSource === DataSource.GEMINI ? 'bg-blue-100' : 'bg-gray-100'}`}>
                       <Shield className={`w-5 h-5 ${settings.dataSource === DataSource.GEMINI ? 'text-blue-600' : 'text-gray-500'}`} />
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900">Gemini AI 模拟</h3>
                      <p className="text-xs text-gray-500 mt-1">使用 AI 生成模拟数据 (测试用)</p>
                    </div>
                  </div>
                  {settings.dataSource === DataSource.GEMINI && <CheckCircle2 className="w-5 h-5 text-blue-500" />}
                </div>
              </div>

              <div 
                onClick={() => isAdmin && setSettings({...settings, dataSource: DataSource.APIFY})}
                className={`relative p-4 border-2 rounded-xl transition-all ${isAdmin ? 'cursor-pointer' : 'cursor-not-allowed opacity-80'} ${
                  settings.dataSource === DataSource.APIFY 
                    ? 'border-blue-500 bg-blue-50' 
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center space-x-3">
                    <div className={`p-2 rounded-lg ${settings.dataSource === DataSource.APIFY ? 'bg-blue-100' : 'bg-gray-100'}`}>
                       <Server className={`w-5 h-5 ${settings.dataSource === DataSource.APIFY ? 'text-blue-600' : 'text-gray-500'}`} />
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900">Apify 实时抓取</h3>
                      <p className="text-xs text-gray-500 mt-1">连接 Actor 实时查询 Facebook 广告库</p>
                    </div>
                  </div>
                   {settings.dataSource === DataSource.APIFY && <CheckCircle2 className="w-5 h-5 text-blue-500" />}
                </div>
              </div>
            </div>
          </div>

          {/* Configuration Forms */}
          {isAdmin ? (
            <>
                {/* Gemini Config Section */}
                {settings.dataSource === DataSource.GEMINI && (
                     <div className="animate-in fade-in slide-in-from-top-4 duration-300 border-t border-gray-100 pt-6">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-sm font-medium text-gray-900 flex items-center">
                                <Cpu className="w-4 h-4 mr-2 text-purple-500" />
                                Gemini API 配置 (2.5 Flash & 3.0 Pro)
                            </h3>
                        </div>

                        <div className="grid grid-cols-1 gap-6">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    自定义 API Key
                                </label>
                                <div className="relative rounded-md shadow-sm">
                                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                        <Key className="h-5 w-5 text-gray-400" />
                                    </div>
                                    <input
                                        type={showKey ? "text" : "password"}
                                        className="block w-full pl-10 pr-10 py-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                                        placeholder="sk-..."
                                        value={settings.customGeminiApiKey || ''}
                                        onChange={(e) => setSettings({...settings, customGeminiApiKey: e.target.value})}
                                    />
                                    <button 
                                        type="button"
                                        onClick={() => setShowKey(!showKey)}
                                        className="absolute inset-y-0 right-0 pr-3 flex items-center cursor-pointer text-gray-400 hover:text-gray-600"
                                    >
                                        {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                    </button>
                                </div>
                            </div>
                            
                            {/* Base URL Input */}
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    Base URL (代理地址)
                                </label>
                                <p className="text-xs text-gray-500 mb-2">
                                    如果您使用 OneAPI 或其他中转服务，请在此填写。默认为 Google 官方地址。
                                </p>
                                <div className="relative rounded-md shadow-sm">
                                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                        <Globe className="h-5 w-5 text-gray-400" />
                                    </div>
                                    <input
                                        type="text"
                                        className="block w-full pl-10 pr-3 py-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                                        placeholder="https://generativelanguage.googleapis.com"
                                        value={settings.customBaseUrl || ''}
                                        onChange={(e) => setSettings({...settings, customBaseUrl: e.target.value})}
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="mt-6 flex items-center space-x-4">
                            <button
                                onClick={handleTestGemini}
                                disabled={testingGemini}
                                className={`flex items-center space-x-2 px-4 py-2 border rounded-lg text-sm font-medium transition-colors ${
                                    testingGemini ? 'bg-gray-100 text-gray-400' : 'bg-white text-gray-700 hover:bg-gray-50 border-gray-300'
                                }`}
                            >
                                {testingGemini ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4 text-yellow-500" />}
                                <span>保存并测试 AI 连接</span>
                            </button>

                            {geminiStatus === 'success' && (
                                <span className="flex items-center text-sm text-green-600 font-medium animate-in fade-in">
                                    <CheckCircle2 className="w-4 h-4 mr-1" />
                                    API 连接正常
                                </span>
                            )}
                            {geminiStatus === 'failed' && (
                                <span className="flex items-center text-sm text-red-600 font-medium animate-in fade-in">
                                    <AlertTriangle className="w-4 h-4 mr-1" />
                                    连接失败 - 请检查 Key 或 Base URL
                                </span>
                            )}
                        </div>
                    </div>
                )}

                {/* Apify Config Section */}
                {settings.dataSource === DataSource.APIFY && (
                    <div className="animate-in fade-in slide-in-from-top-4 duration-300 border-t border-gray-100 pt-6">
                        <div className="bg-yellow-50 border border-yellow-100 rounded-lg p-4 mb-6">
                            <div className="flex">
                                <div className="flex-shrink-0">
                                <ExternalLink className="h-5 w-5 text-yellow-400" aria-hidden="true" />
                                </div>
                                <div className="ml-3">
                                <h3 className="text-sm font-medium text-yellow-800">Apify 配置指南</h3>
                                <div className="mt-2 text-sm text-yellow-700">
                                    <p>1. 系统使用 "Facebook Ads Library Scraper" Actor。</p>
                                    <p>2. 请确保您的 Apify Token 具有调用此 Actor 的权限。</p>
                                </div>
                                </div>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 gap-6">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    Apify API 令牌 (API Token)
                                </label>
                                <div className="relative rounded-md shadow-sm">
                                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                    <Key className="h-5 w-5 text-gray-400" />
                                    </div>
                                    <input
                                    type="password"
                                    className="block w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                                    placeholder="apify_api_..."
                                    value={settings.apifyApiToken}
                                    onChange={(e) => setSettings({...settings, apifyApiToken: e.target.value})}
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="mt-6 flex items-center space-x-4">
                            <button
                                onClick={handleTestConnection}
                                disabled={testingConnection || !settings.apifyApiToken}
                                className={`flex items-center space-x-2 px-4 py-2 border rounded-lg text-sm font-medium transition-colors ${
                                    testingConnection ? 'bg-gray-100 text-gray-400' : 'bg-white text-gray-700 hover:bg-gray-50 border-gray-300'
                                }`}
                            >
                                {testingConnection ? <RefreshCw className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                                <span>测试连接</span>
                            </button>

                            {connectionStatus === 'success' && (
                                <span className="flex items-center text-sm text-green-600 font-medium animate-in fade-in">
                                    <CheckCircle2 className="w-4 h-4 mr-1" />
                                    连接成功
                                </span>
                            )}
                            {connectionStatus === 'failed' && (
                                <span className="flex items-center text-sm text-red-600 font-medium animate-in fade-in">
                                    <AlertTriangle className="w-4 h-4 mr-1" />
                                    连接失败 - 令牌无效
                                </span>
                            )}
                        </div>
                    </div>
                )}
            </>
          ) : (
              <div className="flex items-center justify-center p-6 bg-gray-50 border border-gray-200 border-dashed rounded-lg text-gray-500">
                  <Lock className="w-5 h-5 mr-2" />
                  <span>API 配置已被锁定，请联系管理员修改。</span>
              </div>
          )}
          
        </div>
        
        {/* Footer */}
        {isAdmin && (
            <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex items-center justify-between">
                <div className="flex items-center space-x-2 text-sm text-gray-500">
                    <Shield className="w-4 h-4 text-green-500" />
                    <span>系统状态: 正常</span>
                </div>
                <button
                    onClick={handleSave}
                    className={`flex items-center space-x-2 px-6 py-2.5 rounded-lg text-white font-medium transition-all transform active:scale-95 ${
                        saved ? 'bg-green-600 hover:bg-green-700' : 'bg-blue-600 hover:bg-blue-700'
                    }`}
                >
                    {saved ? (
                        <>
                            <CheckCircle2 className="w-4 h-4" />
                            <span>已保存！</span>
                        </>
                    ) : (
                        <>
                            <Save className="w-4 h-4" />
                            <span>保存配置</span>
                        </>
                    )}
                </button>
            </div>
        )}
      </div>
    </div>
  );
};

export default SettingsPage;