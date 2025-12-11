
import { GoogleGenAI, Type, Chat, Content } from "@google/genai";
import { Ad, MediaType, ModelType, SearchFilters, AdStatus } from "../types";
import { STORAGE_KEYS, DEFAULT_SETTINGS } from "../constants";

// Circuit Breaker State for Rate Limiting
let isRateLimited = false;
let rateLimitResetTime = 0;

// Helper to get configuration (Key + BaseURL)
const getClientConfig = () => {
  let apiKey = process.env.API_KEY || '';
  let baseUrl = 'https://generativelanguage.googleapis.com';

  try {
    const storedSettings = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    
    // 1. Determine API Key
    if (storedSettings) {
      const parsed = JSON.parse(storedSettings);
      if (parsed.customGeminiApiKey && parsed.customGeminiApiKey.trim() !== '') {
        apiKey = parsed.customGeminiApiKey.trim();
      } else {
        apiKey = (DEFAULT_SETTINGS.customGeminiApiKey || apiKey).trim();
      }
      
      // 2. Determine Base URL
      if (parsed.customBaseUrl && parsed.customBaseUrl.trim() !== '') {
        baseUrl = parsed.customBaseUrl.trim();
      } else {
        baseUrl = (DEFAULT_SETTINGS.customBaseUrl || baseUrl).trim();
      }
    } else {
      // No local storage, use defaults
      apiKey = (DEFAULT_SETTINGS.customGeminiApiKey || apiKey).trim();
      baseUrl = (DEFAULT_SETTINGS.customBaseUrl || baseUrl).trim();
    }

    // 3. AUTO-FIX: If Key is 'sk-' (Proxy) but URL is 'googleapis' (Official), force Proxy URL
    if (apiKey && apiKey.startsWith('sk-') && baseUrl.includes('googleapis.com')) {
        console.warn("Detected Proxy Key with Google URL. Auto-switching to VectorEngine.");
        baseUrl = 'https://api.vectorengine.ai';
    }

    // 4. CLEANUP: Remove trailing slash and specific suffixes that break Google paths
    baseUrl = baseUrl.replace(/\/+$/, ''); 
    if (baseUrl.endsWith('/v1')) {
        baseUrl = baseUrl.slice(0, -3); 
    }

  } catch (e) {
    // Ignore error
    apiKey = (DEFAULT_SETTINGS.customGeminiApiKey || apiKey).trim();
    baseUrl = (DEFAULT_SETTINGS.customBaseUrl || baseUrl).trim();
  }
  return { apiKey, baseUrl };
};

// Helper to get a fresh client instance (For Chat / Complex SDK features)
const getAiClient = () => {
    const { apiKey, baseUrl } = getClientConfig();
    if (!apiKey) throw new Error("Missing API Key");
    
    // Pass baseUrl to constructor to support proxies
    return new GoogleGenAI({ apiKey, baseUrl } as any);
};

// --- RAW FETCH HELPER FOR PROXY COMPATIBILITY ---
// Many proxies require 'Authorization: Bearer' which the SDK might not send by default.
const generateContentViaFetch = async (model: string, prompt: string, isJson: boolean = false) => {
    const { apiKey, baseUrl } = getClientConfig();
    if (!apiKey) throw new Error("Missing API Key");

    // Ensure correct endpoint construction
    const url = `${baseUrl}/v1beta/models/${model}:generateContent?key=${apiKey}`;
    
    const body: any = {
        contents: [{
            parts: [{ text: prompt }]
        }]
    };

    if (isJson) {
        body.generationConfig = {
            responseMimeType: "application/json"
        };
    }

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}` // CRITICAL: Inject Bearer Token for proxies
        },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API Request Failed: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const data = await response.json();
    return data;
};

// Helper for delay
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Helper for exponential backoff with jitter
const waitWithBackoff = async (attempt: number) => {
  const baseDelay = 1000; // 1 second
  const maxDelay = 10000; // 10 seconds
  // Add jitter between 0-500ms to prevent thundering herd patterns
  const jitter = Math.random() * 500;
  // Exponential backoff: 1s, 2s, 4s... capped at 10s
  const delayTime = Math.min(baseDelay * Math.pow(2, attempt), maxDelay) + jitter;
  await delay(delayTime);
};

// Helper to generate simulated ads based on a keyword and filters
export const searchAdsWithGemini = async (keyword: string, filters?: SearchFilters): Promise<Ad[]> => {
  try {
    const ai = getAiClient();
    // Construct filter instructions for the prompt
    let filterInstructions = "";
    
    if (filters) {
      if (filters.platforms && filters.platforms.length > 0) {
        filterInstructions += `The 'platform' field MUST strictly only contain values from this list: ${JSON.stringify(filters.platforms)}. `;
      }
      
      if (filters.status === AdStatus.ACTIVE) {
        filterInstructions += `All ads MUST have 'isActive' set to true. `;
      } else if (filters.status === AdStatus.INACTIVE) {
        filterInstructions += `All ads MUST have 'isActive' set to false. `;
      }
      
      if (filters.startDate) {
        filterInstructions += `The 'startDate' should be around or after ${filters.startDate}. `;
      }
      
      // Filter instruction for Media Type
      if (filters.mediaType === MediaType.IMAGE) {
        filterInstructions += `The ads MUST be IMAGE ads. `;
      } else if (filters.mediaType === MediaType.VIDEO) {
        filterInstructions += `The ads MUST be VIDEO ads. `;
      }
    }

    // Determine language instruction
    let langInstruction = "The content (adCopy, ctaText, advertiserName) MUST be in Simplified Chinese (简体中文).";
    if (filters?.language === 'en') langInstruction = "The content MUST be in English.";
    else if (filters?.language === 'es') langInstruction = "The content MUST be in Spanish.";
    else if (filters?.language === 'zh') langInstruction = "The content MUST be in Simplified Chinese (简体中文).";

    const response = await ai.models.generateContent({
      model: ModelType.FLASH,
      contents: `Generate 6 realistic Facebook ad examples for the keyword "${keyword}". 
      Include varied industries if applicable. 
      ${langInstruction}
      ${filterInstructions}
      Ensure the output is strictly JSON.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              advertiserName: { type: Type.STRING },
              adCopy: { type: Type.STRING, description: "The primary text of the ad in Chinese, realistic marketing copy." },
              ctaText: { type: Type.STRING, description: "Call to action button text in Chinese like '了解更多', '立即购买'" },
              isActive: { type: Type.BOOLEAN },
              platform: { 
                type: Type.ARRAY, 
                items: { type: Type.STRING },
                description: "Platforms like Facebook, Instagram, Messenger, Audience Network"
              },
              displayLink: { type: Type.STRING, description: "The website domain shown on the ad link card, UPPERCASE, e.g. 'WWW.NIKE.COM' or 'WWW.ZXNCIETUR.SHOP'" },
              headline: { type: Type.STRING, description: "The bold headline shown next to the button, e.g. 'Limited Time Offer' or brand name" }
            },
            required: ["id", "advertiserName", "adCopy", "ctaText", "isActive", "platform", "displayLink", "headline"]
          }
        }
      }
    });

    const data = JSON.parse(response.text || '[]');
    
    // Hydrate with client-side only data (images/dates) to save token generation cost/complexity
    return data.map((item: any, index: number) => {
      // Determine media type based on filters or random if ALL
      let mType = index % 3 === 0 ? MediaType.VIDEO : MediaType.IMAGE;
      if (filters?.mediaType === MediaType.VIDEO) mType = MediaType.VIDEO;
      if (filters?.mediaType === MediaType.IMAGE) mType = MediaType.IMAGE;

      return {
        ...item,
        advertiserAvatar: `avatar-${keyword}-${index}`,
        // adMedia is optional now and we are not using it for display
        mediaType: mType,
        startDate: filters?.startDate || new Date(Date.now() - Math.random() * 10000000000).toISOString().split('T')[0],
        originalKeyword: keyword
      };
    });

  } catch (error) {
    console.error("Gemini Search Error:", error);
    return [];
  }
};

// Chat client factory
export const createChatSession = (useThinking: boolean, history: Content[] = []): Chat => {
  const ai = getAiClient();
  return ai.chats.create({
    model: ModelType.PRO,
    config: {
      temperature: useThinking ? undefined : 0.7, // Thinking models often manage their own temp or prefer defaults
      thinkingConfig: useThinking ? { thinkingBudget: 32768 } : undefined,
      systemInstruction: "你是一个专业的Facebook广告优化和营销专家。请用中文回答所有问题。"
    },
    history: history
  });
};

export const sendMessageStream = async (chat: Chat, message: string) => {
  return await chat.sendMessageStream({ message });
};

// Translation Helper - Uses Raw Fetch for reliability
export const translateToChinese = async (text: string): Promise<string> => {
    if (!text) return "";
    
    // Circuit Breaker Check
    if (isRateLimited && Date.now() < rateLimitResetTime) {
        return text; 
    }

    try {
        const prompt = `Please translate the following Facebook ad copy into Simplified Chinese (简体中文). Maintain the tone and emoji. Only output the translated text, do not add any explanation or notes.\n\nText: "${text}"`;
        
        const data = await generateContentViaFetch(ModelType.FLASH, prompt);
        
        // Extract text from REST response structure
        const resultText = data.candidates?.[0]?.content?.parts?.[0]?.text;

        // Reset circuit breaker if successful
        isRateLimited = false;
        
        return resultText?.trim() || text;
    } catch (e: any) {
        const msg = e.toString();
        if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('Quota exceeded')) {
             console.warn("Translation Rate Limit hit. Pausing translation for 60s.");
             isRateLimited = true;
             rateLimitResetTime = Date.now() + 60000; // 60s cooldown
        }
        return text;
    }
};

// Batch Translation Helper - Improved with Chunking (100) and Exponential Backoff
export const batchTranslateToChinese = async (texts: string[]): Promise<string[]> => {
    if (!texts || texts.length === 0) return [];
    
    // 1. Circuit Breaker check
    if (isRateLimited && Date.now() < rateLimitResetTime) {
        console.warn("Skipping batch translation due to active rate limit cooldown.");
        return texts;
    }

    // Initialize results array with original texts (as fallback)
    const results: string[] = [...texts];
    
    // Max items per API call to avoid token limits or timeouts
    const BATCH_SIZE = 100;
    
    // Process in chunks to handle large datasets efficiently
    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
        const chunkStartIndex = i;
        const chunkOriginalData = texts.slice(i, i + BATCH_SIZE);
        
        // Optimize: Filter empty strings to save API tokens and time
        const itemsToTranslate = chunkOriginalData
            .map((text, idx) => ({ text, originalIndex: chunkStartIndex + idx }))
            .filter(item => item.text && item.text.trim() !== '');

        if (itemsToTranslate.length === 0) continue;

        const inputTexts = itemsToTranslate.map(item => item.text);

        // Recursive function with exponential backoff for retries
        const translateChunk = async (retryCount = 0): Promise<string[]> => {
            try {
                // Prompt optimized for machine processing
                const prompt = `Translate the following JSON array of strings to Simplified Chinese (简体中文). 
                Rules:
                1. Output ONLY a valid JSON Array of strings.
                2. No Markdown formatting (no \`\`\`json).
                3. Maintain emojis and tone.
                4. The output array length MUST be exactly ${inputTexts.length}.
                
                Input:
                ${JSON.stringify(inputTexts)}`;
                
                const data = await generateContentViaFetch(ModelType.FLASH, prompt, true);
                
                const resultText = data.candidates?.[0]?.content?.parts?.[0]?.text;
                let parsed: string[] = [];
                
                try {
                    const cleaned = resultText?.replace(/```json/g, '').replace(/```/g, '').trim();
                    parsed = JSON.parse(cleaned || '[]');
                } catch (e) {
                    throw new Error("Malformed JSON response");
                }

                if (!Array.isArray(parsed) || parsed.length !== inputTexts.length) {
                     // Try to recover partials or fail
                     throw new Error(`Response length mismatch. Expected ${inputTexts.length}, got ${parsed?.length}`);
                }
                
                // Success - Clear circuit breaker if it was set locally (not global logic here)
                return parsed;

            } catch (error: any) {
                 const errorMsg = error.toString();
                 const isTransient = errorMsg.includes('429') || 
                                     errorMsg.includes('RESOURCE_EXHAUSTED') || 
                                     errorMsg.includes('503') || 
                                     errorMsg.includes('500') ||
                                     errorMsg.includes('network');
                 
                 if (isTransient) {
                     if (retryCount < 3) {
                         // Apply exponential backoff with jitter
                         await waitWithBackoff(retryCount);
                         return translateChunk(retryCount + 1);
                     } else if (errorMsg.includes('429')) {
                         // Hard failure after retries for Rate Limit -> Trigger Global Circuit Breaker
                         console.warn("Global Rate Limit triggered after retries.");
                         isRateLimited = true;
                         rateLimitResetTime = Date.now() + 60000;
                     }
                 }
                 
                 console.error(`Batch translation chunk failed (Attempt ${retryCount + 1}):`, error.message);
                 return inputTexts; // Fallback to original
            }
        };

        const translatedChunk = await translateChunk();

        // Apply translations back to results array using correct original indices
        translatedChunk.forEach((translatedText, idx) => {
            const globalIndex = itemsToTranslate[idx].originalIndex;
            if (translatedText && translatedText.trim() !== '') {
                results[globalIndex] = translatedText;
            }
        });
    }

    return results;
}

// Test Connection - Uses Raw Fetch
export const testGeminiConnection = async (): Promise<boolean> => {
    try {
        const data = await generateContentViaFetch(ModelType.FLASH, "Ping");
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        return !!text;
    } catch (error) {
        console.error("Gemini connection test failed", error);
        return false;
    }
};
