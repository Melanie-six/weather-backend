const axios = require("axios");

const CWA_API_BASE_URL = "https://opendata.cwa.gov.tw/api";
const CWA_API_KEY = process.env.CWA_API_KEY;

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
    const districtName = CITY_DISTRICT_MAP[cityName];

    console.log(`[Debug] 正在查詢: ${cityName} (${districtName})`);
    console.log(`[Debug] API Key 狀態: ${CWA_API_KEY ? "已設定" : "未設定"}`);

    if (!districtName) {
      return res.status(400).json({ error: "不支援的城市" });
    }

    // 呼叫 API
    const url = `${CWA_API_BASE_URL}/v1/rest/datastore/F-D0047-091`;
    console.log(`[Debug] 請求網址: ${url}`);

    const response = await axios.get(url, {
      params: {
        Authorization: CWA_API_KEY,
        locationName: districtName,
        elementName: "T,PoP12h,RH,WS,Wx",
        sort: "time"
      },
    });

    // === Debug 關鍵：印出 API 回傳的結構 ===
    // 如果出錯，請去 Zeabur Logs 看這一段
    const apiResult = response.data;
    console.log(`[Debug] API Success 狀態: ${apiResult.success}`);
    
    if (apiResult.success === "false") {
        console.error(`[Error] API 回傳失敗:`, apiResult.error);
        return res.status(500).json({ error: "API Key 錯誤或權限不足", details: apiResult.error });
    }

    // 檢查層級是否存在
    if (!apiResult.records || !apiResult.records.locations || !apiResult.records.locations[0]) {
        console.error(`[Error] 找不到 records.locations[0]`);
        return res.status(500).json({ error: "API 資料結構異常 (Locations)" });
    }

    const locationGroup = apiResult.records.locations[0];
    const locationData = locationGroup.location && locationGroup.location[0];

    if (!locationData) {
        console.error(`[Error] 找不到 ${districtName} 的資料`);
        return res.status(404).json({ error: "查無此區域資料" });
    }

    // 整理資料
    const elements = {};
    locationData.weatherElement.forEach(el => {
      elements[el.elementName] = el.time;
    });

    // 檢查是否有缺漏的元素
    const requiredElements = ['T', 'PoP12h', 'RH', 'WS', 'Wx'];
    requiredElements.forEach(key => {
        if (!elements[key]) console.warn(`[Warning] 缺少氣象要素: ${key}`);
    });

    // 開始解析 (加上安全檢查 ?. )
    const forecasts = elements['T'].map((timeItem, index) => {
      return {
        startTime: timeItem.startTime,
        endTime: timeItem.endTime,
        weather: elements['Wx']?.[index]?.elementValue[0]?.value || "",
        // 這裡加上 ?. 防止 undefined[0] 錯誤
        rain: elements['PoP12h']?.[index]?.elementValue[0]?.value || "0", 
        temp: timeItem.elementValue[0].value,
        humid: elements['RH']?.[index]?.elementValue[0]?.value || "--",
        windSpeed: elements['WS']?.[index]?.elementValue[0]?.value || "--",
        windScale: elements['WS']?.[index]?.elementValue[1]?.value || "--",
      };
    });

    console.log(`[Debug] 資料解析成功，共 ${forecasts.length} 筆`);

    res.json({
      success: true,
      data: {
        city: cityName,
        district: districtName,
        forecasts: forecasts,
      },
    });

  } catch (error) {
    console.error("[Critical Error] 伺服器內部錯誤:", error);
    if (error.response) {
        console.error("[API Response Error]", error.response.data);
    }
    res.status(500).json({
      error: "伺服器錯誤 (Debug Mode)",
      message: error.message,
      stack: error.stack
    });
  }
};

module.exports = { getCityWeather };