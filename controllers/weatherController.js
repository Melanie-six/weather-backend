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
};

const getCityWeather = async (req, res) => {
  try {
    const cityName = req.params.city || "基隆市";
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

    // === 結構解析 (Locations/Location) ===
    const records = apiResult.records;
    let targetLocation = null;

    const locationsList = records.locations || records.Locations;
    if (locationsList && locationsList.length > 0) {
        const innerLocation = locationsList[0].location || locationsList[0].Location;
        if (innerLocation) {
             targetLocation = innerLocation.find(loc => 
                (loc.locationName === districtName) || (loc.LocationName === districtName)
             );
        }
    } else if (records.location || records.Location) {
        const directLocation = records.location || records.Location;
        targetLocation = directLocation.find(loc => 
            (loc.locationName === districtName) || (loc.LocationName === districtName)
        );
    }

    if (!targetLocation) {
        console.error("[Structure Error] Records keys:", Object.keys(records));
        return res.status(404).json({ error: "找不到區域資料", message: `在結構中找不到 ${districtName}` });
    }

    // === 關鍵修正：氣象要素解析 (兼容大寫 ElementName) ===
    const elements = {};
    const weatherElement = targetLocation.weatherElement || targetLocation.WeatherElement;
    
    if (!weatherElement) {
         return res.status(500).json({ error: "資料結構異常", message: "找不到 weatherElement 欄位" });
    }

    weatherElement.forEach(el => {
      // 同時檢查小寫 elementName 與大寫 ElementName
      const name = el.elementName || el.ElementName;
      const timeData = el.time || el.Time;
      if (name) {
          elements[name] = timeData;
      }
    });

    // 檢查是否有抓到 'T' (溫度)
    const timeArr = elements['T']; 
    if (!timeArr) {
         // 印出抓到了哪些 Key，方便除錯
         const foundKeys = Object.keys(elements);
         console.error(`[Missing Data] 找不到 T，但發現了: ${foundKeys.join(", ")}`);
         return res.status(500).json({ error: "資料缺漏", message: `找不到溫度(T)資料，僅發現: ${foundKeys.join(",")}` });
    }

    // === 數值解析 (兼容大寫 ElementValue/Value) ===
    const forecasts = timeArr.map((timeItem, index) => {
      
      const getValue = (eleKey, valIndex = 0) => {
          const item = elements[eleKey]?.[index];
          if (!item) return null;
          
          // 兼容 elementValue / ElementValue
          const values = item.elementValue || item.ElementValue;
          if (!values) return null;

          // 兼容 value / Value
          const targetVal = values[valIndex];
          return targetVal?.value || targetVal?.Value || "--";
      };

      return {
        startTime: timeItem.startTime || timeItem.StartTime,
        endTime: timeItem.endTime || timeItem.EndTime,
        weather: getValue('Wx', 0),
        rain: getValue('PoP12h', 0) === " " ? "0" : getValue('PoP12h', 0), 
        temp: getValue('T', 0),
        humid: getValue('RH', 0),
        windSpeed: getValue('WS', 0), 
        windScale: getValue('WS', 1), 
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