
import axios from 'axios';
import { Ad, MediaType, SearchFilters } from '../types';
import { ACTOR_ID } from '../constants';

const APIFY_BASE_URL = 'https://api.apify.com/v2';

function convertPeriod(period: string) {
    const periodMap: Record<string, string> = {
        'LAST_24_HOURS': 'last24h',
        'LAST_7_DAYS': 'last7d',
        'LAST_14_DAYS': 'last14d',
        'LAST_30_DAYS': 'last30d',
        'LAST_90_DAYS': 'last30d',
        'LAST_YEAR': 'last30d',
        'ALL': ''
    };
    return periodMap[period] || '';
}

function buildFacebookAdsURL(keyword: string, filters: SearchFilters) {
    const params = new URLSearchParams();
    params.set('active_status', 'active');
    params.set('ad_type', filters.adType || 'all'); 
    params.set('country', filters.region || 'ALL');
    params.set('q', keyword);
    params.set('search_type', 'keyword_unordered');
    
    if (filters.mediaType && filters.mediaType !== 'ALL') {
         params.set('media_type', filters.mediaType.toLowerCase());
    } else {
         params.set('media_type', 'all');
    }

    if (filters.language && filters.language !== 'auto' && filters.language !== 'ALL') {
        params.append('content_languages[0]', filters.language);
    }

    if (filters.dateRange !== 'ALL') {
        let fbTimePeriod = '';
        switch(filters.dateRange) {
            case 'LAST_24_HOURS': fbTimePeriod = 'last_1_day'; break;
            case 'LAST_7_DAYS': fbTimePeriod = 'last_7_days'; break;
            case 'LAST_14_DAYS': fbTimePeriod = 'last_14_days'; break;
            case 'LAST_30_DAYS': fbTimePeriod = 'last_30_days'; break;
            case 'LAST_90_DAYS': fbTimePeriod = 'last_90_days'; break;
            case 'LAST_YEAR': fbTimePeriod = 'last_1_year'; break;
            default: fbTimePeriod = 'last_30_days';
        }
        if (fbTimePeriod) params.set('time_range', fbTimePeriod);
    }

    return `https://www.facebook.com/ads/library/?${params.toString()}`;
}

export const verifyApifyToken = async (token: string): Promise<boolean> => {
    try {
        if (!token) return false;
        await axios.get(`${APIFY_BASE_URL}/users/me`, { params: { token } });
        return true;
    } catch (error) {
        return false;
    }
};

const mapApifyItemToAd = (item: any, index: number): Ad => {
    const id = item.ad_archive_id || item.ad_id || item.id || `apify-${index}`;
    const advertiserName = item.snapshot?.page_name || item.page_name || "Unknown Advertiser";
    
    let adCopy = item.snapshot?.body?.text || item.snapshot?.title || item.ad_creative_body || item.text || "";
    if (!adCopy || adCopy.trim() === '') adCopy = "[纯媒体广告]";
                   
    const ctaText = item.snapshot?.cta_text || item.cta_text || "了解更多";
    let mediaType = (item.snapshot?.videos?.length > 0) ? MediaType.VIDEO : MediaType.IMAGE;

    const displayLink = item.snapshot?.caption || "WWW.FACEBOOK.COM";
    const headline = item.snapshot?.title || advertiserName;
    const startDate = item.start_date || new Date().toISOString().split('T')[0];
    const adLibraryUrl = item.ad_library_url || `https://www.facebook.com/ads/library/?id=${id}`;

    let reach: number | undefined = undefined;
    const parseReach = (val: any): number | undefined => {
        if (typeof val === 'number') return val;
        if (typeof val === 'string') {
            const parsed = parseInt(val.replace(/[^0-9]/g, ''), 10);
            return isNaN(parsed) ? undefined : parsed;
        }
        return undefined;
    };

    if (item.snapshot?.eu_total_reach) reach = parseReach(item.snapshot.eu_total_reach);
    else if (item.snapshot?.impressions?.lower_bound) reach = parseReach(item.snapshot.impressions.lower_bound);

    return {
      id,
      advertiserName,
      advertiserAvatar: `avatar-${advertiserName}`,
      adCopy,
      mediaType,
      ctaText,
      startDate,
      isActive: item.is_active !== false,
      platform: Array.isArray(item.publisher_platform) ? item.publisher_platform : ['Facebook'],
      adLibraryUrl,
      displayLink,
      headline,
      reach
    };
};

/**
 * 核心优化：批量关键词抓取 (Batch Search)
 * 一次请求发送多个 URL 给 Actor，极大减少 Actor 启动开销
 */
export const searchAdsWithApifyBatch = async (
  token: string, 
  keywords: string[], 
  filters: SearchFilters
): Promise<{ads: Ad[], keywordMap: Record<string, number>}> => {
  try {
    if (!token) throw new Error("未配置 Apify Token");

    const urls = keywords.map(k => ({ url: buildFacebookAdsURL(k, filters) }));

    const input = {
        urls: urls,
        count: 50, // 每个关键词抓取的上限，根据需求调整
        period: convertPeriod(filters.dateRange),
        'scrapePageAds.activeStatus': 'all',
        'scrapePageAds.countryCode': 'ALL'
    };

    // run-sync-get-dataset-items 虽然快，但对于超大批量，建议使用异步模式。
    // 这里采用同步模式并增加超时，确保稳定性
    const response = await axios.post(
        `${APIFY_BASE_URL}/acts/${ACTOR_ID}/run-sync-get-dataset-items`,
        input,
        {
            params: { token },
            timeout: 600000 // 10分钟超时
        }
    );

    const items = response.data;
    if (!Array.isArray(items)) return { ads: [], keywordMap: {} };

    const keywordMap: Record<string, number> = {};
    const mappedAds = items.map((item, idx) => {
        const ad = mapApifyItemToAd(item, idx);
        // 尝试找回原始关键词归属（Actor 通常会返回搜索 URL）
        const searchUrl = item.searchUrl || '';
        const matchedKeyword = keywords.find(k => searchUrl.includes(encodeURIComponent(k))) || keywords[0];
        ad.originalKeyword = matchedKeyword;
        keywordMap[matchedKeyword] = (keywordMap[matchedKeyword] || 0) + 1;
        return ad;
    });

    return {
        ads: Array.from(new Map(mappedAds.map(item => [item.id, item])).values()),
        keywordMap
    };

  } catch (error: any) {
    console.error("Batch Search Error:", error);
    if (error.response?.status === 401 || error.response?.status === 403) {
        throw new Error("Invalid Token");
    }
    throw error;
  }
};

// 保持兼容性的单次搜索
export const searchAdsWithApify = async (token: string, keyword: string, filters: SearchFilters): Promise<Ad[]> => {
    const result = await searchAdsWithApifyBatch(token, [keyword], filters);
    return result.ads;
};
