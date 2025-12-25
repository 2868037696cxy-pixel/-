
import React, { useState, useEffect } from 'react';
import { Ad } from '../types';
import { PLACEHOLDER_AVATAR } from '../constants';
import { MoreHorizontal, ThumbsUp, Share2, Facebook, Instagram, Languages, Loader2, Users } from 'lucide-react';
import { translateToChinese } from '../services/geminiService';

interface AdCardProps {
  ad: Ad;
}

const AdCard: React.FC<AdCardProps> = ({ ad }) => {
  const [translatedText, setTranslatedText] = useState<string | null>(null);
  const [showTranslation, setShowTranslation] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);

  // Sync with prop if batch translation occurs
  useEffect(() => {
    if (ad.translatedCopy && ad.translatedCopy !== translatedText) {
        setTranslatedText(ad.translatedCopy);
        setShowTranslation(true);
    }
  }, [ad.translatedCopy]);

  const handleTranslate = async () => {
    if (showTranslation) {
        // Toggle back to original
        setShowTranslation(false);
        return;
    }

    if (translatedText) {
        // If already translated, just show it
        setShowTranslation(true);
        return;
    }

    // Perform translation
    setIsTranslating(true);
    const result = await translateToChinese(ad.adCopy);
    setTranslatedText(result);
    setShowTranslation(true);
    setIsTranslating(false);
  };

  const formatReach = (num?: number) => {
    if (num === undefined || num === null) return '未公开';
    if (num >= 10000) {
        return (num / 10000).toFixed(1) + '万';
    }
    return num.toLocaleString();
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden hover:shadow-md transition-shadow duration-300 flex flex-col h-full">
      {/* Header */}
      <div className="p-4 flex justify-between items-start">
        <div className="flex space-x-3">
          <img 
            src={PLACEHOLDER_AVATAR(ad.advertiserAvatar)} 
            alt={ad.advertiserName} 
            className="w-10 h-10 rounded-full object-cover border border-gray-100"
          />
          <div>
            <h3 className="font-semibold text-gray-900 text-sm">{ad.advertiserName}</h3>
            <div className="flex items-center space-x-2 text-xs text-gray-500 mt-0.5">
              <span>赞助内容</span>
              <span>•</span>
              <span>ID: {ad.id}</span>
            </div>
          </div>
        </div>
        <button className="text-gray-400 hover:text-gray-600">
          <MoreHorizontal className="w-5 h-5" />
        </button>
      </div>

      {/* Copy */}
      <div className="px-4 pb-2">
        <p className="text-gray-800 text-sm leading-relaxed whitespace-pre-wrap line-clamp-6 mb-2">
          {showTranslation ? translatedText : ad.adCopy}
        </p>
        
        {/* Translate Button */}
        <button 
            onClick={handleTranslate}
            disabled={isTranslating}
            className="text-xs text-blue-600 hover:text-blue-800 flex items-center space-x-1 font-medium transition-colors bg-blue-50 px-2 py-1 rounded-md"
        >
            {isTranslating ? (
                <>
                    <Loader2 className="w-3 h-3 animate-spin" />
                    <span>翻译中...</span>
                </>
            ) : (
                <>
                    <Languages className="w-3 h-3" />
                    <span>{showTranslation ? '显示原文' : '翻译成中文'}</span>
                </>
            )}
        </button>
      </div>

      {/* Link Display Area (Replaces Media) */}
      {/* Simulating the Facebook Link Post footer style */}
      <div className="mt-2 bg-gray-50 border-t border-b border-gray-100 px-4 py-3">
         <div className="flex items-center justify-between">
             <div className="flex flex-col min-w-0 mr-3">
                 <span className="text-[10px] text-gray-500 uppercase tracking-wide truncate flex items-center">
                    {ad.displayLink || 'WEBSITE.COM'}
                 </span>
                 <span className="text-sm font-bold text-gray-900 truncate mt-0.5">
                    {ad.headline || ad.advertiserName}
                 </span>
             </div>
             <div className="flex-shrink-0">
                 <button className="bg-gray-200 hover:bg-gray-300 text-gray-800 text-xs font-semibold px-4 py-2 rounded transition-colors border border-gray-300">
                    {ad.ctaText}
                 </button>
             </div>
         </div>
      </div>

      {/* Footer Details */}
      <div className="p-4 mt-auto">
         <div className="flex items-center justify-between mb-3">
            <div className="flex space-x-2">
                {ad.platform.includes('Facebook') && <Facebook className="w-4 h-4 text-blue-600" />}
                {ad.platform.includes('Instagram') && <Instagram className="w-4 h-4 text-pink-600" />}
            </div>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ad.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-600'}`}>
                {ad.isActive ? '活跃' : '已停止'}
            </span>
         </div>
         <div className="flex justify-between items-center text-xs text-gray-500 font-medium">
             <div className="flex items-center space-x-1 text-gray-600 bg-gray-50 px-2 py-1 rounded border border-gray-100" title="预估覆盖人数">
                 <Users className="w-3 h-3" />
                 <span>覆盖 {formatReach(ad.reach)}</span>
             </div>
             
             <div className="flex space-x-4">
                 <div className="flex items-center space-x-1 cursor-pointer hover:text-blue-600">
                    <ThumbsUp className="w-4 h-4" />
                    <span>点赞</span>
                 </div>
                  <div className="flex items-center space-x-1 cursor-pointer hover:text-blue-600">
                    <Share2 className="w-4 h-4" />
                    <span>分享</span>
                 </div>
             </div>
         </div>
         <div className="mt-2 text-[10px] text-gray-400 text-right">
             开始于 {ad.startDate}
         </div>
      </div>
    </div>
  );
};

export default AdCard;
