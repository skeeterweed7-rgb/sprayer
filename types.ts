import { Timestamp } from 'firebase/firestore';

export interface Chemical {
  name: string;
  totalOz: number;
  ozPerGal: string | number;
}

export interface WeatherConditions {
  weather: string;
  temperature: number;
  windDirection: string;
  windSpeed: number;
}

export interface LogEntry {
  id: string;
  roadName: string;
  gallonsUsed: number;
  gallonsLeft: number;
  initialTankVolume: number;
  chemicalMix: Chemical[];
  weatherConditions: WeatherConditions;
  timestamp: Timestamp | null;
}

// Global variable declarations for the specific runtime environment
declare global {
  var __firebase_config: string | undefined;
  var __app_id: string | undefined;
  var __initial_auth_token: string | undefined;
}
