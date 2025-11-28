const axios = require("axios");

const CWA_API_BASE_URL = "https://opendata.cwa.gov.tw/api";
const CWA_API_KEY = process.env.CWA_API_KEY;

// 1. 縣市 vs API ID 對應表 (建議用各縣市專屬 ID，資料比較準且小)
// 這些 ID 是對應到「未來1週天氣預報」
const CITY_API_ID_MAP = {
  "基隆市": "F-D0047-051",
  "臺北市": "F-D0047-063",
  "新北市": "F-D0047-071",
  "桃園市": "F-D0047-007",
  "新竹市": "F-D0047-055",
  "新竹縣": "F-D0047-011",
  "苗栗縣": "F-D0047-015",
  "臺中市": "F-D0047-075",
  "彰化縣": "F-D0047-019",
  "南投縣": "F-D0047-023",
  "雲林縣": "F-D0047-027",
  "嘉義市": "F-D0047-059",
  "嘉義縣": "F-D0047-031",
  "臺南市": "F-D0047-079",
  "高雄市": "F-D0047-067",
  "屏東縣": "F-D0047-035",
  "宜蘭縣": "F-D0047-003",
  "花蓮縣": "F-D0047-043",
  "臺東縣": "F-D0047-039",
  "澎湖縣": "F-D0047-047",
  "金門縣": "F-D0047-087",
  "連江縣": "F-D0047-083"
};

// 2. 代表行政區
const CITY_DISTRICT_MAP = {
  "基隆市": "仁愛區",
  "臺北市": "信義區",
  "新北市": "板橋區",
  "新竹市": "東區",
  "臺中市": "西屯區",
  "臺南市": "安平區",
  "高雄市": "苓雅區",
};

const getCityWeather = async (req, res) => {
  try {
    const cityName = req.params.city || "基隆市";
    
    // 優先使用縣市專用 ID，如果沒有就回退到全台 ID (091)
    const apiId = CITY_API_ID_MAP[cityName] || "F-D0047-091";
    const districtName = CITY_DISTRICT_MAP[cityName];

    console.log(`[Query] 城市: ${cityName}, 區域: ${districtName}, API_ID: ${apiId}`);

    if (!districtName) {
        return res.status(400).json({ error: "未設定代表區域", message: `請新增 ${cityName} 的預設區域` });
    }

    const response = await axios.get(`${CWA_API_BASE_URL}/v1/rest/datastore/${apiId}`, {
      params: {
        Authorization: CWA_API_KEY,
        locationName: districtName,
        elementName: "T,PoP12h,RH,WS,Wx",
        sort: "time"
      },
    });

    const apiResult = response.data;
    if (apiResult.success === "false") {
        return res.status(500).json({ error: "API 回傳錯誤", details: apiResult.error });
    }

    // === 關鍵修改：萬能結構解析器 ===
    // 自動處理 Locations/locations 以及多層/少層的問題
    const records = apiResult.records;
    let targetLocation = null;

    // 狀況 A: F-D0047-091 (全台) -> records.locations[0].location
    // 狀況 B: F-D0047-051 (單縣市) -> records.locations[0].location
    // 狀況 C: 你的觀察 (大寫) -> records.Locations[0].Location
    
    // 1. 先抓出最外層的 location 集合 (不管大寫小寫)
    const locationsList = records.locations || records.Locations;
    
    if (locationsList && locationsList.length > 0) {
        // 這層裡面通常還有一個 location/Location 陣列
        const innerLocation = locationsList[0].location || locationsList[0].Location;
        if (innerLocation) {
             targetLocation = innerLocation.find(loc => 
                (loc.locationName === districtName) || (loc.LocationName === districtName)
             );
        }
    } else if (records.location || records.Location) {
        // 狀況 D: F-C0032-001 (舊版) -> records.location (沒有 locations 那層)
        const directLocation = records.location || records.Location;
        targetLocation = directLocation.find(loc => 
            (loc.locationName === districtName) || (loc.LocationName === districtName)
        );
    }

    if (!targetLocation) {
        // 印出結構讓你看看到底長怎樣
        console.error("[Structure Error] Records keys:", Object.keys(records));
        return res.status(404).json({ 
            error: "找不到區域資料", 
            message: `無法在 ${apiId} 結構中找到 ${districtName}，請檢查 Logs` 
        });
    }

    // === 資料整理 (也相容大小寫欄位) ===
    const elements = {};
    const weatherElement = targetLocation.weatherElement || targetLocation.WeatherElement;
    
    weatherElement.forEach(el => {
      // 統一轉成小寫 key，方便後面取用 (例如 PoP12h 可能變 pop12h)
      // 但我們保留原始 elementName 當作 key
      elements[el.elementName] = el.time || el.Time;
    });

    // 準備解析 (以溫度 T 為基準)
    const timeArr = elements['T']; 
    if (!timeArr) {
         return res.status(500).json({ error: "資料缺漏", message: "找不到溫度(T)資料" });
    }

    const forecasts = timeArr.map((timeItem, index) => {
      // 輔助函式：安全取值 (防止 undefined)
      const getValue = (eleKey, valIndex = 0) => {
          const item = elements[eleKey]?.[index];
          if (!item) return null;
          // 有些 API 是 elementValue，有些是 ElementValue
          const values = item.elementValue || item.ElementValue;
          return values?.[valIndex]?.value || values?.[valIndex]?.Value || "--";
      };

      return {
        startTime: timeItem.startTime || timeItem.StartTime,
        endTime: timeItem.endTime || timeItem.EndTime,
        weather: getValue('Wx', 0),
        rain: getValue('PoP12h', 0) === " " ? "0" : getValue('PoP12h', 0), 
        temp: getValue('T', 0),
        humid: getValue('RH', 0),
        windSpeed: getValue('WS', 0), // 風速
        windScale: getValue('WS', 1), // 風級
      };
    });

    console.log(`[Success] 成功取得 ${cityName} 資料`);

    res.json({
      success: true,
      data: {
        city: cityName,
        district: districtName,
        forecasts: forecasts,
      },
    });

  } catch (error) {
    console.error("[Critical Error]", error);
    res.status(500).json({ error: "伺服器內部錯誤", message: error.message });
  }
};

module.exports = { getCityWeather };