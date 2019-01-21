'use strict';
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (Object.hasOwnProperty.call(mod, k)) result[k] = mod[k];
    result["default"] = mod;
    return result;
};
exports.__esModule = true;
var ICAL = __importStar(require("ical.js"));
var areTimezoneRegistered = false;
var registeredTimezones;
var IcalExpander = /** @class */ (function () {
    function IcalExpander(opts) {
        this.data = {
            events: [],
            occurrences: []
        };
        this.maxIterations = opts.maxIterations != null && opts.maxIterations != undefined ? opts.maxIterations : 1000;
        this.skipInvalidDates = opts.skipInvalidDates != null && opts.skipInvalidDates != undefined ? opts.skipInvalidDates : false;
        this.convertOutput = opts.convertOutput ? true : false;
        this.jCalData = ICAL.parse(opts.ics);
        this.component = new ICAL.Component(this.jCalData);
        this.events = this.component.getAllSubcomponents('vevent').map(function (vevent) { return new ICAL.Event(vevent); });
        if (this.skipInvalidDates) {
            this.events = this.events.filter(function (evt) {
                try {
                    evt.startDate.toJSDate();
                    evt.endDate.toJSDate();
                    return true;
                }
                catch (err) {
                    // skipping events with invalid time
                    return false;
                }
            });
        }
        if (!areTimezoneRegistered) {
            this.timezones = [];
            this.registerTimezonesFromICS(this.component);
        }
        else {
            this.timezones = registeredTimezones;
        }
    }
    IcalExpander.prototype.registerTimezonesFromICS = function (component) {
        var _this = this;
        this.component.getAllSubcomponents('vtimezone').forEach(function (timezoneComp) {
            try {
                _this.timezones.push(new ICAL.Timezone({
                    component: timezoneComp,
                    tzid: timezoneComp.getFirstPropertyValue('tzid')
                }));
            }
            catch (ex) {
                // error logging timezone
            }
        });
    };
    IcalExpander.prototype.isEventWithinRange = function (startTime, endTime, after, before) {
        return (!after || endTime >= after.getTime()) && (!before || startTime <= before.getTime());
    };
    IcalExpander.prototype.getTimes = function (eventOrOccurrence) {
        var startTime = eventOrOccurrence.startDate.toJSDate().getTime();
        var endTime = eventOrOccurrence.endDate.toJSDate().getTime();
        // If it is an all day event, the end date is set to 00:00 of the next day
        // So we need to make it be 23:59:59 to compare correctly with the given range
        if (eventOrOccurrence.endDate.isDate && endTime > startTime) {
            endTime -= 1;
        }
        return { startTime: startTime, endTime: endTime };
    };
    /**
     *
     * Get any events that have any part of their event within the range of after and before
     * Set after undefined or null to get all events up to before
     * Set before undefined or null to get all events that start after the after Date
     *
     * @param after
     * @param before
     */
    IcalExpander.prototype.between = function (after, before) {
        var _this = this;
        var exceptions = [];
        this.events.forEach(function (event) {
            if (event.isRecurrenceException())
                exceptions.push(event);
        });
        this.data = {
            events: [],
            occurrences: []
        };
        this.events
            .filter(function (e) { return !e.isRecurrenceException(); })
            .forEach(function (event) {
            var exdates = [];
            event.component.getAllProperties('exdate').forEach(function (exdateProp) {
                var exdate = exdateProp.getFirstValue();
                exdates.push(exdate.toJSDate().getTime());
            });
            // Recurring event is handled differently
            if (event.isRecurring()) {
                var iterator = event.iterator();
                var next = void 0;
                var i = 0;
                var _loop_1 = function () {
                    i += 1;
                    next = iterator.next();
                    if (next) {
                        var occurrence_1 = event.getOccurrenceDetails(next);
                        var _a = _this.getTimes(occurrence_1), startTime_1 = _a.startTime, endTime_1 = _a.endTime;
                        var isOccurrenceExcluded = exdates.indexOf(startTime_1) !== -1;
                        // TODO check that within same day?
                        var exception = exceptions.find(function (ex) { return ex.uid === event.uid && ex.recurrenceId.toJSDate().getTime() === occurrence_1.startDate.toJSDate().getTime(); });
                        // We have passed the max date, stop
                        if (before && startTime_1 > before.getTime())
                            return "break";
                        // Check that we are within our range
                        if (_this.isEventWithinRange(startTime_1, endTime_1, after, before)) {
                            if (exception) {
                                _this.data.events.push(exception);
                            }
                            else if (!isOccurrenceExcluded) {
                                _this.data.occurrences.push(occurrence_1);
                            }
                        }
                    }
                };
                do {
                    var state_1 = _loop_1();
                    if (state_1 === "break")
                        break;
                } while (next && (!_this.maxIterations || i < _this.maxIterations));
                return;
            }
            // Non-recurring event:
            var _a = _this.getTimes(event), startTime = _a.startTime, endTime = _a.endTime;
            if (_this.isEventWithinRange(startTime, endTime, after, before))
                _this.data.events.push(event);
        });
        if (this.convertOutput) {
            return this.getEventsAsObject();
        }
        else {
            return this.data;
        }
    };
    /**
     * Get all events that start before the provided Date
     * @param before
     */
    IcalExpander.prototype.before = function (before) {
        return this.between(undefined, before);
    };
    /**
     * Get all events that end after the provided date
     * @param after
     */
    IcalExpander.prototype.after = function (after) {
        return this.between(after);
    };
    /**
     * Get all events
     */
    IcalExpander.prototype.all = function () {
        return this.between();
    };
    IcalExpander.prototype.getEventsAsObject = function () {
        var _this = this;
        var data = {
            events: [],
            occurrences: []
        };
        data.events = this.data.events.map(this.convertEvent);
        data.occurrences = this.data.occurrences.map(function (occurrence) { return ({
            endDate: occurrence.endDate,
            item: _this.convertEvent(occurrence.item),
            recurrenceId: occurrence.recurrenceId,
            startDate: occurrence.startDate
        }); });
        return data;
    };
    IcalExpander.prototype.convertEvent = function (event) {
        return event.component.getAllProperties().reduce(function (acc, prop) {
            if (prop.isMultiValue) {
                acc[prop.name] = prop.getValues();
            }
            else {
                acc[prop.name] = prop.getFirstValue();
            }
            return acc;
        }, {});
    };
    return IcalExpander;
}());
exports.IcalExpander = IcalExpander;
/**
 * Register timezones from included JSON file
 * If timezones are included in the ICS, then they will be registered automatically on parse
 * in which case this method should not be called, as it required a performance hit when called.
 */
function registerTimezones() {
    return new Promise(function (resolve, reject) {
        Promise.resolve().then(function () { return __importStar(require('./zones-compiled.json')); }).then(function (timezones) {
            registeredTimezones = [];
            Object.keys(timezones).forEach(function (key) {
                try {
                    // TS adds "default" property, which was not in original data - ignore it
                    if (key === 'default')
                        return;
                    var icsData = timezones[key];
                    var parsed = ICAL.parse("BEGIN:VCALENDAR\nPRODID:-//tzurl.org//NONSGML Olson 2012h//EN\nVERSION:2.0\n" + icsData + "\nEND:VCALENDAR");
                    var comp = new ICAL.Component(parsed);
                    var vtimezone = comp.getFirstSubcomponent('vtimezone');
                    registeredTimezones.push(vtimezone);
                    ICAL.TimezoneService.register(vtimezone);
                }
                catch (ex) {
                    // Error loading timezone
                }
            });
            areTimezoneRegistered = true;
            resolve();
        })["catch"](function (err) {
            reject(err);
        });
    });
}
exports.registerTimezones = registerTimezones;
function resetTimezones() {
    areTimezoneRegistered = false;
    registeredTimezones = [];
}
exports.resetTimezones = resetTimezones;
function registerProperties(props) {
    Object.keys(props).forEach(function (key) { return (ICAL.design.icalendar.property[key.toLowerCase()] = props[key]); });
}
exports.registerProperties = registerProperties;
//# sourceMappingURL=index.js.map