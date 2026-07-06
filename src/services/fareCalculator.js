// Fare calculation service for ShareAuto

const BASE_FARE = {
  private: 30,   // Base fare for private auto in ₹
  shared: 15     // Base fare for shared auto in ₹
};

const PER_KM_RATE = {
  private: 14,   // ₹ per km for private
  shared: 8      // ₹ per km for shared
};

const PER_MIN_RATE = {
  private: 1.5,  // ₹ per minute for private
  shared: 1.0    // ₹ per minute for shared
};

const MIN_FARE = {
  private: 40,
  shared: 25
};

const SURGE_MULTIPLIERS = {
  low: 1.0,
  moderate: 1.2,
  high: 1.5,
  extreme: 2.0
};

// Estimate average speed based on distance (city traffic)
function estimateDuration(distanceKm) {
  // Average speed: 18 km/h in city
  const avgSpeedKmH = 18;
  return (distanceKm / avgSpeedKmH) * 60; // minutes
}

function getSurgeLevel() {
  const hour = new Date().getHours();
  // Peak hours: 8-10 AM, 5-8 PM
  if ((hour >= 8 && hour <= 10) || (hour >= 17 && hour <= 20)) {
    return 'moderate';
  }
  // Late night
  if (hour >= 22 || hour <= 5) {
    return 'high';
  }
  return 'low';
}

function calculateFare(distanceKm, rideType = 'private', passengersInShared = 1) {
  const type = rideType === 'shared' ? 'shared' : 'private';
  const durationMin = estimateDuration(distanceKm);
  const surgeLevel = getSurgeLevel();
  const surgeMultiplier = SURGE_MULTIPLIERS[surgeLevel];

  let fare = BASE_FARE[type] + 
    (distanceKm * PER_KM_RATE[type]) + 
    (durationMin * PER_MIN_RATE[type]);

  // Apply surge pricing
  fare *= surgeMultiplier;

  // For shared rides, further discount based on passengers
  if (type === 'shared' && passengersInShared > 1) {
    fare *= (1 - (passengersInShared - 1) * 0.1); // 10% off per additional passenger
  }

  // Enforce minimum fare
  fare = Math.max(fare, MIN_FARE[type]);

  return {
    baseFare: BASE_FARE[type],
    distanceCharge: parseFloat((distanceKm * PER_KM_RATE[type]).toFixed(2)),
    timeCharge: parseFloat((durationMin * PER_MIN_RATE[type]).toFixed(2)),
    surgeLevel,
    surgeMultiplier,
    subtotal: parseFloat(fare.toFixed(2)),
    total: parseFloat(Math.ceil(fare).toFixed(2)),
    estimatedDuration: Math.ceil(durationMin),
    distanceKm: parseFloat(distanceKm.toFixed(2)),
    rideType: type
  };
}

module.exports = { calculateFare, estimateDuration, getSurgeLevel };
