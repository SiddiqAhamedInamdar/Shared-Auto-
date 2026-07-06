const { db } = require('../config/database');
const { calculateDistance, calculateBearing } = require('../utils/helpers');

const PICKUP_RADIUS_KM = 1.5;    // Max distance between pickups
const DROP_RADIUS_KM = 2.0;      // Max distance between drops
const BEARING_TOLERANCE = 45;     // Degrees tolerance for direction matching
const GROUP_TIMEOUT_MS = 15 * 1000; // 15 seconds (reduced for development testing)
const MAX_PASSENGERS = 3;

/**
 * Try to find an existing shared ride group that matches the new ride request.
 * If found, add the passenger to the group.
 * If not, create a new group.
 */
function findOrCreateSharedGroup(ride) {
  // Look for forming groups with matching criteria
  const formingGroups = db.prepare(`
    SELECT srg.*, 
      (SELECT COUNT(*) FROM rides WHERE shared_group_id = srg.id AND status != 'cancelled') as passenger_count
    FROM shared_ride_groups srg
    WHERE srg.status = 'forming'
      AND srg.current_passengers < srg.max_passengers
      AND (srg.gender_pref = ? OR srg.gender_pref = 'no_preference' OR ? = 'no_preference')
      AND datetime(srg.expires_at) > datetime('now')
    ORDER BY srg.created_at ASC
  `).all(ride.gender_pref, ride.gender_pref);

  for (const group of formingGroups) {
    // Check pickup proximity
    const pickupDist = calculateDistance(
      ride.pickup_lat, ride.pickup_lng,
      group.center_pickup_lat, group.center_pickup_lng
    );

    if (pickupDist > PICKUP_RADIUS_KM) continue;

    // Check drop proximity
    const dropDist = calculateDistance(
      ride.drop_lat, ride.drop_lng,
      group.center_drop_lat, group.center_drop_lng
    );

    if (dropDist > DROP_RADIUS_KM) continue;

    // Check travel direction
    const rideBearing = calculateBearing(
      ride.pickup_lat, ride.pickup_lng,
      ride.drop_lat, ride.drop_lng
    );

    if (group.route_direction !== null) {
      const bearingDiff = Math.abs(rideBearing - group.route_direction);
      const normalizedDiff = bearingDiff > 180 ? 360 - bearingDiff : bearingDiff;
      if (normalizedDiff > BEARING_TOLERANCE) continue;
    }

    // Match found! Add to this group
    const newCount = group.current_passengers + 1;

    // Update group center to average of all pickups/drops
    const newCenterPickupLat = (group.center_pickup_lat * group.current_passengers + ride.pickup_lat) / newCount;
    const newCenterPickupLng = (group.center_pickup_lng * group.current_passengers + ride.pickup_lng) / newCount;
    const newCenterDropLat = (group.center_drop_lat * group.current_passengers + ride.drop_lat) / newCount;
    const newCenterDropLng = (group.center_drop_lng * group.current_passengers + ride.drop_lng) / newCount;

    db.prepare(`
      UPDATE shared_ride_groups 
      SET current_passengers = ?,
          center_pickup_lat = ?,
          center_pickup_lng = ?,
          center_drop_lat = ?,
          center_drop_lng = ?,
          status = CASE WHEN ? >= max_passengers THEN 'matched' ELSE status END
      WHERE id = ?
    `).run(newCount, newCenterPickupLat, newCenterPickupLng, newCenterDropLat, newCenterDropLng, newCount, group.id);

    return { groupId: group.id, isNew: false, isFull: newCount >= group.max_passengers };
  }

  // No matching group found — create a new one
  const rideBearing = calculateBearing(
    ride.pickup_lat, ride.pickup_lng,
    ride.drop_lat, ride.drop_lng
  );

  const expiresAt = new Date(Date.now() + GROUP_TIMEOUT_MS).toISOString();

  const result = db.prepare(`
    INSERT INTO shared_ride_groups (
      status, max_passengers, current_passengers,
      route_direction, center_pickup_lat, center_pickup_lng,
      center_drop_lat, center_drop_lng, gender_pref, expires_at
    ) VALUES ('forming', ?, 1, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    MAX_PASSENGERS, rideBearing,
    ride.pickup_lat, ride.pickup_lng,
    ride.drop_lat, ride.drop_lng,
    ride.gender_pref, expiresAt
  );

  return { groupId: result.lastInsertRowid, isNew: true, isFull: false };
}

/**
 * Find the best available driver for a ride or group.
 */
function findNearestDriver(pickupLat, pickupLng, genderPref = 'no_preference') {
  let query = `
    SELECT d.*, u.full_name, u.gender, u.phone
    FROM drivers d
    JOIN users u ON d.user_id = u.id
    WHERE d.is_online = 1
      AND d.status = 'approved'
      AND u.status = 'active'
      AND d.current_lat IS NOT NULL
      AND d.current_lng IS NOT NULL
  `;

  // If gender preference is set, try to match driver gender
  // (for female_only, prefer female drivers but don't strictly require it)
  
  const drivers = db.prepare(query).all();

  if (drivers.length === 0) return null;

  // Sort by distance to pickup
  const driversWithDistance = drivers.map(d => ({
    ...d,
    distance: calculateDistance(pickupLat, pickupLng, d.current_lat, d.current_lng)
  }));

  driversWithDistance.sort((a, b) => a.distance - b.distance);

  // Check if driver is not already on an active ride
  for (const driver of driversWithDistance) {
    const activeRide = db.prepare(`
      SELECT id FROM rides 
      WHERE driver_id = ? 
      AND status IN ('accepted', 'driver_arriving', 'started')
    `).get(driver.id);

    if (!activeRide && driver.distance <= 50) { // Within 50km (increased from 10km for dev testing)
      return driver;
    }
  }

  return null;
}

/**
 * Process expired shared ride groups — dispatch them even if not full
 */
function processExpiredGroups() {
  const expiredGroups = db.prepare(`
    SELECT * FROM shared_ride_groups 
    WHERE status = 'forming' 
    AND datetime(expires_at) <= datetime('now')
    AND current_passengers > 0
  `).all();

  for (const group of expiredGroups) {
    // Mark as matched (even with fewer passengers)
    db.prepare(`
      UPDATE shared_ride_groups SET status = 'matched' WHERE id = ?
    `).run(group.id);

    // Try to find a driver
    const driver = findNearestDriver(group.center_pickup_lat, group.center_pickup_lng, group.gender_pref);
    
    if (driver) {
      db.prepare(`
        UPDATE shared_ride_groups SET driver_id = ? WHERE id = ?
      `).run(driver.id, group.id);

      // Update all rides in this group
      db.prepare(`
        UPDATE rides SET status = 'matched', driver_id = ? 
        WHERE shared_group_id = ? AND status IN ('requested', 'matching')
      `).run(driver.id, group.id);

      // Notify matched driver and all passengers in the group
      try {
        const { sendToUser } = require('./websocket');
        const groupRides = db.prepare(`
          SELECT id, passenger_id, pickup_address, drop_address, fare_estimate 
          FROM rides 
          WHERE shared_group_id = ? AND status = 'matched'
        `).all(group.id);

        if (groupRides.length > 0) {
          // Notify driver with details of the first passenger's request as representative
          sendToUser(driver.user_id, {
            type: 'new_ride_request',
            rideId: groupRides[0].id,
            rideType: 'shared',
            pickup: groupRides[0].pickup_address,
            drop: groupRides[0].drop_address,
            fare: groupRides[0].fare_estimate
          });

          // Notify all passengers that a driver was found
          for (const gr of groupRides) {
            sendToUser(gr.passenger_id, {
              type: 'ride_status',
              rideId: gr.id,
              status: 'matched',
              message: 'Driver found and matched!'
            });
          }
        }
      } catch (wsErr) {
        console.error('Failed to send WebSocket notifications in processExpiredGroups:', wsErr);
      }
    }
  }

  return expiredGroups.length;
}

module.exports = {
  findOrCreateSharedGroup,
  findNearestDriver,
  processExpiredGroups
};
