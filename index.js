'use strict';

const fs          = require('fs-extra');
const path        = require('path-extra');
const co          = require('co');
const request     = require('co-request');
const sqlite3     = require('co-sqlite3');
const xml         = require('xml2json');
const youtube     = require('youtube-dl');
const sanitize    = require('sanitize-filename');
const child       = require('child_process');
const entities    = require('entities');
const Promise     = require('bluebird');
const req         = require('request');
const thunkify    = require('thunkify');

const remove      = thunkify(fs.remove);
const ensureDir   = thunkify(fs.ensureDir);

const schema      = 'CREATE TABLE IF NOT EXISTS downloads (playlist_id TEXT, video_id TEXT)';

const searchEntry = (playlistId, videoId) => `SELECT * FROM downloads WHERE playlist_id = "${playlistId}" and video_id = "${videoId}"`;
const insertEntry = (playlistId, videoId) => `INSERT INTO downloads VALUES ("${playlistId}", "${videoId}")`;
const convert     = (video, bitrate, temp) => `ffmpeg -y -i "${video}" -b:a ${bitrate}K -vn "${temp}" -loglevel quiet`;
const addCover    = (temp, art, mp3) => `ffmpeg -y -i "${temp}" -i "${art}" -map 0 -map 1 -c copy -id3v2_version 3 "${mp3}" -loglevel quiet`;

const defaults = {
    bitrate: 192,
    downloads: 'downloads',
    feedUrl: 'https://www.youtube.com/feeds/videos.xml?playlist_id=',
    appId: 'com.mariotacke.youtube-sync',
    interval: 1800
};

function download (method, file) {
    return new Promise((resolve, reject) => {
        method
            .on('error', (err) => reject(err))
            .on('end', () => resolve())
            .pipe(fs.createOutputStream(file));
    });
}

const update = (playlistId, options) => {
    console.log(`Updating playlist ${playlistId}`);
    const settings = Object.assign({}, defaults, options);

    co(function* () {
        yield ensureDir(`${path.datadir(settings.appId)}`);
        yield ensureDir(`${settings.downloads}`);

        const feedRequest = yield request(`${settings.feedUrl}${playlistId}`);
        const feed        = JSON.parse(xml.toJson(feedRequest.body)).feed;

        if (!feed.entry.length) return;

        const db = yield sqlite3(`${path.datadir(settings.appId)}/db.sqlite3`);

        yield db.run(schema);

        const playlistName = sanitize(entities.decodeXML(feed.title));

        for (let i = 0; i < feed.entry.length; i++) {
            const videoId   = feed.entry[i]['yt:videoId'];
            const coverUrl  = feed.entry[i]['media:group']['media:thumbnail']['url'];
            const videoUrl  = feed.entry[i]['link']['href'];
            const trackName = sanitize(entities.decodeXML(feed.entry[i]['title']));
            const row       = yield db.get(searchEntry(playlistId, videoId));

            if (row) {
                console.log(`File ${i+1} of ${feed.entry.length}: ${trackName} already exists. Skipping.`);
                continue;
            }

            console.log(`Processing file ${i+1} of ${feed.entry.length}: ${trackName}`);

            const video = `${settings.downloads}/${playlistName}/.staging/${videoId}.mp4`;
            const cover = `${settings.downloads}/${playlistName}/.staging/${videoId}.jpg`;
            const temp  = `${settings.downloads}/${playlistName}/.staging/${videoId}.mp3`;
            const mp3   = `${settings.downloads}/${playlistName}/${trackName}.mp3`;

            yield download(req(coverUrl), cover);
            yield download(youtube(videoUrl), video);

            child.execSync(convert(video, settings.bitrate, temp));
            child.execSync(addCover(temp, cover, mp3));

            yield remove(`${settings.downloads}/${playlistName}/.staging/`);

            yield db.run(insertEntry(playlistId, videoId));
        }

        yield db.close();

        console.log(`Updating again in ${settings.interval} seconds`);
        setTimeout(() => {
            update(playlistId, options);
        }, settings.interval * 1000);
    }).catch((error) => {
        console.log('An unhandled error has occured');
        console.log(error);
    });
};

module.exports = update;
