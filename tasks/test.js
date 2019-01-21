'use strict';

/**
 * PLAYGROUND - WILL DELETE ONCE FINALIZED
 * // TODO: delete this file
 * // TODO: handle conversion from date and datetime
 * // TODO: look at other props for calendars that share all details
 * // TODO: figure out publish steps
 */

/* eslint-env mocha */
/* eslint-disable func-names, prefer-arrow-callback */
const icsExpander = require('../dist');
const IcalExpander = icsExpander.IcalExpander;
const fs = require('fs');
const assert = require('assert');
const path = require('path');

// NOTE: Run with TZ=Etc/UTC mocha ical-parser.js
// https://github.com/mozilla-comm/ical.js/issues/257

async function run() {
  const calendar = fs.readFileSync(path.join(__dirname, 'test.ics'), 'utf-8');
  // const betweenTestCalendar = fs.readFileSync(path.join(__dirname, '../test/between_dates.ics'), 'utf-8');

  registerTypes();

  const icalExpander = new IcalExpander({ ics: calendar, convertOutput: true, skipInvalidDates: true }).all();

  console.log('HERE');
}

function registerTypes() {
  const props = {
    'X-MICROSOFT-CDO-APPT-SEQUENCE': {
      defaultType: 'integer',
    },
    'X-MICROSOFT-CDO-BUSYSTATUS': {
      defaultType: 'text',
    },
    'X-MICROSOFT-CDO-INTENDEDSTATUS': {
      defaultType: 'text',
    },
    'X-MICROSOFT-CDO-ALLDAYEVENT': {
      defaultType: 'boolean',
    },
    'X-MICROSOFT-CDO-IMPORTANCE': {
      defaultType: 'integer',
    },
    'X-MICROSOFT-CDO-INSTTYPE': {
      defaultType: 'integer',
    },
    'X-MICROSOFT-DONOTFORWARDMEETING': {
      defaultType: 'boolean',
    },
    'X-MICROSOFT-DISALLOW-COUNTER': {
      defaultType: 'boolean',
    },
  };

  icsExpander.registerProperties(props);
}

run();
