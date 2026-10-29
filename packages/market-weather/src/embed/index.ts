/** The embed entry: importing it defines `<market-weather-city>`. The one-file build (`dist/market-weather-city.js`) is this. */

import { defineMarketWeatherCity } from "./city.ts";

defineMarketWeatherCity();

export { defineMarketWeatherCity };
export { acceptWeather, layoutCity } from "./layout.ts";
