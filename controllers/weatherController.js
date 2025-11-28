const axios = require("axios");

const CWA_API_BASE_URL = "https://opendata.cwa.gov.tw/api";
const CWA_API_KEY = process.env.CWA_API_KEY;

// 1. 縣市 vs API ID (專屬 ID)
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
  // 你可以自行增加其他縣市的區
};

const getCityWeather = async (req, res) => {
  try {
    const cityName = req.params.city || "基隆市";
    // 預設使用全台 ID (091)，如果有專屬 ID 則使用專屬 ID
    const apiId = CITY_API_ID_MAP[cityName] || "F-D0047-091";
    const districtName = CITY_DISTRICT_MAP[cityName];

    // console.log(`[Query] 城市: ${cityName}, 區域: ${districtName}, API_ID: ${apiId}`);

    if (!districtName) {
        return res.status(400).json({ error: "未設定代表區域", message: `請新增 ${cityName} 的預設區域` });
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

    // === 1. 進入 Location 層級 (根據你提供的 JSON 結構) ===
    // 結構是 records.Locations[0].Location
    const records = apiResult.records;
    let targetLocation = null;

    if (records.Locations && records.Locations[0] && records.Locations[0].Location) {
        targetLocation = records.Locations[0].Location.find(loc => loc.LocationName === districtName);
    }

    if (!targetLocation) {
        return res.status(404).json({ error: "找不到區域資料", message: `在資料中找不到 ${districtName}` });
    }

    // === 2. 整理氣象要素 (WeatherElement) ===
    // 我們把整包資料存進 Map，Key 用中文名稱
    const rawElements = {};
    targetLocation.WeatherElement.forEach(el => {
        rawElements[el.ElementName] = el.Time;
    });

    // 檢查有沒有抓到「平均溫度」這個關鍵欄位
    const timeArr = rawElements['平均溫度'];
    if (!timeArr) {
        return res.status(500).json({ error: "資料缺漏", message: "找不到 '平均溫度' 資料" });
    }

    // === 3. 解析數值 (針對你的 JSON 格式) ===
    const forecasts = timeArr.map((timeItem, index) => {
        
        // 輔助函式：從 rawElements 裡抓值
        // name: 中文要素名稱 (例如 "平均相對濕度")
        // key: JSON 裡面的英文 Key (例如 "RelativeHumidity")
        const getVal = (name, key) => {
            const times = rawElements[name];
            if (!times || !times[index]) return "--";
            
            const values = times[index].ElementValue;
            if (!values || !values[0]) return "--";
            
            return values[0][key] || "--";
        };

        return {
            startTime: timeItem.StartTime,
            endTime: timeItem.EndTime,
            // 溫度 -> 找 "平均溫度" -> 裡的 "Temperature"
            temp: getVal("平均溫度", "Temperature"),
            
            // 降雨 -> 找 "12小時降雨機率" -> 裡的 "ProbabilityOfPrecipitation"
            rain: getVal("12小時降雨機率", "ProbabilityOfPrecipitation") === " " ? "0" : getVal("12小時降雨機率", "ProbabilityOfPrecipitation"),
            
            // 濕度 -> 找 "平均相對濕度" -> 裡的 "RelativeHumidity"
            humid: getVal("平均相對濕度", "RelativeHumidity"),
            
            // 天氣 -> 找 "天氣現象" -> 裡的 "Weather"
            weather: getVal("天氣現象", "Weather"),
            
            // 風速 (m/s) -> 找 "風速" -> 裡的 "WindSpeed"
            windSpeed: getVal("風速", "WindSpeed"),
            
            // 風級 -> 找 "風速" -> 裡的 "BeaufortScale"
            windScale: getVal("風速", "BeaufortScale")
        };
    });

    // console.log(`[Success] 成功取得 ${cityName} 資料`);

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