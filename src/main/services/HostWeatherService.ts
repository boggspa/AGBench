import { spawn, type ChildProcess } from 'child_process'
import os from 'os'

type HostWeatherKind =
  | 'clear'
  | 'partly_cloudy'
  | 'cloudy'
  | 'overcast'
  | 'rain'
  | 'heavy_rain'
  | 'snow'
  | 'mist'
  | 'fog'
  | 'storm'
  | 'unknown'

export interface HostWeatherState {
  kind: HostWeatherKind
  description: string
  temperatureC?: number
  location?: string
  isDay: boolean
  updatedAt: string
  source: 'wttr' | 'fallback'
  error?: string
}

const HOST_WEATHER_CACHE_MS = 30 * 60 * 1000
const HOST_WEATHER_TIMEOUT_MS = 5_000
let hostWeatherCache: HostWeatherState | null = null
let hostWeatherCacheAt = 0

function localDaylightState(): boolean {
  const hour = new Date().getHours()
  return hour >= 7 && hour < 19
}

function parseLocalAstronomyTime(value?: string): Date | null {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) return null

  const match = raw.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i)
  if (!match) return null

  let hour = Number(match[1])
  const minute = Number(match[2])
  const meridiem = match[3]?.toUpperCase()

  if (!Number.isFinite(hour) || !Number.isFinite(minute) || minute < 0 || minute > 59) {
    return null
  }

  if (meridiem === 'PM' && hour < 12) hour += 12
  if (meridiem === 'AM' && hour === 12) hour = 0
  if (hour < 0 || hour > 23) return null

  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0, 0)
}

function resolveAstronomyDaylight(sunrise?: string, sunset?: string): boolean | null {
  const sunriseAt = parseLocalAstronomyTime(sunrise)
  const sunsetAt = parseLocalAstronomyTime(sunset)
  if (!sunriseAt || !sunsetAt) return null

  const now = new Date()
  const effectiveSunset =
    sunsetAt <= sunriseAt ? new Date(sunsetAt.getTime() + 24 * 60 * 60 * 1000) : sunsetAt

  return now >= sunriseAt && now < effectiveSunset
}

function createFallbackHostWeather(error?: string): HostWeatherState {
  const fallback: HostWeatherState = {
    kind: 'unknown',
    description: localDaylightState() ? 'Local daytime sky' : 'Local night sky',
    isDay: localDaylightState(),
    updatedAt: new Date().toISOString(),
    source: 'fallback'
  }
  if (error) {
    fallback.error = error
  }
  return fallback
}

function classifyHostWeather(weatherCode: number | null, description: string): HostWeatherKind {
  const normalizedDescription = description.toLowerCase()

  if (
    [200, 386, 389, 392, 395].includes(weatherCode ?? -1) ||
    /thunder|storm/.test(normalizedDescription)
  ) {
    return 'storm'
  }

  if (
    [
      179, 227, 230, 317, 320, 323, 326, 329, 332, 335, 338, 350, 362, 365, 368, 371, 374, 377, 392,
      395
    ].includes(weatherCode ?? -1) ||
    /snow|sleet|blizzard|ice|freezing/.test(normalizedDescription)
  ) {
    return 'snow'
  }

  if (
    [302, 305, 308, 356, 359].includes(weatherCode ?? -1) ||
    /heavy|torrential|downpour/.test(normalizedDescription)
  ) {
    return 'heavy_rain'
  }

  if (
    [
      176, 182, 185, 263, 266, 281, 284, 293, 296, 299, 302, 305, 308, 311, 314, 353, 356, 359, 386,
      389
    ].includes(weatherCode ?? -1) ||
    /rain|drizzle|shower/.test(normalizedDescription)
  ) {
    return 'rain'
  }

  if ([248, 260].includes(weatherCode ?? -1) || /fog/.test(normalizedDescription)) {
    return 'fog'
  }

  if (weatherCode === 143 || /mist|haze/.test(normalizedDescription)) {
    return 'mist'
  }

  if (weatherCode === 116 || /partly|patchy/.test(normalizedDescription)) {
    return 'partly_cloudy'
  }

  if (weatherCode === 122 || /overcast/.test(normalizedDescription)) {
    return 'overcast'
  }

  if (weatherCode === 119 || /cloud/.test(normalizedDescription)) {
    return 'cloudy'
  }

  if (weatherCode === 113 || /sunny|clear/.test(normalizedDescription)) {
    return 'clear'
  }

  return 'unknown'
}

function runHostWeatherCommand(): Promise<{ stdout: string; error?: string }> {
  return new Promise((resolve) => {
    const command = os.platform() === 'darwin' ? '/usr/bin/curl' : 'curl'
    const args = ['-fsSL', '--max-time', '5', 'https://wttr.in/?format=j1']
    let stdout = ''
    let stderr = ''
    let finished = false
    let timedOut = false
    const finish = (error?: string): void => {
      if (finished) return
      finished = true
      clearTimeout(timeout)
      resolve({ stdout, error })
    }

    let proc: ChildProcess
    try {
      proc = spawn(command, args, { shell: false })
    } catch (error) {
      resolve({ stdout, error: error instanceof Error ? error.message : String(error) })
      return
    }

    const timeout = setTimeout(() => {
      timedOut = true
      proc.kill('SIGTERM')
      finish('weather command timed out')
    }, HOST_WEATHER_TIMEOUT_MS)

    proc.stdout?.on('data', (chunk: Buffer) => {
      if (stdout.length < 1_000_000) {
        stdout += chunk.toString('utf8')
      }
    })

    proc.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < 20_000) {
        stderr += chunk.toString('utf8')
      }
    })

    proc.on('error', (error) => finish(error.message))
    proc.on('close', (code) => {
      if (timedOut) return
      finish(code === 0 ? undefined : stderr.trim() || `weather command exited with ${code}`)
    })
  })
}

async function readHostWeather(): Promise<HostWeatherState> {
  const result = await runHostWeatherCommand()
  if (result.error) {
    return createFallbackHostWeather(result.error)
  }

  try {
    const parsed = JSON.parse(result.stdout)
    const current = Array.isArray(parsed?.current_condition) ? parsed.current_condition[0] : null
    const nearestArea = Array.isArray(parsed?.nearest_area) ? parsed.nearest_area[0] : null
    const todayWeather = Array.isArray(parsed?.weather) ? parsed.weather[0] : null
    const astronomy = Array.isArray(todayWeather?.astronomy) ? todayWeather.astronomy[0] : null
    const description = current?.weatherDesc?.[0]?.value || 'Local sky'
    const weatherCode = Number.isFinite(Number(current?.weatherCode))
      ? Number(current.weatherCode)
      : null
    const temperatureC = Number.isFinite(Number(current?.temp_C))
      ? Number(current.temp_C)
      : undefined
    const areaName = nearestArea?.areaName?.[0]?.value
    const region = nearestArea?.region?.[0]?.value
    const country = nearestArea?.country?.[0]?.value
    const location = [areaName, region, country].filter(Boolean).join(', ') || undefined
    const isDay =
      resolveAstronomyDaylight(astronomy?.sunrise, astronomy?.sunset) ?? localDaylightState()

    return {
      kind: classifyHostWeather(weatherCode, description),
      description,
      isDay,
      updatedAt: new Date().toISOString(),
      source: 'wttr',
      ...(temperatureC !== undefined ? { temperatureC } : {}),
      ...(location ? { location } : {})
    }
  } catch (error) {
    return createFallbackHostWeather(error instanceof Error ? error.message : String(error))
  }
}

export async function getCachedHostWeather(): Promise<HostWeatherState> {
  const now = Date.now()
  if (hostWeatherCache && now - hostWeatherCacheAt < HOST_WEATHER_CACHE_MS) {
    return hostWeatherCache
  }

  hostWeatherCache = await readHostWeather()
  hostWeatherCacheAt = now
  return hostWeatherCache
}
