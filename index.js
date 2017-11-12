'use strict'

const cp = require('comboios')
const retry = require('p-retry')
const timeout = require('p-timeout')
const queue = require('queue')
const ndjson = require('ndjson')
const momentTz = require('moment-timezone')
const groupBy = require('lodash.groupby')
const fs = require('fs')
const union = require('lodash.union')
const map = require('through2-map').obj
const toStream = require('into-stream').obj

const stream = () => map((x) => x)

const degroup = (grouped) => {
    const trainNumbers = []
    for(let date in grouped){
        const d = momentTz.tz(+date, 'Europe/Lisbon')
        for(let tN of grouped[date]){
            const trainNumber = trainNumbers.find((x) => x.trainNumber === tN)
            if(!trainNumber) trainNumbers.push({trainNumber: tN, dates:[d]})
            else trainNumber.dates = union(trainNumber.dates, [d])
        }
    }
    return trainNumbers
}

const departureRequest = (station, date) => {
    console.info('departures', station.id, station.name, momentTz.tz(date, 'Europe/Lisbon').format('DD.MM.YYYY'))
    return retry(
        () => timeout(
            cp.departures(station, date)
            .then((res) => res ? res.map((x) => x.trainNumber) : []),
            10000
        ),
        {retries: 3}
    )
}

const fetchTrainNumbers = (dates, stations) => {
    const q = queue({concurrency: 16})

    return new Promise((resolve, reject) => {
        const trainNumbers = {}
        for(let date of dates){
            trainNumbers[date] = []
            for(let station of stations){
                /*.filter((x) => x.name.indexOf('Ab') === 0)*/
                q.push((cb) =>
                    departureRequest(station, date)
                    .then((fetchedNumbers) => {
                        trainNumbers[+date] = union(trainNumbers[+date], fetchedNumbers)
                        cb()
                    })
                    .catch(() => cb())
                )
            }
        }
        q.start()
        q.on('error', reject)
        q.on('end', () => resolve(trainNumbers))
    })
}

const generateDates = (start, end, tz) => {
    const dates = []
    const startDate = momentTz.tz(start, tz).startOf('day')
    const endDate = momentTz.tz(end, tz).startOf('day')
    let currentDate = momentTz.tz(startDate, tz)
    while(+currentDate <= +endDate){
        dates.push(currentDate.toDate())
        currentDate.add(1, 'days')
    }
    return dates
}

const fetchTrip = (trainNumber) => {
    const q = queue({concurrency: 16})
    return new Promise((resolve, reject) => {
        const timetables = []
        for(let date of trainNumber.dates){
            q.push((cb) =>
                cp.trains(trainNumber.trainNumber, momentTz.tz(date, 'Europe/Lisbon').toDate())
                .then((timetable) => {
                    timetables.push(timetable)
                    cb()
                })
                .catch(() => cb())
            )
        }
        q.start()
        q.on('error', reject)
        q.on('end', () => resolve(timetables))
    })
}

const normalizeDate = (d, refD) => {
    const date = momentTz.tz(+d, 'Europe/Lisbon')
    const refDate = momentTz.tz(+refD, 'Europe/Lisbon').startOf('day')
    return (+d-(+refD))
}

const hashStop = (s) => [s.id, s.name, normalizeDate(s.arrival, s.arrival), normalizeDate(s.departure, s.arrival)].join('_-_')
const hashTimetable = (t) => [t.trainNumber, JSON.stringify(t.service)].concat(t.stops.map(hashStop)).join('#@#')

const getTime = (d, refD) => {
    const date = momentTz.tz(+d, 'Europe/Lisbon')
    const refDate = momentTz.tz(+refD, 'Europe/Lisbon').startOf('day')
    // return (+d-(+refD))
    return date.format('HH:mm:ss')
}

const toGTFS = (dates) => (timetables) => {
    const byTrip = groupBy(timetables, (x) => hashTimetable(x))
    const result = {}
    result.trips = []
    result.stop_times = []
    result.calendar_dates = []

    // trips
    // stop_times
    // calendar_dates
    let i = 0
    for(let key in byTrip){
        const trip = byTrip[key][0]
        result.trips.push([trip.trainNumber, trip.trainNumber+'-'+i, trip.trainNumber+'-'+i, '', '', '', '', '', '', ''])
        let j = 0
        for(let stop of trip.stops){
            result.stop_times.push([trip.trainNumber+'-'+i, getTime(stop.arrival, stop.arrival), getTime(stop.departure, stop.arrival), j, '', '', '', '', ''])
            j++
        }
        for(let trip of byTrip[key]){
            result.calendar_dates.push([trip.trainNumber+'-'+i, momentTz.tz(trip.stops[0].departure, 'Europe/Lisbon').format('YYYYMMDD'), 1])
        }
        i++
    }

    return result
}

const fetchTrips = async (trainNumbers, gtfs, dates) => {
    let counter = 1
    for(let trainNumber of trainNumbers){
        console.info('trainNumber '+counter+'/'+trainNumbers.length)
        counter++
        const data = await fetchTrip(trainNumber).then(toGTFS(dates)).catch(console.error)
        for(let key in data){
            for(let row of data[key]) gtfs[key].write(row)
        }
    }
    return 1
}

const fetch = async (startDate, endDate, timezone='Europe/Lisbon') => {
    const dates = generateDates(startDate, endDate, timezone)
    const stations = await cp.stations()
    const trainNumbersGroupedByDate = await fetchTrainNumbers(dates, stations)
    const trainNumbers = degroup(trainNumbersGroupedByDate)

    const feedStart = momentTz.tz(startDate, timezone).format('YYYYMMDD')
    const feedEnd = momentTz.tz(endDate, timezone).format('YYYYMMDD')
    const gtfs = {
        agency: toStream([
            ['agency_id', 'agency_name', 'agency_url', 'agency_timezone', 'agency_lang', 'agency_phone', 'agency_fare_url', 'agency_email'],
            ['cp', 'Comboios de Portugal', 'https://www.cp.pt/', 'Europe/Lisbon', 'pt', '+351707210220', 'https://www.cp.pt/passageiros/pt/comprar-bilhetes', '']
        ]),
        stops: toStream(Array(
            ['stop_id', 'stop_code', 'stop_name', 'stop_desc', 'stop_lat', 'stop_lon', 'zone_id', 'stop_url', 'location_type', 'parent_station', 'stop_timezone', 'wheelchair_boarding'],
            ...stations.map((s) => [s.id, '', s.name, '', s.coordinates.latitude, s.coordinates.longitude, '', '', 0, '', '', ''])
        )),
        routes: toStream(Array(
            ['route_id', 'agency_id', 'route_short_name', 'route_long_name', 'route_desc', 'route_type', 'route_url', 'route_color', 'route_text_color'],
            ...trainNumbers.map((n) => [n.trainNumber, 'cp', ''+n.trainNumber, ''+n.trainNumber, '', 2, '', '', '']) // todo: type
        )),
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
    await fetchTrips(trainNumbers, gtfs, dates)
    gtfs.trips.end()
    gtfs.stop_times.end()
    gtfs.calendar_dates.end()
    return gtfs
}

const build = (startDate, endDate) => fetch(startDate, endDate)

module.exports = build
