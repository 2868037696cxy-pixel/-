
import axios from 'axios';
import { Ad, MediaType, SearchFilters } from '../types';
import { ACTOR_ID } from '../constants';

const APIFY_BASE_URL = 'https://api.apify.com/v2';

// Helper to convert internal period constants to Apify format
function convertPeriod(period: string) {
    const periodMap: Record<string, string> = {
        'LAST_30_DAYS': 'last30d',
        'LAST_90_DAYS': 'last30d', // Fallback as Apify might not support 90d directly in this actor
        'LAST_YEAR': 'last30d',     // Fallback
        'LAST_24_HOURS': 'last24h',
        'LAST_7_DAYS': 'last7d',
        'LAST_14_DAYS': 'last14d',
        'ALL': ''
    };
    return periodMap[period] || '';
}

// Build the Facebook Ads URL based on filters
function buildFacebookAdsURL(keyword: string, filters: SearchFilters) {
    const baseURL = 'https://www.facebook.com/ads/library/';
    const params = new URLSearchParams();

    // Basic search parameters
    params.set('active_status', 'active'); // Default to active
    params.set('ad_type', filters.adType || 'all'); 
    params.set('country', filters.region || 'ALL');
    params.set('q', keyword);
    params.set('search_type', 'keyword_unordered');
    
    // Media Type
    if (filters.mediaType && filters.mediaType !== 'ALL') {
         params.set('media_type', filters.mediaType.toLowerCase());
    } else {
         params.set('media_type', 'all');
    }

    // Language
    if (filters.language && filters.language !== 'auto' && filters.language !== 'ALL') {
        params.append('content_languages[0]', filters.language);
    }

    // Time period for URL parameters (Facebook format)
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

    return baseURL + '?' + params.toString();
}

/**
 * Verify if the Apify Token is valid
 */
export const verifyApifyToken = async (token: string): Promise<boolean> => {
    try {
        if (!token) return false;
        await axios.get(`${APIFY_BASE_URL}/users/me`, { params: { token } });
        return true;
    } catch (error) {
        return false;
    }
};

/**
 * Maps raw Apify item to internal Ad interface
 * Based on processAdData from reference code
 */
const mapApifyItemToAd = (item: any, index: number): Ad => {
    // Normalize fields
    const id = item.ad_archive_id || item.ad_id || item.id || `apify-${index}`;
    const advertiserName = item.snapshot?.page_name || item.page_name || "Unknown Advertiser";
    
    // Extract content from various potential fields
    let adCopy = item.snapshot?.body?.text || 
                   item.snapshot?.title || 
                   item.ad_creative_body || 
                   item.text || 
                   item.message || 
                   item.description || 
                   "";
    
    // If no text, mark it instead of empty string to avoid filtering
    if (!adCopy || adCopy.trim() === '') {
        adCopy = "[纯媒体广告/无文案]";
    }
                   
    const ctaText = item.snapshot?.cta_text || item.cta_text || "Learn More";
    
    // Media handling (Kept for metadata but not used in UI anymore)
    let adMedia = `ad-apify-${index}`; 
    let mediaType = MediaType.IMAGE;

    if (item.snapshot?.images && item.snapshot.images.length > 0) {
        adMedia = item.snapshot.images[0].original_image_url || item.snapshot.images[0].resized_image_url;
    } else if (item.snapshot?.videos && item.snapshot.videos.length > 0) {
        adMedia = item.snapshot.videos[0].video_preview_image_url; 
        mediaType = MediaType.VIDEO;
    } else if (item.images && item.images.length > 0) {
        adMedia = item.images[0];
    }

    let platform = item.publisher_platform || ["Facebook"];
    if (typeof platform === 'string') platform = [platform];

    // Extraction for Display Link and Headline
    const displayLink = item.snapshot?.caption || "WWW.FACEBOOK.COM"; // 'caption' usually holds the display domain
    const headline = item.snapshot?.title || advertiserName; // 'title' usually holds the link headline

    const startDate = item.start_date || new Date().toISOString().split('T')[0];
    const endDate = item.end_date || undefined;
    const isActive = item.is_active === true;
    const count = item.ads_count || 1;
    const adLibraryUrl = item.ad_library_url || `https://www.facebook.com/ads/library/?id=${id}`;

    // --- Extract Reach (Impressions) Logic ---
    let reach: number | undefined = undefined;

    const parseReach = (val: any): number | undefined => {
        if (typeof val === 'number') return val;
        if (typeof val === 'string') {
            const parsed = parseInt(val.replace(/[^0-9]/g, ''), 10);
            return isNaN(parsed) ? undefined : parsed;
        }
        return undefined;
    };

    // 1. Try EU Transparency Field (Exact number like 348)
    if (item.snapshot?.eu_total_reach) {
        reach = parseReach(item.snapshot.eu_total_reach);
    }
    
    // 2. Try Standard Impressions Lower Bound
    if (reach === undefined && item.snapshot?.impressions?.lower_bound) {
        reach = parseReach(item.snapshot.impressions.lower_bound);
    }

    // 3. Fallback to root level fields
    if (reach === undefined && item.eu_total_reach) {
        reach = parseReach(item.eu_total_reach);
    }
    if (reach === undefined && item.impressions?.lower_bound) {
        reach = parseReach(item.impressions.lower_bound);
    }

    return {
      id,
      advertiserName,
      advertiserAvatar: `avatar-${advertiserName}`, // Placeholder
      adCopy,
      adMedia, 
      mediaType,
      ctaText,
      startDate,
      endDate,
      isActive,
      platform: Array.isArray(platform) ? platform : ['Facebook'],
      adLibraryUrl,
      count,
      displayLink,
      headline,
      reach
    };
};

/**
 * Active Scraping Function
 * Triggers the actor to run specifically for the generated URL
 */
export const searchAdsWithApify = async (
  token: string, 
  keyword: string, 
  filters: SearchFilters
): Promise<Ad[]> => {
  try {
    if (!token) throw new Error("未配置 Apify API 令牌。请在设置中配置。");

    // 1. Build the specific Facebook URL for this query
    const searchUrl = buildFacebookAdsURL(keyword, filters);
    console.log(`Searching Facebook Ads via Apify: ${searchUrl}`);

    // 2. Prepare Input for the Actor
    const input = {
        urls: [{ url: searchUrl }],
        count: 100, // Increased to 100 to catch more ads
        period: convertPeriod(filters.dateRange),
        'scrapePageAds.activeStatus': 'all',
        'scrapePageAds.countryCode': 'ALL'
    };

    // 3. Call the run-sync-get-dataset-items endpoint
    // This runs the actor and waits for results (timeout 2 mins usually sufficient for small batches)
    const response = await axios.post(
        `${APIFY_BASE_URL}/acts/${ACTOR_ID}/run-sync-get-dataset-items`,
        input,
        {
            params: { token },
            timeout: 300000 // 5 minutes timeout
        }
    );

    const items = response.data;
    if (!Array.isArray(items)) return [];

    // 4. Map and Dedup results
    const mappedAds = items
        .map((item, idx) => mapApifyItemToAd(item, idx))
        .filter(ad => ad.id); // Filter only by ID, allow empty text (handled in map function)

    // Remove duplicates based on ID
    const uniqueAds = Array.from(new Map(mappedAds.map(item => [item.id, item])).values());

    // Attach original keyword for tracking
    return uniqueAds.map(ad => ({
        ...ad,
        originalKeyword: keyword
    }));

  } catch (error: any) {
    console.error("Apify Search Error:", error);
    if (error.code === 'ECONNABORTED') {
        throw new Error("请求超时。Facebook 广告库响应较慢，请减少批量并发数。");
    }
    // Handle Axios Network Error specifically
    if (error.message === 'Network Error') {
        throw new Error("网络连接失败。请检查您的网络设置，或是否开启了 VPN/代理导致连接中断。");
    }
    if (error.response?.status === 401 || error.response?.status === 403) {
        throw new Error("Apify API 令牌无效或过期。请前往“系统设置”更新 Token。");
    }
    throw new Error(error.message || "Apify 搜索请求失败");
  }
};
