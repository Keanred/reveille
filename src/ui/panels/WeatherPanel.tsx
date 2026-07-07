import { Text } from 'ink';
import type { WeatherData } from '../../sources/weather.js';

const temp = (n: number | null): string => (n == null ? '—' : `${Math.round(n)}°`);

export function WeatherPanel({ data }: { data: WeatherData }) {
  const head = [temp(data.temp), data.description].filter(Boolean).join('  ');
  const extra = [
    data.feelsLike != null ? `feels ${temp(data.feelsLike)}` : null,
    data.precipKind != null ? `${data.precipKind} ${data.precipMm}mm/h` : null,
    data.humidity != null ? `humidity ${data.humidity}%` : null,
    data.windSpeed != null ? `wind ${Math.round(data.windSpeed)} m/s` : null,
  ].filter(Boolean);
  return <Text>{extra.length ? `${head}  ·  ${extra.join('  ')}` : head}</Text>;
}
