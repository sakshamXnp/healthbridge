// src/services/fqhc.ts
// FQHC (Federally Qualified Health Center) finder
import { FQHCProvider } from '../types/index.js';
import fqhcData from '../data/fqhc_data.json';
import { RIGHTS_TEXT } from '../data/rights_text.js';
import { Language } from '../types/index.js';

export async function findNearestFQHCs(zip: string, limit = 3): Promise<FQHCProvider[]> {
  // Geocode ZIP via zippopotam.us (free, no API key)
  const geo = await fetch(
    `https://api.zippopotam.us/us/${zip}`,
    { signal: AbortSignal.timeout(5000) }
  );
  if (!geo.ok) throw new Error('Invalid ZIP code');

  const geoData = await geo.json();
  const userLat = parseFloat(geoData.places[0].latitude);
  const userLng = parseFloat(geoData.places[0].longitude);

  return (fqhcData as FQHCProvider[])
    .map(p => ({ ...p, distanceMiles: haversine(userLat, userLng, p.lat, p.lng) }))
    .sort((a, b) => a.distanceMiles! - b.distanceMiles!)
    .slice(0, limit);
}

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8; // Earth radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
    * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function formatProviderResults(providers: FQHCProvider[], language: Language): string {
  let msg = `🏥 *Safe Community Health Centers Near You*\n\n`;
  msg += `_These centers serve EVERYONE — no immigration questions asked_\n\n`;

  providers.forEach((p, i) => {
    msg += `*${i + 1}. ${p.name}* — ${p.distanceMiles!.toFixed(1)} miles\n`;
    msg += `📍 ${p.address}, ${p.city}, ${p.state} ${p.zip}\n`;
    msg += `📞 ${p.phone}\n`;
    msg += `💰 Sliding fee: $0–$50 based on income\n`;
    msg += `🗺️ https://maps.google.com/?q=${p.lat},${p.lng}\n\n`;
  });

  msg += `---\n`;
  msg += RIGHTS_TEXT[language] || RIGHTS_TEXT.en;

  return msg;
}
