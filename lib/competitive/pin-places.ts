// Map Pin Drop — curated place coordinates.
//
// Each entry is a prompt ("Drop a pin on X") plus the true latitude/longitude.
// The player pans/zooms an OpenStreetMap (Leaflet) world map and taps to place a
// pin; the haversine distance from their pin to the true coordinate determines
// the score (closer = more points). Both players answer the same prompt.
//
// Two content sources per the locked spec:
//   1. This curated landmark set (~40 famous, unambiguous points).
//   2. REST Countries API (free, no key) for country centroids — fetched
//      server-side and merged in at round-generation time. See
//      lib/competitive/rest-countries.ts.

export interface PinPlace {
  id: string;
  prompt: string;
  lat: number;
  lng: number;
  kind: "landmark" | "city";
}

export const PIN_PLACES: PinPlace[] = [
  { id: "eiffel", prompt: "the Eiffel Tower", lat: 48.8584, lng: 2.2945, kind: "landmark" },
  { id: "statue-liberty", prompt: "the Statue of Liberty", lat: 40.6892, lng: -74.0445, kind: "landmark" },
  { id: "colosseum", prompt: "the Colosseum", lat: 41.8902, lng: 12.4922, kind: "landmark" },
  { id: "taj-mahal", prompt: "the Taj Mahal", lat: 27.1751, lng: 78.0421, kind: "landmark" },
  { id: "great-pyramid", prompt: "the Great Pyramid of Giza", lat: 29.9792, lng: 31.1342, kind: "landmark" },
  { id: "sydney-opera", prompt: "the Sydney Opera House", lat: -33.8568, lng: 151.2153, kind: "landmark" },
  { id: "christ-redeemer", prompt: "Christ the Redeemer", lat: -22.9519, lng: -43.2105, kind: "landmark" },
  { id: "machu-picchu", prompt: "Machu Picchu", lat: -13.1631, lng: -72.5450, kind: "landmark" },
  { id: "big-ben", prompt: "Big Ben", lat: 51.5007, lng: -0.1246, kind: "landmark" },
  { id: "petra", prompt: "Petra", lat: 30.3285, lng: 35.4444, kind: "landmark" },
  { id: "great-wall", prompt: "the Great Wall of China (Badaling)", lat: 40.3587, lng: 116.0079, kind: "landmark" },
  { id: "mount-everest", prompt: "Mount Everest", lat: 27.9881, lng: 86.9250, kind: "landmark" },
  { id: "grand-canyon", prompt: "the Grand Canyon", lat: 36.1069, lng: -112.1129, kind: "landmark" },
  { id: "niagara", prompt: "Niagara Falls", lat: 43.0962, lng: -79.0377, kind: "landmark" },
  { id: "stonehenge", prompt: "Stonehenge", lat: 51.1789, lng: -1.8262, kind: "landmark" },
  { id: "leaning-pisa", prompt: "the Leaning Tower of Pisa", lat: 43.7230, lng: 10.3966, kind: "landmark" },
  { id: "golden-gate", prompt: "the Golden Gate Bridge", lat: 37.8199, lng: -122.4783, kind: "landmark" },
  { id: "burj-khalifa", prompt: "the Burj Khalifa", lat: 25.1972, lng: 55.2744, kind: "landmark" },
  { id: "mount-fuji", prompt: "Mount Fuji", lat: 35.3606, lng: 138.7274, kind: "landmark" },
  { id: "uluru", prompt: "Uluru (Ayers Rock)", lat: -25.3444, lng: 131.0369, kind: "landmark" },

  { id: "tokyo", prompt: "Tokyo", lat: 35.6762, lng: 139.6503, kind: "city" },
  { id: "newyork", prompt: "New York City", lat: 40.7128, lng: -74.0060, kind: "city" },
  { id: "london", prompt: "London", lat: 51.5074, lng: -0.1278, kind: "city" },
  { id: "paris", prompt: "Paris", lat: 48.8566, lng: 2.3522, kind: "city" },
  { id: "moscow", prompt: "Moscow", lat: 55.7558, lng: 37.6173, kind: "city" },
  { id: "cairo", prompt: "Cairo", lat: 30.0444, lng: 31.2357, kind: "city" },
  { id: "rio", prompt: "Rio de Janeiro", lat: -22.9068, lng: -43.1729, kind: "city" },
  { id: "sydney", prompt: "Sydney", lat: -33.8688, lng: 151.2093, kind: "city" },
  { id: "capetown", prompt: "Cape Town", lat: -33.9249, lng: 18.4241, kind: "city" },
  { id: "mexico-city", prompt: "Mexico City", lat: 19.4326, lng: -99.1332, kind: "city" },
  { id: "mumbai", prompt: "Mumbai", lat: 19.0760, lng: 72.8777, kind: "city" },
  { id: "beijing", prompt: "Beijing", lat: 39.9042, lng: 116.4074, kind: "city" },
  { id: "istanbul", prompt: "Istanbul", lat: 41.0082, lng: 28.9784, kind: "city" },
  { id: "buenos-aires", prompt: "Buenos Aires", lat: -34.6037, lng: -58.3816, kind: "city" },
  { id: "nairobi", prompt: "Nairobi", lat: -1.2921, lng: 36.8219, kind: "city" },
  { id: "reykjavik", prompt: "Reykjavik", lat: 64.1466, lng: -21.9426, kind: "city" },
  { id: "singapore", prompt: "Singapore", lat: 1.3521, lng: 103.8198, kind: "city" },
  { id: "toronto", prompt: "Toronto", lat: 43.6532, lng: -79.3832, kind: "city" },
  { id: "berlin", prompt: "Berlin", lat: 52.5200, lng: 13.4050, kind: "city" },
  { id: "honolulu", prompt: "Honolulu", lat: 21.3069, lng: -157.8583, kind: "city" },
];

/** Haversine great-circle distance in kilometers. */
export function haversineKm(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const R = 6371; // Earth radius km
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function pickPinPlaces(n: number): PinPlace[] {
  const shuffled = [...PIN_PLACES].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(n, shuffled.length));
}
