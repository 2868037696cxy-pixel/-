
import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { Search, Filter, Loader2, AlertCircle, Calendar, ChevronDown, ChevronUp, X, Layers, PlayCircle, CheckCircle2, Globe, FileType, Clock, History, Upload, Image, Languages, Settings2, Download, Minus, Plus, Sparkles, Settings } from 'lucide-react';
import { batchTranslateToChinese } from '../services/geminiService';
import { searchAdsWithApify } from '../services/apifyService';
import { getLocalSearchHistory } from '../services/storageService';
import AdCard from '../components/AdCard';
import { Ad, DataSource, SearchFilters, UserProfile, SearchHistoryItem, SearchPageState, BatchResult } from '../types';
import { STORAGE_KEYS, DEFAULT_SETTINGS } from '../constants';

interface AdSearchPageProps {
  ads: Ad[];
  keyword: string;
  onUpdateAds: (ads: Ad[]) => void;
  isSearching: boolean;
  onSearch: (keyword: string, filters: SearchFilters, dataSource: DataSource, apifyToken: string) => Promise<void>;
  currentUser: UserProfile;
  state: SearchPageState;
  onUpdateState: (updates: Partial<SearchPageState>) => void;
}

const AdSearchPage: React.FC<AdSearchPageProps> = ({ ads, keyword, onUpdateAds, isSearching, onSearch, currentUser, state, onUpdateState }) => {
  // Local UI State (Setting related)
  const [dataSource, setDataSource] = useState<DataSource>(DataSource.GEMINI);
  const [apifyToken, setApifyToken] = useState<string>(DEFAULT_SETTINGS.apifyApiToken);
  const [searchHistory, setSearchHistory] = useState<SearchHistoryItem[]>([]);
  const [tokenError, setTokenError] = useState(false);
  const [showFilters, setShowFilters] = useState(true); 
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Translation State (Transient)
  const [isTranslatingAll, setIsTranslatingAll] = useState(false);
  const [translationProgress, setTranslationProgress] = useState<{current: number, total: number} | null>(null);

  useEffect(() => {
    const storedSettings = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    if (storedSettings) {
        try {
            const parsed = JSON.parse(storedSettings);
            setDataSource(parsed.dataSource || DataSource.GEMINI);
            if (parsed.apifyApiToken) {
                setApifyToken(parsed.apifyApiToken);
                setTokenError(false);
            } else if (parsed.dataSource === DataSource.APIFY) {
                setTokenError(true);
            }
        } catch (e) {
            console.error("Error reading settings", e);
        }
    }
    setSearchHistory(getLocalSearchHistory());
  }, [isSearching]);

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        const text = e.target?.result as string;
        if (text) {
            onUpdateState({ batchKeywords: text });
        }
    };
    reader.readAsText(file);
    if (fileInputRef.current) {
        fileInputRef.current.value = '';
    }
  };

  const parsedKeywords = useMemo(() => {
    return state.batchKeywords
        .split(/[\s,]+/) 
        .map(k => k.trim())
        .filter(k => k.length > 0);
  }, [state.batchKeywords]);

  const targetKeywords = useMemo(() => {
      const startIndex = (state.startGroup - 1) * state.groupSize;
      const count = state.groupSize * state.groupCount;
      return parsedKeywords.slice(startIndex, startIndex + count);
  }, [parsedKeywords, state.groupSize, state.groupCount, state.startGroup]);

  const totalAvailableGroups = useMemo(() => {
      return Math.ceil(parsedKeywords.length / state.groupSize);
  }, [parsedKeywords.length, state.groupSize]);


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

    onUpdateState({ 
        isBatchLoading: true, 
        batchProgress: 0, 
        batchTotal: targetKeywords.length, 
        batchResults: [] 
    });
    
    // We don't clear global ads immediately to maintain view until new ones arrive
    let accumulatedAds: Ad[] = [];

    try {
        const CHUNK_SIZE = state.concurrency; 
        let fatalErrorOccurred = false;

        for (let i = 0; i < targetKeywords.length; i += CHUNK_SIZE) {
            if (fatalErrorOccurred) break;
            const chunk = targetKeywords.slice(i, i + CHUNK_SIZE);
            
            const chunkPromises = chunk.map(async (k) => {
                if (fatalErrorOccurred) return { keyword: k, ads: [], success: false, error: "Skipped" };
                try {
                    const res = await searchAdsWithApify(apifyToken, k, state.filters);
                    
                    // Update batch results list
                    onUpdateState({ 
                        batchResults: [...state.batchResults, { keyword: k, count: res.length }],
                        batchProgress: state.batchProgress + 1
                    });
                    
                    return { keyword: k, ads: res, success: true };
                } catch (err: any) {
                    const isFatal = err.isFatal || (err.message && (err.message.includes('403') || err.message.includes('无效') || err.message.includes('Invalid')));
                    if (isFatal) fatalErrorOccurred = true;
                    
                    onUpdateState({ 
                        batchResults: [...state.batchResults, { keyword: k, count: 0, error: err.message }],
                        batchProgress: state.batchProgress + 1
                    });
                    
                    return { keyword: k, ads: [], success: false, error: err.message, isFatal };
                }
            });

            const chunkResults = await Promise.all(chunkPromises);
            for (const res of chunkResults) {
                if (res.isFatal) fatalErrorOccurred = true;
                if (res.ads) accumulatedAds = [...accumulatedAds, ...res.ads];
            }
        }

        const uniqueAds = Array.from(new Map(accumulatedAds.map(item => [item.id, item])).values());
        onUpdateAds(uniqueAds);

        if (fatalErrorOccurred) {
            alert(`部分请求遇到关键错误，批量任务已中止。请检查 Token。`);
        }

    } catch (error) {
        console.error("Batch search error", error);
    } finally {
        onUpdateState({ isBatchLoading: false });
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

          for (const batchIndices of chunks) {
              const batchTexts = batchIndices.map(idx => ads[idx].adCopy || "");
              try {
                  const results = await batchTranslateToChinese(batchTexts);
                  batchIndices.forEach((originalIndex, arrIdx) => {
                      if (results[arrIdx]) newTranslationsMap[originalIndex] = results[arrIdx];
                  });
              } catch (batchError: any) {
                  console.error(batchError);
              }
              completedCount += batchIndices.length;
              setTranslationProgress({ current: Math.min(completedCount, ads.length), total: ads.length });
          }

          const updatedAds = ads.map((ad, index) => ({
              ...ad,
              translatedCopy: newTranslationsMap[index] || ad.translatedCopy || ""
          }));
          onUpdateAds(updatedAds);

      } catch (e) {
          console.error("Bulk translate process failed", e);
      } finally {
          setIsTranslatingAll(false);
          setTranslationProgress(null);
      }
  };

  const handleExportCSV = () => {
    if (ads.length === 0) return;
    const headers = ['广告ID', '关键词', '广告主', '广告文案', '行动号召', '平台', '状态', '开始日期', '落地页/投放网站', '广告库链接', '覆盖人数'];
    const rows = ads.map(ad => [
      ad.id, 
      ad.originalKeyword || '', 
      `"${(ad.advertiserName || '').replace(/"/g, '""')}"`,
      `"${(ad.translatedCopy || ad.adCopy || '').replace(/"/g, '""').replace(/\n/g, ' ')}"`, 
      `"${(ad.ctaText || '').replace(/"/g, '""')}"`, 
      `"${(ad.platform || []).join(', ')}"`,
      ad.isActive ? '活跃' : '停止', 
      ad.startDate, 
      `"${(ad.displayLink || '').replace(/"/g, '""')}"`, 
      ad.adLibraryUrl || '', 
      ad.reach || '未公开'
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
    const effectiveKeyword = overrideKeyword || state.inputKeyword;
    const effectiveFilters = overrideFilters || state.filters;

    if (!effectiveKeyword.trim()) return;

    if (overrideKeyword) onUpdateState({ inputKeyword: overrideKeyword });
    if (overrideFilters) onUpdateState({ filters: overrideFilters });

    await onSearch(effectiveKeyword, effectiveFilters, dataSource, apifyToken);
  }, [state.inputKeyword, state.filters, dataSource, apifyToken, onSearch, onUpdateState]);

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
            <button type="button" onClick={() => onChange(Math.max(min, value - 1))} className="p-1.5 hover:bg-white hover:shadow-sm rounded-md text-gray-500 hover:text-blue-600 transition-all disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:shadow-none flex-shrink-0" disabled={value <= min}>
                <Minus className="w-4 h-4" />
            </button>
            <input type="number" className="w-full bg-transparent border-none text-center text-sm font-medium focus:ring-0 p-0 mx-1 appearance-none" value={value} onChange={(e) => onChange(Math.max(min, parseInt(e.target.value) || min))} min={min} max={max} />
            <button type="button" onClick={() => onChange(max ? Math.min(max, value + 1) : value + 1)} className="p-1.5 hover:bg-white hover:shadow-sm rounded-md text-gray-500 hover:text-blue-600 transition-all disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:shadow-none flex-shrink-0" disabled={max ? value >= max : false}>
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
        <div className={`inline-flex items-center space-x-2 px-3 py-1 rounded-full text-xs font-medium border ${dataSource === DataSource.APIFY ? 'bg-green-50 text-green-700 border-green-200' : 'bg-blue-50 text-blue-700 border-blue-200'}`}>
            <div className={`w-2 h-2 rounded-full ${dataSource === DataSource.APIFY ? 'bg-green-500' : 'bg-blue-500'}`}></div>
            <span>数据源: {dataSource === DataSource.APIFY ? 'Apify 实时抓取' : 'Gemini AI'}</span>
        </div>
        {tokenError && dataSource === DataSource.APIFY && (
            <div className="mt-2">
                <div className="inline-flex items-center px-4 py-2 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                    <AlertCircle className="w-4 h-4 mr-2" />
                    <span>Apify Token 未配置或无效</span>
                    <a href="#" className="ml-2 font-bold underline flex items-center" onClick={(e) => { e.preventDefault(); (document.querySelector('button[title="系统设置"]') as HTMLElement)?.click(); }}>
                        去设置 <Settings className="w-3 h-3 ml-1" />
                    </a>
                </div>
            </div>
        )}
      </div>

      <div className="max-w-4xl mx-auto mb-4 flex justify-end">
          <div className="bg-white p-1 rounded-lg border border-gray-200 inline-flex">
              <button onClick={() => onUpdateState({ isBatchMode: false })} className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${!state.isBatchMode ? 'bg-blue-100 text-blue-700' : 'text-gray-500 hover:text-gray-700'}`}>单次搜索</button>
              <button onClick={() => onUpdateState({ isBatchMode: true })} className={`px-4 py-2 text-sm font-medium rounded-md transition-all flex items-center space-x-1 ${state.isBatchMode ? 'bg-blue-100 text-blue-700' : 'text-gray-500 hover:text-gray-700'}`}>
                  <Layers className="w-4 h-4" /> <span>批量模式</span>
              </button>
          </div>
      </div>

      <div className="max-w-4xl mx-auto mb-12 bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden relative z-10 transition-all">
        {!state.isBatchMode ? (
            <>
                <div className="p-2">
                    <form onSubmit={(e) => handleSingleSearch(e)} className="relative flex items-center">
                        <div className="pl-4">
                            <Search className={`h-6 w-6 transition-colors ${isSearching ? 'text-blue-500 animate-pulse' : 'text-gray-400'}`} />
                        </div>
                        <input
                            type="text"
                            className="flex-1 w-full pl-4 pr-4 py-4 bg-transparent border-none focus:ring-0 text-gray-900 placeholder-gray-400 text-lg"
                            placeholder="输入关键词 (例如 'Nike', '护肤品')..."
                            value={state.inputKeyword}
                            onChange={(e) => onUpdateState({ inputKeyword: e.target.value })}
                        />
                        <div className="flex items-center pr-2 space-x-2">
                             <button type="button" onClick={() => setShowFilters(!showFilters)} className={`p-2 rounded-xl transition-colors flex items-center space-x-1 text-sm font-medium ${showFilters ? 'bg-blue-50 text-blue-600' : 'text-gray-500 hover:bg-gray-100'}`}>
                                <Filter className="w-4 h-4" />
                                {showFilters ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                            </button>
                            <button type="submit" disabled={isSearching} className={`px-8 py-3 rounded-xl font-medium transition-all transform active:scale-95 flex items-center space-x-2 ${isSearching ? 'bg-blue-100 text-blue-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700 text-white'}`}>
                                {isSearching ? <Loader2 className="w-5 h-5 animate-spin" /> : <span>搜索</span>}
                            </button>
                        </div>
                    </form>
                </div>
                
                {searchHistory.length > 0 && (
                    <div className="px-6 pb-4 flex flex-wrap items-center gap-2 animate-in fade-in slide-in-from-top-1">
                        <span className="text-xs font-semibold text-gray-400 flex items-center"><History className="w-3 h-3 mr-1" /> 最近搜索:</span>
                        {searchHistory.map((item, idx) => (
                            <button key={idx} onClick={() => handleHistoryClick(item)} disabled={isSearching} title={`搜索时间: ${new Date(item.timestamp).toLocaleString()}`} className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600 hover:bg-blue-50 hover:text-blue-600 transition-colors border border-transparent hover:border-blue-100 group">
                                <span>{item.keyword}</span>
                            </button>
                        ))}
                    </div>
                )}
                
                {showFilters && (
                    <div className="border-t border-gray-100 bg-gray-50 p-6 animate-in slide-in-from-top-2 duration-200">
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                            <div className="space-y-2">
                                <label className="text-xs font-semibold text-gray-500 uppercase flex items-center"><Calendar className="w-3 h-3 mr-1" /> 日期范围</label>
                                <select className="block w-full rounded-lg border-gray-300 text-sm focus:border-blue-500 focus:ring-blue-500" value={state.filters.dateRange} onChange={(e) => onUpdateState({ filters: {...state.filters, dateRange: e.target.value} })}>
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
                                <label className="text-xs font-semibold text-gray-500 uppercase flex items-center"><Clock className="w-3 h-3 mr-1" /> 广告状态</label>
                                <select className="block w-full rounded-lg border-gray-300 text-sm focus:border-blue-500 focus:ring-blue-500" value={state.filters.status || 'ACTIVE'} onChange={(e) => onUpdateState({ filters: {...state.filters, status: e.target.value} })}>
                                    <option value="ACTIVE">活跃中 (Active)</option>
                                    <option value="ALL">全部 (Active & Inactive)</option>
                                    <option value="INACTIVE">已停止 (Inactive)</option>
                                </select>
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-semibold text-gray-500 uppercase flex items-center"><Globe className="w-3 h-3 mr-1" /> 投放地区</label>
                                <select className="block w-full rounded-lg border-gray-300 text-sm focus:border-blue-500 focus:ring-blue-500" value={state.filters.region} onChange={(e) => onUpdateState({ filters: {...state.filters, region: e.target.value} })}>
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
                                <label className="text-xs font-semibold text-gray-500 uppercase flex items-center"><FileType className="w-3 h-3 mr-1" /> 广告类型</label>
                                <select className="block w-full rounded-lg border-gray-300 text-sm focus:border-blue-500 focus:ring-blue-500" value={state.filters.adType} onChange={(e) => onUpdateState({ filters: {...state.filters, adType: e.target.value} })}>
                                    <option value="all">所有类型</option>
                                    <option value="political_and_issue_ads">社会议题、选举或政治</option>
                                </select>
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-semibold text-gray-500 uppercase flex items-center"><Image className="w-3 h-3 mr-1" /> 媒体类型</label>
                                <select className="block w-full rounded-lg border-gray-300 text-sm focus:border-blue-500 focus:ring-blue-500" value={state.filters.mediaType || 'ALL'} onChange={(e) => onUpdateState({ filters: {...state.filters, mediaType: e.target.value} })}>
                                    <option value="ALL">所有媒体</option>
                                    <option value="IMAGE">图片</option>
                                    <option value="VIDEO">视频</option>
                                </select>
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-semibold text-gray-500 uppercase flex items-center"><Languages className="w-3 h-3 mr-1" /> 语言</label>
                                <select className="block w-full rounded-lg border-gray-300 text-sm focus:border-blue-500 focus:ring-blue-500" value={state.filters.language || 'auto'} onChange={(e) => onUpdateState({ filters: {...state.filters, language: e.target.value} })}>
                                    <option value="auto">不限</option>
                                    <option value="en">English (英语)</option>
                                    <option value="zh">Chinese (中文)</option>
                                    <option value="es">Spanish (西班牙语)</option>
                                </select>
                            </div>
                            <div className="flex items-end">
                                <button type="button" onClick={() => onUpdateState({ filters: INITIAL_SEARCH_STATE.filters })} className="w-full text-gray-500 hover:text-gray-700 text-sm flex items-center justify-center space-x-1 px-3 py-2.5 bg-white border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors">
                                    <X className="w-4 h-4" /> <span>重置</span>
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
                        <label className="block text-sm font-medium text-gray-700">批量关键词 (支持换行、空格分隔)</label>
                        <div className="relative">
                            <input type="file" accept=".txt" ref={fileInputRef} className="hidden" onChange={handleFileUpload} />
                            <button type="button" onClick={() => fileInputRef.current?.click()} className="text-blue-600 hover:text-blue-800 text-sm flex items-center space-x-1">
                                <Upload className="w-4 h-4" /> <span>导入TXT</span>
                            </button>
                        </div>
                    </div>
                    <textarea className="w-full h-32 p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 text-sm font-mono" placeholder={`Nike\nAdidas\nPuma`} value={state.batchKeywords} onChange={(e) => onUpdateState({ batchKeywords: e.target.value })}></textarea>
                     <div className="text-xs text-gray-500 mt-1 flex justify-between">
                         <span>当前已识别: <span className="font-semibold text-gray-700">{parsedKeywords.length}</span> 个关键词</span>
                         <span>共 <span className="font-semibold text-gray-700">{totalAvailableGroups}</span> 组 (每组 {state.groupSize} 个)</span>
                     </div>
                </div>

                <div className="bg-gray-50 p-6 rounded-xl border border-gray-200 mb-6 shadow-inner">
                    <div className="flex items-center space-x-2 mb-4">
                         <Settings2 className="w-5 h-5 text-gray-600" />
                         <span className="text-base font-bold text-gray-800">分组与并发配置</span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                         <NumberControl label="每组关键词数" value={state.groupSize} onChange={(v) => onUpdateState({ groupSize: v })} min={1} tooltip="一次处理多少个关键词" />
                         <NumberControl label="起始组序号" value={state.startGroup} onChange={(v) => onUpdateState({ startGroup: v })} min={1} tooltip="从第几组开始执行" />
                         <NumberControl label="处理组数" value={state.groupCount} onChange={(v) => onUpdateState({ groupCount: v })} min={1} tooltip="本次任务执行多少组" />
                         <NumberControl label="并发数量" value={state.concurrency} onChange={(v) => onUpdateState({ concurrency: v })} min={1} max={100} tooltip="同时发起的请求数量 (最高100)" />
                    </div>
                </div>
                
                <div className="flex justify-end items-center">
                    <button onClick={handleBatchSearch} disabled={state.isBatchLoading || !state.batchKeywords.trim()} className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-3 rounded-xl font-medium transition-all transform active:scale-95 disabled:opacity-50 disabled:active:scale-100 flex items-center space-x-2 shadow-md hover:shadow-lg">
                        {state.isBatchLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <PlayCircle className="w-5 h-5" />}
                        <span>开始批量搜索 ({targetKeywords.length} 词)</span>
                    </button>
                </div>

                {(state.isBatchLoading || state.batchResults.length > 0) && (
                    <div className="mt-8 space-y-4 animate-in fade-in slide-in-from-bottom-2">
                        <div className="flex justify-between text-xs text-gray-500 font-medium mb-1">
                            <span>任务进度</span>
                            <span>{Math.round((state.batchTotal > 0 ? (state.batchProgress / state.batchTotal) * 100 : 0))}%</span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
                            <div className="bg-gradient-to-r from-blue-500 to-blue-600 h-3 rounded-full transition-all duration-300 ease-out" style={{ width: `${state.batchTotal > 0 ? (state.batchProgress / state.batchTotal) * 100 : 0}%` }}></div>
                        </div>
                        <div className="max-h-64 overflow-y-auto border border-gray-100 rounded-xl bg-white shadow-sm p-3 text-xs space-y-2 custom-scrollbar">
                            {state.batchResults.map((res, idx) => (
                                <div key={idx} className={`flex justify-between items-center p-3 rounded-lg border transition-colors ${res.error ? 'bg-red-50 text-red-700 border-red-100' : 'bg-gray-50 text-gray-700 border-gray-100 hover:bg-gray-100'}`}>
                                    <span className="font-medium truncate flex-1 mr-4">{res.keyword}</span>
                                    {res.error ? (
                                        <span className="flex items-center space-x-1 flex-shrink-0 bg-white px-2 py-1 rounded border border-red-100 shadow-sm" title={res.error}><AlertCircle className="w-3 h-3 text-red-500" /><span>失败</span></span>
                                    ) : (
                                        <span className="flex items-center space-x-1 text-green-700 flex-shrink-0 bg-white px-2 py-1 rounded border border-green-100 shadow-sm"><CheckCircle2 className="w-3 h-3 text-green-500" /><span className="font-bold">{res.count}</span> <span>个结果</span></span>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        )}
      </div>

      {(ads.length > 0 || isSearching) && (
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-gray-900">
                    搜索结果 <span className="text-gray-400 font-normal text-base ml-2">({ads.length} 个广告)</span>
                </h2>
                <div className="flex items-center space-x-3">
                    {ads.length > 0 && (
                        <button onClick={handleTranslateAll} disabled={isTranslatingAll} className="text-sm bg-white border border-gray-300 hover:bg-blue-50 text-gray-700 hover:text-blue-700 px-3 py-1.5 rounded-lg transition-colors flex items-center space-x-1">
                            {isTranslatingAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <Languages className="w-4 h-4" />}
                            <span>{isTranslatingAll ? `翻译中... ${translationProgress ? `(${translationProgress.current}/${translationProgress.total})` : ''}` : '一键翻译所有'}</span>
                        </button>
                    )}
                    {ads.length > 0 && (
                        <button onClick={handleExportCSV} className="text-sm bg-white border border-gray-300 hover:bg-green-50 text-gray-700 hover:text-green-700 px-3 py-1.5 rounded-lg transition-colors flex items-center space-x-1">
                            <Download className="w-4 h-4" /> <span>导出 Excel/CSV</span>
                        </button>
                    )}
                    {dataSource === DataSource.GEMINI && (
                        <span className="text-xs bg-purple-50 text-purple-700 px-2 py-1 rounded-md border border-purple-100 flex items-center"><Sparkles className="w-3 h-3 mr-1" /> AI 智能生成结果</span>
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
                !isSearching && (
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
    </div>
  );
};

// Constant for resetting filters
const INITIAL_SEARCH_STATE_FILTERS = {
    dateRange: 'LAST_30_DAYS',
    adType: 'all',
    region: 'ALL',
    language: 'auto',
    mediaType: 'ALL',
    status: 'ACTIVE'
};

const INITIAL_SEARCH_STATE: Partial<SearchPageState> = {
    filters: INITIAL_SEARCH_STATE_FILTERS
};

export default AdSearchPage;
