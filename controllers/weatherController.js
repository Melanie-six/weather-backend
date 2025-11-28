const axios = require("axios");

const CWA_API_BASE_URL = "https://opendata.cwa.gov.tw/api";
const CWA_API_KEY = process.env.CWA_API_KEY;

// 1. 縣市 vs API ID (對應各縣市的「未來1週天氣預報」)
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

// 2. 縣市 vs 預設行政區 (已補齊全台 22 縣市的市中心/政府所在地)
const CITY_DISTRICT_MAP = {
  "基隆市": "仁愛區",
  "臺北市": "信義區",
  "新北市": "板橋區",
  "桃園市": "桃園區",
  "新竹市": "東區",
  "新竹縣": "竹北市",
  "苗栗縣": "苗栗市",
  "臺中市": "西屯區",
  "彰化縣": "彰化市",
  "南投縣": "南投市",
  "雲林縣": "斗六市",
  "嘉義市": "東區",
  "嘉義縣": "太保市",
  "臺南市": "安平區",
  "高雄市": "苓雅區",
  "屏東縣": "屏東市",
  "宜蘭縣": "宜蘭市",
  "花蓮縣": "花蓮市",
  "臺東縣": "臺東市",
  "澎湖縣": "馬公市",
  "金門縣": "金城鎮",
  "連江縣": "南竿鄉"
};

const getCityWeather = async (req, res) => {
  try {
    const cityName = req.params.city || "基隆市";
    // 取得 API ID (預設 fallback 到全台資料 091，但不建議)
    const apiId = CITY_API_ID_MAP[cityName] || "F-D0047-091";
    // 取得行政區
    const districtName = CITY_DISTRICT_MAP[cityName];

    // console.log(`[Query] 城市: ${cityName}, 區域: ${districtName}, API_ID: ${apiId}`);

    if (!districtName) {
        return res.status(400).json({ error: "不支援的城市", message: `目前尚未設定 ${cityName} 的預設區域` });
    }

    const response = await axios.get(`${CWA_API_BASE_URL}/v1/rest/datastore/${apiId}`, {
      params: {
        Authorization: CWA_API_KEY,
        locationName: districtName,
        sort: "time"
      },
    });

    const apiResult = response.data;
    if (apiResult.success === "false") {
        return res.status(500).json({ error: "API 回傳錯誤", details: apiResult.error });
    }

    // === 1. 結構解析 (相容 Locations/locations) ===
    const records = apiResult.records;
    let targetLocation = null;

    // 處理大寫 Locations (新版 API 常見)
    if (records.Locations && records.Locations[0] && records.Locations[0].Location) {
        targetLocation = records.Locations[0].Location.find(loc => loc.LocationName === districtName);
    }
    // 處理小寫 locations (部分舊版或全台 API)
    else if (records.locations && records.locations[0] && records.locations[0].location) {
        targetLocation = records.locations[0].location.find(loc => loc.locationName === districtName);
    }
    // 處理直接 location (少見但有)
    else if (records.location) {
        targetLocation = records.location.find(loc => loc.locationName === districtName);
    }

    if (!targetLocation) {
        return res.status(404).json({ error: "找不到區域資料", message: `在資料中找不到 ${districtName}` });
    }

    // === 2. 整理氣象要素 (相容大小寫 ElementName/elementName) ===
    const rawElements = {};
    const weatherElement = targetLocation.WeatherElement || targetLocation.weatherElement;

    if (!weatherElement) {
         return res.status(500).json({ error: "資料結構異常", message: "找不到 WeatherElement" });
    }

    weatherElement.forEach(el => {
        // 統一使用 ElementName 當 Key (例如 "平均溫度")
        const name = el.ElementName || el.elementName;
        const timeData = el.Time || el.time;
        if (name && timeData) {
            rawElements[name] = timeData;
        }
    });

    // 檢查有沒有抓到「平均溫度」
    const timeArr = rawElements['平均溫度'];
    if (!timeArr) {
        return res.status(500).json({ error: "資料缺漏", message: "找不到 '平均溫度' 資料" });
    }

    // === 3. 解析數值 (針對動態 Key 結構) ===
    const forecasts = timeArr.map((timeItem, index) => {
        
        // 輔助函式：抓值
        const getVal = (name, key) => {
            const times = rawElements[name];
            if (!times || !times[index]) return "--";
            
            // 相容 ElementValue / elementValue
            const values = times[index].ElementValue || times[index].elementValue;
            if (!values || !values[0]) return "--";
            
            // 直接取對應的 key (例如 "Temperature")
            return values[0][key] || "--";
        };

        return {
            // 相容 StartTime / startTime
            startTime: timeItem.StartTime || timeItem.startTime,
            endTime: timeItem.EndTime || timeItem.endTime,
            
            temp: getVal("平均溫度", "Temperature"),
            
            // 降雨機率：如果回傳 " " (空) 或 "-" 則顯示 0
            rain: (getVal("12小時降雨機率", "ProbabilityOfPrecipitation") === " " || getVal("12小時降雨機率", "ProbabilityOfPrecipitation") === "-") ? "0" : getVal("12小時降雨機率", "ProbabilityOfPrecipitation"),
            
            humid: getVal("平均相對濕度", "RelativeHumidity"),
            weather: getVal("天氣現象", "Weather"),
            windSpeed: getVal("風速", "WindSpeed"),
            windScale: getVal("風速", "BeaufortScale")
        };
    });

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