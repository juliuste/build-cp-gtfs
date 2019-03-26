#!/usr/bin/env node
'use strict'

const mri = require('mri')
const fs = require('fs')
const { resolve } = require('path')
const isEmpty = require('is-empty-file')
const { DateTime } = require('luxon')
const stringify = require('csv-stringify')
const isString = require('lodash/isString')
const pump = require('pump')
const pify = require('pify')

const pMkdir = pify(fs.mkdir)
const pUnlink = pify(fs.unlink)
const pPump = pify(pump)

const generateGTFS = require('.')
const pkg = require('./package.json')

const argv = mri(process.argv.slice(2), {
	boolean: ['help', 'h', 'version', 'v']
})

const opt = {
	start: argv._[0],
	end: argv._[1],
	directory: argv._[2],
	help: argv.help || argv.h,
	version: argv.version || argv.v
}

if (opt.help === true) {
	process.stdout.write(`
build-cp-gtfs [options] start-date end-date gtfs-directory

Arguments:
    start-date			Feed start date: YYYY-MM-DD (in Europe/Lisbon timezone)
    end-date			Feed end date: YYYY-MM-DD (included, in Europe/Lisbon timezone)
	gtfs-directory		Directory where the generated GTFS will be placed

Options:
    --help       -h  Show this help message.
    --version    -v  Show the version number.

`)
	process.exit(0)
}

if (opt.version === true) {
	process.stdout.write(`${pkg.version}\n`)
	process.exit(0)
}

const main = async (opt) => {
	if (!isString(opt.start) || !isString(opt.end) || opt.start.length !== 10 || opt.end.length !== 10) {
		throw new Error('missing or invalid `start-date` or `end-date` parameter, must look like this: `YYYY-MM-DD`')
	}
	const start = DateTime.fromFormat(opt.start, 'yyyy-MM-dd', { zone: 'Europe/Lisbon' }).toJSDate()
	const end = DateTime.fromFormat(opt.end, 'yyyy-MM-dd', { zone: 'Europe/Lisbon' }).toJSDate()
	if (+start > +end) throw new Error('`end` cannot be before `start`')

	const gtfs = await generateGTFS(start, end)

	// create directory if necessary
	const directory = resolve(opt.directory)
	await (pMkdir(directory, { recursive: true }).catch(error => {
		if (error.code !== 'EEXIST') throw error
	}))

	const jobs = Object.keys(gtfs).map(file => {
		const writeStream = fs.createWriteStream(resolve(directory, `${file}.txt`))
		return pPump(gtfs[file], stringify({ delimiter: ',' }), writeStream)
	})
	await Promise.all(jobs)

	const actions = await Promise.all(Object.keys(gtfs).map(file => {
		const filePath = resolve(directory, `${file}.txt`)
		if (isEmpty(filePath)) { // @todo
			return pUnlink(filePath).then(() => 'deleted')
		}
		return Promise.resolve('written')
	}))
	console.log(`${actions.filter(a => a === 'written').length} files written`)
}

main(opt)
	.catch(console.error)
