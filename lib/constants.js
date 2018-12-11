'use strict';
/**
 * Coordinate with
 * the documentation and sales team before changing these values.
 */
module.exports = {
    MAX_QUERY_CHARS: 256,
    MAX_QUERY_TOKENS: 20,
    // proximity radius (in miles) used in spatialmatch to call coalesce
    COALESCE_PROXIMITY_RADIUS: 200,
    // proximity radiuses (in miles) used in verifymatch
    Z6_PROXIMITY_RADIUS: 1800,
    Z12_PROXIMITY_RADIUS: 600,
    Z14_PROXIMITY_RADIUS: 100,
    MAX_TEXT_SYNONYMS: 10,
    MIN_CORRECTION_LENGTH: 4,
    // Though spatialmatches are sliced to SPATIALMATCH_STACK_LIMIT elements
    // after stackable, the stackable limit should be higehr to leave some
    // headroom as this step does not include type filtering.
    STACKABLE_LIMIT: 100,
    SPATIALMATCH_STACK_LIMIT: 30,
    MAX_CORRECTION_LENGTH: 8,
    VERIFYMATCH_STACK_LIMIT: 20,
    // Regexp pattern to determine word boundaries when making token replacements
    // detects all punctuation including unicode punctuation plus all whitespace
    WORD_BOUNDARY: "[\\s\\u2000-\\u206F\\u2E00-\\u2E7F\\\\'!\"#$%&()*+,\\-.\\/:;<=>?@\\[\\]^_`{|}~]"
};
