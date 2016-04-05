#!/usr/bin/env node

'use strict';

const argv = require('minimist')(process.argv.slice(2));
const sync = require('../');

if (!argv._.length) {
    console.log('Please specify a playlist id');
    process.exit(1);
}

const options = {};

if (argv.bitrate) options.bitrate = argv.bitrate;
if (argv.downloads) options.downloads = argv.downloads;
if (argv.interval) options.interval = argv.interval;

console.log('Starting update...');
sync(argv._[0], options);
