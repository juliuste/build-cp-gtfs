'use strict'

const cp = require('comboios')
const Queue = require('p-queue')
const momentTz = require('moment-timezone')
const uniq = require('lodash/uniq')
const uniqBy = require('lodash/uniqBy')
const flatten = require('lodash/flatten')
const flatMap = require('lodash/flatMap')
const map = require('through2-map').obj
const toStream = require('into-stream').object

const stream = () => map((x) => x)

const generateDates = (start, end, tz) => {
	const dates = []
	const startDate = momentTz.tz(start, tz).startOf('day')
	const endDate = momentTz.tz(end, tz).startOf('day')
	const currentDate = momentTz.tz(startDate, tz)
	// eslint-disable-next-line no-unmodified-loop-condition
	while (+currentDate <= +endDate) {
		dates.push(currentDate.toDate())
		currentDate.add(1, 'days')
	}
	return dates
}

const stopoverRequest = (station, date) => {
	console.error('departures', station.id, station.name, momentTz.tz(date, 'Europe/Lisbon').format('YYYY-MM-DD'))
	return cp.stopovers(station, { when: date }).catch(error => {
		console.error(error)
		return []
	})
}
const fetchTripIds = async (dates, stations) => {
	const queue = new Queue({ concurrency: 16 })
	const results = await queue.addAll(flatMap(dates, date => stations.map(station => {
		return async () => {
			const stopovers = await stopoverRequest(station, date)
			return stopovers.map(stopover => [stopover.tripId, stopover.line])
		}
	})))
	const flatResults = flatten(results)
	const tripIds = uniq(flatResults.map(([tripId, line]) => tripId))
	const lines = uniqBy(flatResults.map(([tripId, line]) => line), 'id')
	return { tripIds, lines }
}

// @todo format dates properly (e.g. 24:03:00 instead of 00:03:00)
const formatTime = (d, refD) => {
	const date = momentTz.tz(d, 'Europe/Lisbon')
	return date.format('HH:mm:ss')
}
const tripToGtfs = trip => {
	const gtfsTrip = [trip.line.id, trip.id, trip.id, '', '', '', '', '', '', ''] // @todo
	const calendarDate = [trip.id, momentTz.tz(trip.stopovers[0].departure, 'Europe/Lisbon').format('YYYYMMDD'), 1]
	const stopTimes = trip.stopovers.map((stopover, index) => [
		trip.id,
		formatTime(stopover.arrival, stopover.arrival),
		formatTime(stopover.departure, stopover.arrival),
		stopover.stop.id,
		index,
		'', '', '', '', '' // @todo
	])
	return { trip: gtfsTrip, calendarDate, stopTimes }
}
const fetchTrips = async (tripIds, gtfs) => {
	const queue = new Queue({ concurrency: 16 })
	await queue.addAll(tripIds.map((tripId, index) => async () => {
		console.error(`trip ${index + 1} of ${tripIds.length}`)
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
	const feedStart = momentTz.tz(startDate, timezone).format('YYYYMMDD')
	const feedEnd = momentTz.tz(endDate, timezone).format('YYYYMMDD')
	const dates = generateDates(startDate, endDate, timezone)

	const stations = await cp.stations()
	const { tripIds, lines } = await fetchTripIds(dates, stations)

	const gtfs = {
		agency: toStream([
			['agency_id', 'agency_name', 'agency_url', 'agency_timezone', 'agency_lang', 'agency_phone', 'agency_fare_url', 'agency_email'],
			['cp', 'Comboios de Portugal', 'https://www.cp.pt/', 'Europe/Lisbon', 'pt', '+351707210220', 'https://www.cp.pt/passageiros/pt/comprar-bilhetes', '']
		]),
		stops: toStream([
			['stop_id', 'stop_code', 'stop_name', 'stop_desc', 'stop_lat', 'stop_lon', 'zone_id', 'stop_url', 'location_type', 'parent_station', 'stop_timezone', 'wheelchair_boarding'],
			...stations.map((s) => [s.id, '', s.name, '', s.location.latitude, s.location.longitude, '', '', 0, '', '', ''])
		]),
		routes: toStream([
			['route_id', 'agency_id', 'route_short_name', 'route_long_name', 'route_desc', 'route_type', 'route_url', 'route_color', 'route_text_color'],
			...lines.map(l => [l.id, 'cp', l.name, '', '', 2, '', '', '']) // @todo: type
		]),
		trips: stream(),
		stop_times: stream(),
		// calendar: stream(),
		calendar_dates: stream(),
		feed_info: toStream([
			['feed_publisher_name', 'feed_publisher_url', 'feed_lang', 'feed_start_date', 'feed_end_date', 'feed_version'],
			['gtfs.directory', 'https://gtfs.directory', 'pt', feedStart, feedEnd, '']
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
