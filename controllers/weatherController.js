const axios = require("axios");

// CWA API 設定
const CWA_API_BASE_URL = "https://opendata.cwa.gov.tw/api";
const CWA_API_KEY = process.env.CWA_API_KEY;

// 城市 vs 代表區域對應表 (選市政府所在地或繁華區)
// 用來將「縣市名稱」轉換為 API 需要的「鄉鎮市區名稱」
const CITY_DISTRICT_MAP = {
  "基隆市": "仁愛區",
  "臺北市": "信義區",
  "新北市": "板橋區",
  "新竹市": "東區",
  "臺中市": "西屯區",
  "臺南市": "安平區",
  "高雄市": "苓雅區",
  // 你可以自行擴充其他縣市
};

/**
 * 取得指定縣市天氣預報
 * 使用「F-D0047-091」鄉鎮市區未來1週天氣預報
 */
const getCityWeather = async (req, res) => {
  try {
    // 1. 從網址參數取得城市名稱 (例如：基隆市)
    // 如果沒傳，預設為基隆市
    const cityName = req.params.city || "基隆市";
    
    // 2. 轉換為對應的行政區 (例如：仁愛區)
    const districtName = CITY_DISTRICT_MAP[cityName];

    if (!districtName) {
      return res.status(400).json({
        error: "不支援的城市",
        message: `目前尚未支援 ${cityName}，請確認名稱是否正確`,
      });
    }

    if (!CWA_API_KEY) {
      return res.status(500).json({
        error: "伺服器設定錯誤",
        message: "請在 .env 檔案中設定 CWA_API_KEY",
      });
    }

    // 3. 呼叫 CWA API (F-D0047-091)
    // elementName: 過濾我們需要的欄位 (T=溫度, PoP12h=降雨, RH=濕度, WS=風速, Wx=天氣描述)
    const response = await axios.get(
      `${CWA_API_BASE_URL}/v1/rest/datastore/F-D0047-091`,
      {
        params: {
          Authorization: CWA_API_KEY,
          locationName: districtName, 
          elementName: "T,PoP12h,RH,WS,Wx",
          sort: "time"
        },
      }
    );

    const locationData = response.data.records.locations[0].location[0];

    if (!locationData) {
      return res.status(404).json({
        error: "查無資料",
        message: `無法取得 ${cityName} (${districtName}) 的天氣資料`,
      });
    }

    // 4. 整理資料格式
    // API 的資料結構是：每個要素(如溫度)有一串時間序列
    // 我們要把它轉成：每個時間點有一串要素
    
    // 先把各個要素取出來變成 Map 方便查找
    const elements = {};
    locationData.weatherElement.forEach(el => {
      elements[el.elementName] = el.time;
    });

    // 以「溫度 (T)」的時間點為基準來跑迴圈
    // 通常回傳會有約 14-16 筆資料 (未來一週，早晚各一筆)
    const forecasts = elements['T'].map((timeItem, index) => {
      // 取得對應 index 的其他數值
      // 注意：降雨機率 PoP12h 可能因為時間區段不同，index 不一定完全對齊
      // 但在 F-D0047-091 中，通常順序是一致的，若要嚴謹可以用 startTime 比對
      
      const rainVal = elements['PoP12h'][index]?.elementValue[0].value || "0";
      const humidVal = elements['RH'][index]?.elementValue[0].value || "--";
      const windSpeedVal = elements['WS'][index]?.elementValue[0].value || "--"; // 公尺/秒
      const windScaleVal = elements['WS'][index]?.elementValue[1].value || "--"; // 蒲福風級
      const wxVal = elements['Wx'][index]?.elementValue[0].value || "";

      return {
        startTime: timeItem.startTime,
        endTime: timeItem.endTime,
        weather: wxVal,
        rain: rainVal === " " ? "0" : rainVal, // 處理空值
        temp: timeItem.elementValue[0].value,  // 攝氏溫度
        humid: humidVal,     // 濕度 %
        windSpeed: windSpeedVal, // 風速 m/s
        windScale: windScaleVal, // 風力級數
      };
    });

    // 回傳給前端
    res.json({
      success: true,
      data: {
        city: cityName,     // 回傳大城市名 (基隆市)
        district: districtName, // 回傳細部區名 (仁愛區)
        forecasts: forecasts,
      },
    });

  } catch (error) {
    console.error("取得天氣資料失敗:", error.message);
    res.status(500).json({
      error: "伺服器錯誤",
      message: "無法取得天氣資料",
    });
  }
};

// 匯出函式 (注意名稱改了)
module.exports = {
  getCityWeather,
};