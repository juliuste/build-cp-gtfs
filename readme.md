# build-cp-gtfs

Build [GTFS](https://developers.google.com/transit/gtfs/) from the [Comboios de Portugal](https://cp.pt) (CP, Portugese Railways) REST API using the [comboios](https://github.com/juliuste/comboios) JS module. Please ask CP for permission before using this module in production.

*Work in progress. This software is not stable yet. See the [to-do](#to-do) section.*

[![npm version](https://img.shields.io/npm/v/build-cp-gtfs.svg)](https://www.npmjs.com/package/build-cp-gtfs)
[![Build Status](https://travis-ci.org/juliuste/build-cp-gtfs.svg?branch=master)](https://travis-ci.org/juliuste/build-cp-gtfs)
[![Greenkeeper badge](https://badges.greenkeeper.io/juliuste/build-cp-gtfs.svg)](https://greenkeeper.io/)
[![dependency status](https://img.shields.io/david/juliuste/build-cp-gtfs.svg)](https://david-dm.org/juliuste/build-cp-gtfs)
[![dev dependency status](https://img.shields.io/david/dev/juliuste/build-cp-gtfs.svg)](https://david-dm.org/juliuste/build-cp-gtfs#info=devDependencies)
[![license](https://img.shields.io/github/license/juliuste/build-cp-gtfs.svg?style=flat)](LICENSE)
[![chat on gitter](https://badges.gitter.im/juliuste.svg)](https://gitter.im/juliuste)

## Installation

### Library

```shell
npm install --save build-cp-gtfs
```

### CLI
```shell
npm install -g build-cp-gtfs
```

## Usage

### Library

The script takes a `startDate` and an `endDate` JS `Date()` object (the feed will include the `endDate`, days will be calculated in `Europe/Lisbon` timezone) and return a [`Promise`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/promise) that will resolve in an object containing GTFS object streams:

```js
const generateGTFS = require('build-cp-gtfs')

generateGTFS(new Date("2017-12-01T00:00:00"), new Date("2018-05-31T00:00:00"))
.then((gtfs) => {
    gtfs.routes.pipe(someStream)
    gtfs.stops.pipe(anotherStream)
})
```

The GTFS object contains the following streams:
- `agency`
- `stops`
- `routes`
- `trips`
- `stop_times`
- `calendar_dates`

### CLI

```shell
build-cp-gtfs start-date end-date directory
build-cp-gtfs 01.12.2017 31.05.2018 ~/cp-gtfs
```

## To do

- minify/optimize gtfs `calendar_dates` to `calendar`

[@juliuste](https://github.com/juliuste) will be working on this the next few days.

## See also

- [comboios](https://github.com/juliuste/comboios) - Comboios de Portgal API client in JavaScript
- [db-api-to-gtfs](https://github.com/patrickbr/db-api-to-gtfs) - Build GTFS from the Deutsche Bahn (DB, German Railways) REST API

## Contributing

If you found a bug, want to propose a feature or feel the urge to complain about your life, feel free to visit [the issues page](https://github.com/juliuste/build-cp-gtfs/issues).
