
import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { Search, Filter, Loader2, AlertCircle, Calendar, ChevronDown, ChevronUp, X, Layers, PlayCircle, CheckCircle2, Globe, FileType, Clock, History, Upload, Image, Languages, Settings2, Download, Minus, Plus } from 'lucide-react';
import { searchAdsWithGemini, batchTranslateToChinese } from '../services/geminiService';
import { searchAdsWithApify } from '../services/apifyService';
import { saveSearchLog, getLocalSearchHistory, saveLocalSearchHistory } from '../services/storageService';
import AdCard from '../components/AdCard';
import { Ad, DataSource, SearchFilters, UserProfile, AdStatus, SearchHistoryItem, MediaType } from '../types';
import { STORAGE_KEYS, DEFAULT_SETTINGS } from '../constants';

interface AdSearchPageProps {
  onAdsFetched: (ads: Ad[], keyword: string) => void;
  initialAds: Ad[];
  initialKeyword: string;
  currentUser: UserProfile;
}

const AdSearchPage: React.FC<AdSearchPageProps> = ({ onAdsFetched, initialAds, initialKeyword, currentUser }) => {
  const [keyword, setKeyword] = useState(initialKeyword);
  const [ads, setAds] = useState<Ad[]>(initialAds);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(initialAds.length > 0);
  const [dataSource, setDataSource] = useState<DataSource>(DataSource.GEMINI);
  const [apifyToken, setApifyToken] = useState<string>(DEFAULT_SETTINGS.apifyApiToken);
  const [searchHistory, setSearchHistory] = useState<SearchHistoryItem[]>([]);
  
  // Batch Mode State
  const [isBatchMode, setIsBatchMode] = useState(false);
  const [batchKeywords, setBatchKeywords] = useState('');
  const [batchProgress, setBatchProgress] = useState(0);
  const [batchTotal, setBatchTotal] = useState(0);
  const [batchResults, setBatchResults] = useState<{keyword: string, count: number, error?: string}[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Batch Grouping Configuration
  const [groupSize, setGroupSize] = useState(10);
  const [groupCount, setGroupCount] = useState(1);
  const [startGroup, setStartGroup] = useState(1);
  const [concurrency, setConcurrency] = useState(5); // Default concurrency increased slightly for convenience

  // Translation State
  const [isTranslatingAll, setIsTranslatingAll] = useState(false);
  const [translationProgress, setTranslationProgress] = useState<{current: number, total: number} | null>(null);

  // Advanced Filter State
  const [showFilters, setShowFilters] = useState(true); 
  const [filters, setFilters] = useState<SearchFilters>({
    dateRange: 'LAST_30_DAYS',
    adType: 'all',
    region: 'ALL',
    language: 'auto',
    mediaType: 'ALL',
    status: 'ACTIVE' // Default to Active
  });

  useEffect(() => {
    const storedSettings = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    if (storedSettings) {
        try {
            const parsed = JSON.parse(storedSettings);
            setDataSource(parsed.dataSource || DataSource.GEMINI);
            if (parsed.apifyApiToken) setApifyToken(parsed.apifyApiToken);
        } catch (e) {
            console.error("Error reading settings", e);
        }
    }
    setSearchHistory(getLocalSearchHistory());
  }, []);

  useEffect(() => {
    if (initialAds.length > 0 && ads.length === 0) {
      setAds(initialAds);
      setSearched(true);
    }
    if (initialKeyword && !keyword) {
      setKeyword(initialKeyword);
    }
  }, [initialAds, initialKeyword]);

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        const text = e.target?.result as string;
        if (text) {
            setBatchKeywords(text);
        }
    };
    reader.readAsText(file);
    if (fileInputRef.current) {
        fileInputRef.current.value = '';
    }
  };

  const parsedKeywords = useMemo(() => {
    return batchKeywords
        .split(/[\s,]+/) 
        .map(k => k.trim())
        .filter(k => k.length > 0);
  }, [batchKeywords]);

  const targetKeywords = useMemo(() => {
      const startIndex = (startGroup - 1) * groupSize;
      const count = groupSize * groupCount;
      return parsedKeywords.slice(startIndex, startIndex + count);
  }, [parsedKeywords, groupSize, groupCount, startGroup]);

  const totalAvailableGroups = useMemo(() => {
      return Math.ceil(parsedKeywords.length / groupSize);
  }, [parsedKeywords.length, groupSize]);


  const handleBatchSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (targetKeywords.length === 0) {
        alert("没有可处理的关键词。");
        return;
    }

    if (dataSource !== DataSource.APIFY) {
        alert("批量模式需要切换到 Apify 数据源。");
        return;
    }

    setLoading(true);
    setBatchProgress(0);
    setBatchTotal(targetKeywords.length);
    setBatchResults([]);
    setAds([]); 

    try {
        const CHUNK_SIZE = concurrency; 
        let allAds: Ad[] = [];
        let fatalErrorOccurred = false;

        for (let i = 0; i < targetKeywords.length; i += CHUNK_SIZE) {
            if (fatalErrorOccurred) break;

            const chunk = targetKeywords.slice(i, i + CHUNK_SIZE);
            
            const chunkPromises = chunk.map(async (k) => {
                if (fatalErrorOccurred) return { keyword: k, ads: [], success: false, error: "Skipped due to fatal error" };

                try {
                    const res = await searchAdsWithApify(apifyToken, k, filters);
                    
                    // Real-time update: Success
                    // Using functional state update to handle concurrency
                    setBatchResults(prev => [...prev, { 
                        keyword: k, 
                        count: res.length 
                    }]);
                    setBatchProgress(prev => prev + 1);

                    return { keyword: k, ads: res, success: true };
                } catch (err: any) {
                    const isFatal = err.isFatal || (err.message && err.message.includes('403'));
                    if (isFatal) {
                        fatalErrorOccurred = true;
                    }

                    // Real-time update: Failure
                    setBatchResults(prev => [...prev, { 
                        keyword: k, 
                        count: 0, 
                        error: err.message 
                    }]);
                    setBatchProgress(prev => prev + 1);

                    if (isFatal) {
                        return { keyword: k, ads: [], success: false, error: err.message, isFatal: true };
                    }
                    console.error(`Failed to scrape ${k}`, err);
                    return { keyword: k, ads: [], success: false, error: err.message };
                }
            });

            // Wait for chunk to finish to respect concurrency limit, but updates happened in real-time above
            const chunkResults = await Promise.all(chunkPromises);

            for (const res of chunkResults) {
                if (res.isFatal) {
                    fatalErrorOccurred = true;
                    alert(`关键错误: ${res.error}\n批量任务已停止。`);
                }
                if (res.ads) {
                    allAds = [...allAds, ...res.ads];
                }
            }
        }

        const uniqueAds = Array.from(new Map(allAds.map(item => [item.id, item])).values());
        setAds(uniqueAds);
        onAdsFetched(uniqueAds, `批量搜索 (${targetKeywords.length} 词)`);
        setSearched(true);

    } catch (error) {
        console.error("Batch search error", error);
    } finally {
        setLoading(false);
    }
  };

  const handleTranslateAll = async () => {
      if (ads.length === 0) return;
      setIsTranslatingAll(true);
      
      try {
          const adsToTranslateIndices = ads.map((_, idx) => idx);
          let newTranslationsMap: Record<number, string> = {};
          
          const BATCH_SIZE = 50; 

          setTranslationProgress({ current: 0, total: ads.length });
          let completedCount = 0;

          const chunks = [];
          for (let i = 0; i < adsToTranslateIndices.length; i += BATCH_SIZE) {
              chunks.push(adsToTranslateIndices.slice(i, i + BATCH_SIZE));
          }

          // Process chunks
          for (const batchIndices of chunks) {
              const batchTexts = batchIndices.map(idx => ads[idx].adCopy || "");
              
              try {
                  const results = await batchTranslateToChinese(batchTexts);
                  
                  batchIndices.forEach((originalIndex, arrIdx) => {
                      if (results[arrIdx]) {
                          newTranslationsMap[originalIndex] = results[arrIdx];
                      }
                  });
              } catch (batchError: any) {
                  const msg = (batchError.message || batchError.toString()).toLowerCase();
                  console.error("Batch failed", batchError);
                  
                  if (msg.includes('403') || msg.includes('quota') || msg.includes('insufficient_quota')) {
                      alert("Gemini API 配额已耗尽或 Key 无效，翻译任务强制停止。请检查设置。");
                      break; // STOP LOOP
                  }
              }

              completedCount += batchIndices.length;
              setTranslationProgress({ 
                  current: Math.min(completedCount, ads.length), 
                  total: ads.length 
              });
          }

          const updatedAds = ads.map((ad, index) => ({
              ...ad,
              translatedCopy: newTranslationsMap[index] || ad.translatedCopy || ""
          }));

          setAds(updatedAds);
          onAdsFetched(updatedAds, keyword);

      } catch (e: any) {
          console.error("Bulk translate process failed", e);
          if (e.message?.includes('403') || e.message?.includes('quota')) {
              alert("Gemini API 配额已耗尽，翻译任务已停止。");
          } else {
              alert("翻译任务异常终止。");
          }
      } finally {
          setIsTranslatingAll(false);
          setTranslationProgress(null);
      }
  };

  const handleExportCSV = () => {
    if (ads.length === 0) return;
    const headers = ['广告ID', '关键词', '广告主', '广告文案', '行动号召', '平台', '状态', '开始日期', '链接'];
    
    const rows = ads.map(ad => [
      ad.id,
      ad.originalKeyword || '',
      `"${(ad.advertiserName || '').replace(/"/g, '""')}"`,
      `"${(ad.translatedCopy || ad.adCopy || '').replace(/"/g, '""').replace(/\n/g, ' ')}"`, 
      `"${(ad.ctaText || '').replace(/"/g, '""')}"`,
      `"${(ad.platform || []).join(', ')}"`,
      ad.isActive ? '活跃' : '停止',
      ad.startDate,
      ad.adLibraryUrl || ''
    ]);

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob(["\ufeff" + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `fb_ads_export_${new Date().toISOString().slice(0,19).replace(/[:T]/g, '-')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleSingleSearch = useCallback(async (e?: React.FormEvent, overrideKeyword?: string, overrideFilters?: SearchFilters) => {
    if (e) e.preventDefault();
    const effectiveKeyword = overrideKeyword || keyword;
    const effectiveFilters = overrideFilters || filters;

    if (!effectiveKeyword.trim()) return;

    if (overrideKeyword) setKeyword(overrideKeyword);
    if (overrideFilters) setFilters(overrideFilters);

    setLoading(true);
    setSearched(true);
    setAds([]); 

    try {
      let results: Ad[] = [];
      if (dataSource === DataSource.APIFY) {
        results = await searchAdsWithApify(apifyToken, effectiveKeyword, effectiveFilters);
      } else {
        results = await searchAdsWithGemini(effectiveKeyword, effectiveFilters);
      }
      setAds(results);
      onAdsFetched(results, effectiveKeyword); 
      saveSearchLog({
        userId: currentUser.name, 
        userName: currentUser.name,
        keyword: effectiveKeyword,
        resultCount: results.length,
        dataSource: dataSource,
        filtersUsed: true
      });
      saveLocalSearchHistory(effectiveKeyword, effectiveFilters);
      setSearchHistory(getLocalSearchHistory());
    } catch (error: any) {
      console.error("Failed to fetch ads", error);
      alert(error.message || "搜索失败");
    } finally {
      setLoading(false);
    }
  }, [keyword, dataSource, apifyToken, filters, onAdsFetched, currentUser]);

  const handleHistoryClick = (item: SearchHistoryItem) => {
    handleSingleSearch(undefined, item.keyword, item.filters);
  };

  const NumberControl = ({ label, value, onChange, min, max, tooltip }: { label: string, value: number, onChange: (val: number) => void, min: number, max?: number, tooltip?: string }) => (
    <div className="bg-white p-3 rounded-xl border border-gray-200 shadow-sm hover:border-blue-300 transition-colors flex flex-col justify-between h-full">
        <div className="flex justify-between items-start mb-2">
            <label className="text-xs font-semibold text-gray-600 flex items-center gap-1 leading-tight">
                {label}
                {tooltip && <span className="text-gray-400 cursor-help" title={tooltip}>ⓘ</span>}
            </label>
            <span className="text-xs font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">{value}</span>
        </div>
        <div className="flex items-center bg-gray-50 rounded-lg p-1 border border-gray-100">
            <button
                type="button"
                onClick={() => onChange(Math.max(min, value - 1))}
                className="p-1.5 hover:bg-white hover:shadow-sm rounded-md text-gray-500 hover:text-blue-600 transition-all disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:shadow-none flex-shrink-0"
                disabled={value <= min}
            >
                <Minus className="w-4 h-4" />
            </button>
            <input
                type="number"
                className="w-full bg-transparent border-none text-center text-sm font-medium focus:ring-0 p-0 mx-1 appearance-none"
                value={value}
                onChange={(e) => onChange(Math.max(min, parseInt(e.target.value) || min))}
                min={min}
                max={max}
            />
            <button
                type="button"
                onClick={() => onChange(max ? Math.min(max, value + 1) : value + 1)}
                className="p-1.5 hover:bg-white hover:shadow-sm rounded-md text-gray-500 hover:text-blue-600 transition-all disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:shadow-none flex-shrink-0"
                disabled={max ? value >= max : false}
            >
                <Plus className="w-4 h-4" />
            </button>
        </div>
    </div>
  );

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8 text-center space-y-4">
        <h1 className="text-4xl font-extrabold text-gray-900 tracking-tight">
          广告资料库搜索
        </h1>
        
        <div className={`inline-flex items-center space-x-2 px-3 py-1 rounded-full text-xs font-medium border ${
             dataSource === DataSource.APIFY 
             ? 'bg-green-50 text-green-700 border-green-200' 
             : 'bg-blue-50 text-blue-700 border-blue-200'
        }`}>
            <div className={`w-2 h-2 rounded-full ${dataSource === DataSource.APIFY ? 'bg-green-500' : 'bg-blue-500'}`}></div>
            <span>数据源: {dataSource === DataSource.APIFY ? 'Apify 实时抓取' : 'Gemini AI 模拟'}</span>
        </div>
      </div>

      <div className="max-w-4xl mx-auto mb-4 flex justify-end">
          <div className="bg-white p-1 rounded-lg border border-gray-200 inline-flex">
              <button 
                  onClick={() => setIsBatchMode(false)}
                  className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${!isBatchMode ? 'bg-blue-100 text-blue-700' : 'text-gray-500 hover:text-gray-700'}`}
              >
                  单次搜索
              </button>
              <button 
                  onClick={() => setIsBatchMode(true)}
                  className={`px-4 py-2 text-sm font-medium rounded-md transition-all flex items-center space-x-1 ${isBatchMode ? 'bg-blue-100 text-blue-700' : 'text-gray-500 hover:text-gray-700'}`}
              >
                  <Layers className="w-4 h-4" />
                  <span>批量模式</span>
              </button>
          </div>
      </div>

      <div className="max-w-4xl mx-auto mb-12 bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden relative z-10">
        
        {!isBatchMode ? (
            <>
                <div className="p-2">
                    <form onSubmit={(e) => handleSingleSearch(e)} className="relative flex items-center">
                        <div className="pl-4">
                            <Search className="h-6 w-6 text-gray-400" />
                        </div>
                        <input
                            type="text"
                            className="flex-1 w-full pl-4 pr-4 py-4 bg-transparent border-none focus:ring-0 text-gray-900 placeholder-gray-400 text-lg"
                            placeholder="输入关键词 (例如 'Nike', '护肤品')..."
                            value={keyword}
                            onChange={(e) => setKeyword(e.target.value)}
                        />
                        <div className="flex items-center pr-2 space-x-2">
                             <button
                                type="button"
                                onClick={() => setShowFilters(!showFilters)}
                                className={`p-2 rounded-xl transition-colors flex items-center space-x-1 text-sm font-medium ${showFilters ? 'bg-blue-50 text-blue-600' : 'text-gray-500 hover:bg-gray-100'}`}
                            >
                                <Filter className="w-4 h-4" />
                                {showFilters ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                            </button>
                            <button
                                type="submit"
                                disabled={loading}
                                className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-3 rounded-xl font-medium transition-all transform active:scale-95 disabled:opacity-70 disabled:cursor-not-allowed flex items-center space-x-2"
                            >
                                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <span>搜索</span>}
                            </button>
                        </div>
                    </form>
                </div>
                
                {searchHistory.length > 0 && (
                    <div className="px-6 pb-4 flex flex-wrap items-center gap-2 animate-in fade-in slide-in-from-top-1">
                        <span className="text-xs font-semibold text-gray-400 flex items-center">
                            <History className="w-3 h-3 mr-1" /> 最近搜索:
                        </span>
                        {searchHistory.map((item, idx) => (
                            <button
                                key={idx}
                                onClick={() => handleHistoryClick(item)}
                                disabled={loading}
                                title={`搜索时间: ${new Date(item.timestamp).toLocaleString()}`}
                                className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600 hover:bg-blue-50 hover:text-blue-600 transition-colors border border-transparent hover:border-blue-100 group"
                            >
                                <span>{item.keyword}</span>
                            </button>
                        ))}
                    </div>
                )}
                
                {showFilters && (
                    <div className="border-t border-gray-100 bg-gray-50 p-6 animate-in slide-in-from-top-2 duration-200">
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                            
                            <div className="space-y-2">
                                <label className="text-xs font-semibold text-gray-500 uppercase flex items-center">
                                    <Calendar className="w-3 h-3 mr-1" /> 日期范围
                                </label>
                                <select 
                                    className="block w-full rounded-lg border-gray-300 text-sm focus:border-blue-500 focus:ring-blue-500"
                                    value={filters.dateRange}
                                    onChange={(e) => setFilters({...filters, dateRange: e.target.value})}
                                >
                                    <option value="LAST_24_HOURS">过去 24 小时</option>
                                    <option value="LAST_7_DAYS">过去 7 天</option>
                                    <option value="LAST_14_DAYS">过去 14 天</option>
                                    <option value="LAST_30_DAYS">过去 30 天</option>
                                    <option value="LAST_90_DAYS">过去 90 天</option>
                                    <option value="LAST_YEAR">过去一年</option>
                                    <option value="ALL">所有时间</option>
                                </select>
                            </div>

                             <div className="space-y-2">
                                <label className="text-xs font-semibold text-gray-500 uppercase flex items-center">
                                    <Clock className="w-3 h-3 mr-1" /> 广告状态
                                </label>
                                <select 
                                    className="block w-full rounded-lg border-gray-300 text-sm focus:border-blue-500 focus:ring-blue-500"
                                    value={filters.status || 'ACTIVE'}
                                    onChange={(e) => setFilters({...filters, status: e.target.value})}
                                >
                                    <option value="ACTIVE">活跃中 (Active)</option>
                                    <option value="ALL">全部 (Active & Inactive)</option>
                                    <option value="INACTIVE">已停止 (Inactive)</option>
                                </select>
                            </div>

                            <div className="space-y-2">
                                <label className="text-xs font-semibold text-gray-500 uppercase flex items-center">
                                    <Globe className="w-3 h-3 mr-1" /> 投放地区
                                </label>
                                <select 
                                    className="block w-full rounded-lg border-gray-300 text-sm focus:border-blue-500 focus:ring-blue-500"
                                    value={filters.region}
                                    onChange={(e) => setFilters({...filters, region: e.target.value})}
                                >
                                    <option value="ALL">全部地区</option>
                                    <option value="CN">中国 (CN)</option>
                                    <option value="US">美国 (US)</option>
                                    <option value="HK">香港 (HK)</option>
                                    <option value="TW">台湾 (TW)</option>
                                    <option value="JP">日本 (JP)</option>
                                    <option value="KR">韩国 (KR)</option>
                                    <option value="SG">新加坡 (SG)</option>
                                    <option value="GB">英国 (GB)</option>
                                </select>
                            </div>

                            <div className="space-y-2">
                                <label className="text-xs font-semibold text-gray-500 uppercase flex items-center">
                                    <FileType className="w-3 h-3 mr-1" /> 广告类型
                                </label>
                                <select 
                                    className="block w-full rounded-lg border-gray-300 text-sm focus:border-blue-500 focus:ring-blue-500"
                                    value={filters.adType}
                                    onChange={(e) => setFilters({...filters, adType: e.target.value})}
                                >
                                    <option value="all">所有类型</option>
                                    <option value="political_and_issue_ads">社会议题、选举或政治</option>
                                </select>
                            </div>

                            <div className="space-y-2">
                                <label className="text-xs font-semibold text-gray-500 uppercase flex items-center">
                                    <Image className="w-3 h-3 mr-1" /> 媒体类型
                                </label>
                                <select 
                                    className="block w-full rounded-lg border-gray-300 text-sm focus:border-blue-500 focus:ring-blue-500"
                                    value={filters.mediaType || 'ALL'}
                                    onChange={(e) => setFilters({...filters, mediaType: e.target.value})}
                                >
                                    <option value="ALL">所有媒体</option>
                                    <option value="IMAGE">图片</option>
                                    <option value="VIDEO">视频</option>
                                </select>
                            </div>

                            <div className="space-y-2">
                                <label className="text-xs font-semibold text-gray-500 uppercase flex items-center">
                                    <Languages className="w-3 h-3 mr-1" /> 语言
                                </label>
                                <select 
                                    className="block w-full rounded-lg border-gray-300 text-sm focus:border-blue-500 focus:ring-blue-500"
                                    value={filters.language || 'auto'}
                                    onChange={(e) => setFilters({...filters, language: e.target.value})}
                                >
                                    <option value="auto">不限</option>
                                    <option value="en">English (英语)</option>
                                    <option value="zh">Chinese (中文)</option>
                                    <option value="es">Spanish (西班牙语)</option>
                                </select>
                            </div>

                            <div className="flex items-end">
                                <button 
                                    type="button"
                                    onClick={() => setFilters({
                                        dateRange: 'LAST_30_DAYS',
                                        adType: 'all',
                                        region: 'ALL',
                                        language: 'auto',
                                        mediaType: 'ALL',
                                        status: 'ACTIVE'
                                    })}
                                    className="w-full text-gray-500 hover:text-gray-700 text-sm flex items-center justify-center space-x-1 px-3 py-2.5 bg-white border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors"
                                >
                                    <X className="w-4 h-4" />
                                    <span>重置</span>
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </>
        ) : (
            <div className="p-6">
                <div className="mb-4">
                     <div className="flex justify-between items-center mb-2">
                        <label className="block text-sm font-medium text-gray-700">
                            批量关键词 (支持换行、空格分隔)
                        </label>
                        <div className="relative">
                            <input
                                type="file"
                                accept=".txt"
                                ref={fileInputRef}
                                className="hidden"
                                onChange={handleFileUpload}
                            />
                            <button
                                type="button"
                                onClick={() => fileInputRef.current?.click()}
                                className="text-blue-600 hover:text-blue-800 text-sm flex items-center space-x-1"
                            >
                                <Upload className="w-4 h-4" />
                                <span>导入TXT</span>
                            </button>
                        </div>
                    </div>
                    <textarea
                        className="w-full h-32 p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 text-sm font-mono"
                        placeholder={`Nike\nAdidas\nPuma`}
                        value={batchKeywords}
                        onChange={(e) => setBatchKeywords(e.target.value)}
                    ></textarea>
                     <div className="text-xs text-gray-500 mt-1 flex justify-between">
                         <span>当前已识别: <span className="font-semibold text-gray-700">{parsedKeywords.length}</span> 个关键词</span>
                         <span>共 <span className="font-semibold text-gray-700">{totalAvailableGroups}</span> 组 (每组 {groupSize} 个)</span>
                     </div>
                </div>

                <div className="bg-gray-50 p-6 rounded-xl border border-gray-200 mb-6 shadow-inner">
                    <div className="flex items-center space-x-2 mb-4">
                         <Settings2 className="w-5 h-5 text-gray-600" />
                         <span className="text-base font-bold text-gray-800">分组与并发配置</span>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                         <NumberControl 
                            label="每组关键词数" 
                            value={groupSize} 
                            onChange={setGroupSize} 
                            min={1} 
                            tooltip="一次处理多少个关键词"
                         />
                         
                         <NumberControl 
                            label="起始组序号" 
                            value={startGroup} 
                            onChange={setStartGroup} 
                            min={1} 
                            tooltip="从第几组开始执行"
                         />

                         <NumberControl 
                            label="处理组数" 
                            value={groupCount} 
                            onChange={setGroupCount} 
                            min={1} 
                            tooltip="本次任务执行多少组"
                         />

                         <NumberControl 
                            label="并发数量" 
                            value={concurrency} 
                            onChange={setConcurrency} 
                            min={1} 
                            max={100}
                            tooltip="同时发起的请求数量 (最高100)"
                         />
                    </div>

                    <div className="mt-4 flex items-center justify-between text-xs text-blue-700 bg-blue-100/50 p-3 rounded-lg border border-blue-100">
                        <div className="flex items-center space-x-2">
                             <Clock className="w-3.5 h-3.5" />
                             <span>预计任务范围:</span>
                        </div>
                        <div>
                             第 <span className="font-bold">{((startGroup - 1) * groupSize) + 1}</span> 至 <span className="font-bold">{Math.min(((startGroup - 1) * groupSize) + (groupSize * groupCount), parsedKeywords.length || 0)}</span> 个关键词
                        </div>
                    </div>
                </div>
                
                <div className="flex justify-end items-center">
                    <button
                        onClick={handleBatchSearch}
                        disabled={loading || !batchKeywords.trim()}
                        className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-3 rounded-xl font-medium transition-all transform active:scale-95 disabled:opacity-50 disabled:active:scale-100 flex items-center space-x-2 shadow-md hover:shadow-lg"
                    >
                        {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <PlayCircle className="w-5 h-5" />}
                        <span>开始批量搜索 ({targetKeywords.length} 词)</span>
                    </button>
                </div>

                {(loading || batchResults.length > 0) && (
                    <div className="mt-8 space-y-4 animate-in fade-in slide-in-from-bottom-2">
                        <div className="flex justify-between text-xs text-gray-500 font-medium mb-1">
                            <span>任务进度</span>
                            <span>{Math.round((batchTotal > 0 ? (batchProgress / batchTotal) * 100 : 0))}%</span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
                            <div 
                                className="bg-gradient-to-r from-blue-500 to-blue-600 h-3 rounded-full transition-all duration-300 ease-out" 
                                style={{ width: `${batchTotal > 0 ? (batchProgress / batchTotal) * 100 : 0}%` }}
                            ></div>
                        </div>
                        
                        <div className="max-h-64 overflow-y-auto border border-gray-100 rounded-xl bg-white shadow-sm p-3 text-xs space-y-2 custom-scrollbar">
                            {batchResults.map((res, idx) => (
                                <div key={idx} className={`flex justify-between items-center p-3 rounded-lg border transition-colors ${res.error ? 'bg-red-50 text-red-700 border-red-100' : 'bg-gray-50 text-gray-700 border-gray-100 hover:bg-gray-100'}`}>
                                    <span className="font-medium truncate flex-1 mr-4">{res.keyword}</span>
                                    {res.error ? (
                                        <span className="flex items-center space-x-1 flex-shrink-0 bg-white px-2 py-1 rounded border border-red-100 shadow-sm" title={res.error}>
                                            <AlertCircle className="w-3 h-3 text-red-500" />
                                            <span>失败</span>
                                        </span>
                                    ) : (
                                        <span className="flex items-center space-x-1 text-green-700 flex-shrink-0 bg-white px-2 py-1 rounded border border-green-100 shadow-sm">
                                            <CheckCircle2 className="w-3 h-3 text-green-500" />
                                            <span className="font-bold">{res.count}</span> <span>个结果</span>
                                        </span>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        )}
      </div>

      {searched && (
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-gray-900">
                    搜索结果 <span className="text-gray-400 font-normal text-base ml-2">({ads.length} 个广告)</span>
                </h2>
                
                <div className="flex items-center space-x-3">
                    {ads.length > 0 && (
                        <button 
                            onClick={handleTranslateAll}
                            disabled={isTranslatingAll}
                            className="text-sm bg-white border border-gray-300 hover:bg-blue-50 text-gray-700 hover:text-blue-700 px-3 py-1.5 rounded-lg transition-colors flex items-center space-x-1"
                        >
                            {isTranslatingAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <Languages className="w-4 h-4" />}
                            <span>
                                {isTranslatingAll 
                                    ? `翻译中... ${translationProgress ? `(${translationProgress.current}/${translationProgress.total})` : ''}` 
                                    : '一键翻译所有'}
                            </span>
                        </button>
                    )}

                    {ads.length > 0 && (
                        <button 
                            onClick={handleExportCSV}
                            className="text-sm bg-white border border-gray-300 hover:bg-green-50 text-gray-700 hover:text-green-700 px-3 py-1.5 rounded-lg transition-colors flex items-center space-x-1"
                        >
                            <Download className="w-4 h-4" />
                            <span>导出 Excel/CSV</span>
                        </button>
                    )}

                    {dataSource === DataSource.GEMINI && (
                        <span className="text-xs bg-yellow-100 text-yellow-800 px-2 py-1 rounded-md border border-yellow-200 flex items-center">
                            <AlertCircle className="w-3 h-3 mr-1" /> 
                            模拟数据仅供演示
                        </span>
                    )}
                </div>
            </div>

            {ads.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 gap-6">
                    {ads.map((ad, index) => (
                        <AdCard key={`${ad.id}-${index}`} ad={ad} />
                    ))}
                </div>
            ) : (
                !loading && (
                    <div className="text-center py-12 bg-white rounded-xl border border-gray-200 border-dashed">
                        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gray-100 mb-4">
                            <Search className="w-8 h-8 text-gray-400" />
                        </div>
                        <h3 className="text-lg font-medium text-gray-900">未找到相关广告</h3>
                        <p className="mt-1 text-gray-500">尝试更换关键词或调整筛选条件。</p>
                    </div>
                )
            )}
        </div>
      )}

      {loading && !isBatchMode && (
          <div className="fixed inset-0 bg-white/50 backdrop-blur-sm z-50 flex flex-col items-center justify-center">
              <Loader2 className="w-12 h-12 text-blue-600 animate-spin mb-4" />
              <p className="text-gray-600 font-medium animate-pulse">正在搜索广告库...</p>
          </div>
      )}

    </div>
  );
};

export default AdSearchPage;
