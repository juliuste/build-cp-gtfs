'use strict'

const cp = require('comboios')
const Queue = require('p-queue')
const { DateTime } = require('luxon')
const uniq = require('lodash/uniq')
const uniqBy = require('lodash/uniqBy')
const flatten = require('lodash/flatten')
const flatMap = require('lodash/flatMap')
const map = require('through2-map').obj
const toStream = require('into-stream').object

const stream = () => map((x) => x)

const generateDateTimes = (startDateTime, endDateTime) => {
	const dateTimes = []
	let currentDate = startDateTime
	while (currentDate <= endDateTime) {
		dateTimes.push(new DateTime(currentDate))
		currentDate = currentDate.plus({ day: 1 })
	}
	return dateTimes
}

const stopoverRequest = (station, dateTime) => {
	console.info('departures', station.id, station.name, dateTime.toFormat('yyyyMMdd'))
	return cp.stopovers(station, { when: dateTime.toJSDate() }).catch(error => {
		console.error(error)
		return []
	})
}
const fetchTripIds = async (dateTimes, stations) => {
	const queue = new Queue({ concurrency: 16 })
	const results = await queue.addAll(flatMap(dateTimes, dateTime => stations.map(station => {
		return async () => {
			const stopovers = await stopoverRequest(station, dateTime)
			return stopovers.map(stopover => [stopover.tripId, stopover.line])
		}
	})))
	const flatResults = flatten(results)
	const tripIds = uniq(flatResults.map(([tripId, line]) => tripId))
	const lines = uniqBy(flatResults.map(([tripId, line]) => line), 'id')
	return { tripIds, lines }
}

// @todo format dates properly (e.g. 24:03:00 instead of 00:03:00)
const formatTime = (date, referenceDateTime) => {
	const dayEndDateTime = referenceDateTime.endOf('day')
	const dateTime = DateTime.fromISO(date, { zone: 'Europe/Lisbon' })
	// same day as reference date
	if (dateTime <= dayEndDateTime) return dateTime.toFormat('HH:mm:ss')
	// day(s) after reference date
	const { days } = dateTime.diff(referenceDateTime.startOf('day'), ['days']).toObject()
	const minutesAndSeconds = dateTime.toFormat('mm:ss')
	const hours = dateTime.get('hour') + (24 * Math.floor(days))
	return `${hours}:${minutesAndSeconds}`
}
const tripToGtfs = trip => {
	const gtfsTrip = [trip.line.id, trip.id, trip.id, '', '', '', '', '', '', ''] // @todo
	const referenceDateTime = DateTime.fromISO(trip.stopovers[0].departure, { zone: 'Europe/Lisbon' })
	const calendarDate = [trip.id, referenceDateTime.toFormat('yyyyMMdd'), 1]
	const stopTimes = trip.stopovers.map((stopover, index) => [
		trip.id,
		formatTime(stopover.arrival, referenceDateTime),
		formatTime(stopover.departure, referenceDateTime),
		stopover.stop.id,
		index,
		'', '', '', '', '' // @todo
	])
	return { trip: gtfsTrip, calendarDate, stopTimes }
}
const fetchTrips = async (tripIds, gtfs) => {
	const queue = new Queue({ concurrency: 16 })
	await queue.addAll(tripIds.map((tripId, index) => async () => {
		console.info(`trip ${index + 1} of ${tripIds.length}`)
		const _trip = await (cp.trip(tripId).catch(error => {
			console.error(error)
			return null
		}))
		if (!_trip) return
		const { stopTimes, trip, calendarDate } = tripToGtfs(_trip)
		gtfs.trips.write(trip)
		stopTimes.forEach(stopTime => gtfs.stop_times.write(stopTime))
		gtfs.calendar_dates.write(calendarDate)
	}))
}

const build = async (startDate, endDate) => {
	const timezone = 'Europe/Lisbon'
	const startDateTime = DateTime.fromJSDate(startDate, { zone: timezone })
	const endDateTime = DateTime.fromJSDate(endDate, { zone: timezone })
	const dateTimes = generateDateTimes(startDateTime, endDateTime)

	const feedStart = startDateTime.toFormat('yyyyMMdd')
	const feedEnd = endDateTime.toFormat('yyyyMMdd')

	const stations = await cp.stations()
	const { tripIds, lines } = await fetchTripIds(dateTimes, stations)

	const gtfs = {
		agency: toStream([
			['agency_id', 'agency_name', 'agency_url', 'agency_timezone', 'agency_lang', 'agency_phone', 'agency_fare_url', 'agency_email'],
			['cp', 'Comboios de Portugal', 'https://www.cp.pt/', 'Europe/Lisbon', 'pt', '+351707210220', 'https://www.cp.pt/passageiros/pt/comprar-bilhetes', '']
		]),
		stops: toStream([
			['stop_id', 'stop_code', 'stop_name', 'stop_desc', 'stop_lat', 'stop_lon', 'zone_id', 'stop_url', 'location_type', 'parent_station', 'stop_timezone', 'wheelchair_boarding'],
			...stations.map((s) => [s.id, '', s.name, '', s.location.latitude, s.location.longitude, '', '', 0, '', s.timezone, ''])
		]),
		routes: toStream([
			['route_id', 'agency_id', 'route_short_name', 'route_long_name', 'route_desc', 'route_type', 'route_url', 'route_color', 'route_text_color', 'route_sort_order'],
			...lines.map(l => [l.id, 'cp', l.name, '', '', 2, '', '', '', '']) // @todo: type
		]),
		trips: stream(),
		stop_times: stream(),
		// calendar: stream(),
		calendar_dates: stream(),
		feed_info: toStream([
			['feed_publisher_name', 'feed_publisher_url', 'feed_lang', 'feed_start_date', 'feed_end_date', 'feed_version', 'feed_contact_email', 'feed_contact_url'],
			['gtfs.directory', 'https://gtfs.directory', 'pt', feedStart, feedEnd, '', '', 'https://gitter.im/public-transport/Lobby']
		])
	}
	gtfs.trips.push(['route_id', 'service_id', 'trip_id', 'trip_headsign', 'trip_short_name', 'direction_id', 'block_id', 'shape_id', 'wheelchair_accessible', 'bikes_allowed'])
	gtfs.stop_times.push(['trip_id', 'arrival_time', 'departure_time', 'stop_id', 'stop_sequence', 'stop_headsign', 'pickup_type', 'drop_off_type', 'shape_dist_traveled', 'timepoint'])
	gtfs.calendar_dates.push(['service_id', 'date', 'exception_type'])

	await fetchTrips(tripIds, gtfs)
	gtfs.trips.end()
	gtfs.stop_times.end()
	gtfs.calendar_dates.end()

	return gtfs
}

module.exports = build
