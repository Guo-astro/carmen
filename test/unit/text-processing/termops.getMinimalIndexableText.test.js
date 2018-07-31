'use strict';
const termops = require('../../../lib/text-processing/termops');
const token = require('../../../lib/text-processing/token');
const test = require('tape');

test('termops.getMinimalIndexableText', (t) => {
    let replacer;
    let doc;
    let texts;

    replacer = token.createReplacer({});
    doc = { properties: { 'carmen:text': 'Main Street' } };
    texts = [
        ['main', 'street']
    ];
    t.deepEqual(termops.getMinimalIndexableText(replacer, [], doc), texts, 'creates indexableText');

    replacer = token.createReplacer({ 'Street':'St' });
    doc = { properties: { 'carmen:text': 'Main Street' } };
    texts = [
        ['main', 'st']
    ];
    t.deepEqual(termops.getMinimalIndexableText(replacer, [], doc), texts, 'creates contracted phrases using geocoder_tokens');

    replacer = token.createReplacer({ 'Street':'St' });
    doc = { properties: { 'carmen:text': 'Main Street, main st' } };
    texts = [
        ['main', 'st']
    ];
    t.deepEqual(termops.getMinimalIndexableText(replacer, [], doc), texts, 'dedupes phrases');

    replacer = token.createReplacer({ 'Street':'St', 'Lane':'Ln' });
    doc = { properties: { 'carmen:text': 'Main Street Lane' } };
    texts = [
        ['main', 'st', 'ln']
    ];
    t.deepEqual(termops.getMinimalIndexableText(replacer, [], doc), texts, 'dedupes phrases');

    replacer = token.createReplacer({ 'dix-huitième':'18e' });
    doc = { properties: { 'carmen:text': 'Avenue du dix-huitième régiment' } };
    texts = [['avenue', 'du', '18e', 'régiment']];
    t.deepEqual(termops.getMinimalIndexableText(replacer, [], doc), texts, 'hypenated replacement');

    replacer = token.createReplacer({});
    doc = {
        properties: {
            'carmen:text':'Main Street',
            'carmen:addressnumber': [[1, 10, 100, 200]]
        }
    };
    texts = [
        ['2##', 'main', 'street'],
        ['1##', 'main', 'street'],
        ['##', 'main', 'street'],
        ['#', 'main', 'street'],
    ];
    t.deepEqual(termops.getMinimalIndexableText(replacer, [],  doc), texts, 'with range');

    // sets indexDegens to false for translated text
    replacer = token.createReplacer({});
    doc = { properties: { 'carmen:text': 'Main Street', 'carmen:text_es': 'El Main Street' } };
    texts = [
        ['main', 'street'],
        ['el', 'main', 'street']
    ];
    t.deepEqual(termops.getMinimalIndexableText(replacer, [], doc), texts, 'creates indexableText');

    // doesn't indexDegens for synonyms
    replacer = token.createReplacer({});
    doc = { properties: { 'carmen:text': 'Latveria,Republic of Latveria' } };
    texts = [
        ['latveria'],
        ['republic', 'of', 'latveria']
    ];
    t.deepEqual(termops.getMinimalIndexableText(replacer, [], doc), texts, 'creates indexableText w/ synonyms');

    t.end();
});

