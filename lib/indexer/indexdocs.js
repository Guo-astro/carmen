'use strict';
const cover = require('@mapbox/tile-cover');
const grid = require('../util/grid');
const token = require('../util/token');
const termops = require('../util/termops');
const tilebelt = require('@mapbox/tilebelt');
const centroid = require('@turf/point-on-feature');
const DEBUG = process.env.DEBUG;
const extent = require('@turf/bbox');
const point = require('@turf/helpers').point;
const linestring = require('@turf/helpers').lineString;
const geojsonHint = require('@mapbox/geojsonhint');
const feature = require('../util/feature');
const center2zxy = require('../util/proximity').center2zxy;
const cl = require('../util/closest-lang');
const TIMER = process.env.TIMER;
const rewind = require('geojson-rewind');
const bbox = require('../util/bbox');
const constants = require('../constants');

module.exports = {};
module.exports = indexdocs;
module.exports.loadDoc = loadDoc;
module.exports.parseDocs = parseDocs;
module.exports.runChecks = runChecks;
module.exports.standardize = standardize;
module.exports.verifyCenter = verifyCenter;
module.exports.isOutlierDetected = isOutlierDetected;
module.exports.generateFrequency = generateFrequency;

/**
 * Index documents, stored in a CarmenSource
 *
 * @param {Array<Feature>} docs - an array of GeoJSON `Feature` documents
 * @param {CarmenSource} source - the source that is to be indexed
 * @param {object} options - options
 * @param {number} options.zoom - the max zoom level for the index
 * @param {Object<string, string>} options.geocoder_tokens - Mapping to replace tokens with other tokens. After a text string is tokenized, any token that matches a key in this mapping will be replaced with the corresponding value. Helpful for abbreviations, eg. "Streets" => "St"
 * @param {Object<string, string>} options.tokens - mapping from string patterns to strings. Patterns are replaced with strings when found in queries. This is treated as a global token replacement map: any substring matching a pattern key (which can be regex) is replaced with the associated string value. Helpful for replacing strings within and across tokens, eg "talstrasse" => "tal str".
 * @param {function} callback - a callback function
 * @returns {void} returns nothing
 */
function indexdocs(docs, source, options, callback) {
    if (typeof options.zoom !== 'number')
        return callback(new Error('index has no zoom'));
    if (options.zoom < 0)
        return callback(new Error('zoom must be greater than 0 --- zoom was ' + options.zoom));
    if (options.zoom > 14)
        return callback(new Error('zoom must be less than 15 --- zoom was ' + options.zoom));
    if (typeof callback !== 'function')
        return callback(new Error('callback required'));
    if (options.tokens) {
        options.tokens = token.createGlobalReplacer(options.tokens);
    }

    const full = { grid: {}, text:[], docs:[], vectors:[] };
    if (source && source.use_normalization_cache) full.normalizations = {};
    const settings = { source:source, zoom: options.zoom, geocoder_tokens: options.geocoder_tokens, tokens: options.tokens };

    try {
        parseDocs(docs, settings, full);
    } catch (err) {
        return callback(err);
    }

    if (TIMER) console.time('update:freq');
    let freq;
    try {
        freq = generateFrequency(docs, source.token_replacer, options.tokens, parseInt(source.maxscore), source.lang.has_languages);
    } catch (err) {
        return callback(err);
    }

    if (TIMER) console.timeEnd('update:freq');

    const ids = Object.keys(freq);

    for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        freq[id][0] = (source._geocoder.freq.get(id) || [0])[0] + freq[id][0];
        // maxscore should not be cumulative.
        if (id === '__MAX__') {
            freq[id][0] = (source._geocoder.freq.get(id) || [0,0])[0] || freq[id][0];
        }
        source._geocoder.freq.set(id, freq[id]);
    }
    if (TIMER) console.time('update:indexdocs');

    if (!source.lang.fallback_matrix) {
        const matrix = cl.fallbackMatrix(source.lang.languages.filter((l) => { return l !== 'default'; }));
        source.lang.fallback_matrix = matrix;
    }

    for (let f_it = 0; f_it < docs.length; f_it++) {
        loadDoc(freq, full, docs[f_it], source, options.zoom, source.indexing_replacer, options.tokens);
    }
    callback(null, full);
}

function parseDocs(docs, settings, full) {
    const zoom = settings.zoom;

    for (let i = 0; i < docs.length; i++) {
        docs[i] = standardize(docs[i], zoom);
        docs[i].properties.id = docs[i].id;
        let c_it, addr_it, feat;

        // Create vectorizable version of doc
        if (docs[i].properties['carmen:addressnumber']) {
            for (c_it = 0; c_it < docs[i].properties['carmen:addressnumber'].length; c_it++) {
                if (!docs[i].properties['carmen:addressnumber'][c_it]) continue;
                for (addr_it = 0; addr_it < docs[i].properties['carmen:addressnumber'][c_it].length; addr_it++) {
                    feat = point(docs[i].geometry.geometries[c_it].coordinates[addr_it], feature.storableProperties(docs[i].properties, 'vector'));
                    feat.id = docs[i].id;
                    full.vectors.push(feat);
                }
            }
        }

        if (docs[i].properties['carmen:rangetype']) {
            for (c_it = 0; c_it < docs[i].geometry.geometries.length; c_it++) {
                if (docs[i].geometry.geometries[c_it].type !== 'MultiLineString') continue;
                for (addr_it = 0; addr_it < docs[i].geometry.geometries[c_it].coordinates.length; addr_it++) {
                    feat = linestring(docs[i].geometry.geometries[c_it].coordinates[addr_it], feature.storableProperties(docs[i].properties, 'vector'));
                    feat.id = docs[i].id;
                    full.vectors.push(feat);
                }
            }
        }

        if (!docs[i].properties['carmen:addressnumber'] && !docs[i].properties['carmen:rangetype']) {
            full.vectors.push({
                id: docs[i].id,
                type: 'Feature',
                geometry: docs[i].geometry,
                properties: feature.storableProperties(docs[i].properties, 'vector')
            });
        }
    }
}

function runChecks(doc) {
    const geojsonErr = geojsonHint.hint(doc);

    if (!doc.id) {
        throw Error('doc has no id');
    } else if (geojsonErr.length) {
        for (let err_it = 0; err_it < geojsonErr.length; err_it++) {
            if (geojsonErr[err_it].level === 'message') {
            // It's good practice to follow these warnings but required
                console.warn(geojsonErr[err_it].message + ' on id:' + doc.id);
            } else if (!geojsonErr[err_it].message.match(/GeometryCollection with a single geometry/)) {
                throw Error(geojsonErr[err_it].message + ' on id:' + doc.id);
            // Throw error for everything else except single geom GeometryCollection as we use these for pt/itp addresses
            }
        }
    } else if (!doc.geometry) {
        throw Error('doc has no geometry on id: ' + doc.id);
    } else if (!doc.properties) {
        throw Error('doc has no properties on id:' + doc.id);
    } else if (!doc.properties['carmen:text']) {
        throw Error('doc has no carmen:text on id:' + doc.id);
    } else if (doc.properties['carmen:text'].split(',').length > constants.MAX_TEXT_SYNONYMS && (doc.properties['carmen:addressnumber'] || doc.properties['carmen:rangetype'])) {
        throw Error('doc\'s carmen:text on id:' + doc.id + ' has more than the allowed ' + constants.MAX_TEXT_SYNONYMS + ' synonyms');
    } else if (doc.properties['carmen:geocoder_stack'] && typeof doc.properties['carmen:geocoder_stack'] !== 'string') {
        throw Error('geocoder_stack must be a string value');
    }
    if (doc.geometry.type === 'Polygon' || doc.geometry.type === 'MultiPolygon') {
        // check for Polygons or Multipolygons with too many vertices
        let vertices = 0;
        let ringCount;
        if (doc.geometry.type === 'Polygon') {
            ringCount = doc.geometry.coordinates.length;
            for (let i = 0; i < ringCount; i++) {
                vertices += doc.geometry.coordinates[i].length;
            }
        } else {
            const polygonCount = doc.geometry.coordinates.length;
            for (let k = 0; k < polygonCount; k++) {
                ringCount = doc.geometry.coordinates[k].length;
                for (let j = 0; j < ringCount; j++) {
                    vertices += doc.geometry.coordinates[k][j].length;
                }
            }
        }
        if (vertices > 50000) {
            throw Error('Polygons may not have more than 50k vertices. Simplify your polygons, or split the polygon into multiple parts on id:' + doc.id);
        }
    }
}

function standardize(doc, zoom) {
    if (doc.geometry && (doc.geometry.type === 'Polygon' || doc.geometry.type === 'MultiPolygon')) {
        doc = rewind(doc);
    }

    // Requires MultiPolygons to be in proper winding order
    runChecks(doc, zoom);

    let tiles = [];
    if (doc.geometry.type === 'GeometryCollection' && !doc.properties['carmen:zxy']) {
        doc.properties['carmen:zxy'] = [];
        tiles = [];
        for (let feat_it = 0; feat_it < doc.geometry.geometries.length; feat_it++) {
            tiles = tiles.concat(cover.tiles(doc.geometry.geometries[feat_it], { min_zoom: zoom, max_zoom: zoom }));
        }
        tiles.forEach((tile) => {
            doc.properties['carmen:zxy'].push(tile[2] + '/' + tile[0] + '/' + tile[1]);
        });
    } else if (!doc.properties['carmen:zxy']) {
        tiles = cover.tiles(doc.geometry, { min_zoom: zoom, max_zoom: zoom });
        doc.properties['carmen:zxy'] = [];
        tiles.forEach((tile) => {
            doc.properties['carmen:zxy'].push(tile[2] + '/' + tile[0] + '/' + tile[1]);
        });
    } else {
        doc.properties['carmen:zxy'].forEach((tile) => {
            tile = tile.split('/');
            tiles.push([tile[1], tile[2], tile[0]]);
        });
    }

    // if an outlier is detected in address numbers for example in [1,2,3,5000], 5000 is considered an outlier, then drop interpolation for it
    if (doc.properties['carmen:addressnumber'] && doc.geometry.type === 'GeometryCollection') {
        if (isOutlierDetected(doc.properties['carmen:addressnumber'])) {
            console.warn('address cluster contains addressnumbers outside the threshold, drop interpolation for address cluster');
            const interpolationProperties = ['carmen:lfromhn','carmen:ltohn', 'carmen:parityr', 'carmen:rfromhn','carmen:rtohn', 'carmen:parityl'];

            // set interpolation properties values to null, for example: "carmen:parityr":[["O", "O" ,null ,null ,null], null] would become "carmen:parityr":[[null, null ,null ,null ,null], null]
            interpolationProperties.forEach((p) => {
                if (doc.properties[p]) {
                    for (let i = 0; i < doc.properties[p].length; i++) {
                        if (doc.properties[p][i] != null) {
                            doc.properties[p][i] = doc.properties[p][i].fill(null);
                        }
                        doc.properties[p][i] = doc.properties[p][i];
                    }
                }
            });
        }
    }

    if (!doc.properties['carmen:center'] || !verifyCenter(doc.properties['carmen:center'], tiles)) {
        console.warn('carmen:center did not fall within the provided geometry for %s (%s). Calculating new point on surface.',
            doc.id, doc.properties['carmen:text']);
        doc.properties['carmen:center'] = centroid(doc.geometry).geometry.coordinates;
        if (!verifyCenter(doc.properties['carmen:center'], tiles)) {
            throw Error('Invalid carmen:center provided, and unable to calculate corrected centroid. Verify validity of doc.geometry for doc id:' + doc.id);
        } else {
            console.warn('new: carmen:center: ', doc.properties['carmen:center']);
            console.warn('new: zxy:    ', doc.properties['carmen:zxy']);
        }
    }

    // Standardize all addresses to GeometryCollections
    doc = feature.addrTransform(doc);

    if (!doc.bbox && (doc.geometry.type === 'MultiPolygon' || doc.geometry.type === 'Polygon')) {
        const boundingBox = extent(doc.geometry);
        const bboxWidth = boundingBox[2] - boundingBox[0];
        if (bboxWidth < 180) {
            doc.bbox = boundingBox;
        } else {
            doc.bbox = bbox.crossAntimeridian(doc.geometry, boundingBox);
        }
    }

    // zxy must be set at this point
    if (!doc.properties['carmen:zxy']) {
        throw Error('doc.properties[\'carmen:zxy\'] undefined, failed indexing, doc id:' + doc.id);
    }

    // Limit carmen:zxy length to 10000 covers.
    // Stopgap: If covers exceed this amount drop covers furthest from
    // the center of this feature. This breaks forward geocode stacking
    // for any of the dropped covers.
    if (doc.properties['carmen:zxy'] && doc.properties['carmen:zxy'].length > 10000) {
        console.warn('carmen:zxy exceeded 10000, truncating to 10000 (doc id: %s, text: %s)', doc.id, doc.properties['carmen:text']);
        const centerCover = center2zxy(doc.properties['carmen:center'], zoom);
        const sortedCovers = doc.properties['carmen:zxy'].slice(0);
        sortedCovers.sort((a, b) => {
            a = a.split('/');
            b = b.split('/');
            const aDist = Math.sqrt(Math.pow(centerCover[1] - parseInt(a[1],10),2) + Math.pow(centerCover[2] - parseInt(a[2],10),2));
            const bDist = Math.sqrt(Math.pow(centerCover[1] - parseInt(b[1],10),2) + Math.pow(centerCover[2] - parseInt(b[2],10),2));
            return aDist - bDist;
        });
        doc.properties['carmen:zxy'] = sortedCovers.slice(0,10000);
    }
    return doc;
}

function loadDoc(freq, patch, doc, source, zoom, token_replacer, globalTokens) {
    const xy = [];
    let l = doc.properties['carmen:zxy'].length;
    const coverId = termops.feature(doc.id.toString());

    while (l--) {
        const zxy = doc.properties['carmen:zxy'][l].split('/');
        zxy[1] = parseInt(zxy[1],10);
        zxy[2] = parseInt(zxy[2],10);
        if (zxy[1] < 0 || zxy[2] < 0) continue;
        xy.push({ x:zxy[1], y:zxy[2] });
    }

    const maxScore = freq['__MAX__'][0] || 0;
    const scaledScore = termops.encode3BitLogScale(doc.properties['carmen:score'], maxScore) || 0;

    const texts = termops.getIndexableText(token_replacer, globalTokens, doc, source ? source.use_normalization_cache : false);
    const allPhrases = new Map();
    let phrase, phraseObj, languages, y, variants = new Map(); // eslint-disable-line prefer-const

    for (let x = 0; x < texts.length; x++) {
        const phrases = termops.getIndexablePhrases(texts[x].tokens, freq);

        for (y = 0; y < phrases.length; y++) {
            phrase = phrases[y].phrase;
            if (!allPhrases.has(phrase)) allPhrases.set(phrase, { languages: new Set(), phrase: phrases[y] });
            phraseObj = allPhrases.get(phrase);

            // the same text may occur multiple times with different relevances; choose the highest possible
            // relevance for this phrase
            if (phrases[y].relev > phraseObj.phrase.relev) phraseObj.phrase.relev = phrases[y].relev;

            texts[x].languages.forEach((l) => { phraseObj.languages.add(l); });

            if (DEBUG && !phrases[y].degen) {
                console.warn('[%d] phrase: %s @ %d', doc.id, phrases[y].text, phrases[y].relev);
            }
        }

        if (texts[x].variants) {
            for (y = 0; y < texts[x].variants.length; y++) {
                variants.set(termops.encodableText(texts[x].variants[y].join(' ')), termops.encodableText(texts[x].tokens.join(' ')));
            }
        }
    }

    // here, we'll look at all the languages represented in our current set of phrases
    // and for any that aren't represented but are in our source list, we'll pick the closest
    // language we do have using our precomputed fallback matrix, and add the missing language's tag to
    // the existing phrases
    const phrasesByLanguage = new Map();
    for (const phraseValue of allPhrases.values()) {
        for (const phraseLang of phraseValue.languages) {
            if (!phrasesByLanguage.has(phraseLang)) phrasesByLanguage.set(phraseLang, []);
            phrasesByLanguage.get(phraseLang).push(phraseValue);
        }
    }

    if (source.lang.has_languages) {
        for (const lang of source.lang.languages) {
            if (lang === 'all') continue;
            if (lang === 'default') continue;
            if (!phrasesByLanguage.has(lang)) {
                for (const candidate of source.lang.fallback_matrix.get(lang)) {
                // at this point we know a language we're missing (lang)
                // and the closest language to it that we do have (candidate)
                // so iterate over each phrase of language candidate
                // and make it also a phrase of lang
                    if (phrasesByLanguage.has(candidate)) {
                        for (const item of phrasesByLanguage.get(candidate)) {
                            item.languages.add(lang);
                        }
                        break;
                    }
                }
            }
        }
    }

    for (const phraseItem of allPhrases) {
        phrase = phraseItem[0];
        phraseObj = phraseItem[1].phrase;
        languages = phraseItem[1].languages;

        const langList = Array.from(languages).sort().join(',');

        patch.grid[phrase] = patch.grid[phrase] || new Map();
        const gridPatch = patch.grid[phrase];

        if (!gridPatch.has(langList)) gridPatch.set(langList, []);
        l = xy.length;

        while (l--) {
            let encoded = null;
            try {
                encoded = grid.encode({
                    id: coverId,
                    x: xy[l].x,
                    y: xy[l].y,
                    relev: phraseObj.relev,
                    score: scaledScore
                });
            } catch (err) {
                console.warn(err.toString() + ', doc id: ' + doc.id);
            }
            if (encoded) gridPatch.get(langList).push(encoded);
        }

        if (gridPatch.size) {
            patch.grid[phrase] = gridPatch;
            patch.text.push(phraseObj.text);
            if (patch.normalizations) {
                for (const v of variants) {
                    patch.normalizations[v[0]] = v[1];
                }
            }
        }
    }
    patch.docs.push(doc);
    return doc;
}

function verifyCenter(center, tiles) {
    let found = false;
    let i = 0;
    while (!found && i < tiles.length) {
        const bbox = tilebelt.tileToBBOX(tiles[i]);
        if (center[0] >= bbox[0] && center[0] <= bbox[2] && center[1] >= bbox[1] && center[1] <= bbox[3] && center[0] !== null && center[1] !== null) {
            found = true;
        }
        i++;
    }
    return found;
}

function generateFrequency(docs, replacer, globalTokens, maxScore) {
    const freq = {};
    // Uses freq[0] as a convention for storing total # of docs.
    // Reserved for this use by termops.encodeTerm
    freq['__COUNT__'] = [0];

    // Uses freq[1] as a convention for storing max score.
    // Reserved for this use by termops.encodeTerm
    freq['__MAX__'] = [0];

    for (let i = 0; i < docs.length; i++) {
        if (!docs[i].properties['carmen:text']) {
            throw new Error('doc has no carmen:text');
        }
        // set max score
        freq['__MAX__'][0] = maxScore || Math.max(freq['__MAX__'][0], docs[i].properties['carmen:score'] || 0);

        const texts = termops.getIndexableText(replacer, globalTokens, docs[i]);

        for (let x = 0; x < texts.length; x++) {
            const terms = termops.terms(texts[x].tokens);

            for (let k = 0; k < terms.length; k++) {
                const id = terms[k];
                freq[id] = freq.hasOwnProperty(id) ? freq[id] : [0];
                freq[id][0]++;
                freq['__COUNT__'][0]++;
            }
        }
    }
    return freq;
}

/**
*isOutlierDetected uses tuckey's fences formula to calculate whether there are outliers in a given set - https://en.wikipedia.org/wiki/Outlier
*
* @param {Array} array of addressnumbers in a cluster
*
*/

function isOutlierDetected(addressnumber) {
    const addresses = [];
    let quartile1, quartile3, upperLimit, lowerLimit;

    for (let i = 0; i < addressnumber.length; i++) {
        if (addressnumber[i] != null) {
            const sortedArray = addressnumber[i].map((num) => parseInt(num)).filter((num) => !isNaN(num)).sort((a,b) => a - b);
            addresses.push(sortedArray);
            // Calculates the two quartiles needed for the formula: {[Q1-k(Q3-Q1),Q3+k(Q3-Q1)]} using percentiles
            quartile1 = Math.floor(percentile(sortedArray, 0.25));
            quartile3 = Math.floor(percentile(sortedArray, 0.75));

            // The value of k in the equation is usually 1.5, can modify if this seems too aggressive
            lowerLimit = quartile1 - (1.5 * (quartile3 - quartile1));
            upperLimit = quartile3 + (1.5 * (quartile3 - quartile1));

            const containsOutliers = sortedArray.filter((x) => { return (x < lowerLimit || x > upperLimit); });

            if (containsOutliers.length !== 0) {
                return true;
            }
            else return false;
        }
    }
}

/**
*percentile - Returns the value at a given percentile in a sorted numeric array
*
* @param {Array} array of addressnumbers in a cluster
* @param {num} percentile value
*/

function percentile(arr, p) {
    if (arr.length === 0) return 0;
    if (typeof p !== 'number') throw new TypeError('p must be a number');
    if (p <= 0) return arr[0];
    if (p >= 1) return arr[arr.length - 1];

    const index = (arr.length - 1) * p;
    const lower = Math.floor(index),
        upper = lower + 1,
        weight = index % 1;

    if (upper >= arr.length) return arr[lower];
    return arr[lower] * (1 - weight) + arr[upper] * weight;
}
