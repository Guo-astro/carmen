'use strict';

// this is *either* at least three letters (with optional diacritics) followed by at least one number
// *or* at least one number followed by at least four letters (ditto) -- four to avoid abbreviations like 7ème
const NUMBER_LETTER_MATCHER = /^(([A-Za-zÀ-ÖØ-öø-ÿ]{3,})([0-9]+)|([0-9]+)([A-Za-zÀ-ÖØ-öø-ÿ]{4,}))$/;
function numbersPlusLetters(query) {
    const newTokens = [];
    let found = false;
    for (const token of query.tokens) {
        const match = token.match(NUMBER_LETTER_MATCHER);
        if (match) {
            found = true;
            // either 2 and 3 or 4 and 5 will be populated depending which flavor
            newTokens.push(
                (match[2] ? [match[2], match[3]] : [match[4], match[5]]).join(' ')
            );
        } else {
            newTokens.push(token);
        }
    }

    if (found) {
        return { ...query, tokens: newTokens };
    }
    return false;
}

module.exports = { correctors: [numbersPlusLetters] };
